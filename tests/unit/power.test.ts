import { describe, expect, it } from 'vitest';
import { GENERATORS, WELL, generatorPorts } from '../../src/game/data';
import type { GeneratorData } from '../../src/game/types';
import { augmentedGeneration, simulate, wellPower } from '../../src/sim/simulate';
import { belt, extractor, generator, machine, miner, pipe, sink, well } from './helpers';

/*
 * Energia: geradores, saldo da rede, Alien Power Augmenter e poço de recurso.
 * Números de referência: satisfactory.wiki.gg (1.2), os mesmos de src/game/gamedata.json.
 */

const problems = (r: ReturnType<typeof simulate>) => r.issues.filter((i) => i.level !== 'info');
const gen = (generatorId: string, fuel?: string, clock = 100): GeneratorData => ({ kind: 'generator', generator: generatorId, fuel, clock });

describe('consumo dos geradores a 100% (wiki)', () => {
  it('Coal-Powered Generator: 15 Coal + 45 m³ de água por minuto, 75 MW', () => {
    const p = generatorPorts(gen('coal-powered-generator', 'coal'));
    expect(p.inputs.map((x) => [x.item, x.rate])).toEqual([
      ['coal', 15],
      ['water', 45],
    ]);
    expect(p.outputs).toEqual([]);
    expect(GENERATORS['coal-powered-generator'].power).toBe(75);
  });

  it('Coal-Powered Generator: Compacted Coal 7,142857/min e Petroleum Coke 25/min', () => {
    expect(generatorPorts(gen('coal-powered-generator', 'compacted-coal')).inputs[0].rate).toBeCloseTo(7.142857, 5);
    expect(generatorPorts(gen('coal-powered-generator', 'petroleum-coke')).inputs[0].rate).toBeCloseTo(25);
  });

  it('Fuel-Powered Generator: 20 m³ de Fuel, sem água, 250 MW', () => {
    const p = generatorPorts(gen('fuel-powered-generator', 'fuel'));
    expect(p.inputs).toHaveLength(1);
    expect(p.inputs[0]).toMatchObject({ item: 'fuel', rate: 20 });
    expect(generatorPorts(gen('fuel-powered-generator', 'rocket-fuel')).inputs[0].rate).toBeCloseTo(60 / 14.4, 6);
    expect(GENERATORS['fuel-powered-generator'].power).toBe(250);
  });

  it('Nuclear Power Plant: 0,2 barra + 240 m³ de água e 10 de Uranium Waste por minuto', () => {
    const p = generatorPorts(gen('nuclear-power-plant', 'uranium-fuel-rod'));
    expect(p.inputs.map((x) => [x.item, +x.rate.toFixed(6)])).toEqual([
      ['uranium-fuel-rod', 0.2],
      ['water', 240],
    ]);
    expect(p.outputs.map((x) => [x.item, +x.rate.toFixed(6)])).toEqual([['uranium-waste', 10]]);
    // Plutonium: 0,1 barra → 1 de resíduo; Ficsonium não deixa resíduo
    expect(generatorPorts(gen('nuclear-power-plant', 'plutonium-fuel-rod')).outputs[0].rate).toBeCloseTo(1);
    expect(generatorPorts(gen('nuclear-power-plant', 'ficsonium-fuel-rod')).outputs).toEqual([]);
  });

  it('Biomass Burner: 4 Solid Biofuel/min a 30 MW', () => {
    expect(generatorPorts(gen('biomass-burner', 'solid-biofuel')).inputs).toEqual([{ item: 'solid-biofuel', rate: 4 }]);
  });

  it('combustível inválido cai no primeiro aceito pelo gerador', () => {
    expect(generatorPorts(gen('coal-powered-generator', 'fuel')).inputs[0].item).toBe('coal');
  });
});

