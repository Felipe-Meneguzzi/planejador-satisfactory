import type { BeltEdge, BeltTier, FactoryData, FactoryNode, PipeTier, Purity } from '../game/types';

const KEY = 'satisplanner:v1';
/** Versões boas anteriores (backup rotativo), da mais nova pra mais antiga */
const BACKUP_KEY = 'satisplanner:backups:v1';
/** quantas versões guardar */
export const MAX_BACKUPS = 5;
/** intervalo mínimo entre duas versões do backup (o salvamento normal roda a cada edição) */
export const BACKUP_INTERVAL = 2 * 60_000;

export interface SavedState {
  version: 1;
  nodes: FactoryNode[];
  edges: BeltEdge[];
  defaultTier: BeltTier;
  /** Mk dos canos novos */
  defaultPipeTier?: PipeTier;
  /** padrão das esteiras: seguir o grid com ângulos retos */
  gridBelts?: boolean;
  /** mostrar rótulos nas esteiras */
  beltLabels?: boolean;
  /** cupons do AWESOME Sink já impressos (pra estimar o custo dos próximos) */
  couponsPrinted?: number;
}

/** contador da sessão: o gerador cria centenas de ids no mesmo milissegundo */
let idSeq = 0;
export const newId = (prefix = 'n') => `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** id, posição numérica e dados com `kind`: o mínimo pro canvas desenhar o node */
function validNode(n: unknown) {
  return (
    isObj(n) &&
    typeof n.id === 'string' &&
    isObj(n.position) &&
    finite(n.position.x) &&
    finite(n.position.y) &&
    isObj(n.data) &&
    typeof n.data.kind === 'string'
  );
}

function validEdge(e: unknown) {
  return isObj(e) && typeof e.id === 'string' && typeof e.source === 'string' && typeof e.target === 'string';
}

const PURITY_VALUES: Purity[] = ['impure', 'normal', 'pure'];
const isPurity = (v: unknown): v is Purity => PURITY_VALUES.includes(v as Purity);

/**
 * Migra formatos antigos de node pro atual:
 *  - extrator de poço ('extractor' com extractor 'well', um satélite cujo clock era o do
 *    pressurizador) vira um poço ('well') com aquele único satélite e o mesmo clock. As
 *    conexões continuam valendo: a saída do satélite 1 é a mesma out-0.
 *  - poço com lista de satélites quebrada fica só com as purezas válidas.
 */
function migrateNode(type: unknown, data: Record<string, unknown>): { type: string; data: FactoryData } {
  if (data.kind === 'extractor' && data.extractor === 'well') {
    const { purity, extractor: _e, ...rest } = data;
    return { type: 'well', data: { ...rest, kind: 'well', satellites: [isPurity(purity) ? purity : 'normal'] } as FactoryData };
  }
  if (data.kind === 'well') {
    const satellites = Array.isArray(data.satellites) ? data.satellites.filter(isPurity) : [];
    return { type: 'well', data: { ...data, satellites } as FactoryData };
  }
  return { type: typeof type === 'string' ? type : String(data.kind), data: data as FactoryData };
}

/** Mantém só o que importa (descarta seleção, medidas etc.) e migra formatos antigos */
export function sanitize(raw: unknown): SavedState | null {
  const p = raw as Partial<SavedState> | null;
  if (!p || p.version !== 1 || !Array.isArray(p.nodes) || !Array.isArray(p.edges)) return null;
  // um node ou esteira quebrado invalida o estado inteiro (melhor não salvar do que gravar lixo por cima)
  if (!p.nodes.every(validNode) || !p.edges.every(validEdge)) return null;
  return {
    version: 1,
    defaultTier: p.defaultTier ?? 1,
    defaultPipeTier: p.defaultPipeTier ?? 1,
    gridBelts: p.gridBelts ?? true,
    beltLabels: p.beltLabels ?? true,
    ...(finite(p.couponsPrinted) && p.couponsPrinted! > 0 ? { couponsPrinted: Math.floor(p.couponsPrinted!) } : {}),
    nodes: p.nodes.map((n) => ({ id: n.id, position: n.position, ...migrateNode(n.type, n.data as Record<string, unknown>) }) as FactoryNode),
    edges: p.edges.map((e) => ({
      id: e.id,
      type: e.type === 'pipe' ? ('pipe' as const) : ('belt' as const),
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      data: {
        tier: e.data?.tier ?? 1,
        ...(e.data?.routing ? { routing: e.data.routing } : {}),
        ...(e.data?.bends && e.data.anchor ? { bends: e.data.bends, anchor: e.data.anchor } : {}),
      },
    })),
  };
}

export interface Backup {
  /** horário em que a versão foi guardada (ms) */
  savedAt: number;
  state: SavedState;
}

/* ---------- trava do salvamento ---------- */

/** Quem está em estado de erro (ex.: o Error Boundary do app ou do canvas): enquanto houver alguém, nada é salvo */
const blockers = new Set<string>();
export const blockSaves = (who: string) => void blockers.add(who);
export const unblockSaves = (who: string) => void blockers.delete(who);
export const savesBlocked = () => blockers.size > 0;

/* ---------- leitura ---------- */

function readMain(): SavedState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Versões guardadas, da mais nova pra mais antiga (as inválidas são ignoradas) */
export function loadBackups(): Backup[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((b) => {
      const state = isObj(b) && finite(b.savedAt) ? sanitize(b.state) : null;
      return state ? [{ savedAt: b.savedAt as number, state }] : [];
    });
  } catch {
    return [];
  }
}

/** Estado salvo; se estiver corrompido, a versão mais nova do backup; sem nada, o exemplo */
export function loadState(): SavedState {
  return readMain() ?? loadBackups()[0]?.state ?? demoState();
}

/** Último estado bom guardado (o salvo ou, se ele estiver ruim, o backup mais novo) */
export function lastGoodState(): SavedState | null {
  return readMain() ?? loadBackups()[0]?.state ?? null;
}

/* ---------- gravação ---------- */

function writeBackups(list: Backup[]) {
  // sem espaço: vai largando as versões mais antigas até caber
  for (let n = Math.min(list.length, MAX_BACKUPS); n > 0; n--) {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, n)));
      return;
    } catch {
      /* tenta com menos */
    }
  }
}

/**
 * Guarda a versão no backup rotativo: no máximo uma a cada BACKUP_INTERVAL (ou sempre, com `force`).
 * Planta vazia não entra: não há o que restaurar.
 */
function pushBackup(state: SavedState, now: number, force = false) {
  if (!state.nodes.length) return;
  const list = loadBackups();
  const latest = list[0];
  if (latest && JSON.stringify(latest.state) === JSON.stringify(state)) return;
  if (latest && !force && now - latest.savedAt < BACKUP_INTERVAL) return;
  writeBackups([{ savedAt: now, state }, ...list]);
}

/**
 * Salva o estado se ele for válido e nenhum Error Boundary estiver em erro.
 * Retorna se salvou (um estado ruim nunca grava por cima do bom).
 */
export function saveState(s: SavedState, now = Date.now()): boolean {
  if (savesBlocked()) return false;
  const clean = sanitize(s);
  if (!clean) {
    console.warn('[satisplanner] estado inválido: salvamento automático ignorado');
    return false;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* sem storage, segue sem salvar */
    return false;
  }
  pushBackup(clean, now);
  return true;
}

/**
 * Volta para uma versão do backup. A planta atual entra no backup antes, então dá pra desfazer.
 * Retorna o estado restaurado (null se a versão não existe mais).
 */
export function restoreBackup(savedAt: number, now = Date.now()): SavedState | null {
  const chosen = loadBackups().find((b) => b.savedAt === savedAt);
  if (!chosen) return null;
  const current = readMain();
  if (current) pushBackup(current, now, true);
  try {
    localStorage.setItem(KEY, JSON.stringify(chosen.state));
  } catch {
    /* sem storage: o app ainda pode aplicar o estado em memória */
  }
  return chosen.state;
}

/** Baixa o estado como .json (Exportar e o backup do painel de erro) */
export function downloadJson(s: SavedState, name: string) {
  const blob = new Blob([JSON.stringify(sanitize(s), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const belt = (id: string, source: string, sh: number, target: string, th: number): BeltEdge => ({
  id,
  type: 'belt',
  source,
  sourceHandle: `out-${sh}`,
  target,
  targetHandle: `in-${th}`,
  data: { tier: 1 },
});

/** Exemplo: 60 minério -> 2 fundidoras -> 1 construtora (que só usa 30 lingotes: gera aviso) */
export function demoState(): SavedState {
  return {
    version: 1,
    defaultTier: 1,
    gridBelts: true,
    beltLabels: true,
    nodes: [
      { id: 'miner', type: 'miner', position: { x: 0, y: 100 }, data: { kind: 'miner', resource: 'iron-ore', purity: 'normal', tier: 1, clock: 100 } },
      { id: 'split', type: 'splitter', position: { x: 400, y: 220 }, data: { kind: 'splitter' } },
      { id: 'smelt1', type: 'machine', position: { x: 640, y: -170 }, data: { kind: 'machine', machine: 'smelter', recipe: 'iron-ingot', clock: 100 } },
      { id: 'smelt2', type: 'machine', position: { x: 640, y: 450 }, data: { kind: 'machine', machine: 'smelter', recipe: 'iron-ingot', clock: 100 } },
      { id: 'merge', type: 'merger', position: { x: 1080, y: 220 }, data: { kind: 'merger' } },
      { id: 'cons', type: 'machine', position: { x: 1320, y: 110 }, data: { kind: 'machine', machine: 'constructor', recipe: 'iron-plate', clock: 100 } },
      { id: 'store', type: 'sink', position: { x: 1720, y: 270 }, data: { kind: 'sink' } },
    ],
    edges: [
      belt('b1', 'miner', 0, 'split', 0),
      belt('b2', 'split', 0, 'smelt1', 0),
      belt('b3', 'split', 2, 'smelt2', 0),
      belt('b4', 'smelt1', 0, 'merge', 0),
      belt('b5', 'smelt2', 0, 'merge', 2),
      belt('b6', 'merge', 0, 'cons', 0),
      belt('b7', 'cons', 0, 'store', 0),
    ],
  };
}
