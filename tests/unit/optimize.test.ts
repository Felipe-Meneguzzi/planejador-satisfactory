import { describe, expect, it } from 'vitest';
import { optimize, type OptimizeInput } from '../../src/planner/optimize';
import { planOptimized } from '../../src/planner/optimizedPlan';
import { planLine, type Plan } from '../../src/planner/plan';

const base: OptimizeInput = {
  item: 'iron-plate',
  goal: 'target',
  rate: 30,
  objective: 'resources',
  policy: 'standard',
  alternates: [],
  weights: {},
  available: {},
  unlimitedWater: true,
  ores: {},
  maxClock: 100,
  maxBelt: 3,
  maxPipe: 1,
};
const run = (extra: Partial<OptimizeInput>) => optimize({ ...base, ...extra });
const settings = (item: string) => ({ item, ores: {}, maxClock: 100, maxBelt: 3 as const, maxPipe: 1 as const });
const manual = (item: string, rate: number) => planLine({ ...settings(item), rate, choices: {} });

/** quanto o plano tira do chão de cada recurso */
const extracted = (p: Plan) => {
  const m: Record<string, number> = {};
  for (const g of p.groups) if (g.kind !== 'machine') m[g.item] = (m[g.item] ?? 0) + g.demand;
  return m;
};