describe('geradores na simulação', () => {
  it('Coal a 100% com carvão e água sobrando gera 75 MW e consome 15 + 45', () => {
    const r = simulate(
      [miner('c', 'coal'), extractor('w', 'water', 'water'), generator('g', 'coal-powered-generator', 'coal')],
      [belt('b', 'c', 0, 'g', 0), pipe('p', 'w', 0, 'g', 1)],
    );
    expect(r.nodes.g.generated).toBeCloseTo(75);
    expect(r.nodes.g.util).toBeCloseTo(1);
    expect(r.edges.b.flow).toBeCloseTo(15);
    expect(r.edges.p.flow).toBeCloseTo(45);
    expect(r.energy.fuel).toEqual([
      { item: 'coal', rate: 15 },
      { item: 'water', rate: 45 },
    ]);
  });

  it('consumo, água e geração escalam 1:1 com o clock (250% = 3 shards)', () => {
    const r = simulate([generator('g', 'coal-powered-generator', 'coal', 250)], []);
    expect(r.nodes.g.inputs[0].max).toBeCloseTo(37.5);
    expect(r.nodes.g.inputs[1].max).toBeCloseTo(112.5);
    // sem combustível não gera nada, mas a capacidade nominal é 187,5 MW
    expect(r.nodes.g.generated).toBe(0);
    expect(r.energy.byType).toEqual([{ generator: 'coal-powered-generator', count: 1, generated: 0, nominal: 187.5 }]);
    const n = simulate([generator('n', 'nuclear-power-plant', 'uranium-fuel-rod', 250)], []);
    expect(n.nodes.n.inputs[0].max).toBeCloseTo(0.5);
    expect(n.nodes.n.inputs[1].max).toBeCloseTo(600);
    expect(n.nodes.n.outputs[0].max).toBeCloseTo(25);
    const f = simulate([generator('f', 'fuel-powered-generator', 'fuel', 50)], []);
    expect(f.nodes.f.inputs[0].max).toBeCloseTo(10);
    expect(f.energy.byType[0].nominal).toBeCloseTo(125);
  });

  it('falta de carvão: gera proporcional ao que chega e acusa "Falta Coal"', () => {
    // carvão impuro Mk.1 = 30/min; gerador a 250% pede 37,5 → 80%
    const r = simulate(
      [miner('c', 'coal', 'impure'), extractor('w', 'water', 'water'), generator('g', 'coal-powered-generator', 'coal', 250)],
      [belt('b', 'c', 0, 'g', 0), pipe('p', 'w', 0, 'g', 1)],
    );
    expect(r.nodes.g.util).toBeCloseTo(0.8);
    expect(r.nodes.g.generated).toBeCloseTo(150);
    // a água só é puxada na proporção do que dá pra queimar
    expect(r.edges.p.flow).toBeCloseTo(90);
    const issue = r.issues.find((i) => i.id === 'g:starve0');
    expect(issue?.level).toBe('warning');
    expect(issue?.message).toBe('Falta Coal: recebe 30 de 37,5/min (80%) — gera 150 de 187,5 MW');
  });

  it('falta de água também limita a geração', () => {
    // extrator de água a 30% = 36 m³/min; o gerador pede 45
    const r = simulate(
      [miner('c', 'coal'), extractor('w', 'water', 'water', 'normal', 30), generator('g', 'coal-powered-generator', 'coal')],
      [belt('b', 'c', 0, 'g', 0), pipe('p', 'w', 0, 'g', 1)],
    );
    expect(r.nodes.g.generated).toBeCloseTo(60);
    expect(r.edges.b.flow).toBeCloseTo(12);
    expect(r.issues.find((i) => i.id === 'g:starve1')?.message).toBe('Falta Water: recebe 36 de 45 m³/min (80%) — gera 60 de 75 MW');
  });

  it('gerador sem esteira/cano avisa o que falta e não gera', () => {
    const r = simulate([generator('n', 'nuclear-power-plant', 'uranium-fuel-rod')], []);
    expect(r.nodes.n.generated).toBe(0);
    const msgs = problems(r).map((i) => i.message);
    expect(msgs).toContain('Falta Uranium Fuel Rod: entrada sem esteira — precisa de 0,2/min (gera 0 de 2.500 MW)');
    expect(msgs).toContain('Falta Water: entrada sem cano — precisa de 240 m³/min (gera 0 de 2.500 MW)');
  });

  it('item errado na entrada do gerador é recusado', () => {
    const r = simulate([miner('m', 'iron-ore'), generator('g', 'coal-powered-generator', 'coal')], [belt('b', 'm', 0, 'g', 0)]);
    expect(r.edges.b.status).toBe('wrong-item');
    expect(r.issues.find((i) => i.id === 'b:wrong')?.message).toBe('Iron Ore não serve aqui — o gerador espera Coal');
  });

  it('Geothermal Generator: 100 / 200 / 400 MW (média) por pureza, sem overclock', () => {
    for (const [purity, mw] of [
      ['impure', 100],
      ['normal', 200],
      ['pure', 400],
    ] as const) {
      const r = simulate([generator('g', 'geothermal-generator', undefined, 250, purity)], []);
      expect(r.nodes.g.generated).toBe(mw);
      expect(r.nodes.g.inputs).toEqual([]);
      expect(problems(r)).toEqual([]);
    }
  });
});

