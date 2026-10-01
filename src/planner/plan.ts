import { BELTS, EXTRACTORS, ITEMS, MACHINES, MINER_TIERS, PIPES, PURITIES, RECIPES, RESOURCES, WELL, isFluid, type Recipe } from '../game/data';
import type { BeltTier, ExtractorKind, ItemId, MachineId, MinerTier, PipeTier, Purity } from '../game/types';
import { powerAt, shardsFor, wellPower } from '../sim/simulate';

/*
 * Cálculo da linha de produção (sem desenho).
 *
 * Regras combinadas com o usuário:
 *  - todas as máquinas de um grupo rodam no mesmo clock (até o clock máximo informado);
 *  - cada item tem UM grupo produtor, que se divide depois pros consumidores;
 *  - nenhuma esteira/cano passa do Mk máximo liberado: se um fluxo não cabe, vira linhas
 *    paralelas. Pra isso o item é dividido em sub-grupos, cada um alimentando só as
 *    "faixas" (lanes) de consumidores que cabem numa esteira/cano. Assim toda faixa de
 *    consumidor tem exatamente UM produtor, e os divisores no caminho só dividem,
 *    nunca misturam fontes — o que garante 100% no regime (sem sobra nem falta);
 *  - sólidos andam em esteira (limite = Mk de esteira), fluidos em cano (limite = Mk de cano);
 *  - subprodutos (2ª saída de uma receita, ex.: Heavy Oil Residue do Plastic) vão pra
 *    armazéns próprios: no jogo, uma saída sem destino trava a máquina.
 *  - fluido de poço (Nitrogen Gas): cada satélite conta como uma "máquina" do grupo; eles
 *    são agrupados em poços de até WELL.satelliteLimit satélites (média de satélites por
 *    poço daquele recurso no mapa, arredondada pra cima), todos com a pureza escolhida e o
 *    pressurizador no clock do grupo.
 */

export const MINE = '__mine__';
const EPS = 1e-9;
const ceilSafe = (x: number) => Math.max(1, Math.ceil(x - 1e-9));

/** Configuração da extração de um recurso: pureza do nó e, pra sólidos, o Mk da mineradora */
export interface OreSetting {
  purity: Purity;
  tier: MinerTier;
}

export interface PlanInput {
  item: ItemId;
  rate: number;
  /** receita escolhida por item (id da receita ou MINE = minerar/extrair) */
  choices: Record<ItemId, string>;
  ores: Record<ItemId, OreSetting>;
  /** clock máximo em % (100 = sem Power Shards) */
  maxClock: number;
  maxBelt: BeltTier;
  maxPipe: PipeTier;
}

/** Uma faixa = um conjunto contíguo de máquinas de um consumidor, alimentado por uma esteira/cano */
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

/** Coleta de um subproduto: máquinas [from, to) do grupo mandam a saída `output` pra um armazém */
export interface ByproductLane {
  output: number;
  item: ItemId;
  from: number;
  to: number;
  amount: number;
  sink: string;
}

/** De onde sai um fluido do chão: extrator de água/petróleo ou poço de recurso */
export type FluidSource = ExtractorKind | 'well';

export interface Group {
  id: string;
  item: ItemId;
  /** 'well': `count` = satélites, `wells` = satélites em cada poço */
  kind: 'machine' | 'miner' | 'extractor' | 'well';
  recipe?: Recipe;
  machine?: MachineId;
  ore?: OreSetting;
  extractor?: ExtractorKind;
  /** satélites de cada poço (só no grupo de poço) */
  wells?: number[];
  demand: number;
  count: number;
  clock: number;
  /** produção por máquina no clock calculado */
  perMachine: number;
  /** faixas de entrada, por índice de entrada da receita */
  inputLanes: Lane[][];
  /** faixas de consumidores que este grupo alimenta (saída principal) */
  feeds: Lane[];
  /** subprodutos (saídas 2+ da receita), cada faixa vai pra um armazém */
  byproducts: ByproductLane[];
  level: number;
  power: number;
  shards: number;
}

export interface SinkPlan {
  id: string;
  item: ItemId;
  demand: number;
  /** armazém do produto final: alimentado por uma faixa como qualquer consumidor */
  lane?: Lane;
  /** armazém de subproduto: recebe direto da coleta do grupo */
  byproduct?: { group: string; output: number };
}

