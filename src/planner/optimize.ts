import { solve, type Coefficients, type Constraint } from 'yalps';
import { EXTRACTORS, ITEMS, MACHINES, MINER_TIERS, OVERCLOCK, PURITIES, RECIPES, WELL, type Recipe } from '../game/data';
import type { BeltTier, ExtractorKind, ItemId, PipeTier } from '../game/types';
import { powerAt, wellPower } from '../sim/simulate';
import { capOfSettings, defaultOre, extractorFor, isResource, type OreSetting } from './plan';

/*
 * Otimizador da linha por programação linear (YALPS, simplex em TypeScript).
 *
 * Variáveis (todas ≥ 0):
 *  - r|<receita>: quanto a receita roda, em "máquinas a 100%" (= ciclos/min × duração/60);
 *  - x|<recurso>: extração do recurso (minério, água, petróleo, gás de poço) por minuto;
 *  - e|<item>: insumo que vem de fora (item sem receita permitida que produza ele, ex.: Mycelia);
 *  - out: produção do item pedido (só no modo "maximizar").
 *
 * Restrição de balanço por item: produção (todas as saídas, inclusive subprodutos) − consumo
 * + extração + de fora ≥ demanda (o pedido no item final, 0 nos demais). A sobra de cada item é
 * a folga dessa desigualdade. Como subproduto entra no balanço igual à saída principal, ele
 * alimenta qualquer receita que precise dele (água da Aluminum Scrap, Heavy Oil Residue etc.);
 * o que sobrar vai pra armazém.
 *
 * Objetivos: soma ponderada dos recursos (peso 1 por padrão, configurável), máquinas
 * (aproximação contínua no clock máximo) ou energia (MW no clock máximo). Um termo pequeno
 * desempata (máquinas no objetivo de recursos; recursos nos outros) e evita laços inúteis
 * (ex.: empacotar e desempacotar água).
 */

export type Objective = 'resources' | 'machines' | 'power';
export type RecipePolicy = 'standard' | 'selected' | 'all';

export interface OptimizeInput {
  item: ItemId;
  /** 'target' = produzir `rate`/min; 'maximize' = o máximo com `available` */
  goal: 'target' | 'maximize';
  rate: number;
  objective: Objective;
  policy: RecipePolicy;
  /** alternativas liberadas na política 'selected' (ids de receita) */
  alternates: string[];
  /** peso de cada recurso/insumo de fora no objetivo "menos recursos" (padrão 1) */
  weights: Record<ItemId, number>;
  /** modo maximizar: quanto há de cada recurso (por minuto); o que não estiver aqui é 0 */
  available: Record<ItemId, number>;
  /** modo maximizar: água sem limite (extrator em qualquer lago) */
  unlimitedWater: boolean;
  ores: Record<ItemId, OreSetting>;
  maxClock: number;
  maxBelt: BeltTier;
  maxPipe: PipeTier;
}

export interface Optimized {
  error?: string;
  /** produção do item pedido (no modo maximizar, o máximo encontrado) */
  rate: number;
  /** receitas usadas e quanto cada uma roda, em máquinas a 100% */
  recipes: { recipe: Recipe; machines: number }[];
  extraction: Record<ItemId, number>;
  external: Record<ItemId, number>;
  /** sobra de cada item (vai pra armazém) */
  excess: Record<ItemId, number>;
  /** parte da sobra que é de extração presa no clock mínimo (ver minExtraction) */
  overflow: Record<ItemId, number>;
  /** subprodutos (saídas 2+): quanto sai, quanto é reaproveitado e quanto vai pra armazém */
  byproducts: { item: ItemId; produced: number; reused: number; stored: number }[];
  /** estimativas contínuas (máquinas no clock máximo, sem arredondar) */
  machines: number;
  power: number;
  /** receitas descartadas por formarem laço sem semente (não dá partida no jogo) */
  dropped: string[];
}

const TINY = 1e-7;
const TIE = 1e-4;
const WATER = 'water';
/** peso padrão de um insumo de fora (coletável/drop): só entra quando não há outro jeito */
export const EXTERNAL_WEIGHT = 1000;

