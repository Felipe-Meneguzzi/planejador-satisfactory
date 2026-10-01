import { RECIPES, type Recipe } from '../game/data';
import type { ItemId } from '../game/types';
import { busItems, copiesFor, recipeParts, type Optimized, type Part } from './optimize';
import { MINE, buildGroup, capOfSettings, isResource, planLine, recipesProducing, type Bus, type BusSource, type Group, type GroupSettings, type Lane, type Plan, type SinkPlan } from './plan';

/*
 * Plano (grupos, faixas, armazéns) a partir da solução do otimizador.
 *
 * 1) Se a solução é uma "árvore" (cada item com uma fonte só, nenhum subproduto reaproveitado,
 *    nada sobrando além dos subprodutos), ela é exatamente o que o modo manual faria com essas
 *    receitas: usa o planLine e o resultado é idêntico ao do modo "Eu escolho as receitas".
 *
 * 2) Senão, um item pode ter várias fontes (grupo principal + subprodutos de outros grupos, ou
 *    duas receitas). Estratégia: BARRAMENTO por item. Todas as fontes do item vão inteiras pra
 *    um mesclador; a soma delas é exatamente a soma das faixas que consomem o item (mais a
 *    sobra, que vira uma faixa pra um armazém). Daí o barramento divide pras faixas como um
 *    grupo comum. No water-filling, mesclador com oferta total = demanda consome tudo de todas
 *    as entradas e divisor com demanda total = oferta entrega a demanda exata de cada saída,
 *    então a linha fecha em 100% sem nenhuma esteira de "transbordo".
 *
 *    Mk máximo: o barramento tem que caber numa esteira/cano. Em vez de particionar fonte a
 *    fonte (um subproduto está preso à saída principal do grupo dele, e cortar um grupo mexe
 *    em outro item, em cascata), a linha inteira é dividida em N CÓPIAS iguais, com N = o
 *    menor número que faz o fluxo total de cada item caber no Mk máximo. Cada cópia é uma
 *    linha completa que fecha sozinha. Custa algumas máquinas a mais (arredondamento por
 *    cópia), mas é sempre exato.
 */

export type OptimizedPlanSettings = GroupSettings & { item: ItemId };

const TINY = 1e-7;

export function planOptimized(opt: Optimized, s: OptimizedPlanSettings): Plan {
  if (opt.error) return { groups: [], sinks: [], external: [], levels: {}, power: 0, shards: 0, error: opt.error };
  return asTree(opt, s) ?? planWithBuses(opt, s);
}

/** Receitas/extração por item se a solução for uma árvore; senão undefined */
function asTree(opt: Optimized, s: OptimizedPlanSettings): Plan | undefined {
  if (opt.byproducts.some((b) => b.reused > TINY)) return undefined;
  const byproductStored = new Map(opt.byproducts.map((b) => [b.item, b.stored]));
  // sobra só pode ser de subproduto (que vai pro armazém como no modo manual)
  for (const [item, v] of Object.entries(opt.excess)) if (Math.abs((byproductStored.get(item) ?? 0) - v) > 1e-6) return undefined;
  const choices: Record<ItemId, string> = {};
  for (const { recipe } of opt.recipes) {
    const item = recipe.outputs[0].item;
    if (choices[item]) return undefined;
    choices[item] = recipe.id;
  }
  for (const item of Object.keys(opt.extraction)) {
    if (choices[item]) return undefined;
    choices[item] = MINE;
  }
  // de fora: o manual só faz isso com item que não tem receita nenhuma
  for (const item of Object.keys(opt.external)) if (choices[item] || recipesProducing(item).length || isResource(item)) return undefined;

  const plan = planLine({ item: s.item, rate: opt.rate, choices, ores: s.ores, maxClock: s.maxClock, maxBelt: s.maxBelt, maxPipe: s.maxPipe });
  if (plan.error) return undefined;
  // confere: cada receita roda o mesmo que na solução e cada recurso é extraído na mesma quantidade
  const machines = new Map<string, number>();
  const extracted = new Map<ItemId, number>();
  for (const g of plan.groups) {
    if (g.recipe) machines.set(g.recipe.id, (machines.get(g.recipe.id) ?? 0) + g.demand / g.recipe.outputs[0].rate);
    else extracted.set(g.item, (extracted.get(g.item) ?? 0) + g.demand);
  }
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  if (machines.size !== opt.recipes.length || !opt.recipes.every((r) => close(machines.get(r.recipe.id) ?? 0, r.machines))) return undefined;
  if (extracted.size !== Object.keys(opt.extraction).length || !Object.entries(opt.extraction).every(([k, v]) => close(extracted.get(k) ?? 0, v))) return undefined;
  return plan;
}

