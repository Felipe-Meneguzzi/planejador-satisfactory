import { AMPLIFICATION, BELTS, BELT_TIERS, EXTRACTORS, GENERATORS, ITEMS, MACHINES, MINER_TIERS, OVERCLOCK, PIPES, PIPE_TIERS, PURITIES, SINK, WELL, extractorClockable, generatorClockable, generatorPorts, getRecipe, isFluid, sinkPoints, withUnit } from '../game/data';
import type { BeltItem, BeltTier, ExtractorData, FactoryData, GeneratorData, GeneratorId, ItemId, MachineData, MinerData, PipeTier, SinkData, WellData } from '../game/types';
import { fmt } from '../format';

/*
 * Modelo de fluxo
 * ----------------
 * Cada esteira tem dois valores calculados:
 *   - oferta (s): quanto o lado de cima conseguiria empurrar nela
 *   - demanda (d): quanto o lado de baixo conseguiria absorver dela
 * Ambos são limitados pela capacidade da esteira. O fluxo real é min(s, d).
 *
 * As máquinas aplicam back-pressure: se a saída entope, a demanda da entrada cai;
 * se a entrada falta, a oferta da saída cai. Divisores e mescladores repartem de
 * forma justa (water-filling), como no jogo. Tudo é resolvido por iteração até
 * convergir (ponto fixo).
 */

export type SimNode = { id: string; data: FactoryData };
export type SimEdge = {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
  tier: BeltTier;
  /** 'pipe' = cano (capacidade em m³/min pelos tiers de cano) */
  medium?: 'belt' | 'pipe';
};

export type EdgeStatus = 'idle' | 'ok' | 'excess' | 'bottleneck' | 'wrong-item';
export interface EdgeResult {
  item: BeltItem;
  /** é um cano (fluido) */
  pipe: boolean;
  cap: number;
  /** oferta bruta (sem limite da esteira) */
  offered: number;
  /** demanda efetiva (já limitada pela esteira) */
  wanted: number;
  flow: number;
  status: EdgeStatus;
}
export interface PortResult {
  handle: string;
  item: BeltItem;
  max: number;
  actual: number;
  connected: boolean;
}
export interface NodeResult {
  util: number;
  /** consumo em MW */
  power: number;
  /** geração em MW (geradores; sem o bônus do Alien Power Augmenter) */
  generated?: number;
  /** pontos/min do AWESOME Sink */
  points?: number;
  inputs: PortResult[];
  outputs: PortResult[];
}
export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue {
  id: string;
  level: IssueLevel;
  target: { kind: 'node' | 'edge'; id: string };
  message: string;
  fixTier?: BeltTier;
  /** a correção é de cano (nomes/tiers de cano) */
  fixPipe?: boolean;
}
/** Saldo de energia da planta (tudo em MW) */
export interface EnergyResult {
  /** consumo total: máquinas, mineradoras, extratores, pressurizadores, AWESOME Sinks */
  consumption: number;
  /** geração real total, já com o bônus dos Alien Power Augmenters */
  generation: number;
  /** geração sem o bônus: geradores + os MW próprios de cada APA */
  base: number;
  /** MW que o bônus dos APAs soma na rede */
  boost: number;
  /** bônus somado dos APAs (0,1 sem combustível, 0,3 abastecido, cada) */
  boostRate: number;
  /** quantidade de geradores (de qualquer tipo) */
  generators: number;
  /** por tipo de gerador: real (sem bônus) e nominal no clock escolhido */
  byType: { generator: GeneratorId; count: number; generated: number; nominal: number }[];
  /** insumos que os geradores consomem por minuto (combustível, água, Alien Power Matrix) */
  fuel: { item: ItemId; rate: number }[];
  /** consumo ÷ geração (null sem geradores) */
  usage: number | null;
}
export interface SimResult {
  nodes: Record<string, NodeResult>;
  edges: Record<string, EdgeResult>;
  issues: Issue[];
  byTarget: Record<string, Issue[]>;
  /** consumo de energia (MW) */
  power: number;
  energy: EnergyResult;
  machines: number;
  /** total de Somersloops em uso */
  sloops: number;
  /** `sunk` = destruído em AWESOME Sinks (só aparece quando há) */
  production: { item: ItemId; stored: number; loose: number; sunk?: number }[];
  /** AWESOME Sinks: quantos há, pontos/min e pontos/min do contador de DNA */
  sink: { count: number; points: number; dna: number };
}

