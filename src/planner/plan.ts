import { BELTS, MACHINES, MINER_TIERS, PURITIES, RECIPES, RESOURCES, isFluid, type Recipe } from '../game/data';
import type { BeltTier, ItemId, MachineId, MinerTier, Purity } from '../game/types';
import { powerAt, shardsFor } from '../sim/simulate';

/*
 * Cálculo da linha de produção (sem desenho).
 *
 * Regras combinadas com o usuário:
 *  - todas as máquinas de um grupo rodam no mesmo clock (até o clock máximo informado);
 *  - cada item tem UM grupo produtor, que se divide depois pros consumidores;
 *  - nenhuma esteira passa do Mk máximo liberado: se um fluxo não cabe, vira linhas
 *    paralelas. Pra isso o item é dividido em sub-grupos, cada um alimentando só as
 *    "faixas" (lanes) de consumidores que cabem numa esteira. Assim toda faixa de
 *    consumidor tem exatamente UM produtor, e os divisores no caminho só dividem,
 *    nunca misturam fontes — o que garante 100% no regime (sem sobra nem falta).
 */

export const MINE = '__mine__';
const EPS = 1e-9;
const ceilSafe = (x: number) => Math.max(1, Math.ceil(x - 1e-9));

export interface OreSetting {
  purity: Purity;
  tier: MinerTier;
}

export interface PlanInput {
  item: ItemId;
  rate: number;
  /** receita escolhida por item (id da receita ou MINE) */
  choices: Record<ItemId, string>;
  ores: Record<ItemId, OreSetting>;
  /** clock máximo em % (100 = sem Power Shards) */
  maxClock: number;
  maxBelt: BeltTier;
}

/** Uma faixa = um conjunto contíguo de máquinas de um consumidor, alimentado por uma esteira */
export interface Lane {
  id: string;
  /** id do grupo consumidor (ou do armazém) */
  consumer: string;
  input: number;
  item: ItemId;
  /** máquinas [from, to) do consumidor atendidas por esta faixa */
  from: number;
  to: number;
  demand: number;
  /** grupo produtor que alimenta esta faixa (vazio = insumo de fora) */
  source?: string;
}

export interface Group {
  id: string;
  item: ItemId;
  kind: 'machine' | 'miner';
  recipe?: Recipe;
  machine?: MachineId;
  ore?: OreSetting;
  demand: number;
  count: number;
  clock: number;
  /** produção por máquina no clock calculado */
  perMachine: number;
  /** faixas de entrada, por índice de entrada da receita */
  inputLanes: Lane[][];
  /** faixas de consumidores que este grupo alimenta */
  feeds: Lane[];
  level: number;
  power: number;
  shards: number;
}

export interface SinkPlan {
  id: string;
  lane: Lane;
}

export interface Plan {
  groups: Group[];
  sinks: SinkPlan[];
  /** insumos que não dá pra produzir aqui (fluidos, coletáveis): precisam vir de fora */
  external: { item: ItemId; demand: number; lanes: Lane[] }[];
  levels: Record<ItemId, number>;
  cap: number;
  power: number;
  shards: number;
  error?: string;
}

/* ---------- receitas por item ---------- */

/** Por enquanto o gerador só monta linhas de sólidos: receitas com fluido ficam de fora
 *  (o item vira "fornecer de fora"). */
const solidOnly = (r: Recipe) => ![...r.inputs, ...r.outputs].some((p) => isFluid(p.item));

const byMainOutput = new Map<ItemId, Recipe[]>();
for (const r of Object.values(RECIPES).filter(solidOnly)) {
  const k = r.outputs[0].item;
  if (!byMainOutput.has(k)) byMainOutput.set(k, []);
  byMainOutput.get(k)!.push(r);
}
for (const list of byMainOutput.values()) list.sort((a, b) => Number(a.alternate) - Number(b.alternate) || a.name.localeCompare(b.name));

export const recipesProducing = (item: ItemId) => byMainOutput.get(item) ?? [];
export const isResource = (item: ItemId) => RESOURCES.includes(item);
/** itens que dá pra pedir no gerador */
export const PLANNABLE_ITEMS: ItemId[] = [...byMainOutput.keys()].sort();

export function defaultChoice(item: ItemId): string | undefined {
  if (isResource(item)) return MINE;
  const rs = recipesProducing(item);
  return rs.find((r) => !r.alternate)?.id ?? rs[0]?.id;
}

export function choiceOf(item: ItemId, choices: Record<ItemId, string>): string | undefined {
  const c = choices[item];
  if (c === MINE && isResource(item)) return MINE;
  if (c && RECIPES[c]?.outputs[0].item === item && solidOnly(RECIPES[c])) return c;
  return defaultChoice(item);
}

export const defaultOre = (): OreSetting => ({ purity: 'normal', tier: 1 });

/* ---------- cálculo ---------- */

