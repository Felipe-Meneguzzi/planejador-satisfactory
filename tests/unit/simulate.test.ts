import { describe, expect, it } from 'vitest';
import { simulate, type SimEdge, type SimNode } from '../../src/sim/simulate';
import { demoPlant } from '../../src/state/storage';
import { belt, extractor, machine, merger, miner, pipe, sink, splitter, well } from './helpers';

/** só os problemas que aparecem no painel (erro/aviso) */
const problems = (r: ReturnType<typeof simulate>) => r.issues.filter((i) => i.level !== 'info');

describe('simulate', () => {
  it('avisa sobra com os números (60 produz / 45 consome)', () => {
    // mineradora normal Mk.1 (60/min) → fundidora a 150% (consome 45/min)
    const r = simulate([miner('m'), machine('s', 'smelter', 'iron-ingot', 150)], [belt('b', 'm', 0, 's', 0)]);
    expect(r.edges.b.status).toBe('excess');
    expect(r.edges.b.flow).toBeCloseTo(45);
    const excess = r.issues.find((i) => i.id === 'b:excess');
    expect(excess?.level).toBe('warning');
    expect(excess?.message).toBe('Sobrando 15/min de Iron Ore: produz 60/min, consome 45/min');
  });

  it('acusa esteira fraca e sugere o Mk que aguenta', () => {
    // mineradora pura Mk.1 = 120/min numa esteira Mk.1 (60/min)
    const r = simulate([miner('m', 'iron-ore', 'pure'), sink('k')], [belt('b', 'm', 0, 'k', 0, 1)]);
    expect(r.edges.b.status).toBe('bottleneck');
    expect(r.edges.b.flow).toBeCloseTo(60);
    const issue = r.issues.find((i) => i.id === 'b:belt');
    expect(issue?.level).toBe('error');
    expect(issue?.fixTier).toBe(2);
    expect(issue?.fixPipe).toBeUndefined();
    expect(issue?.message).toMatch(/^Esteira Mk\.1 frac\w*: precisa levar 120\/min, aguenta 60\/min$/);

    // com Mk.2 o problema some
    const ok = simulate([miner('m', 'iron-ore', 'pure'), sink('k')], [belt('b', 'm', 0, 'k', 0, 2)]);
    expect(problems(ok)).toEqual([]);
    expect(ok.edges.b.flow).toBeCloseTo(120);
  });

  it('escreve "fraca" (feminino) na mensagem de esteira fraca', () => {
    const r = simulate([miner('m', 'iron-ore', 'pure'), sink('k')], [belt('b', 'm', 0, 'k', 0, 1)]);
    expect(r.issues.find((i) => i.id === 'b:belt')?.message).toBe('Esteira Mk.1 fraca: precisa levar 120/min, aguenta 60/min');
  });

  it('divisor + mesclador balanceados não geram problema', () => {
    // 60 minério → divisor → 2 fundidoras (30 cada) → mesclador → armazém
    const nodes: SimNode[] = [
      miner('m'),
      splitter('sp'),
      machine('s1', 'smelter', 'iron-ingot'),
      machine('s2', 'smelter', 'iron-ingot'),
      merger('mg'),
      sink('k'),
    ];
    const edges: SimEdge[] = [
      belt('b1', 'm', 0, 'sp', 0),
      belt('b2', 'sp', 0, 's1', 0),
      belt('b3', 'sp', 2, 's2', 0),
      belt('b4', 's1', 0, 'mg', 0),
      belt('b5', 's2', 0, 'mg', 2),
      belt('b6', 'mg', 0, 'k', 0),
    ];
    const r = simulate(nodes, edges);
    expect(problems(r)).toEqual([]);
    expect(r.edges.b2.flow).toBeCloseTo(30);
    expect(r.edges.b3.flow).toBeCloseTo(30);
    expect(r.edges.b6.flow).toBeCloseTo(60);
    expect(r.edges.b6.item).toBe('iron-ingot');
    expect(r.nodes.s1.util).toBeCloseTo(1);
    expect(r.production).toEqual([{ item: 'iron-ingot', stored: 60, loose: 0 }]);
  });

  it('o exemplo padrão acusa a sobra de lingotes (e, por back-pressure, de minério)', () => {
    const demo = demoPlant();
    const r = simulate(
      demo.nodes.map((n) => ({ id: n.id, data: n.data })),
      demo.edges.map((e) => ({ ...e, tier: e.data!.tier, medium: 'belt' as const })),
    );
    expect(problems(r).map((i) => i.message).sort()).toEqual([
      'Sobrando 30/min de Iron Ingot: produz 60/min, consome 30/min',
      'Sobrando 30/min de Iron Ore: produz 60/min, consome 30/min',
    ]);
    expect(r.edges.b7.flow).toBeCloseTo(20);
  });

  it('avisa falta de insumo (starve) e reduz a utilização', () => {
    // mineradora impura (30/min) numa fundidora a 200% (precisa de 60/min)
    const r = simulate([miner('m', 'iron-ore', 'impure'), machine('s', 'smelter', 'iron-ingot', 200)], [belt('b', 'm', 0, 's', 0)]);
    const issue = r.issues.find((i) => i.id === 's:starve0');
    expect(issue?.level).toBe('warning');
    expect(issue?.message).toBe('Falta Iron Ore: recebe 30 de 60/min (50%)');
    expect(r.nodes.s.util).toBeCloseTo(0.5);
    expect(r.nodes.s.outputs[0].actual).toBeCloseTo(30);
  });

  it('recusa item errado na entrada da máquina', () => {
    const r = simulate([miner('m', 'copper-ore'), machine('s', 'smelter', 'iron-ingot')], [belt('b', 'm', 0, 's', 0)]);
    expect(r.edges.b.status).toBe('wrong-item');
    expect(r.edges.b.flow).toBe(0);
    const issue = r.issues.find((i) => i.id === 'b:wrong');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toBe('Copper Ore não serve aqui — a máquina espera Iron Ore');
    expect(r.nodes.s.util).toBe(0);
  });

  it('Foundry com 2 entradas fica limitada pela menor', () => {
    // Steel Ingot: 45 minério + 45 carvão → 45 aço; o carvão só chega 30/min
    const r = simulate(
      [miner('fe'), miner('c', 'coal', 'impure'), machine('f', 'foundry', 'steel-ingot'), sink('k')],
      [belt('b1', 'fe', 0, 'f', 0), belt('b2', 'c', 0, 'f', 1), belt('b3', 'f', 0, 'k', 0)],
    );
    expect(r.nodes.f.util).toBeCloseTo(2 / 3);
    expect(r.edges.b3.flow).toBeCloseTo(30);
    // back-pressure: a entrada de minério só puxa o que a máquina consegue usar
    expect(r.edges.b1.flow).toBeCloseTo(30);
    expect(r.issues.find((i) => i.id === 'f:starve1')?.message).toBe('Falta Coal: recebe 30 de 45/min (67%)');
    expect(r.issues.find((i) => i.id === 'b1:excess')?.message).toBe('Sobrando 30/min de Iron Ore: produz 60/min, consome 30/min');
  });

  describe('Somersloop', () => {
    it('Constructor Iron Plate 1/1 → 40/min e 16 MW (insumo não muda)', () => {
      const r = simulate([machine('a', 'constructor', 'iron-plate', 100, 1)], []);
      expect(r.nodes.a.outputs[0].max).toBeCloseTo(40);
      expect(r.nodes.a.inputs[0].max).toBeCloseTo(30);
      expect(r.nodes.a.power).toBeCloseTo(16);
      expect(r.sloops).toBe(1);
    });

    it('Manufacturer 4/4 a 250% → energia 13,431× a base', () => {
      const r = simulate([machine('a', 'manufacturer', 'computer', 250, 4)], []);
      // Computer: 2,5/min a 100%; ×2,5 de clock ×2 de amplificação
      expect(r.nodes.a.outputs[0].max).toBeCloseTo(12.5);
      expect(r.nodes.a.power / 55).toBeCloseTo(13.431, 2);
      expect(r.sloops).toBe(4);
    });

    it('limita aos slots da máquina (Smelter aceita só 1)', () => {
      const r = simulate([machine('a', 'smelter', 'iron-ingot', 100, 3)], []);
      expect(r.nodes.a.outputs[0].max).toBeCloseTo(60);
      expect(r.sloops).toBe(1);
    });
  });

  it('acusa cano fraco (Mk.1 300 m³/min com 480) e sugere Mk.2', () => {
    // 2 extratores de petróleo puros (240 cada) → junção → cano Mk.1 → armazém
    const r = simulate(
      [extractor('o1', 'oil', 'crude-oil', 'pure'), extractor('o2', 'oil', 'crude-oil', 'pure'), merger('j', true), sink('k')],
      [pipe('a', 'o1', 0, 'j', 0), pipe('b', 'o2', 0, 'j', 1), pipe('c', 'j', 0, 'k', 0, 1)],
    );
    expect(r.edges.c.pipe).toBe(true);
    expect(r.edges.c.cap).toBe(300);
    expect(r.edges.c.status).toBe('bottleneck');
    const issue = r.issues.find((i) => i.id === 'c:belt');
    expect(issue?.level).toBe('error');
    expect(issue?.fixTier).toBe(2);
    expect(issue?.fixPipe).toBe(true); // o botão de correção fala de cano, não de esteira
    expect(issue?.message).toBe('Cano Mk.1 fraco: precisa levar 480 m³/min, aguenta 300 m³/min');
  });

  it('avisa subproduto sem destino (Refinery Plastic com só a saída principal ligada)', () => {
    // petróleo impuro (60 m³/min) → 1 refinaria a 200%, que puxa exatamente 60 m³/min
    const r = simulate(
      [extractor('o', 'oil', 'crude-oil', 'impure'), machine('r', 'refinery', 'plastic', 200), sink('k')],
      [pipe('p', 'o', 0, 'r', 0), belt('b', 'r', 0, 'k', 0, 2)],
    );
    const issue = r.issues.find((i) => i.id === 'r:free1');
    expect(issue?.level).toBe('warning');
    expect(issue?.message).toMatch(/^Subproduto sem destino: 20 m³\/min de Heavy Oil Residue/);
    expect(problems(r)).toHaveLength(1);
    // sem nenhuma saída ligada, é só uma prévia (info)
    const preview = simulate(
      [extractor('o', 'oil', 'crude-oil', 'impure'), machine('r', 'refinery', 'plastic', 200)],
      [pipe('p', 'o', 0, 'r', 0)],
    );
    expect(preview.issues.find((i) => i.id === 'r:free1')?.level).toBe('info');
  });

  it('poço: o clock do pressurizador vale pros satélites e só o pressurizador consome energia', () => {
    const r = simulate([well('w', 'nitrogen-gas', ['pure'], 250), sink('k')], [pipe('p', 'w', 0, 'k', 0, 2)]);
    expect(r.nodes.w.outputs[0].max).toBeCloseTo(300);
    expect(r.edges.p.flow).toBeCloseTo(300);
    expect(r.edges.p.item).toBe('nitrogen-gas');
    // 150 MW × 2,5^1,321928 (wiki: 503,66 MW a 250%)
    expect(r.nodes.w.power).toBeCloseTo(503.66, 1);
    expect(problems(r)).toEqual([]);
    expect(r.production).toEqual([{ item: 'nitrogen-gas', stored: 300, loose: 0 }]);
  });
});