/** receitas que o otimizador pode usar */
export function allowedRecipes(policy: RecipePolicy, alternates: string[]): Recipe[] {
  const alt = new Set(alternates);
  return Object.values(RECIPES).filter((r) => !r.alternate || policy === 'all' || (policy === 'selected' && alt.has(r.id)));
}

/** máquinas (contínuo) e MW por unidade extraída, no clock máximo */
export function extractionCost(item: ItemId, ore: OreSetting, maxClock: number): { machines: number; power: number } {
  const c = maxClock / 100;
  const src = extractorFor(item);
  if (src === 'well') {
    const per = WELL.rates[ore.purity] * c;
    const limit = WELL.satelliteLimit[item] ?? WELL.maxSatellites;
    return { machines: 1 / per, power: wellPower(maxClock) / (limit * per) };
  }
  if (src) {
    const info = EXTRACTORS[src as ExtractorKind];
    const per = info.rate(ore.purity) * (info.overclockable ? c : 1);
    return { machines: 1 / per, power: powerAt(info.power, info.overclockable ? maxClock : 100) / per };
  }
  const per = MINER_TIERS[ore.tier].base * PURITIES[ore.purity].mult * c;
  return { machines: 1 / per, power: powerAt(MINER_TIERS[ore.tier].power, maxClock) / per };
}

/** quanto UMA mineradora/extrator/satélite tira por minuto a 100% */
function extractionPer100(item: ItemId, ore: OreSetting): number {
  const src = extractorFor(item);
  if (src === 'well') return WELL.rates[ore.purity];
  if (src) return EXTRACTORS[src as ExtractorKind].rate(ore.purity);
  return MINER_TIERS[ore.tier].base * PURITIES[ore.purity].mult;
}

/**
 * Itens com mais de uma fonte (duas receitas, pedaços de uma receita, extração + receita) ou que
 * recebem subproduto reaproveitado: esses passam por um barramento (ver optimizedPlan).
 */
export function busItems(res: Pick<Optimized, 'recipes' | 'extraction' | 'excess' | 'overflow'>): Set<ItemId> {
  const count = new Map<ItemId, number>();
  const bus = new Set<ItemId>();
  const add = (k: ItemId) => count.set(k, (count.get(k) ?? 0) + 1);
  for (const p of recipeParts(res, 1).parts)
    p.recipe.outputs.forEach((o, i) => {
      if (p.stored.has(i)) return;
      if (i === 0) add(o.item);
      else bus.add(o.item);
    });
  for (const item of Object.keys(res.extraction)) add(item);
  for (const [item, n] of count) if (n > 1) bus.add(item);
  return bus;
}

/**
 * Em quantas cópias iguais a linha é dividida pra que o barramento de cada item caiba numa
 * esteira/cano do Mk máximo (ver optimizedPlan). Item de uma fonte só não conta: ele se divide
 * em sub-grupos como no modo manual.
 */
export function copiesFor(res: Pick<Optimized, 'recipes' | 'extraction' | 'excess' | 'overflow'>, s: { maxBelt: BeltTier; maxPipe: PipeTier }): number {
  const capOf = capOfSettings(s);
  const bus = busItems(res);
  const supply = new Map<ItemId, number>();
  const add = (k: ItemId, v: number) => bus.has(k) && supply.set(k, (supply.get(k) ?? 0) + v);
  for (const { recipe, machines } of res.recipes) for (const p of recipe.outputs) add(p.item, p.rate * machines);
  for (const [item, v] of Object.entries(res.extraction)) add(item, v);
  let copies = 1;
  for (const [item, v] of supply) copies = Math.max(copies, Math.ceil(v / capOf(item) - 1e-9));
  return copies;
}

/** Pedaço de uma receita: roda `machines` (máquinas a 100%, todas as cópias); as saídas em `stored` vão inteiras pra armazém */
export interface Part {
  recipe: Recipe;
  machines: number;
  stored: Set<number>;
}

