import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_INTERVAL,
  MAX_BACKUPS,
  blockSaves,
  demoState,
  lastGoodState,
  loadBackups,
  loadState,
  newId,
  restoreBackup,
  sanitize,
  saveState,
  unblockSaves,
  type SavedState,
} from '../../src/state/storage';

/** localStorage em memória (os testes rodam em node, sem browser) */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

describe('storage', () => {
  it('sanitize descarta seleção/medidas e preserva canos e trajetos', () => {
    const raw = {
      version: 1,
      defaultTier: 2,
      nodes: [{ id: 'a', type: 'sink', position: { x: 0, y: 0 }, data: { kind: 'sink' }, selected: true, measured: { width: 1, height: 1 } }],
      edges: [
        { id: 'p', type: 'pipe', source: 'x', sourceHandle: 'out-0', target: 'a', targetHandle: 'in-0', data: { tier: 2, bends: [20], anchor: [0, 0, 20, 20] }, selected: true },
        { id: 'b', source: 'x', sourceHandle: 'out-1', target: 'a', targetHandle: 'in-1', data: { tier: 1, bends: [20] } },
      ],
    };
    const s = sanitize(raw)!;
    expect(s.nodes[0]).toEqual({ id: 'a', type: 'sink', position: { x: 0, y: 0 }, data: { kind: 'sink' } });
    expect(s.edges[0]).toMatchObject({ type: 'pipe', data: { tier: 2, bends: [20], anchor: [0, 0, 20, 20] } });
    expect(s.edges[0]).not.toHaveProperty('selected');
    // trajeto sem âncora é descartado; tipo ausente vira esteira
    expect(s.edges[1]).toMatchObject({ type: 'belt', data: { tier: 1 } });
    expect(s.edges[1].data).not.toHaveProperty('bends');
    expect(s.defaultPipeTier).toBe(1);
  });

  it('sanitize recusa formato inválido', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize({ version: 2, nodes: [], edges: [] })).toBeNull();
    expect(sanitize({ version: 1, nodes: {} as unknown, edges: [] })).toBeNull();
    // um node ou esteira quebrado invalida tudo
    const ok = { id: 'a', type: 'sink', position: { x: 0, y: 0 }, data: { kind: 'sink' } };
    expect(sanitize({ version: 1, nodes: [ok, { ...ok, position: { x: NaN, y: 0 } }], edges: [] })).toBeNull();
    expect(sanitize({ version: 1, nodes: [{ ...ok, data: {} }], edges: [] })).toBeNull();
    expect(sanitize({ version: 1, nodes: [null], edges: [] })).toBeNull();
    expect(sanitize({ version: 1, nodes: [ok], edges: [{ id: 'b', source: 'a' }] })).toBeNull();
  });

  it('migra o extrator de poço antigo pra um poço com um satélite (mesmo clock, conexão mantida)', () => {
    const raw = {
      version: 1,
      defaultTier: 1,
      nodes: [
        { id: 'w', type: 'extractor', position: { x: 0, y: 0 }, data: { kind: 'extractor', extractor: 'well', resource: 'nitrogen-gas', purity: 'pure', clock: 150, rotation: 90 } },
        { id: 'k', type: 'sink', position: { x: 400, y: 0 }, data: { kind: 'sink' } },
      ],
      edges: [{ id: 'p', type: 'pipe', source: 'w', sourceHandle: 'out-0', target: 'k', targetHandle: 'in-0', data: { tier: 2 } }],
    };
    const s = sanitize(raw)!;
    expect(s.nodes[0]).toEqual({
      id: 'w',
      type: 'well',
      position: { x: 0, y: 0 },
      data: { kind: 'well', resource: 'nitrogen-gas', clock: 150, rotation: 90, satellites: ['pure'] },
    });
    // a saída do satélite 1 é a mesma out-0 de antes
    expect(s.edges[0]).toMatchObject({ source: 'w', sourceHandle: 'out-0', type: 'pipe' });
    // migrar de novo não muda nada
    expect(sanitize(JSON.parse(JSON.stringify(s)))).toEqual(s);
    // extratores de água/petróleo ficam como estão
    const water = { id: 'x', type: 'extractor', position: { x: 0, y: 0 }, data: { kind: 'extractor', extractor: 'water', resource: 'water', purity: 'normal', clock: 100 } };
    expect(sanitize({ version: 1, nodes: [water], edges: [] })!.nodes[0]).toEqual(water);
  });

  it('poço com satélites quebrados fica só com as purezas válidas', () => {
    const raw = { version: 1, nodes: [{ id: 'w', type: 'well', position: { x: 0, y: 0 }, data: { kind: 'well', resource: 'water', clock: 100, satellites: ['pure', 'x', 3] } }], edges: [] };
    expect(sanitize(raw)!.nodes[0].data).toMatchObject({ satellites: ['pure'] });
    const none = { ...raw, nodes: [{ ...raw.nodes[0], data: { kind: 'well', resource: 'water', clock: 100 } }] };
    expect(sanitize(none)!.nodes[0].data).toMatchObject({ satellites: [] });
  });

  it('guarda os cupons já impressos (inteiro positivo)', () => {
    expect(sanitize({ version: 1, nodes: [], edges: [], couponsPrinted: 12.7 })!.couponsPrinted).toBe(12);
    expect(sanitize({ version: 1, nodes: [], edges: [], couponsPrinted: -3 })).not.toHaveProperty('couponsPrinted');
  });

  it('o exemplo sobrevive ao sanitize', () => {
    const demo = demoState();
    expect(sanitize(JSON.parse(JSON.stringify(demo)))).toEqual({ ...demo, defaultPipeTier: 1 });
  });

  // o gerador cria centenas de ids no mesmo milissegundo: o contador garante que não repetem
  it('newId não repete em 2000 chamadas seguidas', () => {
    const ids = Array.from({ length: 2000 }, () => newId('b'));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('salvamento protegido e backup rotativo', () => {
  let store: ReturnType<typeof memoryStorage>;
  const T0 = 1_700_000_000_000;
  /** planta do exemplo com n nodes (pra diferenciar as versões) */
  const plant = (n: number): SavedState => {
    const demo = demoState();
    return { ...demo, defaultPipeTier: 1, nodes: demo.nodes.slice(0, n), edges: [] };
  };
  const saved = () => JSON.parse(store.data.get('satisplanner:v1') ?? 'null');

  beforeEach(() => {
    store = memoryStorage();
    vi.stubGlobal('localStorage', store);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    unblockSaves('teste');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('não grava estado inválido por cima do bom', () => {
    expect(saveState(plant(3), T0)).toBe(true);
    const broken = { ...plant(4), nodes: [...plant(3).nodes, { id: 'x', position: { x: NaN, y: 0 }, data: { kind: 'sink' } }] } as SavedState;
    expect(saveState(broken, T0 + 1000)).toBe(false);
    expect(saved().nodes).toHaveLength(3);
    expect(console.warn).toHaveBeenCalled();
  });

  it('não salva enquanto um Error Boundary estiver em erro', () => {
    saveState(plant(3), T0);
    blockSaves('teste');
    expect(saveState(plant(5), T0 + 1000)).toBe(false);
    expect(saved().nodes).toHaveLength(3);
    unblockSaves('teste');
    expect(saveState(plant(5), T0 + 2000)).toBe(true);
    expect(saved().nodes).toHaveLength(5);
  });

  it('guarda no máximo uma versão por intervalo e só as últimas MAX_BACKUPS', () => {
    saveState(plant(1), T0);
    // dentro do intervalo: salva, mas não cria versão nova
    saveState(plant(2), T0 + 1000);
    expect(loadBackups()).toHaveLength(1);
    expect(loadBackups()[0].state.nodes).toHaveLength(1);

    for (let i = 1; i <= MAX_BACKUPS + 2; i++) saveState(plant(1 + (i % 7)), T0 + i * BACKUP_INTERVAL);
    const list = loadBackups();
    expect(list).toHaveLength(MAX_BACKUPS);
    // da mais nova pra mais antiga
    expect(list[0].savedAt).toBe(T0 + (MAX_BACKUPS + 2) * BACKUP_INTERVAL);
    expect(list.map((b) => b.savedAt)).toEqual([...list.map((b) => b.savedAt)].sort((a, b) => b - a));
  });

  it('não repete versão igual nem guarda planta vazia', () => {
    saveState(plant(3), T0);
    saveState(plant(3), T0 + BACKUP_INTERVAL);
    saveState({ ...plant(0) }, T0 + 2 * BACKUP_INTERVAL);
    expect(loadBackups()).toHaveLength(1);
    // a planta vazia é salva normalmente, só não vira backup
    expect(saved().nodes).toHaveLength(0);
  });

  it('com o estado salvo corrompido, carrega e oferece o backup mais novo', () => {
    saveState(plant(3), T0);
    store.data.set('satisplanner:v1', '{ quebrado');
    expect(loadState().nodes).toHaveLength(3);
    expect(lastGoodState()?.nodes).toHaveLength(3);
    // sem nada guardado: o exemplo (e nenhum backup pra baixar)
    store.clear();
    expect(loadState().nodes).toHaveLength(7);
    expect(lastGoodState()).toBeNull();
  });

  it('ignora backups corrompidos sem quebrar', () => {
    store.data.set('satisplanner:backups:v1', 'não é json');
    expect(loadBackups()).toEqual([]);
    store.data.set('satisplanner:backups:v1', JSON.stringify([{ savedAt: T0, state: plant(2) }, { savedAt: 'x', state: plant(2) }, { savedAt: T0, state: {} }]));
    expect(loadBackups()).toHaveLength(1);
  });

  it('sem espaço pro backup inteiro, larga as versões mais antigas', () => {
    for (let i = 0; i < 3; i++) saveState(plant(i + 1), T0 + i * BACKUP_INTERVAL);
    const setItem = store.setItem;
    // só cabem 2 versões
    store.setItem = (k, v) => {
      if (k === 'satisplanner:backups:v1' && JSON.parse(v).length > 2) throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    expect(saveState(plant(7), T0 + 3 * BACKUP_INTERVAL)).toBe(true);
    expect(loadBackups().map((b) => b.state.nodes.length)).toEqual([7, 3]);
  });

  it('restaurar uma versão guarda a planta atual antes (dá pra voltar)', () => {
    saveState(plant(2), T0);
    saveState(plant(5), T0 + BACKUP_INTERVAL);
    saveState(plant(6), T0 + BACKUP_INTERVAL + 1000);
    const restored = restoreBackup(T0, T0 + BACKUP_INTERVAL + 2000);
    expect(restored?.nodes).toHaveLength(2);
    expect(saved().nodes).toHaveLength(2);
    // a planta de 6 nodes (que não tinha versão própria) virou a mais nova do backup
    expect(loadBackups().map((b) => b.state.nodes.length)).toEqual([6, 5, 2]);
    expect(restoreBackup(123)).toBeNull();
  });
});
