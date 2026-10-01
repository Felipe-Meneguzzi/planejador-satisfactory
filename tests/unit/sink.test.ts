import { describe, expect, it } from 'vitest';
import { SINK, couponCost, couponsFor, sinkPoints } from '../../src/game/data';
import { mediumsMatch, portMedium } from '../../src/game/ports';
import type { SinkData } from '../../src/game/types';
import { simulate, sinkRefuses } from '../../src/sim/simulate';
import { belt, extractor, machine, merger, miner, pipe, sink } from './helpers';

/* AWESOME Sink: pontos (wiki, Module:AwesomeSinkPoints), só sólidos, custo dos cupons */

const awesome: SinkData = { kind: 'sink', mode: 'awesome' };
const problems = (r: ReturnType<typeof simulate>) => r.issues.filter((i) => i.level !== 'info');

describe('AWESOME Sink', () => {
  it('pontos do wiki por item; fluido e item proibido não têm pontos', () => {
    expect(sinkPoints('iron-ore')).toBe(1);
    expect(sinkPoints('iron-plate')).toBe(6);
    expect(sinkPoints('packaged-water')).toBe(130);
    expect(sinkPoints('water')).toBeUndefined();
    expect(sinkPoints('uranium-waste')).toBeUndefined();
    expect(SINK.power).toBe(30);
  });

  it('pontos/min = itens/min × pontos do item, e consome 30 MW enquanto recebe', () => {
    // 60 Iron Ore/min (1 ponto) e 20 Iron Plate/min (6 pontos)
    const r = simulate(
      [miner('m'), sink('k', 'awesome'), miner('m2'), machine('s', 'smelter', 'iron-ingot'), machine('c', 'constructor', 'iron-plate'), sink('k2', 'awesome')],
      [belt('b', 'm', 0, 'k', 0), belt('b2', 'm2', 0, 's', 0, 2), belt('b3', 's', 0, 'c', 0), belt('b4', 'c', 0, 'k2', 0)],
    );
    expect(r.nodes.k.points).toBeCloseTo(60);
    expect(r.nodes.k2.points).toBeCloseTo(120);
    expect(r.sink).toEqual({ count: 2, points: 180, dna: 0 });
    expect(r.nodes.k.power).toBe(30);
    expect(r.energy.consumption).toBeCloseTo(5 + 5 + 4 + 4 + 30 + 30);
    // o que vai pro Sink aparece na produção como destruído, não armazenado
    expect(r.production.find((p) => p.item === 'iron-plate')).toEqual({ item: 'iron-plate', stored: 0, loose: 0, sunk: 20 });
  });

  it('parado não consome energia', () => {
    const r = simulate([sink('k', 'awesome')], []);
    expect(r.nodes.k.power).toBe(0);
    expect(r.sink).toEqual({ count: 1, points: 0, dna: 0 });
  });

  it('conexão de cano é recusada: a entrada do Sink é só de esteira', () => {
    expect(portMedium(awesome, 'in-0')).toBe('solid');
    expect(mediumsMatch(portMedium({ kind: 'extractor', extractor: 'water', resource: 'water', purity: 'normal', clock: 100 }, 'out-0'), portMedium(awesome, 'in-0'))).toBe(
      false,
    );
    // o Armazém continua aceitando qualquer coisa
    expect(portMedium({ kind: 'sink' }, 'in-0')).toBe('any');
  });

  it('se chegar fluido mesmo assim (planta antiga), é erro e nada flui', () => {
    const r = simulate([extractor('w', 'water', 'water'), sink('k', 'awesome')], [pipe('p', 'w', 0, 'k', 0)]);
    expect(r.edges.p.flow).toBe(0);
    expect(r.edges.p.status).toBe('wrong-item');
    const issue = r.issues.find((i) => i.id === 'k:fluid');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toBe('AWESOME Sink não aceita fluidos: Water precisa ser empacotado (Packager) antes');
    // não vira "sobra" na esteira
    expect(problems(r)).toHaveLength(1);
    expect(r.nodes.k.points).toBe(0);
  });

  it('item que não vale pontos é recusado (o Sink trava a esteira)', () => {
    expect(sinkRefuses(awesome, 'uranium-waste')).toBe(true);
    expect(sinkRefuses(awesome, 'power-shard')).toBe(true);
    expect(sinkRefuses(awesome, 'water')).toBe(true);
    expect(sinkRefuses(awesome, 'iron-plate')).toBe(false);
    expect(sinkRefuses(awesome, 'mixed')).toBe(false);
    expect(sinkRefuses({ kind: 'sink' }, 'uranium-waste')).toBe(false);
  });

  it('itens misturados: aceita, mas avisa que os pontos não dá pra calcular', () => {
    const r = simulate(
      [miner('a', 'iron-ore'), miner('b', 'copper-ore'), merger('mg'), sink('k', 'awesome')],
      [belt('b1', 'a', 0, 'mg', 0), belt('b2', 'b', 0, 'mg', 1), belt('b3', 'mg', 0, 'k', 0, 2)],
    );
    expect(r.edges.b3.flow).toBeCloseTo(120);
    expect(r.issues.find((i) => i.id === 'k:mixed')?.level).toBe('warning');
  });

  it('modo Armazém continua igual (guarda e não pontua)', () => {
    const r = simulate([miner('m'), sink('k')], [belt('b', 'm', 0, 'k', 0)]);
    expect(r.production).toEqual([{ item: 'iron-ore', stored: 60, loose: 0 }]);
    expect(r.sink.count).toBe(0);
    expect(r.nodes.k.power).toBe(0);
  });
});

describe('cupons (FICSIT Coupon)', () => {
  it('custo de cada cupom segue a tabela do wiki', () => {
    expect([1, 2, 3].map(couponCost)).toEqual([500, 500, 500]);
    expect([4, 6, 7, 10, 13, 30].map(couponCost)).toEqual([1250, 1250, 2000, 3250, 5000, 21250]);
    // acumulado dos 30 primeiros: 242.250 pontos
    expect(Array.from({ length: 30 }, (_, i) => couponCost(i + 1)).reduce((a, b) => a + b, 0)).toBe(242250);
    // a partir do 2998 o custo para de subir
    expect(couponCost(2998)).toBe(249501250);
    expect(couponCost(5000)).toBe(249501250);
  });

  it('estima quantos cupons os pontos pagam, a partir dos já impressos', () => {
    expect(couponsFor(1500, 0)).toEqual({ count: 3, next: 1250, left: 0 });
    expect(couponsFor(5250, 0).count).toBe(6);
    expect(couponsFor(3249, 9)).toEqual({ count: 0, next: 3250, left: 3249 });
    expect(couponsFor(3250 * 3, 9).count).toBe(3);
  });
});