/**
 * Sobra sem "transbordo": divisor comum não separa uma quantia exata pro armazém (ele reparte
 * por igual), então a sobra de cada item sai de fontes INTEIRAS. A receita que gera a sobra é
 * cortada em pedaços (cada um com seu clock): no pedaço "guardado" aquela saída vai toda pro
 * armazém; no outro, toda pro consumo. Primeiro saídas inteiras (subprodutos antes da saída
 * principal, das menores pras maiores); o resto, num corte onde os dois pedaços fiquem acima do
 * clock mínimo. Se não houver corte assim, o item vai em `awkward` (o otimizador então exige
 * balanço exato dele). A sobra de extração presa no mínimo (`overflow`) sai por outro caminho.
 */
export function recipeParts(opt: Pick<Optimized, 'recipes' | 'excess' | 'overflow'>, copies: number): { parts: Part[]; awkward: ItemId[] } {
  const minK = (OVERCLOCK.min / 100) * copies * (1 - 1e-9);
  const stored = new Map<string, number[]>();
  const awkward: ItemId[] = [];
  const outs = opt.recipes.flatMap(({ recipe, machines }) => recipe.outputs.map((p, o) => ({ recipe, machines, o, item: p.item, amount: p.rate * machines })));
  for (const [item, total] of Object.entries(opt.excess)) {
    let left = total - (opt.overflow[item] ?? 0);
    if (left <= TINY) continue;
    const cands = outs.filter((x) => x.item === item).sort((a, b) => Number(a.o === 0) - Number(b.o === 0) || a.amount - b.amount);
    const put = (x: (typeof cands)[number], v: number) => {
      const arr = stored.get(x.recipe.id) ?? x.recipe.outputs.map(() => 0);
      arr[x.o] = v;
      stored.set(x.recipe.id, arr);
    };
    const used = new Set<(typeof cands)[number]>();
    for (const x of cands)
      if (x.amount <= left * (1 + 1e-9) + TINY) {
        put(x, x.amount);
        used.add(x);
        left -= x.amount;
      }
    if (left <= TINY) continue;
    const cut = cands.find((x) => !used.has(x) && x.machines * (left / x.amount) >= minK && x.machines * (1 - left / x.amount) >= minK);
    if (cut) put(cut, left);
    else awkward.push(item);
  }
  const parts: Part[] = [];
  for (const { recipe, machines } of opt.recipes) {
    const st = stored.get(recipe.id);
    if (!st) {
      parts.push({ recipe, machines, stored: new Set() });
      continue;
    }
    // fração guardada de cada saída; a parte guardada fica no fim do intervalo [0, 1]
    const f = st.map((v, o) => Math.min(1, v / (recipe.outputs[o].rate * machines)));
    const cuts = [...new Set([0, 1, ...f.map((x) => 1 - x).filter((x) => x > 1e-9 && x < 1 - 1e-9)])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [a, b] = [cuts[i], cuts[i + 1]];
      if (b - a < 1e-12) continue;
      const part = { recipe, machines: machines * (b - a), stored: new Set(f.flatMap((x, o) => (a >= 1 - x - 1e-9 && x > 1e-9 ? [o] : []))) };
      // duas saídas cortadas em pontos diferentes podem deixar um pedaço do meio pequeno demais
      if (part.machines < minK) awkward.push(...recipe.outputs.filter((_, o) => st[o] > TINY).map((p) => p.item));
      parts.push(part);
    }
  }
  return { parts, awkward: [...new Set(awkward)] };
}

/** MW de uma "máquina a 100%" da receita rodando no clock máximo (por unidade de x) */
const recipePower = (r: Recipe, maxClock: number) => powerAt(r.power ?? MACHINES[r.machine].power, maxClock) / (maxClock / 100);

const fail = (error: string): Optimized => ({ error, rate: 0, recipes: [], extraction: {}, external: {}, excess: {}, overflow: {}, byproducts: [], machines: 0, power: 0, dropped: [] });
const name = (item: ItemId) => ITEMS[item]?.name ?? item;

interface Lp {
  status: string;
  rate: number;
  x: Map<string, number>;
}