describe('otimizador (programação linear)', () => {
  it('Aluminum Ingot com "menos recursos" reaproveita a água da Aluminum Scrap', () => {
    const o = run({ item: 'aluminum-ingot', rate: 30 });
    expect(o.error).toBeUndefined();
    // 15 m³/min de água saem da Aluminum Scrap e voltam pra Alumina Solution
    const water = o.byproducts.find((b) => b.item === 'water')!;
    expect(water.reused).toBeCloseTo(15);
    expect(water.stored).toBeCloseTo(0);
    // a silica também (12,5/min), o resto vem da receita de Silica
    expect(o.byproducts.find((b) => b.item === 'silica')!.reused).toBeCloseTo(12.5);
    expect(o.extraction.water).toBeCloseTo(30);
    // o modo manual manda o subproduto pro armazém e tira toda a água do chão
    expect(extracted(manual('aluminum-ingot', 30)).water).toBeCloseTo(45);
    expect(o.extraction.water).toBeLessThan(extracted(manual('aluminum-ingot', 30)).water - 1);

    // no plano, a água tem duas fontes (extrator + subproduto) juntas num barramento
    const p = planOptimized(o, settings('aluminum-ingot'));
    expect(p.error).toBeUndefined();
    const bus = p.buses!.find((b) => b.item === 'water')!;
    expect(bus.sources.map((s) => s.output).sort()).toEqual([0, 1]);
    expect(bus.sources.reduce((a, s) => a + s.amount, 0)).toBeCloseTo(bus.demand);
    expect(extracted(p).water).toBeCloseTo(30);
  });

  it('Plastic reaproveita o Heavy Oil Residue da Rubber virando Fuel', () => {
    const o = run({ item: 'plastic', rate: 60, policy: 'selected', alternates: ['alt-recycled-plastic', 'alt-heavy-oil-residue'] });
    expect(o.error).toBeUndefined();
    const ids = o.recipes.map((r) => r.recipe.id);
    expect(ids).toEqual(expect.arrayContaining(['rubber', 'residual-fuel', 'alt-recycled-plastic']));
    const hor = o.byproducts.find((b) => b.item === 'heavy-oil-residue')!;
    expect(hor.reused).toBeCloseTo(hor.produced);
    expect(hor.stored).toBeCloseTo(0);
    // menos petróleo que o manual (60 Plastic na receita padrão = 90 m³/min)
    expect(extracted(manual('plastic', 60))['crude-oil']).toBeCloseTo(90);
    expect(o.extraction['crude-oil']).toBeLessThan(90);
  });

  it('Smokeless Powder só com receitas padrão: HOR da Rubber reaproveitado, a Rubber que sobra vai pro armazém', () => {
    const o = run({ item: 'smokeless-powder', rate: 20 });
    expect(o.error).toBeUndefined();
    expect(o.byproducts.find((b) => b.item === 'heavy-oil-residue')!.reused).toBeCloseTo(10);
    expect(o.excess.rubber).toBeCloseTo(10);
    const p = planOptimized(o, settings('smokeless-powder'));
    // a Rubber inteira sai pra um armazém; o HOR vai direto pro Smokeless Powder
    expect(p.sinks.filter((s) => s.item === 'rubber').reduce((a, s) => a + s.demand, 0)).toBeCloseTo(10);
  });

  it('maximizar: 240 Iron Ore → 160 Iron Plate (receitas padrão)', () => {
    const o = run({ goal: 'maximize', available: { 'iron-ore': 240 } });
    expect(o.error).toBeUndefined();
    // Iron Ingot 30 → 30 e Iron Plate 30 → 20 (por minuto, a 100%)
    expect(o.rate).toBeCloseTo(160, 6);
    expect(o.extraction['iron-ore']).toBeCloseTo(240);
  });

  it('maximizar com Pure Iron Ingot e água à vontade: 240 Iron Ore → 297,14 Iron Plate', () => {
    const o = run({ goal: 'maximize', available: { 'iron-ore': 240 }, policy: 'selected', alternates: ['alt-pure-iron-ingot'] });
    expect(o.error).toBeUndefined();
    // Pure Iron Ingot: 35 minério + 20 água → 65 lingotes; Iron Plate: 3 lingotes → 2 placas
    expect(o.rate).toBeCloseTo((240 / 35) * 65 * (2 / 3), 3);
    expect(o.rate).toBeLessThanOrEqual((240 / 35) * 65 * (2 / 3));
    expect(o.recipes.map((r) => r.recipe.id)).toContain('alt-pure-iron-ingot');
    // sem água à vontade (e sem água informada), volta pro lingote padrão
    expect(run({ goal: 'maximize', available: { 'iron-ore': 240 }, policy: 'selected', alternates: ['alt-pure-iron-ingot'], unlimitedWater: false }).rate).toBeCloseTo(160, 6);
  });

  it('inviável: maximizar Plastic só com Iron Ore diz o que falta', () => {
    const o = run({ item: 'plastic', goal: 'maximize', available: { 'iron-ore': 240 } });
    expect(o.error).toBe('Com os recursos informados não sai nada de Plastic: falta Crude Oil.');
    expect(o.recipes).toEqual([]);
    expect(planOptimized(o, settings('plastic')).error).toBe(o.error);
  });

  it('quantidade inválida vira erro', () => {
    expect(run({ rate: 0 }).error).toBe('Informe uma quantidade maior que zero.');
  });

  it.each([
    ['modular-frame', 10],
    ['computer', 2],
    ['plastic', 60],
  ])('só receitas padrão reproduz o plano manual: %s %d/min', (item, rate) => {
    const o = run({ item, rate });
    expect(o.error).toBeUndefined();
    const p = planOptimized(o, settings(item));
    const m = manual(item, rate);
    const shape = (x: Plan) => x.groups.map((g) => [g.item, g.recipe?.id ?? g.kind, g.count, +g.clock.toFixed(6)]);
    expect(shape(p)).toEqual(shape(m));
    expect(p.buses).toBeUndefined();
    expect(p.power).toBeCloseTo(m.power);
  });

  it('cada objetivo puxa pro seu lado: menos máquinas usa menos máquinas que menos recursos', () => {
    const opts = { item: 'heavy-modular-frame', rate: 2, policy: 'all' as const };
    const res = run({ ...opts, objective: 'resources' });
    const mach = run({ ...opts, objective: 'machines' });
    const pow = run({ ...opts, objective: 'power' });
    for (const o of [res, mach, pow]) expect(o.error).toBeUndefined();
    const total = (o: typeof res) => Object.values(o.extraction).reduce((a, b) => a + b, 0);
    expect(mach.machines).toBeLessThanOrEqual(res.machines + 1e-6);
    expect(pow.power).toBeLessThanOrEqual(res.power + 1e-6);
    expect(total(res)).toBeLessThanOrEqual(total(mach) + 1e-6);
  });

  it('peso alto num recurso faz o otimizador fugir dele', () => {
    const o = run({ item: 'iron-ingot', rate: 60, policy: 'all', weights: { 'iron-ore': 100 } });
    expect(o.error).toBeUndefined();
    expect(o.extraction['iron-ore'] ?? 0).toBeLessThan(60);
  });

  it('linha que passa do Mk máximo é dividida em cópias que fecham sozinhas', () => {
    // 240 Aluminum Ingot pedem 360 m³/min de água: não cabe num cano Mk.1 (300)
    const o = run({ item: 'aluminum-ingot', rate: 240 });
    const p = planOptimized(o, settings('aluminum-ingot'));
    expect(p.copies).toBe(2);
    for (const b of p.buses!) {
      expect(b.demand).toBeLessThanOrEqual(300 + 1e-6);
      expect(b.sources.reduce((a, s) => a + s.amount, 0)).toBeCloseTo(b.demand);
    }
    expect(p.sinks.filter((s) => s.item === 'aluminum-ingot').map((s) => s.demand)).toEqual([120, 120]);
  });
});
