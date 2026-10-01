import { describe, expect, it, vi } from 'vitest';
import { getRecipe } from '../../src/game/data';
import { mediumsMatch, portMedium } from '../../src/game/ports';
import type { BeltTier, FactoryNode, PipeTier } from '../../src/game/types';
import { layoutPlan, type DistributionMode, type Layout } from '../../src/planner/layout';
import { optimize, type OptimizeInput } from '../../src/planner/optimize';
import { planOptimized } from '../../src/planner/optimizedPlan';
import { planLine, type Plan } from '../../src/planner/plan';
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
  // Nitrogen Gas vem de poço de recurso (pressurizador + satélites)
  ['nitric-acid', 30],
  ['nitrogen-gas', 1500],
  // insumos "de fora" (coletáveis/resíduos) viram Entradas externas com a vazão da faixa
  ['fabric', 10],
  ['power-shard', 10],
  ['encased-plutonium-cell', 10],
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
    case 'well':
      return { w: 240, h: 100 + 20 * (d.satellites.length - 1) };
    case 'splitter':
    case 'merger':
      return { w: 120, h: 120 };
    case 'sink':
    case 'outbound':
      return { w: 280, h: 100 };
    case 'inbound':
      // gerada minimizada e com a saída em cima
      return { w: 240, h: 100 };
    default:
      // o gerador nunca cria moldura nem anotação
      throw new Error(`node inesperado na linha gerada: ${d.kind}`);
  }
}

const generate = (item: string, rate: number, mode: DistributionMode): Layout =>
  draw(planLine({ item, rate, choices: {}, ores: {}, maxClock: 100, maxBelt: MAX_BELT, maxPipe: MAX_PIPE }), mode);

const draw = (plan: Plan, mode: DistributionMode): Layout => {
  expect(plan.error).toBeUndefined();
  const layout = layoutPlan(plan, mode, MAX_BELT, MAX_PIPE, { x: 0, y: 0 });
  // uma Entrada externa por faixa de insumo de fora, com a vazão exata dela
  const inbound = layout.nodes.flatMap((n) => (n.data.kind === 'inbound' ? [n.data] : []));
  const lanes = plan.external.flatMap((e) => e.lanes);
  expect(inbound.map((d) => [d.item, d.rate])).toEqual(lanes.map((l) => [l.item, l.demand]));
  return layout;
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

/** roda a 100%: nenhum erro nem aviso, e o pedido chega inteiro ao armazém */
function expectRuns(layout: Layout, item: string, rate: number) {
  const sim = simulateLayout(layout);
  const problems = sim.issues.filter((i) => i.level !== 'info').map((i) => `${i.level}: ${i.message}`);
  expect(problems).toEqual([]);
  const stored = sim.production.find((p) => p.item === item)?.stored ?? 0;
  expect(stored).toBeCloseTo(rate, 6);
}

/** nodes no grid e sem sobreposição */
function expectTidy({ nodes }: Layout) {
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
}

/** conexões válidas: meio certo, uma por porta, Mk dentro do limite, viradas no grid */
function expectValidEdges({ nodes, edges }: Layout) {
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
}

describe.each(MODES)('gerador de linha (%s)', (mode) => {
  it.each(CASES)('%s %d/min roda sem erro nem aviso', (item, rate) => expectRuns(generate(item, rate, mode), item, rate));
  it.each(CASES)('%s %d/min: nodes no grid e sem sobreposição', (item, rate) => expectTidy(generate(item, rate, mode)));
  it.each(CASES)('%s %d/min: conexões válidas (meio certo, uma por porta, Mk dentro do limite)', (item, rate) => expectValidEdges(generate(item, rate, mode)));
});

/*
 * Modo otimizado: a solução do LP vira plano (barramentos pros itens com várias fontes,
 * subprodutos reaproveitados, cópias quando passa do Mk máximo) e tem que fechar igual.
 */
const OPT_BASE: OptimizeInput = {
  item: '',
  goal: 'target',
  rate: 0,
  objective: 'resources',
  policy: 'standard',
  alternates: [],
  weights: {},
  available: {},
  unlimitedWater: true,
  ores: {},
  maxClock: 100,
  maxBelt: MAX_BELT,
  maxPipe: MAX_PIPE,
};
const HMF_ALTERNATES = [
  'alt-heavy-encased-frame',
  'alt-steeled-frame',
  'alt-encased-industrial-pipe',
  'alt-solid-steel-ingot',
  'alt-steel-screws',
  'alt-pure-iron-ingot',
  'alt-coated-iron-plate',
  'alt-heavy-flexible-frame',
  'alt-rubber-concrete',
  'alt-recycled-plastic',
  'alt-recycled-rubber',
  'alt-diluted-fuel',
  'alt-heavy-oil-residue',
];
const OPT_CASES: [label: string, input: Partial<OptimizeInput>][] = [
  ['Aluminum Ingot 30 (água e silica reaproveitadas)', { item: 'aluminum-ingot', rate: 30 }],
  ['Plastic 60 com Rubber/Fuel (HOR reaproveitado)', { item: 'plastic', rate: 60, policy: 'selected', alternates: ['alt-recycled-plastic', 'alt-heavy-oil-residue'] }],
  ['Rubber 60 (todas as receitas)', { item: 'rubber', rate: 60, policy: 'all' }],
  ['Smokeless Powder 20 (sobra de Rubber pro armazém)', { item: 'smokeless-powder', rate: 20 }],
  ['Computer 5 (só padrão)', { item: 'computer', rate: 5 }],
  ['Computer 2 (todas, menos energia)', { item: 'computer', rate: 2, policy: 'all', objective: 'power' }],
  ['Heavy Modular Frame 2 (alternativas escolhidas)', { item: 'heavy-modular-frame', rate: 2, policy: 'selected', alternates: HMF_ALTERNATES }],
  ['Heavy Modular Frame 2 (todas, menos máquinas)', { item: 'heavy-modular-frame', rate: 2, policy: 'all', objective: 'machines' }],
  ['Aluminum Ingot 240 (água passa do cano Mk.1: 2 cópias)', { item: 'aluminum-ingot', rate: 240 }],
  ['Plastic 300 (passa da esteira Mk.3)', { item: 'plastic', rate: 300, policy: 'selected', alternates: ['alt-recycled-plastic', 'alt-heavy-oil-residue'] }],
  ['Iron Plate no máximo com 240 Iron Ore e Pure Iron Ingot', { item: 'iron-plate', goal: 'maximize', available: { 'iron-ore': 240 }, policy: 'selected', alternates: ['alt-pure-iron-ingot'] }],
];
const optimized = (input: Partial<OptimizeInput>) => {
  const o = optimize({ ...OPT_BASE, ...input });
  expect(o.error).toBeUndefined();
  return { o, plan: planOptimized(o, { item: input.item!, ores: {}, maxClock: 100, maxBelt: MAX_BELT, maxPipe: MAX_PIPE }) };
};

describe.each(MODES)('gerador de linha otimizado (%s)', (mode) => {
  it.each(OPT_CASES)('%s roda sem erro nem aviso', (_, input) => {
    const { o, plan } = optimized(input);
    expectRuns(draw(plan, mode), input.item!, o.rate);
  });
  it.each(OPT_CASES)('%s: nodes no grid e sem sobreposição', (_, input) => expectTidy(draw(optimized(input).plan, mode)));
  it.each(OPT_CASES)('%s: conexões válidas', (_, input) => expectValidEdges(draw(optimized(input).plan, mode)));
});
