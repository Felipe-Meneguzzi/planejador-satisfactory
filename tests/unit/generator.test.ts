import { describe, expect, it, vi } from 'vitest';
import { getRecipe } from '../../src/game/data';
import { mediumsMatch, portMedium } from '../../src/game/ports';
import type { BeltTier, FactoryNode, PipeTier } from '../../src/game/types';
import { layoutPlan, type DistributionMode, type Layout } from '../../src/planner/layout';
import { planLine } from '../../src/planner/plan';
import { simulate } from '../../src/sim/simulate';

/*
 * Aceitação do gerador sem browser: planLine → layoutPlan → simulate.
 * Toda linha gerada tem que rodar a 100% (sem erro nem aviso), sem nodes sobrepostos e no grid.
 */

// ids sequenciais: o newId real (Date.now + 4 caracteres aleatórios) às vezes repete numa linha
// grande gerada no mesmo milissegundo — ver o teste pulado em storage.test.ts
vi.mock('../../src/state/storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/state/storage')>();
  let seq = 0;
  return { ...original, newId: (prefix = 'n') => `${prefix}-${seq++}` };
});

const onGrid = (v: number) => v % 20 === 0;

const MAX_BELT: BeltTier = 3;
const MAX_PIPE: PipeTier = 1;

const CASES: [item: string, rate: number][] = [
  ['modular-frame', 10],
  ['heavy-modular-frame', 2],
  ['iron-plate', 300],
  ['plastic', 60],
  ['rubber', 60],
  ['fuel', 100],
  ['fuel', 400],
  ['aluminum-ingot', 30],
  ['turbofuel', 20],
  ['computer', 2],
];
const MODES: DistributionMode[] = ['manifold', 'tree'];

/** tamanho na tela (mesmas medidas do CSS: máquina minimizada, cubo e armazém) */
function sizeOf(n: FactoryNode): { w: number; h: number } {
  const d = n.data;
  switch (d.kind) {
    case 'machine':
      return { w: 240, h: 100 + 20 * (getRecipe(d).outputs.length - 1) };
    case 'miner':
    case 'extractor':
    case 'generator':
      return { w: 240, h: 100 };
    case 'splitter':
    case 'merger':
      return { w: 120, h: 120 };
    case 'sink':
      return { w: 280, h: 100 };
  }
}

const generate = (item: string, rate: number, mode: DistributionMode): Layout => {
  const plan = planLine({ item, rate, choices: {}, ores: {}, maxClock: 100, maxBelt: MAX_BELT, maxPipe: MAX_PIPE });
  expect(plan.error).toBeUndefined();
  expect(plan.external).toEqual([]);
  return layoutPlan(plan, mode, MAX_BELT, MAX_PIPE, { x: 0, y: 0 });
};

const simulateLayout = ({ nodes, edges }: Layout) =>
  simulate(
    nodes.map((n) => ({ id: n.id, data: n.data })),
    edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      tier: e.data!.tier,
      medium: e.type === 'pipe' ? ('pipe' as const) : ('belt' as const),
    })),
  );

describe.each(MODES)('gerador de linha (%s)', (mode) => {
  it.each(CASES)('%s %d/min roda sem erro nem aviso', (item, rate) => {
    const layout = generate(item, rate, mode);
    const sim = simulateLayout(layout);
    const problems = sim.issues.filter((i) => i.level !== 'info').map((i) => `${i.level}: ${i.message}`);
    expect(problems).toEqual([]);
    // tudo o que é pedido chega ao armazém
    const stored = sim.production.find((p) => p.item === item)?.stored ?? 0;
    expect(stored).toBeCloseTo(rate, 6);
  });

  it.each(CASES)('%s %d/min: nodes no grid e sem sobreposição', (item, rate) => {
    const { nodes } = generate(item, rate, mode);
    for (const n of nodes) {
      expect(onGrid(n.position.x), `${n.id} x=${n.position.x}`).toBe(true);
      expect(onGrid(n.position.y), `${n.id} y=${n.position.y}`).toBe(true);
    }
    const rects = nodes.map((n) => ({ id: n.id, ...n.position, ...sizeOf(n) }));
    const overlaps: string[] = [];
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push(`${a.id} × ${b.id}`);
      }
    expect(overlaps).toEqual([]);
  });

  it.each(CASES)('%s %d/min: conexões válidas (meio certo, uma por porta, Mk dentro do limite)', (item, rate) => {
    const { nodes, edges } = generate(item, rate, mode);
    expect(new Set([...nodes, ...edges].map((x) => x.id)).size).toBe(nodes.length + edges.length);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const used = new Set<string>();
    for (const e of edges) {
      const src = byId.get(e.source)!;
      const tgt = byId.get(e.target)!;
      expect(src && tgt, e.id).toBeTruthy();
      for (const port of [`${e.source}|${e.sourceHandle}`, `${e.target}|${e.targetHandle}`]) {
        expect(used.has(port), `porta usada duas vezes: ${port}`).toBe(false);
        used.add(port);
      }
      const from = portMedium(src.data, e.sourceHandle);
      const to = portMedium(tgt.data, e.targetHandle);
      expect(mediumsMatch(from, to), `${e.id}: ${from} → ${to}`).toBe(true);
      expect(e.type).toBe(from === 'fluid' || to === 'fluid' ? 'pipe' : 'belt');
      expect(e.data!.tier).toBeLessThanOrEqual(e.type === 'pipe' ? MAX_PIPE : MAX_BELT);
      // viradas e âncoras do trajeto também ficam no grid
      for (const v of [...(e.data!.bends ?? []), ...(e.data!.anchor ?? [])]) expect(onGrid(v), `${e.id}: ${v}`).toBe(true);
    }
  });
});