describe('Alien Power Augmenter', () => {
  it('fórmula do wiki: (geração + 500 × APAs) × (1 + 0,1 sem combustível / 0,3 abastecido)', () => {
    // exemplos do wiki: 5000 MW + 1 APA sem combustível = 6050; + 2 = 7200
    expect(augmentedGeneration(5000 + 500, [0]).generation).toBeCloseTo(6050);
    expect(augmentedGeneration(5000 + 1000, [0, 0]).generation).toBeCloseTo(7200);
    expect(augmentedGeneration(5000 + 500, [1])).toEqual({ rate: 0.3, generation: 5500 * 1.3 });
    // metade da Alien Power Matrix: bônus médio de 20%
    expect(augmentedGeneration(1000, [0.5]).rate).toBeCloseTo(0.2);
  });

  it('na simulação o bônus vale pra rede inteira (Geothermal normal + APA = 770 MW)', () => {
    const r = simulate([generator('geo', 'geothermal-generator', undefined, 100, 'normal'), generator('apa', 'alien-power-augmenter', 'alien-power-matrix')], []);
    expect(r.nodes.apa.generated).toBe(500);
    expect(r.energy.base).toBeCloseTo(700);
    expect(r.energy.boostRate).toBeCloseTo(0.1);
    expect(r.energy.boost).toBeCloseTo(70);
    expect(r.energy.generation).toBeCloseTo(770);
    // sem a matriz é só informação, não problema
    expect(problems(r)).toEqual([]);
    expect(r.issues.find((i) => i.id === 'apa:nofuel0')?.level).toBe('info');
  });
});

