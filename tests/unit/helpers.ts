import type { BeltTier, ExtractorKind, Purity, SinkMode } from '../../src/game/types';
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
/** poço de recurso: pressurizador no `clock` com um satélite por pureza da lista */
export const well = (id: string, resource: string, satellites: Purity[], clock = 100): SimNode => ({
  id,
  data: { kind: 'well', resource, satellites, clock },
});
export const splitter = (id: string, fluid = false): SimNode => ({ id, data: { kind: 'splitter', ...(fluid ? { fluid } : {}) } });
export const merger = (id: string, fluid = false): SimNode => ({ id, data: { kind: 'merger', ...(fluid ? { fluid } : {}) } });
export const sink = (id: string, mode?: SinkMode): SimNode => ({ id, data: { kind: 'sink', ...(mode ? { mode } : {}) } });
/** gerador `gen` (slug) com o combustível `fuel`; `purity` só pro Geothermal Generator */
export const generator = (id: string, gen: string, fuel?: string, clock = 100, purity?: Purity): SimNode => ({
  id,
  data: { kind: 'generator', generator: gen, ...(fuel ? { fuel } : {}), clock, ...(purity ? { purity } : {}) },
});

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
