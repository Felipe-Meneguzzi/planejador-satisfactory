import { describe, expect, it } from 'vitest';
import { simulateProject, summarizeProject, type ProjectFactory, type SimCache } from '../../src/sim/project';
import type { SimNode } from '../../src/sim/simulate';
import { belt, machine, miner, sink } from './helpers';

/* Simulação de várias fábricas ligadas por Saída externa → Entrada externa */

const outbound = (id: string, name?: string): SimNode => ({ id, data: { kind: 'outbound', ...(name ? { name } : {}) } });
const inbound = (id: string, item: string, rate: number, link?: { factory: string; node: string }): SimNode => ({
  id,
  data: { kind: 'inbound', item, rate, ...(link ? { link } : {}) },
});
const problems = (p: ReturnType<typeof simulateProject>, f: string) => p.results[f].issues.filter((i) => i.level !== 'info').map((i) => i.message);

/** Ferro: mineradora normal (60 minério) → 1 fundidora (30 lingotes) → Saída externa */
const ferro: ProjectFactory = {
  id: 'ferro',
  name: 'Ferro',
  nodes: [miner('m'), machine('s', 'smelter', 'iron-ingot'), outbound('out', 'Lingotes')],
  edges: [belt('b1', 'm', 0, 's', 0), belt('b2', 's', 0, 'out', 0)],
};
/** Placas: Entrada externa de lingotes → Constructor (pede 30) → Armazém */
const placas = (rate = 30, link: { factory: string; node: string } | null = { factory: 'ferro', node: 'out' }): ProjectFactory => ({
  id: 'placas',
  name: 'Placas',
  nodes: [inbound('in', 'iron-ingot', rate, link ?? undefined), machine('c', 'constructor', 'iron-plate'), sink('k')],
  edges: [belt('b1', 'in', 0, 'c', 0), belt('b2', 'c', 0, 'k', 0)],
});

describe('simulateProject', () => {
  it('a entrada ligada recebe o que chega na saída, em qualquer ordem das abas', () => {
    for (const list of [
      [ferro, placas(999)],
      [placas(999), ferro],
    ]) {
      const p = simulateProject(list);
      expect(p.order).toEqual(['ferro', 'placas']);
      // a vazão manual (999) é ignorada: vem os 30 lingotes que chegam na saída
      expect(p.feeds.placas.in).toMatchObject({ status: 'linked', rate: 30, delivered: { item: 'iron-ingot', rate: 30 } });
      expect(p.results.placas.production).toEqual([{ item: 'iron-plate', stored: 20, loose: 0 }]);
      expect(problems(p, 'placas')).toEqual([]);
      expect(problems(p, 'ferro')).toEqual(['Sobrando 30/min de Iron Ore: produz 60/min, consome 30/min']);
      expect(p.destinations.ferro.out).toEqual([{ factory: 'placas', factoryName: 'Placas', node: 'in', rate: 30, status: 'linked' }]);
      expect(p.outbounds).toEqual([{ factory: 'ferro', factoryName: 'Ferro', node: 'out', label: 'Lingotes', item: 'iron-ingot', rate: 30 }]);
    }
  });

  it('entrada pedindo mais do que a saída manda: aviso na entrada', () => {
    const f = { ...ferro, nodes: [miner('m'), machine('s', 'smelter', 'iron-ingot', 50), outbound('out')] };
    const p = simulateProject([f, placas()]);
    expect(p.feeds.placas.in.rate).toBeCloseTo(15);
    expect(problems(p, 'placas')).toContain('Pede 30/min, mas a saída "Iron Ingot" (Ferro) só manda 15/min');
  });

  it('item diferente: a entrada não recebe nada e avisa', () => {
    const p = simulateProject([ferro, { ...placas(), nodes: [inbound('in', 'copper-ingot', 30, { factory: 'ferro', node: 'out' }), machine('c', 'constructor', 'copper-wire'), sink('k')] }]);
    expect(p.feeds.placas.in).toMatchObject({ status: 'mismatch', rate: 0 });
    expect(problems(p, 'placas')).toContain('Item diferente: a saída "Lingotes" (Ferro) manda Iron Ingot, esta entrada espera Copper Ingot');
  });

  it('ciclo entre fábricas: usa a vazão manual e avisa', () => {
    // A manda pra B e B manda pra A
    const a: ProjectFactory = {
      id: 'a',
      name: 'A',
      nodes: [inbound('in', 'iron-ingot', 12, { factory: 'b', node: 'out' }), outbound('out')],
      edges: [belt('e', 'in', 0, 'out', 0)],
    };
    const b: ProjectFactory = {
      id: 'b',
      name: 'B',
      nodes: [inbound('in', 'iron-ingot', 7, { factory: 'a', node: 'out' }), outbound('out')],
      edges: [belt('e', 'in', 0, 'out', 0)],
    };
    const p = simulateProject([a, b]);
    expect(p.cycles).toEqual([expect.arrayContaining(['a', 'b'])]);
    expect(p.feeds.a.in).toMatchObject({ status: 'cycle', rate: 12 });
    expect(p.feeds.b.in).toMatchObject({ status: 'cycle', rate: 7 });
    expect(p.results.a.transfers.exports).toEqual([{ node: 'out', item: 'iron-ingot', rate: 12 }]);
    expect(problems(p, 'a')).toEqual(['Ciclo entre as fábricas A, B: não dá pra saber o que chega, usando a vazão manual de 12/min']);
    // fábrica fora do ciclo que puxa dele continua seguindo a ordem
    const c: ProjectFactory = { id: 'c', name: 'C', nodes: [inbound('in', 'iron-ingot', 1, { factory: 'b', node: 'out' }), sink('k')], edges: [belt('e', 'in', 0, 'k', 0)] };
    const p2 = simulateProject([c, a, b]);
    expect(p2.order.indexOf('c')).toBe(2);
    expect(p2.feeds.c.in).toMatchObject({ status: 'linked' });
    // a saída de B (7/min) é dividida entre A (em ciclo, não conta) e C
    expect(p2.feeds.c.in.rate).toBeCloseTo(7);
  });

  it('saída sem ninguém ligado e link quebrado avisam', () => {
    const p = simulateProject([ferro, placas(25, { factory: 'sumiu', node: 'x' })]);
    expect(problems(p, 'ferro')).toContain('Nenhuma Entrada externa ligada: 30/min de Iron Ingot não vão pra lugar nenhum');
    expect(p.feeds.placas.in).toMatchObject({ status: 'missing', rate: 25 });
    expect(problems(p, 'placas')).toContain('A Saída externa ligada não existe mais (fábrica ou node apagado): usando a vazão manual de 25/min');
  });

  it('várias entradas na mesma saída dividem a vazão igualmente', () => {
    const outra: ProjectFactory = { ...placas(), id: 'outra', name: 'Outra' };
    const p = simulateProject([ferro, placas(), outra]);
    expect(p.feeds.placas.in).toMatchObject({ rate: 15, sharedBy: 2 });
    expect(p.feeds.outra.in.rate).toBe(15);
  });

  it('o cache só simula de novo a fábrica que mudou', () => {
    const cache: SimCache = new Map();
    const withKey = (f: ProjectFactory) => ({ ...f, key: JSON.stringify([f.nodes, f.edges]) });
    const first = simulateProject([withKey(ferro), withKey(placas())], cache);
    const again = simulateProject([withKey(ferro), withKey(placas())], cache);
    expect(again.results.ferro.nodes).toBe(first.results.ferro.nodes);
    // mudar o clock da fundidora muda o que chega em Placas: as duas são simuladas de novo
    const slow = withKey({ ...ferro, nodes: [miner('m'), machine('s', 'smelter', 'iron-ingot', 50), outbound('out', 'Lingotes')] });
    const changed = simulateProject([slow, withKey(placas())], cache);
    expect(changed.results.ferro.nodes).not.toBe(first.results.ferro.nodes);
    expect(changed.feeds.placas.in.rate).toBeCloseTo(15);
  });
});

