import { describe, expect, it } from 'vitest';
import { WELL } from '../../src/game/data';
import { defaultChoice, planLine, type Group, type Plan, type PlanInput } from '../../src/planner/plan';
import { wellPower } from '../../src/sim/simulate';

const base: Omit<PlanInput, 'item' | 'rate'> = { choices: {}, ores: {}, maxClock: 100, maxBelt: 3, maxPipe: 1 };
const plan = (item: string, rate: number, extra: Partial<PlanInput> = {}) => planLine({ ...base, item, rate, ...extra });

/** grupos de um item (pode haver sub-grupos quando o fluxo não cabe numa esteira/cano) */
const groupsOf = (p: Plan, item: string) => p.groups.filter((g) => g.item === item);
const one = (p: Plan, item: string): Group => {
  const gs = groupsOf(p, item);
  expect(gs, `grupos de ${item}`).toHaveLength(1);
  return gs[0];
};

describe('defaultChoice', () => {
  it('prefere a receita padrão com o mesmo nome do item', () => {
    // "Residual Rubber" também é padrão e viria antes em ordem alfabética
    expect(defaultChoice('rubber')).toBe('rubber');
    expect(defaultChoice('plastic')).toBe('plastic');
  });
});

describe('planLine', () => {
  it('25 Iron Plate → 2 Constructors a 62,5%', () => {
    const p = plan('iron-plate', 25);
    expect(p.error).toBeUndefined();
    const g = one(p, 'iron-plate');
    expect(g.machine).toBe('constructor');
    expect(g.count).toBe(2);
    expect(g.clock).toBeCloseTo(62.5);
    expect(one(p, 'iron-ingot').count).toBe(2);
    expect(one(p, 'iron-ore').kind).toBe('miner');
    expect(p.sinks.map((s) => [s.item, s.demand])).toEqual([['iron-plate', 25]]);
  });

  it('10 Modular Frame → contagens conhecidas', () => {
    const p = plan('modular-frame', 10);
    expect(p.error).toBeUndefined();
    const counts = Object.fromEntries(p.groups.map((g) => [g.item, [g.machine ?? g.kind, g.count, +g.clock.toFixed(2)]]));
    expect(counts).toEqual({
      'modular-frame': ['assembler', 5, 100],
      'reinforced-iron-plate': ['assembler', 3, 100],
      screws: ['constructor', 5, 90],
      'iron-rod': ['constructor', 7, 100],
      'iron-plate': ['constructor', 5, 90],
      'iron-ingot': ['smelter', 8, 100],
      'iron-ore': ['miner', 4, 100],
    });
    const ore = one(p, 'iron-ore');
    expect(ore.ore).toEqual({ purity: 'normal', tier: 1 });
    expect(ore.demand).toBeCloseTo(240);
    expect(p.external).toEqual([]);
  });

  it('300 Iron Plate em esteira Mk.3 vira 2 sub-grupos e 2 armazéns de 150', () => {
    const p = plan('iron-plate', 300, { maxBelt: 3 });
    const plates = groupsOf(p, 'iron-plate');
    expect(plates).toHaveLength(2);
    for (const g of plates) expect(g.demand).toBeCloseTo(150);
    expect(p.sinks.map((s) => [s.item, s.demand])).toEqual([
      ['iron-plate', 150],
      ['iron-plate', 150],
    ]);
    // cada faixa de consumidor tem exatamente um produtor
    for (const g of p.groups) for (const lanes of g.inputLanes) for (const l of lanes) expect(l.source).toBeTruthy();
  });

  it('ciclo de receitas vira erro', () => {
    const p = plan('plastic', 60, { choices: { plastic: 'alt-recycled-plastic', rubber: 'alt-recycled-rubber' } });
    expect(p.error).toMatch(/^As receitas escolhidas formam um ciclo: /);
    expect(p.error).toContain('plastic → rubber → plastic');
    expect(p.groups).toEqual([]);
  });

  it('quantidade inválida vira erro', () => {
    expect(plan('iron-plate', 0).error).toBe('Informe uma quantidade maior que zero.');
  });

  it('60 Plastic → 3 Refinery e 30 m³/min de Heavy Oil Residue num armazém', () => {
    const p = plan('plastic', 60);
    const g = one(p, 'plastic');
    expect(g.machine).toBe('refinery');
    expect(g.count).toBe(3);
    expect(g.clock).toBeCloseTo(100);
    expect(g.byproducts).toHaveLength(1);
    expect(g.byproducts[0]).toMatchObject({ item: 'heavy-oil-residue', output: 1, from: 0, to: 3 });
    expect(g.byproducts[0].amount).toBeCloseTo(30);
    const sub = p.sinks.find((s) => s.byproduct);
    expect(sub).toMatchObject({ item: 'heavy-oil-residue', byproduct: { group: g.id, output: 1 } });
    expect(sub!.demand).toBeCloseTo(30);
    expect(one(p, 'crude-oil')).toMatchObject({ kind: 'extractor', extractor: 'oil' });
  });

  it('Alumínio gera subprodutos de água e silica', () => {
    const p = plan('aluminum-ingot', 30);
    expect(p.error).toBeUndefined();
    const subs = p.sinks.filter((s) => s.byproduct).map((s) => [s.item, +s.demand.toFixed(2)]);
    expect(subs).toEqual(
      expect.arrayContaining([
        ['water', 15],
        ['silica', 12.5],
      ]),
    );
    expect(one(p, 'water')).toMatchObject({ kind: 'extractor', extractor: 'water' });
  });

  it('400 Fuel com cano Mk.1 (300 m³/min) vira 2 linhas', () => {
    const p = plan('fuel', 400, { maxPipe: 1 });
    const fuel = groupsOf(p, 'fuel');
    expect(fuel).toHaveLength(2);
    for (const g of fuel) expect(g.demand).toBeCloseTo(200);
    expect(p.sinks.filter((s) => s.item === 'fuel').map((s) => s.demand)).toEqual([200, 200]);
    // com cano Mk.2 (600) cabe numa linha só
    expect(groupsOf(plan('fuel', 400, { maxPipe: 2 }), 'fuel')).toHaveLength(1);
  });

  it('Nitrogen Gas vem de poço: satélites divididos em poços de até 8, pressurizadores na conta', () => {
    // 600 m³/min com satélites puros (120) e cano Mk.2 (600): 5 satélites num poço só
    const p = plan('nitrogen-gas', 600, { ores: { 'nitrogen-gas': { purity: 'pure', tier: 1 } }, maxPipe: 2 });
    const g = one(p, 'nitrogen-gas');
    expect(g.kind).toBe('well');
    expect(g.count).toBe(5);
    expect(g.wells).toEqual([5]);
    expect(g.clock).toBeCloseTo(100);
    expect(g.power).toBeCloseTo(150);
    // 1.200 m³/min com satélites normais (60) a 100%: 2 linhas de 600 → 10 satélites cada → 2 poços de 5 por linha
    const big = plan('nitrogen-gas', 1200, { maxPipe: 2 });
    for (const w of groupsOf(big, 'nitrogen-gas')) {
      expect(w.kind).toBe('well');
      expect(Math.max(...w.wells!)).toBeLessThanOrEqual(WELL.satelliteLimit['nitrogen-gas']);
      expect(w.wells!.reduce((a, b) => a + b, 0)).toBe(w.count);
      expect(w.power).toBeCloseTo(wellPower(w.clock) * w.wells!.length);
    }
    expect(groupsOf(big, 'nitrogen-gas').flatMap((w) => w.wells)).toEqual([5, 5, 5, 5]);
  });
});