const EPS = 1e-6;
const key = (node: string, handle?: string | null) => `${node}|${handle ?? ''}`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const minOf = (xs: number[]) => (xs.length ? Math.min(...xs) : 1);
const minExcept = (xs: number[], i: number) => minOf(xs.filter((_, j) => j !== i));
const diff = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b));
const isWrong = (item: BeltItem, expected: ItemId) => item !== null && item !== expected;
const itemName = (item: BeltItem) => (item === 'mixed' ? 'itens misturados' : item ? ITEMS[item].name : 'nada');

export const CLOCK_MIN = OVERCLOCK.min;
export const CLOCK_MAX = OVERCLOCK.max;
export const clampClock = (c: number) => (Number.isFinite(c) ? Math.min(CLOCK_MAX, Math.max(CLOCK_MIN, c)) : 100);
/** Power Shards necessários pro clock (faixas vindas dos dados do jogo) */
export const shardsFor = (clock: number) => {
  const c = clampClock(clock);
  return OVERCLOCK.shards.find((s) => c <= s.upTo + 1e-9)?.shards ?? OVERCLOCK.shards[OVERCLOCK.shards.length - 1].shards;
};
export const minerRate = (d: MinerData) =>
  (MINER_TIERS[d.tier].base * PURITIES[d.purity].mult * clampClock(d.clock)) / 100;
/** Vazão de um extrator de fluido (m³/min) no clock atual */
export const extractorRate = (d: ExtractorData) => {
  const info = EXTRACTORS[d.extractor];
  return (info.rate(d.purity) * (extractorClockable(d.extractor) ? clampClock(d.clock) : 100)) / 100;
};
/** Consumo de energia com overclock/underclock */
export const powerAt = (base: number, clock: number) => base * Math.pow(clampClock(clock) / 100, OVERCLOCK.powerExponent);

/** Vazão de cada extrator-satélite do poço (m³/min): pureza dele × clock do pressurizador */
export const wellSatelliteRates = (d: WellData) => d.satellites.map((p) => (WELL.rates[p] * clampClock(d.clock)) / 100);
/** Consumo do Resource Well Pressurizer: fixo pro clock (não depende dos satélites nem do fluxo) */
export const wellPower = (clock: number) => WELL.power * Math.pow(clampClock(clock) / 100, WELL.powerExponent);

/** Clock efetivo do gerador (Geothermal e Alien Power Augmenter não aceitam: ficam em 100%) */
export const generatorClock = (d: GeneratorData) => (generatorClockable(d) ? clampClock(d.clock) : 100);
/**
 * Geração nominal do gerador em MW no clock atual, com combustível e água sobrando.
 * Gerador a combustível escala 1:1 com o clock; o geotérmico usa a média da pureza do gêiser.
 */
export const generatorNominal = (d: GeneratorData) => {
  const g = GENERATORS[d.generator];
  if (!g) return 0;
  if (g.geothermal) return g.geothermal[d.purity ?? 'normal'].avg;
  return (g.power * generatorClock(d)) / 100;
};

/**
 * Geração da rede com Alien Power Augmenters (fórmula do wiki):
 * (geração dos outros + 500 MW × APAs) × (1 + Σ bônus), bônus = 0,1 sem combustível e 0,3 abastecido.
 * `base` já inclui os MW próprios dos APAs; `fed` = fração abastecida de cada APA (0..1, parcial = média).
 */
export function augmentedGeneration(base: number, fed: number[]) {
  const boost = Object.values(GENERATORS).find((g) => g.boost)?.boost ?? { unfueled: 0, fueled: 0 };
  const rate = fed.reduce((a, f) => a + boost.unfueled + (boost.fueled - boost.unfueled) * Math.min(1, Math.max(0, f)), 0);
  return { rate, generation: base * (1 + rate) };
}

/** O AWESOME Sink recusa o item (fluido ou item sem pontos): a esteira para */
export const sinkRefuses = (d: SinkData, item: BeltItem) =>
  d.mode === 'awesome' && !!item && item !== 'mixed' && (isFluid(item) || (sinkPoints(item) === undefined && item !== SINK.dna.item));

/** Somersloops efetivos (limitados aos slots da máquina) */
export const sloopsOf = (d: MachineData) => Math.max(0, Math.min(MACHINES[d.machine]?.sloopSlots ?? 0, Math.floor(d.sloops ?? 0)));
/** Multiplicador de produção da amplificação: 1 + preenchidos/total */
export const ampOf = (d: MachineData) => {
  const slots = MACHINES[d.machine]?.sloopSlots ?? 0;
  return slots ? 1 + sloopsOf(d) / slots : 1;
};

/**
 * Parte justa de `total` que um participante com capacidade ilimitada recebe,
 * dividindo com outros participantes de capacidades `others` (water-filling).
 */