/** Monta e resolve o modelo; `fixedRate` fixa a produção (2ª fase do maximizar) */
function runLp(
  input: OptimizeInput,
  recipes: Recipe[],
  mode: 'target' | 'maximize',
  fixedRate?: number,
  bounds = new Map<string, number>(),
  exact = new Set<ItemId>(),
): Lp {
  const maxClock = Math.min(250, Math.max(1, input.maxClock));
  const c = maxClock / 100;
  const items = new Set<ItemId>([input.item]);
  const producible = new Set<ItemId>();
  for (const r of recipes) {
    for (const p of r.inputs) items.add(p.item);
    for (const p of r.outputs) {
      items.add(p.item);
      producible.add(p.item);
    }
  }
  const weight = (item: ItemId) => Math.max(0, input.weights[item] ?? (isResource(item) ? 1 : EXTERNAL_WEIGHT));
  const constraints = new Map<string, Constraint>();
  const variables = new Map<string, Coefficients>();
  const target = mode === 'target' ? (fixedRate ?? input.rate) : 0;
  // balanço: produção − consumo ≥ demanda; nos itens de `exact`, sem sobra nenhuma
  for (const item of items) {
    const d = item === input.item ? target : 0;
    constraints.set(`b|${item}`, exact.has(item) && item !== input.item ? { equal: d } : { min: d });
  }

  for (const r of recipes) {
    const coef = new Map<string, number>();
    const add = (k: string, v: number) => coef.set(k, (coef.get(k) ?? 0) + v);
    for (const p of r.outputs) add(`b|${p.item}`, p.rate);
    for (const p of r.inputs) add(`b|${p.item}`, -p.rate);
    const machines = 1 / c;
    const power = recipePower(r, maxClock);
    add('cost', input.objective === 'machines' ? machines : input.objective === 'power' ? power : TIE * machines);
    variables.set(`r|${r.id}`, coef);
  }
  for (const item of items) {
    const resource = isResource(item);
    // insumo de fora só pra quem não tem receita permitida (e nunca o próprio produto)
    if (!resource && (producible.has(item) || item === input.item)) continue;
    const coef = new Map<string, number>([[`b|${item}`, 1]]);
    const w = weight(item);
    if (resource) {
      const ex = extractionCost(item, input.ores[item] ?? defaultOre(), maxClock);
      coef.set('cost', input.objective === 'machines' ? ex.machines + TIE * w : input.objective === 'power' ? ex.power + TIE * w : w);
    } else coef.set('cost', input.objective === 'resources' ? w : TIE * w);
    if (input.goal === 'maximize' && !(item === WATER && input.unlimitedWater)) {
      coef.set(`a|${item}`, 1);
      constraints.set(`a|${item}`, { max: Math.max(0, input.available[item] ?? 0) });
    }
    variables.set(`${resource ? 'x' : 'e'}|${item}`, coef);
  }
  if (mode === 'maximize') variables.set('out', new Map([[`b|${input.item}`, -1], ['prod', 1]]));
  // mínimos (clock de 1%): a variável ganha uma restrição própria
  for (const [key, min] of bounds) {
    const coef = variables.get(key) as Map<string, number> | undefined;
    if (!coef) continue;
    coef.set(`m|${key}`, 1);
    constraints.set(`m|${key}`, { min });
  }
  const sol = solve(
    { direction: mode === 'maximize' ? 'maximize' : 'minimize', objective: mode === 'maximize' ? 'prod' : 'cost', constraints, variables },
    { maxPivots: 200_000 },
  );
  return { status: sol.status, rate: sol.result, x: new Map(sol.variables) };
}

/** Itens/receitas que dão partida: tudo que nasce de extração/de fora e o que dá pra fazer a partir disso */
function unseeded(recipes: { recipe: Recipe; machines: number }[], seeds: Set<ItemId>): Recipe[] {
  const seeded = new Set(seeds);
  const live = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const { recipe } of recipes) {
      if (live.has(recipe.id) || !recipe.inputs.every((p) => seeded.has(p.item))) continue;
      live.add(recipe.id);
      recipe.outputs.forEach((p) => seeded.add(p.item));
      changed = true;
    }
  }
  return recipes.filter((r) => !live.has(r.recipe.id)).map((r) => r.recipe);
}