describe('saldo de energia', () => {
  it('consumo total × geração total, com % de uso da rede', () => {
    // mineradora Mk.1 (5 MW) + extrator de água (20 MW) alimentando o próprio gerador a carvão (75 MW)
    const r = simulate(
      [miner('c', 'coal'), extractor('w', 'water', 'water'), generator('g', 'coal-powered-generator', 'coal')],
      [belt('b', 'c', 0, 'g', 0), pipe('p', 'w', 0, 'g', 1)],
    );
    expect(r.energy.consumption).toBeCloseTo(25);
    expect(r.power).toBeCloseTo(25);
    expect(r.energy.generation).toBeCloseTo(75);
    expect(r.energy.usage).toBeCloseTo(1 / 3);
    expect(r.energy.generators).toBe(1);
    expect(r.issues.some((i) => i.id.endsWith(':nopower'))).toBe(false);
  });

  it('geração menor que o consumo vira erro "Falta energia"', () => {
    // Biomass Burner sem combustível: 0 MW pra uma mineradora de 5 MW
    const r = simulate([miner('m'), generator('b', 'biomass-burner', 'solid-biofuel')], []);
    const issue = r.issues.find((i) => i.id === 'b:nopower');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toMatch(/^Falta energia: consumo de 5 MW, geração de 0 MW — faltam 5 MW/);
    expect(r.energy.usage).toBe(Infinity);
  });

  it('sem nenhum gerador não acusa falta de energia (a energia vem de fora)', () => {
    const r = simulate([miner('m'), machine('s', 'smelter', 'iron-ingot')], [belt('b', 'm', 0, 's', 0)]);
    expect(r.energy.generators).toBe(0);
    expect(r.energy.usage).toBeNull();
    expect(r.issues.some((i) => i.id.endsWith(':nopower'))).toBe(false);
  });

  it('pressurizador entra no consumo', () => {
    const r = simulate([well('w', 'water', ['normal']), generator('g', 'geothermal-generator', undefined, 100, 'impure')], []);
    expect(r.energy.consumption).toBeCloseTo(150);
    expect(r.issues.find((i) => i.id === 'g:nopower')?.message).toMatch(/faltam 50 MW/);
  });
});

describe('poço de recurso (Resource Well Pressurizer)', () => {
  it('energia: 150 MW a 100% e 150 × clock^1,321928 com overclock (wiki)', () => {
    expect(wellPower(100)).toBeCloseTo(150);
    expect(wellPower(250)).toBeCloseTo(503.66, 1);
    expect(wellPower(200)).toBeCloseTo(375, 1);
    expect(wellPower(50)).toBeCloseTo(60, 1);
  });

  it('o clock do pressurizador multiplica a extração de todos os satélites', () => {
    const r = simulate([well('w', 'crude-oil', ['impure', 'normal', 'pure'], 200)], []);
    expect(r.nodes.w.outputs.map((o) => o.max)).toEqual([60, 120, 240]);
    expect(r.nodes.w.power).toBeCloseTo(375, 1);
    // satélites sem cano: produção livre, uma informação só
    expect(r.production).toEqual([{ item: 'crude-oil', stored: 0, loose: 420 }]);
    expect(r.issues.filter((i) => i.id.startsWith('w:free'))).toHaveLength(1);
  });

  it('o consumo não depende dos satélites e poço vazio é avisado', () => {
    const one = simulate([well('w', 'nitrogen-gas', ['pure'])], []);
    const many = simulate([well('w', 'nitrogen-gas', ['pure', 'pure', 'pure', 'pure'])], []);
    expect(one.nodes.w.power).toBeCloseTo(many.nodes.w.power);
    const empty = simulate([well('w', 'nitrogen-gas', [])], []);
    expect(empty.nodes.w.power).toBeCloseTo(150);
    expect(empty.issues.find((i) => i.id === 'w:nosat')?.level).toBe('warning');
  });

  it('cada satélite tem a própria saída de cano', () => {
    const r = simulate(
      [well('w', 'water', ['normal', 'pure']), sink('a'), sink('b')],
      [pipe('p0', 'w', 0, 'a', 0), pipe('p1', 'w', 1, 'b', 0)],
    );
    expect(r.edges.p0.flow).toBeCloseTo(60);
    expect(r.edges.p1.flow).toBeCloseTo(120);
    expect(problems(r)).toEqual([]);
  });

  it('limite de satélites por poço do gerador: média do mapa arredondada pra cima', () => {
    // Nitrogen Gas: 45 satélites em 6 poços; Crude Oil: 18 em 3; Water: 55 em 8
    expect(WELL.satelliteLimit).toEqual({ 'nitrogen-gas': 8, 'crude-oil': 6, water: 7 });
    expect(WELL.maxSatellites).toBe(8);
  });
});