/** Nível de cada item no desenho (minério à esquerda); laços são cortados na volta */
function itemLevels(opt: Optimized): Record<ItemId, number> {
  const producers = new Map<ItemId, Recipe[]>();
  for (const { recipe } of opt.recipes) {
    const k = recipe.outputs[0].item;
    producers.set(k, [...(producers.get(k) ?? []), recipe]);
  }
  const levels: Record<ItemId, number> = {};
  const visiting = new Set<ItemId>();
  const level = (item: ItemId): number => {
    if (levels[item] !== undefined) return levels[item];
    if (visiting.has(item)) return 0;
    visiting.add(item);
    let v = 0;
    for (const r of producers.get(item) ?? []) v = Math.max(v, 1 + Math.max(0, ...r.inputs.map((p) => level(p.item))));
    visiting.delete(item);
    levels[item] = v;
    return v;
  };
  for (const { recipe } of opt.recipes) for (const p of [...recipe.inputs, ...recipe.outputs]) level(p.item);
  return levels;
}

function planWithBuses(opt: Optimized, s: OptimizedPlanSettings): Plan {
  const levels = itemLevels(opt);
  levels[s.item] ??= 0;
  const capOf = capOfSettings(s);
  const copies = copiesFor(opt, s);
  const parts = recipeParts(opt, copies).parts;
  const bus = busItems(opt);
  const overflow = new Map(Object.entries(opt.overflow));

  // itens de uma fonte só, dos consumidores pros produtores (como no modo manual): quando um
  // deles é montado, todas as faixas que pedem ele já existem. Laço sempre passa por um item de
  // barramento (laço só de itens de uma fonte não teria semente), e esses são montados antes.
  const producer = new Map<ItemId, Part>();
  for (const p of parts) if (!p.stored.has(0) && !bus.has(p.recipe.outputs[0].item)) producer.set(p.recipe.outputs[0].item, p);
  const order: ItemId[] = [];
  const seen = new Set<ItemId>();
  const visit = (item: ItemId) => {
    if (seen.has(item)) return;
    seen.add(item);
    for (const p of parts) if (p.recipe.outputs[0].item === item) p.recipe.inputs.forEach((i) => visit(i.item));
    order.push(item);
  };
  visit(s.item);
  for (const p of parts) visit(p.recipe.outputs[0].item);
  Object.keys(opt.extraction).forEach(visit);
  const singles = order.reverse().filter((item) => !bus.has(item) && (producer.has(item) || opt.extraction[item]));

  const groups: Group[] = [];
  const sinks: SinkPlan[] = [];
  const buses: Bus[] = [];
  const external = new Map<ItemId, { item: ItemId; demand: number; lanes: Lane[] }>();
  let laneSeq = 0;
  let gSeq = 0;
  let sinkSeq = 0;
  let bySeq = 0;
  let busSeq = 0;

  for (let c = 0; c < copies; c++) {
    const lanesByItem = new Map<ItemId, Lane[]>();
    const pushLane = (lane: Omit<Lane, 'id'>) => {
      const l = { ...lane, id: `l${laneSeq++}` };
      lanesByItem.set(l.item, [...(lanesByItem.get(l.item) ?? []), l]);
      return l;
    };
    const mine: Group[] = [];
    /** saídas que vão inteiras pra armazém, por grupo */
    const storedOf = new Map<string, Set<number>>();
    const make = (item: ItemId, D: number, part?: Part) => {
      const g = buildGroup(`g${gSeq++}`, item, D, part && RECIPES[part.recipe.id], levels[item] ?? 0, s, pushLane);
      storedOf.set(g.id, part?.stored ?? new Set());
      mine.push(g);
      return g;
    };
    /** um sink por faixa: o grupo manda a saída principal inteira pra ele */
    const toSink = (g: Group) => {
      const id = `sink${sinkSeq++}`;
      const lane: Lane = { id: `l${laneSeq++}`, consumer: id, input: 0, item: g.item, from: 0, to: 1, demand: g.demand, source: g.id };
      sinks.push({ id, item: g.item, demand: g.demand, lane });
      g.feeds = [lane];
    };

    // a) fontes dos barramentos: tamanho vem direto da solução
    for (const p of parts) {
      const item = p.recipe.outputs[0].item;
      if (bus.has(item) && !p.stored.has(0)) make(item, (p.machines * p.recipe.outputs[0].rate) / copies, p);
    }
    for (const [item, v] of Object.entries(opt.extraction)) if (bus.has(item)) make(item, v / copies);

    // b) pedaços com a saída principal guardada: vão inteiros pra armazéns (cada um numa esteira/cano)
    for (const p of parts) {
      if (!p.stored.has(0)) continue;
      const item = p.recipe.outputs[0].item;
      const total = (p.machines * p.recipe.outputs[0].rate) / copies;
      const n = Math.max(1, Math.ceil(total / capOf(item) - 1e-9));
      for (let i = 0; i < n; i++) toSink(make(item, total / n, p));
    }

    // c) armazém(ns) do produto final
    const finalRate = opt.rate / copies;
    const finalCount = bus.has(s.item) ? 1 : Math.max(1, Math.ceil(finalRate / capOf(s.item) - 1e-9));
    for (let i = 0; i < finalCount; i++) {
      const id = `sink${sinkSeq++}`;
      sinks.push({ id, item: s.item, demand: finalRate / finalCount, lane: pushLane({ consumer: id, input: 0, item: s.item, from: 0, to: 1, demand: finalRate / finalCount }) });
    }

    // d) itens de uma fonte: faixas empacotadas em sub-grupos que cabem numa esteira/cano
    for (const item of singles) {
      const lanes = lanesByItem.get(item) ?? [];
      if (!lanes.length) continue;
      const cap = capOf(item);
      const bins: { lanes: Lane[]; total: number }[] = [];
      for (const lane of [...lanes].sort((a, b) => b.demand - a.demand)) {
        const bin = bins.find((b) => b.total + lane.demand <= cap + 1e-9);
        if (bin) {
          bin.lanes.push(lane);
          bin.total += lane.demand;
        } else bins.push({ lanes: [lane], total: lane.demand });
      }
      const extra = (overflow.get(item) ?? 0) / copies;
      bins.forEach((bin, i) => {
        const more = i === 0 && extra > TINY ? extra : 0;
        const g = make(item, bin.total + more, producer.get(item));
        g.feeds = bin.lanes;
        for (const l of bin.lanes) l.source = g.id;
        if (more) {
          g.overflow = { sink: `sink${sinkSeq++}`, amount: more };
          sinks.push({ id: g.overflow.sink, item, demand: more, overflow: g.id });
        }
      });
    }
    groups.push(...mine);

    // e) subprodutos guardados: cada coleta pro seu armazém
    for (const g of mine)
      for (const b of g.byproducts)
        if (storedOf.get(g.id)?.has(b.output) || !bus.has(b.item)) {
          b.sink = `by${bySeq++}`;
          sinks.push({ id: b.sink, item: b.item, demand: b.amount, byproduct: { group: g.id, output: b.output } });
        }

    // f) barramentos: todas as fontes do item juntas, depois divididas pras faixas
    for (const item of bus) {
      const mains = mine.filter((g) => g.item === item && !storedOf.get(g.id)?.has(0));
      const byps = mine.flatMap((g) => g.byproducts.filter((b) => b.item === item && !b.sink).map((lane) => ({ group: g, lane })));
      const lanes = lanesByItem.get(item) ?? [];
      if (!mains.length && !byps.length) continue;
      if (!lanes.length) {
        // ninguém consome (não devia acontecer: a sobra já saiu inteira acima)
        mains.forEach(toSink);
        for (const { group, lane } of byps) {
          lane.sink = `by${bySeq++}`;
          sinks.push({ id: lane.sink, item, demand: lane.amount, byproduct: { group: group.id, output: lane.output } });
        }
        continue;
      }
      if (mains.length === 1 && !byps.length) {
        mains[0].feeds = lanes;
        for (const l of lanes) l.source = mains[0].id;
        continue;
      }
      const id = `bus${busSeq++}`;
      const sources: BusSource[] = [
        ...mains.map((g) => ({ group: g.id, output: 0, amount: g.demand })),
        ...byps.map(({ group, lane }) => ({ group: group.id, output: lane.output, lane, amount: lane.amount })),
      ];
      for (const g of mains) g.bus = id;
      for (const { lane } of byps) lane.bus = id;
      for (const l of lanes) l.source = id;
      buses.push({ id, item, demand: lanes.reduce((a, l) => a + l.demand, 0), sources, feeds: lanes, level: (levels[item] ?? 0) + 0.5 });
    }

    // insumos de fora: uma Entrada externa por faixa, como no modo manual
    for (const [item, lanes] of lanesByItem) {
      if (bus.has(item) || producer.has(item) || opt.extraction[item]) continue;
      const e = external.get(item) ?? { item, demand: 0, lanes: [] };
      e.lanes.push(...lanes);
      e.demand += lanes.reduce((a, l) => a + l.demand, 0);
      external.set(item, e);
    }
  }

  return {
    groups,
    sinks,
    buses,
    copies,
    external: [...external.values()],
    levels,
    power: groups.reduce((a, g) => a + g.power, 0),
    shards: groups.reduce((a, g) => a + g.shards, 0),
  };
}