describe('summarizeProject', () => {
  it('por fábrica e no total: energia, máquinas, importa/exporta, produção e pontos', () => {
    const names = [ferro, placas()].map(({ id, name }) => ({ id, name }));
    const s = summarizeProject(names, simulateProject([ferro, placas()]));
    const [f, p] = s.factories;
    expect(f).toMatchObject({ name: 'Ferro', machines: 2, imports: [], exports: [{ item: 'iron-ingot', rate: 30, to: ['Placas'] }] });
    expect(f.consumption).toBeCloseTo(5 + 4);
    expect(p).toMatchObject({ name: 'Placas', machines: 1, imports: [{ item: 'iron-ingot', rate: 30, from: 'Ferro' }], exports: [] });
    expect(s.total.machines).toBe(3);
    expect(s.total.consumption).toBeCloseTo(5 + 4 + 4);
    expect(s.total.production).toEqual([{ item: 'iron-plate', stored: 20, loose: 0 }]);
    expect(s.total.fromOutside).toEqual([]);
    expect(s.total.unclaimed).toEqual([]);
    expect(s.total.warnings).toBe(1);
  });

  it('entrada manual vem de fora do projeto; saída sem destino entra no "sem destino"', () => {
    const lone = placas(30, null);
    const s = summarizeProject(
      [
        { id: 'ferro', name: 'Ferro' },
        { id: 'placas', name: 'Placas' },
      ],
      simulateProject([ferro, lone]),
    );
    expect(s.factories[1].imports).toEqual([{ node: 'in', item: 'iron-ingot', rate: 30, from: 'fora do projeto' }]);
    expect(s.total.fromOutside).toEqual([{ item: 'iron-ingot', rate: 30 }]);
    expect(s.total.unclaimed).toEqual([{ item: 'iron-ingot', rate: 30 }]);
    expect(s.factories[0].exports[0].to).toEqual([]);
  });
});
