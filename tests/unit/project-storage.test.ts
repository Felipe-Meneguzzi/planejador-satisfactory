import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryNode } from '../../src/game/types';
import {
  MIGRATED_ID,
  addFactories,
  applyImport,
  exportFactory,
  exportProject,
  loadBackups,
  loadState,
  parseImport,
  sanitize,
  uniqueName,
  type Factory,
  type ProjectState,
} from '../../src/state/storage';

const sink = (id: string, x = 0): FactoryNode => ({ id, type: 'sink', position: { x, y: 0 }, data: { kind: 'sink' } });
const inbound = (id: string, link?: { factory: string; node: string }, item = 'iron-plate', rate = 30): FactoryNode => ({
  id,
  type: 'inbound',
  position: { x: 0, y: 0 },
  data: { kind: 'inbound', item, rate, ...(link ? { link } : {}) },
});
const outbound = (id: string, name?: string): FactoryNode => ({ id, type: 'outbound', position: { x: 0, y: 0 }, data: { kind: 'outbound', ...(name ? { name } : {}) } });
const factory = (id: string, name: string, nodes: FactoryNode[] = []): Factory => ({ id, name, nodes, edges: [] });
const project = (factories: Factory[], active = factories[0].id): ProjectState => ({
  version: 2,
  defaultTier: 1,
  defaultPipeTier: 1,
  gridBelts: true,
  beltLabels: true,
  factories,
  active,
});

const v1 = {
  version: 1,
  defaultTier: 3,
  defaultPipeTier: 2,
  gridBelts: false,
  beltLabels: false,
  couponsPrinted: 4,
  nodes: [sink('store', 100)],
  edges: [],
};