/** Receitas (entre `list`) que fazem parte de algum laço: a saída de uma volta, por elas, pra entrada dela */
function inCycle(list: Recipe[]): Recipe[] {
  const next = new Map(list.map((r) => [r.id, list.filter((q) => r.outputs.some((o) => q.inputs.some((i) => i.item === o.item)))]));
  return list.filter((start) => {
    const seen = new Set<string>();
    const stack = [...next.get(start.id)!];
    while (stack.length) {
      const r = stack.pop()!;
      if (r.id === start.id) return true;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      stack.push(...next.get(r.id)!);
    }
    return false;
  });
}

export function optimize(input: OptimizeInput): Optimized {
  if (!ITEMS[input.item]) return fail('Escolha um item.');
  if (input.goal === 'target' && !(input.rate > 0)) return fail('Informe uma quantidade maior que zero.');
  let recipes = allowedRecipes(input.policy, input.alternates);
  if (!recipes.some((r) => r.outputs.some((p) => p.item === input.item)) && !isResource(input.item))
    return fail(`Nenhuma receita permitida produz ${name(input.item)}. Libere alternativas ou todas as receitas.`);

  const dropped: string[] = [];
  const bounds = new Map<string, number>();
  const minClock = OVERCLOCK.min / 100;
  /** receitas tiradas na última rodada por rodarem abaixo do clock mínimo (voltam se fizerem falta) */
  let trial: Recipe[] = [];
  let copies = 1;
  /** itens cuja sobra não dá pra separar limpo (ver recipeParts): o LP tem que fechar exato */
  const exact = new Set<ItemId>();
  const gaveUp = new Set<ItemId>();
  let lastExact: ItemId[] = [];
  /** última solução completa (se as rodadas acabarem, fica com ela mesmo com alguma sobra cortada fino) */
  let best: Optimized | undefined;
  /** recursos que precisam ser extraídos pra dar partida num laço */
  const seeds = new Set<ItemId>();
  // Rodadas de ajuste da solução:
  //  1) laço sem semente (ex.: Recycled Rubber ↔ Recycled Plastic sem nada de fora) não dá
  //     partida no jogo: as receitas dele saem e resolve de novo;
  //  2) nenhuma máquina roda abaixo do clock mínimo (1%), contando por cópia da linha (ver
  //     copiesFor): receita usada num fluxo minúsculo sai (o LP acha outro caminho); se sem ela
  //     não der, ela volta presa no mínimo, e o que passar do necessário vira sobra (armazém).
  for (let round = 0; round < 24; round++) {
    const restore = () => {
      for (const r of trial) bounds.set(`r|${r.id}`, minClock * copies * 1.000001);
      recipes = [...recipes, ...trial];
      trial = [];
    };
    let rate = input.rate;
    if (input.goal === 'maximize') {
      const max = runLp(input, recipes, 'maximize', undefined, bounds, exact);
      if (max.status === 'unbounded') return fail(`A produção de ${name(input.item)} ficou ilimitada: informe os recursos disponíveis.`);
      // arredonda pra baixo (4 casas) pra não pedir um fio a mais do que há
      rate = max.status === 'optimal' ? Math.floor(max.rate * 1e4 + 1e-6) / 1e4 : 0;
      if (!(rate > 0) && trial.length) {
        restore();
        continue;
      }
      if (!(rate > 0) && lastExact.length) {
        lastExact.forEach((item) => (exact.delete(item), gaveUp.add(item)));
        lastExact = [];
        continue;
      }
      if (max.status !== 'optimal' && max.status !== 'infeasible') return fail('O otimizador não conseguiu resolver esse caso.');
      if (!(rate > 0)) return fail(missingFor(input, recipes));
    }
    const lp = runLp(input, recipes, 'target', rate, bounds, exact);
    if (lp.status === 'infeasible' && trial.length) {
      restore();
      continue;
    }
    if (lp.status === 'infeasible' && lastExact.length) {
      // não fecha exato: aceita a sobra desses itens como está
      for (const item of lastExact) {
        exact.delete(item);
        gaveUp.add(item);
      }
      lastExact = [];
      continue;
    }
    if (lp.status === 'infeasible')
      return fail(
        dropped.length
          ? `Não dá pra produzir ${name(input.item)}: o caminho que sobra depende de laços que não dão partida sozinhos (${[...new Set(dropped)].map((id) => RECIPES[id]?.name ?? id).join(', ')}).`
          : `Não dá pra produzir ${name(input.item)} com as receitas permitidas.`,
      );
    if (lp.status !== 'optimal') return fail('O otimizador não conseguiu resolver esse caso.');
    trial = [];
    lastExact = [];
    const res = collect(input, recipes, lp, rate, bounds);
    // laço que só precisa de um recurso pra dar partida (ex.: água que volta como subproduto):
    // esse recurso passa a ser extraído de verdade (ver minExtraction); senão, as receitas saem
    let bad: Recipe[] = [];
    for (;;) {
      bad = unseeded(res.recipes, new Set([...Object.keys(res.extraction), ...Object.keys(res.external), ...seeds]));
      const need = bad.flatMap((r) => r.inputs.map((p) => p.item)).filter((item) => isResource(item) && !seeds.has(item) && !res.extraction[item]);
      if (!need.length) break;
      need.forEach((item) => seeds.add(item));
    }
    if (bad.length) {
      // só as receitas do laço em si (as que dependem dele mais à frente voltam a funcionar)
      const loop = inCycle(bad);
      dropped.push(...loop.map((r) => r.id));
      const out = new Set(loop.map((r) => r.id));
      recipes = recipes.filter((r) => !out.has(r.id));
      continue;
    }
    copies = copiesFor(res, input);
    const tiny = res.recipes.filter((r) => r.machines < minClock * copies * (1 - 1e-9));
    for (const r of tiny) {
      const key = `r|${r.recipe.id}`;
      if (bounds.has(key)) bounds.set(key, minClock * copies * 1.000001);
      else trial.push(r.recipe);
    }
    if (trial.length) {
      const out = new Set(trial.map((r) => r.id));
      recipes = recipes.filter((r) => !out.has(r.id));
    }
    if (tiny.length) continue;
    const done = minExtraction(input, res, copies, seeds);
    const awkward = recipeParts(done, copies).awkward.filter((item) => !exact.has(item) && !gaveUp.has(item));
    if (!awkward.length) return { ...done, dropped };
    best = { ...done, dropped: [...dropped] };
    lastExact = awkward;
    awkward.forEach((item) => exact.add(item));
  }
  return best ?? fail('Não deu pra fechar uma solução com todas as máquinas acima do clock mínimo; tente outras receitas.');
}