export interface Plan {
  groups: Group[];
  sinks: SinkPlan[];
  /** insumos que não dá pra produzir aqui (coletáveis, etc.): precisam vir de fora */
  external: { item: ItemId; demand: number; lanes: Lane[] }[];
  levels: Record<ItemId, number>;
  power: number;
  shards: number;
  error?: string;
}

/* ---------- receitas e recursos ---------- */

const byMainOutput = new Map<ItemId, Recipe[]>();
for (const r of Object.values(RECIPES)) {
  const k = r.outputs[0].item;
  if (!byMainOutput.has(k)) byMainOutput.set(k, []);
  byMainOutput.get(k)!.push(r);
}
for (const list of byMainOutput.values()) list.sort((a, b) => Number(a.alternate) - Number(b.alternate) || a.name.localeCompare(b.name));

export const recipesProducing = (item: ItemId) => byMainOutput.get(item) ?? [];

/** Extrator que tira esse fluido do chão (água/petróleo antes do poço) */
export function extractorFor(item: ItemId): FluidSource | undefined {
  const k = (['water', 'oil'] as ExtractorKind[]).find((x) => EXTRACTORS[x].resources.includes(item));
  return k ?? (WELL.resources.includes(item) ? 'well' : undefined);
}
/** Nome do que extrai o fluido (pro seletor de receita) */
export const fluidSourceName = (src: FluidSource) => (src === 'well' ? WELL.title : EXTRACTORS[src].name);
/** Recurso que dá pra minerar (sólido) ou extrair (fluido) */
export const isResource = (item: ItemId) => RESOURCES.includes(item) || !!extractorFor(item);
/** itens que dá pra pedir no gerador */
export const PLANNABLE_ITEMS: ItemId[] = [...byMainOutput.keys()].sort();

export function defaultChoice(item: ItemId): string | undefined {
  if (isResource(item)) return MINE;
  const rs = recipesProducing(item);
  const std = rs.filter((r) => !r.alternate);
  // entre as padrão, a que leva o nome do item (ex.: "Rubber", não "Residual Rubber")
  return (std.find((r) => r.name === ITEMS[item]?.name) ?? std[0] ?? rs[0])?.id;
}

export function choiceOf(item: ItemId, choices: Record<ItemId, string>): string | undefined {
  const c = choices[item];
  if (c === MINE && isResource(item)) return MINE;
  if (c && RECIPES[c]?.outputs[0].item === item) return c;
  return defaultChoice(item);
}

export const defaultOre = (): OreSetting => ({ purity: 'normal', tier: 1 });

/* ---------- cálculo ---------- */