describe('migração v1 → v2', () => {
  it('a planta v1 vira um projeto com uma fábrica, mantendo as configurações', () => {
    const p = sanitize(v1)!;
    expect(p).toEqual({
      version: 2,
      defaultTier: 3,
      defaultPipeTier: 2,
      gridBelts: false,
      beltLabels: false,
      couponsPrinted: 4,
      factories: [{ id: MIGRATED_ID, name: 'Fábrica 1', nodes: [sink('store', 100)], edges: [] }],
      active: MIGRATED_ID,
    });
    // migrar de novo não muda nada
    expect(sanitize(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  describe('no load e nos backups', () => {
    let data: Map<string, string>;
    beforeEach(() => {
      data = new Map();
      vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('o salvo v1 abre como projeto', () => {
      data.set('satisplanner:v1', JSON.stringify(v1));
      const p = loadState();
      expect(p.version).toBe(2);
      expect(p.factories[0].nodes.map((n) => n.id)).toEqual(['store']);
    });

    it('backups v1 e v2 convivem na lista de versões', () => {
      const v2 = project([factory('a', 'A', [sink('x')]), factory('b', 'B', [sink('y')])]);
      data.set('satisplanner:backups:v1', JSON.stringify([{ savedAt: 2, state: v2 }, { savedAt: 1, state: v1 }]));
      const list = loadBackups();
      expect(list.map((b) => b.state.factories.map((f) => f.name))).toEqual([['A', 'B'], ['Fábrica 1']]);
    });
  });
});

describe('sanitize do projeto', () => {
  it('limpa nomes, completa configurações e corrige a fábrica ativa', () => {
    const p = sanitize({ version: 2, factories: [{ id: 'a', name: '  Ferro  ', nodes: [], edges: [] }, { id: 'b', nodes: [], edges: [] }], active: 'zzz' })!;
    expect(p.factories.map((f) => f.name)).toEqual(['Ferro', 'Fábrica 2']);
    expect(p.active).toBe('a');
    expect(p).toMatchObject({ defaultTier: 1, defaultPipeTier: 1, gridBelts: true, beltLabels: true });
    expect(sanitize({ ...p, active: 'b' })!.active).toBe('b');
  });

  it('recusa projeto sem fábricas, ids repetidos ou fábrica quebrada', () => {
    expect(sanitize({ version: 2, factories: [] })).toBeNull();
    expect(sanitize({ version: 2, factories: [factory('a', 'A'), factory('a', 'B')] })).toBeNull();
    expect(sanitize({ version: 2, factories: [{ name: 'sem id', nodes: [], edges: [] }] })).toBeNull();
    expect(sanitize({ version: 2, factories: [factory('a', 'A'), { id: 'b', name: 'B', nodes: [{ id: 'x' }], edges: [] }] })).toBeNull();
  });

  it('Entrada externa: item precisa existir, vazão inválida vira 0 e link quebrado sai', () => {
    const p = sanitize(project([factory('a', 'A', [{ ...inbound('i'), data: { kind: 'inbound', item: 'iron-plate', rate: -5, link: { factory: 3 } } } as unknown as FactoryNode])]))!;
    expect(p.factories[0].nodes[0].data).toEqual({ kind: 'inbound', item: 'iron-plate', rate: 0 });
    const ok = sanitize(project([factory('a', 'A', [inbound('i', { factory: 'b', node: 'o' })])]))!;
    expect(ok.factories[0].nodes[0].data).toEqual({ kind: 'inbound', item: 'iron-plate', rate: 30, link: { factory: 'b', node: 'o' } });
    expect(sanitize(project([factory('a', 'A', [inbound('i', undefined, 'não-existe')])]))).toBeNull();
  });

  it('Saída externa: nome aparado e opcional', () => {
    const p = sanitize(project([factory('a', 'A', [outbound('o', '   Placas   '), outbound('p', '   ')])]))!;
    expect(p.factories[0].nodes.map((n) => n.data)).toEqual([
      { kind: 'outbound', name: 'Placas' },
      { kind: 'outbound' },
    ]);
  });
});

describe('importar', () => {
  it('detecta o formato: planta v1, projeto e fábrica avulsa', () => {
    const a = parseImport(v1, 'minha-planta');
    expect(a.ok && a.incoming.kind).toBe('v1');
    expect(a.ok && a.incoming.project.factories[0].name).toBe('minha-planta');

    const p = project([factory('a', 'A', [sink('x')]), factory('b', 'B')]);
    const b = parseImport(exportProject(p));
    expect(b.ok && b.incoming.kind).toBe('project');
    expect(b.ok && b.incoming.project.factories.map((f) => f.name)).toEqual(['A', 'B']);

    const c = parseImport(exportFactory(factory('b', 'B', [sink('y')])));
    expect(c.ok && c.incoming.kind).toBe('factory');
    expect(c.ok && c.incoming.project.factories).toEqual([factory('b', 'B', [sink('y')])]);
  });

  it('erros com mensagem clara', () => {
    const msg = (raw: unknown) => {
      const r = parseImport(raw);
      return r.ok ? '' : r.error;
    };
    expect(msg('texto')).toBe('Não dá pra abrir: o conteúdo não é um objeto JSON do planejador.');
    expect(msg({ nodes: [] })).toBe('Não dá pra abrir: falta o campo "version".');
    expect(msg({ version: 7 })).toBe('Não dá pra abrir: versão 7 não suportada (o app lê as versões 1 e 2).');
    expect(msg({ version: 2, factories: [] })).toBe('Não dá pra abrir: o projeto não tem nenhuma fábrica.');
    expect(msg({ version: 1, nodes: [{ id: 'x' }], edges: [] })).toBe('Não dá pra abrir: a planta tem node ou conexão inválida.');
    expect(msg({ version: 2, type: 'factory', factory: { id: 'f', name: 'Quebrada', nodes: [{}], edges: [] } })).toBe(
      'Não dá pra abrir: a fábrica "Quebrada" tem node ou conexão inválida.',
    );
  });

  it('adicionar como nova fábrica mantém as atuais, renomeia repetidas e troca ids que já existem (com os links)', () => {
    const current = project([factory('a', 'Ferro', [sink('x')]), factory('b', 'Cobre')], 'b');
    // projeto importado com os mesmos ids: a "b" puxa da saída da "a"
    const incoming = project([factory('a', 'Ferro', [outbound('o')]), factory('b', 'Aço', [inbound('i', { factory: 'a', node: 'o' }), inbound('j', { factory: 'z', node: 'q' })])]);
    const { project: next, added } = applyImport(current, { kind: 'project', project: incoming }, 'add');
    expect(next.factories.map((f) => f.name)).toEqual(['Ferro', 'Cobre', 'Ferro (2)', 'Aço']);
    expect(next.factories.slice(0, 2)).toEqual(current.factories);
    const [ferro2, aco] = added;
    expect(ferro2.id).not.toBe('a');
    expect(aco.id).not.toBe('b');
    expect(new Set(next.factories.map((f) => f.id)).size).toBe(4);
    // o link interno acompanha o id novo; link pra fora do que foi importado fica como está
    expect(aco.nodes.map((n) => n.data.kind === 'inbound' && n.data.link)).toEqual([
      { factory: ferro2.id, node: 'o' },
      { factory: 'z', node: 'q' },
    ]);
    // abre a primeira fábrica adicionada; configurações continuam as atuais
    expect(next.active).toBe(ferro2.id);
    expect(next.defaultTier).toBe(current.defaultTier);
  });

  it('substituir troca o projeto inteiro (com as configurações do importado)', () => {
    const current = project([factory('a', 'Ferro', [sink('x')]), factory('b', 'Cobre')]);
    const incoming = sanitize(v1)!;
    const { project: next } = applyImport(current, { kind: 'v1', project: incoming }, 'replace');
    expect(next).toEqual(incoming);
    expect(next.defaultTier).toBe(3);
  });

  it('ids sem conflito ficam iguais (links continuam valendo)', () => {
    const { added } = addFactories([factory('a', 'A')], [factory('b', 'B', [inbound('i', { factory: 'a', node: 'o' })])]);
    expect(added[0].id).toBe('b');
    expect(added[0].nodes[0].data).toMatchObject({ link: { factory: 'a', node: 'o' } });
  });

  it('uniqueName', () => {
    expect(uniqueName('A', ['B'])).toBe('A');
    expect(uniqueName('A', ['A', 'A (2)'])).toBe('A (3)');
  });
});