/**
 * Extração menor que o mínimo de uma máquina (clock de 1%) não existe no jogo: a máquina tira
 * max(mínimo, 2 × o necessário) e a sobra vai pro armazém por um divisor na saída. O dobro
 * garante sobra ≥ metade, e aí o divisor comum entrega o exato pras faixas (ver Group.overflow).
 * Fica fora do LP de propósito: se a sobra entrasse lá, ela viraria "recurso de graça" e o LP
 * passaria a usá-la, mudando o necessário a cada rodada.
 */
function minExtraction(input: OptimizeInput, res: Optimized, copies: number, seeds: Set<ItemId>): Optimized {
  const extraction = { ...res.extraction };
  const excess = { ...res.excess };
  const overflow: Record<ItemId, number> = {};
  const made = new Set(res.recipes.flatMap((r) => r.recipe.outputs.map((p) => p.item)));
  // semente de laço: extração "zero" que precisa existir (o mínimo de uma máquina)
  const needs = new Map(Object.entries(res.extraction));
  for (const item of seeds) if (!needs.has(item) && made.has(item)) needs.set(item, 0);
  for (const [item, need] of needs) {
    const min = extractionPer100(item, input.ores[item] ?? defaultOre()) * (OVERCLOCK.min / 100) * copies;
    if (need >= min * (1 - 1e-9)) continue;
    if (made.has(item)) {
      // o item também sai de receitas (ex.: água de subproduto): saídas INTEIRAS dessas receitas
      // vão pro armazém (subprodutos antes, das menores pras maiores) até cobrir a diferença pro
      // mínimo, e a extração cresce o mesmo tanto. Fecha exato sem cortar receita em pedaço fino.
      const outs = res.recipes
        .flatMap(({ recipe, machines }) => recipe.outputs.map((p, o) => ({ o, amount: p.item === item ? p.rate * machines : 0 })))
        .filter((x) => x.amount > TINY)
        .sort((a, b) => Number(a.o === 0) - Number(b.o === 0) || a.amount - b.amount);
      let stored = 0;
      for (const x of outs) {
        if (need + stored >= min * (1 - 1e-9)) break;
        stored += x.amount;
      }
      extraction[item] = need + stored;
      excess[item] = (excess[item] ?? 0) + stored;
      continue;
    }
    extraction[item] = Math.max(min, 2 * need) * 1.000001;
    overflow[item] = extraction[item] - need;
    excess[item] = (excess[item] ?? 0) + overflow[item];
  }
  // a extração mudou um pouco: confere se o número de cópias continua o mesmo
  if (copiesFor({ ...res, extraction, excess, overflow }, input) !== copies) return res;
  return { ...res, extraction, excess, overflow };
}

