import type { BeltTier, ExtractorKind, Purity } from '../../src/game/types';
import type { SimEdge, SimNode } from '../../src/sim/simulate';

/* Construtores curtos de nodes e conexões pros cenários de simulação */

export const miner = (id: string, resource = 'iron-ore', purity: Purity = 'normal', tier: 1 | 2 | 3 = 1, clock = 100): SimNode => ({
  id,
  data: { kind: 'miner', resource, purity, tier, clock },
});
export const machine = (id: string, machineId: string, recipe: string, clock = 100, sloops = 0): SimNode => ({
  id,
  data: { kind: 'machine', machine: machineId, recipe, clock, sloops },
});
export const extractor = (id: string, kind: ExtractorKind, resource: string, purity: Purity = 'normal', clock = 100): SimNode => ({
  id,
  data: { kind: 'extractor', extractor: kind, resource, purity, clock },
});
export const splitter = (id: string, fluid = false): SimNode => ({ id, data: { kind: 'splitter', ...(fluid ? { fluid } : {}) } });
export const merger = (id: string, fluid = false): SimNode => ({ id, data: { kind: 'merger', ...(fluid ? { fluid } : {}) } });
export const sink = (id: string): SimNode => ({ id, data: { kind: 'sink' } });

/** esteira de `s:out-sh` pra `t:in-th` */
export const belt = (id: string, s: string, sh: number, t: string, th: number, tier: BeltTier = 1): SimEdge => ({
  id,
  source: s,
  sourceHandle: `out-${sh}`,
  target: t,
  targetHandle: `in-${th}`,
  tier,
  medium: 'belt',
});
/** cano de `s:out-sh` pra `t:in-th` */
export const pipe = (id: string, s: string, sh: number, t: string, th: number, tier: BeltTier = 1): SimEdge => ({
  ...belt(id, s, sh, t, th, tier),
  medium: 'pipe',
});