export function planLine(input: PlanInput): Plan {
  const cap = BELTS[input.maxBelt].rate;
  const maxClock = Math.min(250, Math.max(1, input.maxClock));
  const empty: Plan = { groups: [], sinks: [], external: [], levels: {}, cap, power: 0, shards: 0 };
  if (!(input.rate > 0)) return { ...empty, error: 'Informe uma quantidade maior que zero.' };
  if (!choiceOf(input.item, input.choices)) return { ...empty, error: 'Esse item não tem receita nas máquinas disponíveis.' };

  const recipeOf = (item: ItemId): Recipe | undefined => {
    const c = choiceOf(item, input.choices);
    return c && c !== MINE ? RECIPES[c] : undefined;
  };

  // Ordem topológica (produtor antes do consumidor) + detecção de ciclo
  const order: ItemId[] = [];
  const state = new Map<ItemId, 'visiting' | 'done'>();
  const stack: ItemId[] = [];
  let cycle: string | undefined;
  const visit = (item: ItemId) => {
    if (cycle || state.get(item) === 'done') return;
    if (state.get(item) === 'visiting') {
      cycle = [...stack.slice(stack.indexOf(item)), item].join(' → ');
      return;
    }
    state.set(item, 'visiting');
    stack.push(item);
    for (const inp of recipeOf(item)?.inputs ?? []) visit(inp.item);
    stack.pop();
    state.set(item, 'done');
    order.push(item);
  };
  visit(input.item);
  if (cycle) return { ...empty, error: `As receitas escolhidas formam um ciclo: ${cycle}` };

  const levels: Record<ItemId, number> = {};
  for (const item of order) {
    const r = recipeOf(item);
    levels[item] = r ? 1 + Math.max(0, ...r.inputs.map((i) => levels[i.item] ?? 0)) : 0;
  }

  let laneSeq = 0;
  const lanesByItem = new Map<ItemId, Lane[]>();
  const pushLane = (lane: Omit<Lane, 'id'>) => {
    const l = { ...lane, id: `l${laneSeq++}` };
    if (!lanesByItem.has(l.item)) lanesByItem.set(l.item, []);
    lanesByItem.get(l.item)!.push(l);
    return l;
  };

  /** Divide `n` máquinas que pedem `q`/min cada em faixas contíguas que cabem numa esteira */
  const splitLanes = (consumer: string, inputIdx: number, item: ItemId, n: number, q: number) => {
    let L = ceilSafe((n * q) / cap);
    while (Math.ceil(n / L) * q > cap + EPS) L++;
    const lanes: Lane[] = [];
    let from = 0;
    for (let i = 0; i < L; i++) {
      const size = Math.floor(n / L) + (i < n % L ? 1 : 0);
      lanes.push(pushLane({ consumer, input: inputIdx, item, from, to: from + size, demand: size * q }));
      from += size;
    }
    return lanes;
  };

  // Armazéns: o produto final em faixas iguais que cabem numa esteira
  const sinks: SinkPlan[] = [];
  const sinkCount = ceilSafe(input.rate / cap);
  for (let i = 0; i < sinkCount; i++) {
    const id = `sink${i}`;
    sinks.push({ id, lane: pushLane({ consumer: id, input: 0, item: input.item, from: 0, to: 1, demand: input.rate / sinkCount }) });
  }

  const groups: Group[] = [];
  const external: Plan['external'] = [];
  let gSeq = 0;

  // Consumidor antes do produtor: quando um item é processado, todas as faixas que pedem ele já existem
  for (const item of [...order].reverse()) {
    const lanes = lanesByItem.get(item) ?? [];
    if (!lanes.length) continue;
    const choice = choiceOf(item, input.choices);
    const recipe = recipeOf(item);
    if (!recipe && choice !== MINE) {
      external.push({ item, demand: lanes.reduce((a, l) => a + l.demand, 0), lanes });
      continue;
    }

    // Empacota as faixas em sub-grupos cujo total cabe numa esteira (first-fit decreasing)
    const bins: { lanes: Lane[]; total: number }[] = [];
    for (const lane of [...lanes].sort((a, b) => b.demand - a.demand)) {
      const bin = bins.find((b) => b.total + lane.demand <= cap + EPS);
      if (bin) {
        bin.lanes.push(lane);
        bin.total += lane.demand;
      } else bins.push({ lanes: [lane], total: lane.demand });
    }

    for (const bin of bins) {
      const D = bin.total;
      const id = `g${gSeq++}`;
      let group: Group;
      if (!recipe) {
        const ore = input.ores[item] ?? defaultOre();
        const per100 = MINER_TIERS[ore.tier].base * PURITIES[ore.purity].mult;
        const count = Math.max(ceilSafe(D / ((per100 * maxClock) / 100)), ceilSafe(D / cap));
        const clock = (D / (count * per100)) * 100;
        group = {
          id, item, kind: 'miner', ore, demand: D, count, clock, perMachine: D / count, inputLanes: [], feeds: bin.lanes, level: 0,
          power: powerAt(MINER_TIERS[ore.tier].power, clock) * count, shards: shardsFor(clock) * count,
        };
      } else {
        const base = recipe.outputs[0].rate;
        const count = Math.max(
          ceilSafe(D / ((base * maxClock) / 100)),
          ceilSafe(D / cap),
          ...recipe.inputs.map((inp) => ceilSafe((D * inp.rate) / base / cap)),
        );
        const clock = (D / (count * base)) * 100;
        const m = MACHINES[recipe.machine];
        group = {
          id, item, kind: 'machine', recipe, machine: recipe.machine, demand: D, count, clock, perMachine: D / count,
          inputLanes: [], feeds: bin.lanes, level: levels[item],
          power: powerAt(recipe.power ?? m.power, clock) * count, shards: shardsFor(clock) * count,
        };
        group.inputLanes = recipe.inputs.map((inp, k) => splitLanes(id, k, inp.item, count, (D * inp.rate) / base / count));
      }
      for (const lane of bin.lanes) lane.source = id;
      groups.push(group);
    }
  }

  return {
    groups,
    sinks,
    external,
    levels,
    cap,
    power: groups.reduce((a, g) => a + g.power, 0),
    shards: groups.reduce((a, g) => a + g.shards, 0),
  };
}