/** Monta o resultado a partir das variáveis do LP, recalculando os balanços */
function collect(input: OptimizeInput, recipes: Recipe[], lp: Lp, rate: number, bounds = new Map<string, number>()): Optimized {
  const maxClock = Math.min(250, Math.max(1, input.maxClock));
  const raw = recipes.map((recipe) => ({ recipe, machines: lp.x.get(`r|${recipe.id}`) ?? 0 })).filter((r) => r.machines > 1e-7);
  // receitas presas no mínimo (clock de 1%) ficam com esse valor exato na correção
  const fixed = new Map<string, number>();
  for (const r of raw) {
    const min = bounds.get(`r|${r.recipe.id}`);
    if (min !== undefined && Math.abs(r.machines - min) <= 1e-6 * Math.max(1, min)) fixed.set(r.recipe.id, min);
  }
  const used = repair(raw, input.item, rate, fixed) ?? raw;
  const produced = new Map<ItemId, number>();
  const byproduct = new Map<ItemId, number>();
  const consumed = new Map<ItemId, number>();
  const add = (m: Map<ItemId, number>, k: ItemId, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const { recipe, machines } of used) {
    recipe.outputs.forEach((p, i) => {
      add(produced, p.item, p.rate * machines);
      if (i > 0) add(byproduct, p.item, p.rate * machines);
    });
    for (const p of recipe.inputs) add(consumed, p.item, p.rate * machines);
  }
  add(consumed, input.item, rate);
  const extraction: Record<ItemId, number> = {};
  const external: Record<ItemId, number> = {};
  const excess: Record<ItemId, number> = {};
  for (const item of new Set([...produced.keys(), ...consumed.keys()])) {
    const net = (produced.get(item) ?? 0) - (consumed.get(item) ?? 0);
    if (net < -TINY) (isResource(item) ? extraction : external)[item] = -net;
    else if (net > TINY) excess[item] = net;
  }
  const byproducts = [...byproduct.entries()].map(([item, amount]) => {
    const stored = Math.min(amount, excess[item] ?? 0);
    return { item, produced: amount, reused: amount - stored, stored };
  });
  let machines = 0;
  let power = 0;
  for (const { recipe, machines: m } of used) {
    machines += m / (maxClock / 100);
    power += m * recipePower(recipe, maxClock);
  }
  for (const [item, amount] of Object.entries(extraction)) {
    const ex = extractionCost(item, input.ores[item] ?? defaultOre(), maxClock);
    machines += amount * ex.machines;
    power += amount * ex.power;
  }
  return { rate, recipes: used, extraction, external, excess, overflow: {}, byproducts, machines, power, dropped: [] };
}

/** Mensagem do "não sai nada": o que a receita mais barata precisaria e não foi informado */
function missingFor(input: OptimizeInput, recipes: Recipe[]): string {
  const free = runLp({ ...input, goal: 'target', rate: 1, objective: 'resources' }, recipes, 'target', 1);
  const base = `Com os recursos informados não sai nada de ${name(input.item)}`;
  if (free.status !== 'optimal') return `${base}.`;
  const res = collect({ ...input, goal: 'target' }, recipes, free, 1);
  const lacking = [...Object.keys(res.extraction), ...Object.keys(res.external)].filter(
    (item) => !(input.available[item] > 0) && !(item === WATER && input.unlimitedWater),
  );
  return lacking.length ? `${base}: falta ${lacking.map(name).join(', ')}.` : `${base}.`;
}