export function planLine(input: PlanInput): Plan {
  const beltCap = BELTS[input.maxBelt].rate;
  const pipeCap = PIPES[input.maxPipe]?.rate ?? PIPES[1].rate;
  /** limite de uma faixa desse item: Mk de cano pra fluido, de esteira pra sólido */
  const capOf = (item: ItemId) => (isFluid(item) ? pipeCap : beltCap);
  const maxClock = Math.min(250, Math.max(1, input.maxClock));
  const empty: Plan = { groups: [], sinks: [], external: [], levels: {}, power: 0, shards: 0 };
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

  /** Divide `n` máquinas que pedem/produzem `q`/min cada em faixas contíguas que cabem numa esteira/cano */
  const splitRanges = (n: number, q: number, cap: number) => {
    let L = ceilSafe((n * q) / cap);
    while (Math.ceil(n / L) * q > cap + EPS) L++;
    const ranges: [number, number][] = [];
    let from = 0;
    for (let i = 0; i < L; i++) {
      const size = Math.floor(n / L) + (i < n % L ? 1 : 0);
      ranges.push([from, from + size]);
      from += size;
    }
    return ranges;
  };

  // Armazéns do produto final: faixas iguais que cabem numa esteira/cano
  const sinks: SinkPlan[] = [];
  const sinkCount = ceilSafe(input.rate / capOf(input.item));
  for (let i = 0; i < sinkCount; i++) {
    const id = `sink${i}`;
    const demand = input.rate / sinkCount;
    sinks.push({ id, item: input.item, demand, lane: pushLane({ consumer: id, input: 0, item: input.item, from: 0, to: 1, demand }) });
  }

  const groups: Group[] = [];
  const external: Plan['external'] = [];
  let gSeq = 0;
  let bySeq = 0;

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
    const cap = capOf(item);

    // Empacota as faixas em sub-grupos cujo total cabe numa esteira/cano (first-fit decreasing)
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
      const base: Pick<Group, 'id' | 'item' | 'demand' | 'feeds' | 'inputLanes' | 'byproducts'> = { id, item, demand: D, feeds: bin.lanes, inputLanes: [], byproducts: [] };
      let group: Group;
      if (!recipe && extractorFor(item) === 'well') {
        // poço: satélites com a pureza escolhida, divididos em poços de até `limit` satélites
        const ore = input.ores[item] ?? defaultOre();
        const per100 = WELL.rates[ore.purity];
        const count = Math.max(ceilSafe(D / ((per100 * maxClock) / 100)), ceilSafe(D / cap));
        const clock = (D / (count * per100)) * 100;
        const limit = WELL.satelliteLimit[item] ?? WELL.maxSatellites;
        const nWells = ceilSafe(count / limit);
        const wells = Array.from({ length: nWells }, (_, i) => Math.floor(count / nWells) + (i < count % nWells ? 1 : 0));
        group = {
          ...base, kind: 'well', ore, wells, count, clock, perMachine: D / count, level: 0,
          power: wellPower(clock) * nWells, shards: shardsFor(clock) * nWells,
        };
      } else if (!recipe && extractorFor(item)) {
        // fluido tirado do chão: extrator de água ou de petróleo
        const kind = extractorFor(item) as ExtractorKind;
        const info = EXTRACTORS[kind];
        const ore = input.ores[item] ?? defaultOre();
        const per100 = info.rate(ore.purity);
        const count = Math.max(ceilSafe(D / ((per100 * maxClock) / 100)), ceilSafe(D / cap));
        const clock = (D / (count * per100)) * 100;
        group = {
          ...base, kind: 'extractor', extractor: kind, ore, count, clock, perMachine: D / count, level: 0,
          power: powerAt(info.power, clock) * count, shards: shardsFor(clock) * count,
        };
      } else if (!recipe) {
        const ore = input.ores[item] ?? defaultOre();
        const per100 = MINER_TIERS[ore.tier].base * PURITIES[ore.purity].mult;
        const count = Math.max(ceilSafe(D / ((per100 * maxClock) / 100)), ceilSafe(D / cap));
        const clock = (D / (count * per100)) * 100;
        group = {
          ...base, kind: 'miner', ore, count, clock, perMachine: D / count, level: 0,
          power: powerAt(MINER_TIERS[ore.tier].power, clock) * count, shards: shardsFor(clock) * count,
        };
      } else {
        const out = recipe.outputs[0].rate;
        // nenhuma porta de uma máquina pode passar do limite da esteira/cano dela
        const count = Math.max(
          ceilSafe(D / ((out * maxClock) / 100)),
          ...recipe.inputs.map((p) => ceilSafe((D * p.rate) / out / capOf(p.item))),
          ...recipe.outputs.map((p) => ceilSafe((D * p.rate) / out / capOf(p.item))),
        );
        const clock = (D / (count * out)) * 100;
        const m = MACHINES[recipe.machine];
        group = {
          ...base, kind: 'machine', recipe, machine: recipe.machine, count, clock, perMachine: D / count, level: levels[item],
          power: powerAt(recipe.power ?? m.power, clock) * count, shards: shardsFor(clock) * count,
        };
        group.inputLanes = recipe.inputs.map((p, k) => {
          const q = (D * p.rate) / out / count;
          return splitRanges(count, q, capOf(p.item)).map(([from, to]) => pushLane({ consumer: id, input: k, item: p.item, from, to, demand: (to - from) * q }));
        });
        // subprodutos: coletados em faixas que cabem numa esteira/cano, cada uma pra um armazém
        recipe.outputs.slice(1).forEach((p, j) => {
          const q = (D * p.rate) / out / count;
          for (const [from, to] of splitRanges(count, q, capOf(p.item))) {
            const sink = `by${bySeq++}`;
            group.byproducts.push({ output: j + 1, item: p.item, from, to, amount: (to - from) * q, sink });
            sinks.push({ id: sink, item: p.item, demand: (to - from) * q, byproduct: { group: id, output: j + 1 } });
          }
        });
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
    power: groups.reduce((a, g) => a + g.power, 0),
    shards: groups.reduce((a, g) => a + g.shards, 0),
  };
}