export function shareWithUnbounded(total: number, others: number[]): number {
  if (total <= 0) return 0;
  const sorted = [...others].sort((a, b) => a - b);
  let remaining = total;
  let n = sorted.length + 1;
  for (const c of sorted) {
    if (c * n > remaining) break;
    remaining -= c;
    n--;
  }
  return remaining / n;
}

interface Belt {
  id: string;
  pipe: boolean;
  tier: BeltTier;
  cap: number;
  item: BeltItem;
  rawS: number;
  rawD: number;
  s: number;
  d: number;
}

export function simulate(nodes: SimNode[], edges: SimEdge[]): SimResult {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const belts = new Map<string, Belt>();
  const bySource = new Map<string, Belt>();
  const byTarget = new Map<string, Belt>();
  const valid = edges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target));
  for (const e of valid) {
    const pipe = e.medium === 'pipe';
    const tier = (pipe ? (PIPES[e.tier as PipeTier] ? e.tier : 1) : BELTS[e.tier] ? e.tier : 1) as BeltTier;
    const cap = pipe ? PIPES[tier as PipeTier].rate : BELTS[tier].rate;
    const b: Belt = { id: e.id, pipe, tier, cap, item: null, rawS: 0, rawD: 0, s: 0, d: 0 };
    belts.set(e.id, b);
    bySource.set(key(e.source, e.sourceHandle), b);
    byTarget.set(key(e.target, e.targetHandle), b);
  }
  const outB = (n: string, i: number) => bySource.get(key(n, `out-${i}`));
  const inB = (n: string, i: number) => byTarget.get(key(n, `in-${i}`));
  const present = (bs: (Belt | undefined)[]) => bs.filter((b): b is Belt => !!b);
  const three = [0, 1, 2];

  // 1) Propaga qual item corre em cada esteira
  const outItems = (n: SimNode): BeltItem[] => {
    const d = n.data;
    switch (d.kind) {
      case 'miner':
      case 'extractor':
        return [d.resource];
      case 'well':
        return d.satellites.map(() => d.resource);
      case 'machine':
        return getRecipe(d).outputs.map((o) => o.item);
      case 'generator':
        return generatorPorts(d).outputs.map((o) => o.item);
      case 'splitter': {
        const it = inB(n.id, 0)?.item ?? null;
        return [it, it, it];
      }
      case 'merger': {
        const items = new Set(present(three.map((i) => inB(n.id, i))).map((b) => b.item).filter((x) => x !== null));
        return [items.size === 0 ? null : items.size === 1 ? [...items][0] : 'mixed'];
      }
      case 'sink':
        return [];
    }
  };
  for (let it = 0; it <= nodes.length + 1; it++) {
    let changed = false;
    for (const n of nodes) {
      outItems(n).forEach((item, i) => {
        const b = outB(n.id, i);
        if (b && b.item !== item) {
          b.item = item;
          changed = true;
        }
      });
    }
    if (!changed) break;
  }

  // 2) Ponto fixo de oferta/demanda
  let delta = 0;
  const setS = (b: Belt, raw: number) => {
    const s = Math.min(b.cap, raw);
    delta = Math.max(delta, diff(b.s, s));
    b.rawS = raw;
    b.s = s;
  };
  const setD = (b: Belt, raw: number) => {
    const d = Math.min(b.cap, raw);
    delta = Math.max(delta, diff(b.d, d));
    b.rawD = raw;
    b.d = d;
  };

  const step = (n: SimNode) => {
    const d = n.data;
    switch (d.kind) {
      case 'miner': {
        const b = outB(n.id, 0);
        if (b) setS(b, minerRate(d));
        break;
      }
      case 'extractor': {
        const b = outB(n.id, 0);
        if (b) setS(b, extractorRate(d));
        break;
      }
      case 'well': {
        wellSatelliteRates(d).forEach((rate, i) => {
          const b = outB(n.id, i);
          if (b) setS(b, rate);
        });
        break;
      }
      case 'machine': {
        const r = getRecipe(d);
        const k = clampClock(d.clock) / 100;
        const ins = r.inputs.map((p, i) => ({ need: p.rate * k, item: p.item, b: inB(n.id, i) }));
        const outs = r.outputs.map((p, i) => ({ max: p.rate * k * ampOf(d), b: outB(n.id, i) }));
        const inR = ins.map((p) => (!p.b || isWrong(p.b.item, p.item) ? 0 : Math.min(1, p.b.s / p.need)));
        const outR = outs.map((p) => (!p.b ? 1 : Math.min(1, p.b.d / p.max)));
        ins.forEach((p, i) => {
          if (!p.b) return;
          setD(p.b, isWrong(p.b.item, p.item) ? 0 : p.need * Math.min(minOf(outR), minExcept(inR, i)));
        });
        outs.forEach((p, j) => {
          if (p.b) setS(p.b, p.max * Math.min(minOf(inR), minExcept(outR, j)));
        });
        break;
      }
      case 'generator': {
        // igual a uma máquina: combustível e água entram, resíduo sai (o que faltar limita o resto)
        const gp = generatorPorts(d);
        const k = generatorClock(d) / 100;
        const ins = gp.inputs.map((p, i) => ({ need: p.rate * k, item: p.item, optional: !!p.optional, b: inB(n.id, i) }));
        const outs = gp.outputs.map((p, i) => ({ max: p.rate * k, b: outB(n.id, i) }));
        // insumo opcional (Alien Power Matrix) não trava o gerador: só puxa o que ele queima
        const inR = ins.map((p) => (p.optional ? 1 : !p.b || isWrong(p.b.item, p.item) ? 0 : Math.min(1, p.b.s / p.need)));
        const outR = outs.map((p) => (!p.b ? 1 : Math.min(1, p.b.d / p.max)));
        ins.forEach((p, i) => {
          if (!p.b) return;
          setD(p.b, isWrong(p.b.item, p.item) ? 0 : p.optional ? p.need : p.need * Math.min(minOf(outR), minExcept(inR, i)));
        });
        outs.forEach((p, j) => {
          if (p.b) setS(p.b, p.max * Math.min(minOf(inR), minExcept(outR, j)));
        });
        break;
      }
      case 'splitter': {
        const inp = inB(n.id, 0);
        const outs = present(three.map((i) => outB(n.id, i)));
        const S = inp ? inp.s : 0;
        outs.forEach((b, i) =>
          setS(
            b,
            shareWithUnbounded(
              S,
              outs.filter((_, j) => j !== i).map((o) => o.d),
            ),
          ),
        );
        if (inp) setD(inp, sum(outs.map((o) => o.d)));
        break;
      }
      case 'merger': {
        const ins = present(three.map((i) => inB(n.id, i)));
        const out = outB(n.id, 0);
        const D = out ? out.d : 0;
        ins.forEach((b, i) =>
          setD(
            b,
            shareWithUnbounded(
              D,
              ins.filter((_, j) => j !== i).map((o) => o.s),
            ),
          ),
        );
        if (out) setS(out, sum(ins.map((o) => o.s)));
        break;
      }
      case 'sink': {
        const b = inB(n.id, 0);
        if (b) setD(b, sinkRefuses(d, b.item) ? 0 : Infinity);
        break;
      }
    }
  };
  for (let iter = 0; iter < 5000; iter++) {
    delta = 0;
    for (const n of nodes) step(n);
    if (delta < 1e-9) break;
  }

  // 3) Resultados, problemas e resumo
  const issues: Issue[] = [];
  const add = (level: IssueLevel, kind: 'node' | 'edge', id: string, code: string, message: string, fixTier?: BeltTier, fixPipe?: boolean) =>
    issues.push({ id: `${id}:${code}`, level, target: { kind, id }, message, fixTier, ...(fixPipe ? { fixPipe } : {}) });
  const flowOf = (b?: Belt) => (b ? Math.min(b.s, b.d) : 0);
  const port = (handle: string, item: BeltItem, max: number, b?: Belt, actual?: number): PortResult => ({
    handle,
    item,
    max,
    actual: actual ?? flowOf(b),
    connected: !!b,
  });

  const edgeResults: Record<string, EdgeResult> = {};
  for (const e of valid) {
    const b = belts.get(e.id)!;
    const src = nodeById.get(e.source)!.data;
    const tgt = nodeById.get(e.target)!.data;
    const flow = flowOf(b);
    let status: EdgeStatus = flow > EPS ? 'ok' : 'idle';
    const inIdx = Number(e.targetHandle?.split('-')[1]);
    const expected =
      tgt.kind === 'machine' ? getRecipe(tgt).inputs[inIdx]?.item : tgt.kind === 'generator' ? generatorPorts(tgt).inputs[inIdx]?.item : undefined;
    const need = Math.min(b.rawS, b.rawD);
    const u = (v: number) => withUnit(fmt(v), b.item);
    const what = b.pipe ? 'Cano' : 'Esteira';

    if (tgt.kind === 'sink' && sinkRefuses(tgt, b.item)) {
      // o problema aparece no próprio AWESOME Sink (não vira "sobra" na esteira)
      status = 'wrong-item';
    } else if (expected && isWrong(b.item, expected)) {
      status = 'wrong-item';
      add(
        'error',
        'edge',
        e.id,
        'wrong',
        b.item === 'mixed'
          ? `${what} com ${b.pipe ? 'fluidos' : 'itens'} misturados entrando numa máquina`
          : `${itemName(b.item)} não serve aqui — ${tgt.kind === 'generator' ? 'o gerador' : 'a máquina'} espera ${ITEMS[expected].name}`,
      );
    } else if (need > b.cap + EPS) {
      status = 'bottleneck';
      const fix = b.pipe ? PIPE_TIERS.find((t) => PIPES[t].rate >= need - EPS) : BELT_TIERS.find((t) => BELTS[t].rate >= need - EPS);
      const tierName = b.pipe ? PIPES[b.tier as PipeTier].name : BELTS[b.tier].name;
      const maxName = b.pipe ? `Mk.${PIPE_TIERS[PIPE_TIERS.length - 1]}` : `Mk.${BELT_TIERS[BELT_TIERS.length - 1]}`;
      add(
        'error',
        'edge',
        e.id,
        'belt',
        `${what} ${tierName} frac${b.pipe ? 'o' : 'a'}: precisa levar ${u(need)}, aguenta ${u(b.cap)}` +
          (fix ? '' : ` — nem ${b.pipe ? 'o' : 'a'} ${maxName} aguenta, divida em ${b.pipe ? 'mais canos' : 'mais esteiras'}`),
        fix,
        b.pipe,
      );
    } else if (b.rawS > b.d + EPS && src.kind !== 'splitter' && tgt.kind !== 'merger') {
      // Sobra: reportada só na esteira "raiz" (antes do divisor / depois do mesclador)
      status = 'excess';
      add(
        'warning',
        'edge',
        e.id,
        'excess',
        `Sobrando ${u(b.rawS - b.d)} de ${itemName(b.item)}: produz ${u(b.rawS)}, consome ${u(b.d)}`,
      );
    }
    edgeResults[e.id] = { item: b.item, pipe: b.pipe, cap: b.cap, offered: b.rawS, wanted: b.d, flow, status };
  }

  const nodeResults: Record<string, NodeResult> = {};
  const stored = new Map<ItemId, number>();
  const loose = new Map<ItemId, number>();
  const addTo = (m: Map<ItemId, number>, item: BeltItem, v: number) => {
    if (item && item !== 'mixed' && v > EPS) m.set(item, (m.get(item) ?? 0) + v);
  };
  let power = 0;
  let machines = 0;
  let sloops = 0;
  // energia: geração sem bônus, bônus dos APAs, por tipo e insumos consumidos
  let genBase = 0;
  const apaFed: number[] = [];
  let generatorCount = 0;
  let firstGenerator: string | undefined;
  const byType = new Map<GeneratorId, { count: number; generated: number; nominal: number }>();
  const sunk = new Map<ItemId, number>();
  let sinkCount = 0;
  let sinkPointsTotal = 0;
  let sinkDna = 0;
  const fuelUsed = new Map<ItemId, number>();

  for (const n of nodes) {
    const d = n.data;
    switch (d.kind) {
      case 'miner': {
        const R = minerRate(d);
        const b = outB(n.id, 0);
        const actual = b ? flowOf(b) : R;
        const p = powerAt(MINER_TIERS[d.tier].power, d.clock);
        power += p;
        machines++;
        nodeResults[n.id] = { util: R > 0 ? actual / R : 0, power: p, inputs: [], outputs: [port('out-0', d.resource, R, b, actual)] };
        if (!b) {
          addTo(loose, d.resource, R);
          add('info', 'node', n.id, 'free', `Saída livre: ${withUnit(fmt(R), d.resource)} de ${ITEMS[d.resource].name} disponíveis`);
        }
        break;
      }
      case 'extractor': {
        const R = extractorRate(d);
        const b = outB(n.id, 0);
        const actual = b ? flowOf(b) : R;
        const p = powerAt(EXTRACTORS[d.extractor].power, EXTRACTORS[d.extractor].overclockable ? d.clock : 100);
        power += p;
        machines++;
        nodeResults[n.id] = { util: R > 0 ? actual / R : 0, power: p, inputs: [], outputs: [port('out-0', d.resource, R, b, actual)] };
        if (!b) {
          addTo(loose, d.resource, R);
          add('info', 'node', n.id, 'free', `Saída livre: ${withUnit(fmt(R), d.resource)} de ${ITEMS[d.resource].name} disponíveis`);
        }
        break;
      }
      case 'well': {
        // o pressurizador consome sempre o mesmo pro clock, mesmo com a saída entupida
        const rates = wellSatelliteRates(d);
        const outs = rates.map((R, i) => ({ R, b: outB(n.id, i) }));
        const actual = outs.map((x) => (x.b ? flowOf(x.b) : x.R));
        const total = sum(rates);
        const p = wellPower(d.clock);
        power += p;
        machines++;
        nodeResults[n.id] = {
          util: total > 0 ? sum(actual) / total : 0,
          power: p,
          inputs: [],
          outputs: outs.map((x, i) => port(`out-${i}`, d.resource, x.R, x.b, actual[i])),
        };
        if (!rates.length) add('warning', 'node', n.id, 'nosat', `Poço sem extratores-satélite: o ${WELL.name} consome ${fmt(p)} MW sem extrair nada`);
        // satélites sem cano: uma mensagem só, com o total disponível
        const free = outs.map((x, i) => ({ ...x, i })).filter((x) => !x.b);
        free.forEach((x) => addTo(loose, d.resource, x.R));
        if (free.length) {
          const which = free.length === outs.length ? 'Saída livre' : `Saída livre nos satélites ${free.map((x) => x.i + 1).join(', ')}`;
          add('info', 'node', n.id, 'free', `${which}: ${withUnit(fmt(sum(free.map((x) => x.R))), d.resource)} de ${ITEMS[d.resource].name} disponíveis`);
        }
        break;
      }
      case 'machine': {
        const r = getRecipe(d);
        const k = clampClock(d.clock) / 100;
        const m = MACHINES[d.machine];
        const ins = r.inputs.map((p, i) => ({ need: p.rate * k, item: p.item, b: inB(n.id, i) }));
        const amp = ampOf(d);
        const outs = r.outputs.map((p, i) => ({ max: p.rate * k * amp, item: p.item, b: outB(n.id, i) }));
        const inR = ins.map((p) => (!p.b || isWrong(p.b.item, p.item) ? 0 : Math.min(1, p.b.s / p.need)));
        const outR = outs.map((p) => (!p.b ? 1 : Math.min(1, p.b.d / p.max)));
        const util = Math.min(minOf(inR), minOf(outR));
        const p = powerAt(r.power ?? m.power, d.clock) * Math.pow(amp, AMPLIFICATION.powerExponent);
        sloops += sloopsOf(d);
        power += p;
        machines++;
        nodeResults[n.id] = {
          util,
          power: p,
          inputs: ins.map((x, i) => port(`in-${i}`, x.item, x.need, x.b)),
          outputs: outs.map((x, i) => port(`out-${i}`, x.item, x.max, x.b, x.b ? undefined : x.max * util)),
        };
        const uu = (v: number, item: ItemId) => withUnit(fmt(v), item);
        ins.forEach((x, i) => {
          const name = ITEMS[x.item].name;
          if (!x.b) {
            add('warning', 'node', n.id, `in${i}`, `Entrada sem ${isFluid(x.item) ? 'cano' : 'esteira'} — precisa de ${uu(x.need, x.item)} de ${name}`);
          } else if (!isWrong(x.b.item, x.item) && x.b.s < x.need - EPS) {
            add(
              'warning',
              'node',
              n.id,
              `starve${i}`,
              `Falta ${name}: recebe ${fmt(x.b.s)} de ${uu(x.need, x.item)} (${Math.round((x.b.s / x.need) * 100)}%)`,
            );
          }
        });
        // Com mais de uma saída, uma saída sem destino trava a máquina no jogo (o estoque
        // interno enche e ela para). Só é "livre" quando nenhuma saída está ligada (prévia).
        const someOutLinked = outs.some((x) => x.b);
        outs.forEach((x, i) => {
          if (!x.b && x.max * util > EPS) {
            addTo(loose, x.item, x.max * util);
            if (outs.length > 1 && someOutLinked)
              add(
                'warning',
                'node',
                n.id,
                `free${i}`,
                `Subproduto sem destino: ${uu(x.max * util, x.item)} de ${ITEMS[x.item].name} — no jogo a máquina para quando o estoque interno encher`,
              );
            else add('info', 'node', n.id, `free${i}`, `Saída livre: ${uu(x.max * util, x.item)} de ${ITEMS[x.item].name}`);
          }
        });
        break;
      }
      case 'generator': {
        const g = GENERATORS[d.generator];
        if (!g) break;
        const gp = generatorPorts(d);
        const k = generatorClock(d) / 100;
        const nominal = generatorNominal(d);
        const ins = gp.inputs.map((p, i) => ({ need: p.rate * k, item: p.item, optional: !!p.optional, b: inB(n.id, i) }));
        const outs = gp.outputs.map((p, i) => ({ max: p.rate * k, item: p.item, b: outB(n.id, i) }));
        const supply = (x: (typeof ins)[number]) => (!x.b || isWrong(x.b.item, x.item) ? 0 : Math.min(1, x.b.s / x.need));
        const inR = ins.map((x) => (x.optional ? 1 : supply(x)));
        const outR = outs.map((x) => (!x.b ? 1 : Math.min(1, x.b.d / x.max)));
        const util = Math.min(minOf(inR), minOf(outR));
        const generated = nominal * util;
        genBase += generated;
        generatorCount++;
        firstGenerator ??= n.id;
        const t = byType.get(d.generator) ?? { count: 0, generated: 0, nominal: 0 };
        byType.set(d.generator, { count: t.count + 1, generated: t.generated + generated, nominal: t.nominal + nominal });
        ins.forEach((x) => x.b && !isWrong(x.b.item, x.item) && addTo(fuelUsed, x.item, flowOf(x.b)));
        if (g.boost) {
          // bônus do APA entra na conta da rede inteira (augmentedGeneration)
          const fed = ins.length ? supply(ins[0]) : 0;
          apaFed.push(fed);
        }
        nodeResults[n.id] = {
          util,
          power: 0,
          generated,
          inputs: ins.map((x, i) => port(`in-${i}`, x.item, x.need, x.b)),
          outputs: outs.map((x, i) => port(`out-${i}`, x.item, x.max, x.b, x.b ? undefined : x.max * util)),
        };
        const uu = (v: number, item: ItemId) => withUnit(fmt(v), item);
        const short = `gera ${fmt(generated)} de ${fmt(nominal)} MW`;
        ins.forEach((x, i) => {
          const name = ITEMS[x.item].name;
          if (x.optional) {
            // Alien Power Augmenter: sem a matriz o bônus cai de +30% pra +10%
            if (x.b && !isWrong(x.b.item, x.item) && x.b.s < x.need - EPS && x.b.s > EPS)
              add('warning', 'node', n.id, `starve${i}`, `Falta ${name}: recebe ${fmt(x.b.s)} de ${uu(x.need, x.item)} — o bônus na rede fica parcial`);
            else if (!x.b || x.b.s <= EPS) add('info', 'node', n.id, `nofuel${i}`, `Sem ${name}: bônus de +${fmt(g.boost!.unfueled * 100)}% na rede (abastecido seria +${fmt(g.boost!.fueled * 100)}%)`);
          } else if (!x.b) {
            add('warning', 'node', n.id, `in${i}`, `Falta ${name}: entrada sem ${isFluid(x.item) ? 'cano' : 'esteira'} — precisa de ${uu(x.need, x.item)} (${short})`);
          } else if (!isWrong(x.b.item, x.item) && x.b.s < x.need - EPS) {
            add('warning', 'node', n.id, `starve${i}`, `Falta ${name}: recebe ${fmt(x.b.s)} de ${uu(x.need, x.item)} (${Math.round((x.b.s / x.need) * 100)}%) — ${short}`);
          }
        });
        outs.forEach((x, i) => {
          const name = ITEMS[x.item].name;
          if (!x.b && x.max * util > EPS) {
            addTo(loose, x.item, x.max * util);
            add('warning', 'node', n.id, `free${i}`, `Resíduo sem destino: ${uu(x.max * util, x.item)} de ${name} — no jogo a usina para quando o estoque interno encher`);
          } else if (x.b && x.b.d < x.max - EPS && minOf(inR) > EPS) {
            add('warning', 'node', n.id, `jam${i}`, `Resíduo entupido: a saída de ${name} só escoa ${fmt(x.b.d)} de ${uu(x.max, x.item)} — ${short}`);
          }
        });
        break;
      }
      case 'splitter': {
        const inp = inB(n.id, 0);
        const outs = three.map((i) => outB(n.id, i));
        nodeResults[n.id] = {
          util: 1,
          power: 0,
          inputs: [port('in-0', inp?.item ?? null, inp?.s ?? 0, inp)],
          outputs: outs.map((b, i) => port(`out-${i}`, b?.item ?? null, b?.s ?? 0, b)),
        };
        const label = d.fluid ? 'Junção' : 'Divisor';
        if (!inp) add('info', 'node', n.id, 'noin', `${label} sem entrada`);
        else if (!outs.some(Boolean)) add('warning', 'node', n.id, 'noout', `${label} sem nenhuma saída conectada`);
        break;
      }
      case 'merger': {
        const ins = three.map((i) => inB(n.id, i));
        const out = outB(n.id, 0);
        const total = sum(present(ins).map((b) => b.s));
        nodeResults[n.id] = {
          util: 1,
          power: 0,
          inputs: ins.map((b, i) => port(`in-${i}`, b?.item ?? null, b?.s ?? 0, b)),
          outputs: [port('out-0', out?.item ?? null, total, out)],
        };
        const firstItem = present(ins)[0]?.item ?? null;
        if (!out && total > EPS) add('warning', 'node', n.id, 'noout', `Saída não conectada — ${withUnit(fmt(total), firstItem)} parados`);
        if (out?.item === 'mixed') add('warning', 'node', n.id, 'mixed', d.fluid ? 'Misturando fluidos diferentes no mesmo cano' : 'Mesclando itens diferentes na mesma esteira');
        break;
      }
      case 'sink': {
        const b = inB(n.id, 0);
        const flow = flowOf(b);
        if (d.mode !== 'awesome') {
          nodeResults[n.id] = { util: 1, power: 0, inputs: [port('in-0', b?.item ?? null, b?.cap ?? 0, b)], outputs: [] };
          if (b) addTo(stored, b.item, flow);
          break;
        }
        // AWESOME Sink: consome energia só enquanto recebe itens
        const p = flow > EPS ? SINK.power : 0;
        power += p;
        sinkCount++;
        const item = b?.item ?? null;
        const pts = item && item !== 'mixed' ? sinkPoints(item) : undefined;
        const points = pts !== undefined ? flow * pts : 0;
        sinkPointsTotal += points;
        nodeResults[n.id] = { util: 1, power: p, points, inputs: [port('in-0', item, b?.cap ?? 0, b)], outputs: [] };
        if (!b || !item) break;
        const name = itemName(item);
        if (item === 'mixed') add('warning', 'node', n.id, 'mixed', 'Itens misturados chegando: os pontos/min não podem ser calculados');
        else if (isFluid(item)) add('error', 'node', n.id, 'fluid', `${SINK.name} não aceita fluidos: ${name} precisa ser empacotado (Packager) antes`);
        else if (item === SINK.dna.item) {
          sinkDna += flow * SINK.dna.points;
          addTo(sunk, item, flow);
          add('info', 'node', n.id, 'dna', `${name} vai pro contador separado de DNA: ${fmt(flow * SINK.dna.points)} pontos/min`);
        } else if (pts === undefined) add('warning', 'node', n.id, 'nopoints', `${name} não pode ser destruído no ${SINK.name} (não vale pontos): a esteira fica parada`);
        else addTo(sunk, item, flow);
        break;
      }
    }
  }

  // Saldo: (geração + MW próprios dos APAs) × (1 + bônus somado dos APAs)
  const { rate: boostRate, generation } = augmentedGeneration(genBase, apaFed);
  if (firstGenerator && power > generation + EPS)
    add(
      'error',
      'node',
      firstGenerator,
      'nopower',
      `Falta energia: consumo de ${fmt(power)} MW, geração de ${fmt(generation)} MW — faltam ${fmt(power - generation)} MW (no jogo o disjuntor desarma e a rede para)`,
    );
  const energy: EnergyResult = {
    consumption: power,
    generation,
    base: genBase,
    boost: generation - genBase,
    boostRate,
    generators: generatorCount,
    byType: [...byType.entries()].map(([generator, v]) => ({ generator, ...v })),
    fuel: [...fuelUsed.entries()].map(([item, rate]) => ({ item, rate })),
    usage: generatorCount ? (generation > EPS ? power / generation : power > EPS ? Infinity : 0) : null,
  };

  const order: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  const byTargetIssues: Record<string, Issue[]> = {};
  for (const i of issues) (byTargetIssues[i.target.id] ??= []).push(i);

  const items = new Set<ItemId>([...stored.keys(), ...loose.keys(), ...sunk.keys()]);
  const production = (Object.keys(ITEMS) as ItemId[])
    .filter((i) => items.has(i))
    .map((item) => ({ item, stored: stored.get(item) ?? 0, loose: loose.get(item) ?? 0, ...(sunk.has(item) ? { sunk: sunk.get(item)! } : {}) }));

  const sink = { count: sinkCount, points: sinkPointsTotal, dna: sinkDna };
  return { nodes: nodeResults, edges: edgeResults, issues, byTarget: byTargetIssues, power, energy, machines, sloops, production, sink };
}