/**
 * O simplex devolve as taxas com ruído (~1e-7), o que vira sobra ou falta de "um fio" na linha.
 * Aqui refazemos a conta exata: com as receitas usadas e o papel de cada item (balanço exato,
 * tirado do chão/de fora, ou sobrando), resolve o sistema linear por eliminação de Gauss.
 * Se o sistema não fechar (caso degenerado), fica com a solução do simplex.
 */
function repair(
  all: { recipe: Recipe; machines: number }[],
  target: ItemId,
  rate: number,
  fixed: Map<string, number>,
): { recipe: Recipe; machines: number }[] | undefined {
  const items = new Set<ItemId>([target]);
  for (const { recipe } of all) for (const p of [...recipe.inputs, ...recipe.outputs]) items.add(p.item);
  const list = [...items];
  const row = new Map(list.map((item, i) => [item, i]));
  const net = new Array(list.length).fill(0);
  // as fixas entram do lado direito (já descontadas da demanda)
  const demand = list.map((item) => (item === target ? rate : 0));
  for (const [id, v] of fixed) {
    const r = RECIPES[id];
    for (const p of r.outputs) demand[row.get(p.item)!] -= p.rate * v;
    for (const p of r.inputs) demand[row.get(p.item)!] += p.rate * v;
  }
  const used = all.filter((u) => !fixed.has(u.recipe.id));
  const n = used.length;
  const a: number[][] = list.map(() => new Array(n).fill(0));
  used.forEach(({ recipe, machines }, j) => {
    for (const p of recipe.outputs) a[row.get(p.item)!][j] += p.rate;
    for (const p of recipe.inputs) a[row.get(p.item)!][j] -= p.rate;
    for (let i = 0; i < list.length; i++) net[i] += a[i][j] * machines;
  });
  // folga por item que não fecha exato: +1 = vem do chão/de fora, −1 = sobra
  const slack: { i: number; sign: number }[] = [];
  list.forEach((_, i) => {
    const d = net[i] - demand[i];
    if (Math.abs(d) > 1e-5) slack.push({ i, sign: d < 0 ? 1 : -1 });
  });
  const cols = n + slack.length;
  const m = list.map((_, i) => [...a[i], ...slack.map((s) => (s.i === i ? s.sign : 0)), demand[i]]);
  // eliminação com pivô parcial
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < cols && r < m.length; c++) {
    let best = r;
    for (let k = r + 1; k < m.length; k++) if (Math.abs(m[k][c]) > Math.abs(m[best][c])) best = k;
    if (Math.abs(m[best][c]) < 1e-12) return undefined;
    [m[r], m[best]] = [m[best], m[r]];
    for (let k = 0; k < m.length; k++) {
      if (k === r || m[k][c] === 0) continue;
      const f = m[k][c] / m[r][c];
      for (let q = c; q <= cols; q++) m[k][q] -= f * m[r][q];
    }
    pivots.push(c);
    r++;
  }
  if (pivots.length < cols) return undefined;
  // linhas que sobraram têm que fechar (sistema consistente)
  for (let k = r; k < m.length; k++) if (Math.abs(m[k][cols]) > 1e-9) return undefined;
  const sol = pivots.map((c, k) => m[k][cols] / m[k][c]);
  if (sol.some((v) => v < -1e-9)) return undefined;
  const solved = used.map((u, j) => ({ ...u, machines: sol[j] }));
  // a correção é pequena; se mudou muito, algo não bateu
  if (solved.some((f, j) => Math.abs(f.machines - used[j].machines) > 1e-4 * Math.max(1, used[j].machines))) return undefined;
  const byId = new Map(solved.map((f) => [f.recipe.id, f]));
  return all.map((u) => (fixed.has(u.recipe.id) ? { ...u, machines: fixed.get(u.recipe.id)! } : byId.get(u.recipe.id)!)).filter((f) => f.machines > 1e-12);
}
