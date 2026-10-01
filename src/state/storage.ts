import type { BeltEdge, BeltTier, FactoryNode } from '../game/types';

const KEY = 'satisplanner:v1';

export interface SavedState {
  version: 1;
  nodes: FactoryNode[];
  edges: BeltEdge[];
  defaultTier: BeltTier;
  /** padrão das esteiras: seguir o grid com ângulos retos */
  gridBelts?: boolean;
  /** mostrar rótulos nas esteiras */
  beltLabels?: boolean;
}

export const newId = (prefix = 'n') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Mantém só o que importa (descarta seleção, medidas etc.) */
export function sanitize(raw: unknown): SavedState | null {
  const p = raw as Partial<SavedState> | null;
  if (!p || p.version !== 1 || !Array.isArray(p.nodes) || !Array.isArray(p.edges)) return null;
  return {
    version: 1,
    defaultTier: p.defaultTier ?? 1,
    gridBelts: p.gridBelts ?? true,
    beltLabels: p.beltLabels ?? true,
    nodes: p.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }) as FactoryNode),
    edges: p.edges.map((e) => ({
      id: e.id,
      type: 'belt' as const,
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

export function loadState(): SavedState {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw && sanitize(JSON.parse(raw));
    if (s) return s;
  } catch {
    /* storage indisponível ou corrompido: cai no exemplo */
  }
  return demoState();
}

export function saveState(s: SavedState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitize(s)));
  } catch {
    /* sem storage, segue sem salvar */
  }
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
