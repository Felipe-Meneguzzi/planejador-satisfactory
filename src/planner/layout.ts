import { BELTS, BELT_TIERS, PIPES, PIPE_TIERS, isFluid } from '../game/data';
import type { BeltEdge, BeltTier, FactoryNode, ItemId, PipeTier, ProductionData, ProductionNode, Rotation } from '../game/types';
import { newId } from '../state/storage';
import type { Bus, ByproductLane, Group, Lane, Plan } from './plan';

/*
 * Desenho da linha planejada.
 *
 * Organização (tudo em múltiplos do grid de 20px):
 *  - Cada grupo de máquinas é uma "faixa" vertical; as faixas ficam lado a lado, do
 *    minério (esquerda) ao armazém (direita).
 *  - Dentro da faixa: colunas de distribuição (divisores) | máquinas | coleta (mescladores).
 *    Máquina com várias entradas tem uma coluna de divisores por entrada, cada uma deslocada
 *    140px pra baixo (um "degrau"), e a esteira dela vira só perto da máquina: assim nenhuma
 *    esteira atravessa o divisor de outra entrada. Subprodutos (2ª saída) fazem o mesmo do
 *    lado da coleta.
 *  - Entre faixas, as esteiras sobem pra um "corredor" de trilhos acima de tudo (um trilho
 *    por esteira), andam na horizontal e descem até o destino. Nada cruza máquina.
 *  - Fluidos usam cano e junções de cano no lugar de esteira, divisor e mesclador.
 *  - Insumos que não dá pra produzir (coletáveis) viram Entradas externas à esquerda de tudo,
 *    uma por faixa, com a vazão que a faixa pede.
 *  - Poço de recurso: cada satélite ocupa a "vaga" de uma máquina na coleta. O node do poço
 *    fica na vaga do 1º satélite dele e cada cano de satélite desce, ao lado do poço, até a
 *    vaga do seu mesclador. O satélite de cima vira mais longe do poço, então os canos de um
 *    mesmo poço nunca se cruzam.
 *
 * As conexões que precisam de curvas extras levam `bends` (coordenadas das viradas) e
 * `anchor` (onde estavam as pontas na geração). Se um node for movido, a âncora deixa de
 * bater e a conexão volta pro roteamento automático.
 */

export type DistributionMode = 'manifold' | 'tree';

const G = 20;
const CUBE = 120;
const MACH_W = 240; // máquina minimizada
const SINK_W = 280;
const COL = 160; // largura de uma coluna de divisores/mescladores (cubo + folga)
const STEP = 140; // degrau vertical entre colunas de entradas (ou saídas) diferentes

/** altura da máquina minimizada: 100 com 1 saída, +20 por saída extra (título sempre em 1 linha) */
const machineHeight = (outputs: number) => 100 + 20 * Math.max(0, outputs - 1);

const snap = (v: number) => Math.round(v / G) * G;
/** posição do conector numa borda (mesma conta do CSS round() das faixas de conector) */
const stripOffset = (i: number, n: number, len: number) => snap(((i + 1) / (n + 1)) * len - 0.5);
const EPS = 1e-6;

interface Pt {
  x: number;
  y: number;
}
type Side = 'left' | 'right' | 'top' | 'bottom';
/** Ponto de conexão: node, conector, borda e coordenada (na borda do node) */
interface Port {
  node: string;
  handle: string;
  side: Side;
  pt: Pt;
}

interface Band {
  group?: Group;
  left: number;
  right: number;
  top: number;
  /** saída principal (topo da coleta) */
  source?: Port;
  /** topo de cada coleta de subproduto, por armazém de destino */
  byproductSources: { lane: ByproductLane; port: Port }[];
  /** entradas das faixas de consumidor, por id da faixa */
  entries: Map<string, Port>;
}

export interface Layout {
  nodes: FactoryNode[];
  edges: BeltEdge[];
}

export function layoutPlan(plan: Plan, mode: DistributionMode, maxBelt: BeltTier, maxPipe: PipeTier, origin: Pt): Layout {
  const nodes: ProductionNode[] = [];
  const edges: BeltEdge[] = [];

  /** menor Mk que aguenta o fluxo (esteira pra sólido, cano pra fluido), até o máximo liberado */
  const tierFor = (flow: number, item: ItemId) =>
    isFluid(item)
      ? (PIPE_TIERS.find((t) => PIPES[t].rate >= flow - EPS && t <= maxPipe) ?? maxPipe)
      : (BELT_TIERS.find((t) => BELTS[t].rate >= flow - EPS && t <= maxBelt) ?? maxBelt);

  const addNode = (data: ProductionData, x: number, y: number) => {
    const id = newId(data.kind);
    nodes.push({ id, type: data.kind, position: { x, y }, data } as ProductionNode);
    return id;
  };
  /** divisor/mesclador; pra fluido vira junção de cano */
  const cube = (kind: 'splitter' | 'merger', rotation: Rotation, x: number, y: number, item: ItemId) =>
    addNode({ kind, rotation, ...(isFluid(item) ? { fluid: true } : {}) }, x, y);
  /** conector de um cubo (todos ficam no meio da face) */
  const cubePort = (node: string, handle: string, side: Side, x: number, y: number): Port => ({
    node,
    handle,
    side,
    pt: side === 'left' ? { x, y: y + 60 } : side === 'right' ? { x: x + CUBE, y: y + 60 } : side === 'top' ? { x: x + 60, y } : { x: x + 60, y: y + CUBE },
  });
  /** esteira (sólido) ou cano (fluido) */
  const belt = (from: Port, to: Port, flow: number, item: ItemId, bends?: number[]) => {
    edges.push({
      id: newId('b'),
      type: isFluid(item) ? 'pipe' : 'belt',
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
      data: {
        tier: tierFor(flow, item),
        ...(bends?.length ? { bends, anchor: [from.pt.x, from.pt.y, to.pt.x, to.pt.y] } : {}),
      },
    });
  };

  /* ---------- faixa de um grupo ---------- */

  const layoutGroup = (g: Group, X0: number): Band => {
    const n = g.count;
    const K = g.recipe?.inputs.length ?? 0;
    const O = g.recipe?.outputs.length ?? 1;
    // poço: satélites [wellStart[w], wellStart[w] + wells[w]) pertencem ao poço w
    const wells = g.kind === 'well' ? g.wells! : [];
    const wellStart = wells.map((_, w) => wells.slice(0, w).reduce((a, b) => a + b, 0));
    const wellOf = (m: number) => {
      let w = 0;
      while (w + 1 < wells.length && wellStart[w + 1] <= m) w++;
      return { w, i: m - wellStart[w], k: wells[w] };
    };
    const H = machineHeight(O);
    const P = Math.max(STEP, STEP * K, STEP * O); // distância vertical entre máquinas
    const yin = (k: number) => stripOffset(k, K, H);
    const yout = (k: number) => stripOffset(k, O, H);
    const base = K ? yin(0) - 60 : 0; // alinha o divisor da 1ª entrada com o conector dela
    const gapIn = K ? G * (K + 2) : 0;
    const slotTop = (m: number, k: number) => m * P + base + STEP * k;
    const slotCy = (m: number, k: number) => slotTop(m, k) + 60;
    const outBase = yout(0) - 60; // alinha o mesclador da saída principal com o conector dela
    const outSlotTop = (m: number, k: number) => m * P + outBase + STEP * k;
    const perOut = g.demand / n;
    const mainItem = g.item;

    // colunas de distribuição: por entrada (k), por faixa (lane), e na árvore por profundidade
    const treeDepth = (s: number): number => (s <= 3 ? 0 : 1 + treeDepth(Math.ceil(s / 3)));
    const blocks: { k: number; lane: Lane; cols: number }[] = [];
    for (let k = 0; k < K; k++)
      for (const lane of g.inputLanes[k]) blocks.push({ k, lane, cols: mode === 'tree' ? treeDepth(lane.to - lane.from) + 1 : 1 });
    const F = blocks.reduce((a, b) => a + b.cols, 0);

    const machineX = X0 + 40 + F * COL + gapIn;
    const colX = (c: number) => machineX - gapIn - CUBE - c * COL; // c = 0 é a coluna mais perto da máquina
    const bendX = (k: number) => machineX - G * (K - k + 1);

    const band: Band = { group: g, left: X0, right: 0, top: Infinity, entries: new Map(), byproductSources: [] };
    const track = (id: string) => {
      const nd = nodes.find((x) => x.id === id)!;
      band.top = Math.min(band.top, nd.position.y);
    };

    // máquinas / mineradoras / extratores (ou um node por poço)
    const machines: string[] = [];
    wells.forEach((k, w) => {
      const id = addNode({ kind: 'well', resource: g.item, clock: g.clock, satellites: Array(k).fill(g.ore!.purity), collapsed: true }, machineX, wellStart[w] * P);
      machines.push(id);
      track(id);
    });
    for (let m = 0; m < (wells.length ? 0 : n); m++) {
      const data: ProductionData =
        g.kind === 'miner'
          ? { kind: 'miner', resource: g.item, purity: g.ore!.purity, tier: g.ore!.tier, clock: g.clock, collapsed: true }
          : g.kind === 'extractor'
            ? { kind: 'extractor', extractor: g.extractor!, resource: g.item, purity: g.ore!.purity, clock: g.clock, collapsed: true }
            : { kind: 'machine', machine: g.machine!, recipe: g.recipe!.id, clock: g.clock, collapsed: true };
      machines.push(addNode(data, machineX, m * P));
      track(machines[m]);
    }
    const machineIn = (m: number, k: number): Port => ({ node: machines[m], handle: `in-${k}`, side: 'left', pt: { x: machineX, y: m * P + yin(k) } });
    const machineOut = (m: number, k = 0): Port => {
      if (!wells.length) return { node: machines[m], handle: `out-${k}`, side: 'right', pt: { x: machineX + MACH_W, y: m * P + yout(k) } };
      const s = wellOf(m);
      return { node: machines[s.w], handle: `out-${s.i}`, side: 'right', pt: { x: machineX + MACH_W, y: wellStart[s.w] * P + stripOffset(s.i, s.k, machineHeight(s.k)) } };
    };
    /**
     * Viradas da saída m até o mesclador. Máquina: `plain` (o desenho de sempre). Satélite de
     * poço: vira numa coluna própria ao lado do poço (a de cima mais longe) e desce até a vaga.
     */
    const outBends = (m: number, to: Port, plain?: number[]) => {
      if (!wells.length) return plain;
      const s = wellOf(m);
      const x = machineX + MACH_W + G * (s.k - s.i);
      const y = machineOut(m).pt.y;
      if (to.side === 'left') return y === to.pt.y ? undefined : [x, to.pt.y];
      return [x, to.side === 'top' ? to.pt.y - G : to.pt.y + G, to.pt.x];
    };

    // conexão de um ponto da coluna da entrada k até a máquina m (vira só perto da máquina)
    const toMachine = (from: Port, m: number, k: number, q: number, item: ItemId) => {
      const to = machineIn(m, k);
      const vertical = from.side === 'top' || from.side === 'bottom';
      if (k === 0) belt(from, to, q, item, vertical ? [to.pt.y] : undefined);
      else belt(from, to, q, item, vertical ? [slotCy(m, k), bendX(k)] : [bendX(k)]);
    };

    /* distribuição */
    let c = 0;
    for (const { k, lane, cols } of blocks) {
      const q = lane.demand / (lane.to - lane.from);
      const item = lane.item;
      if (mode === 'manifold') {
        // corrente de divisores girados 90°: entra por cima, sai pra máquina (direita) e pro próximo (baixo)
        let prev: string | undefined;
        for (let m = lane.from; m < lane.to; m++) {
          const x = colX(c);
          const y = slotTop(m, k);
          const id = cube('splitter', 90, x, y, item);
          track(id);
          if (prev) belt(cubePort(prev, 'out-1', 'bottom', x, slotTop(m - 1, k)), cubePort(id, 'in-0', 'top', x, y), q * (lane.to - m), item);
          else band.entries.set(lane.id, cubePort(id, 'in-0', 'top', x, y));
          toMachine(cubePort(id, 'out-0', 'right', x, y), m, k, q, item);
          prev = id;
        }
      } else {
        // árvore de divisores (até 3 filhos cada); folhas ficam na linha da máquina do meio
        const c0 = c;
        const build = (a: number, b: number): { id: string; x: number; y: number; depth: number } => {
          const size = b - a;
          if (size <= 3) {
            const mid = size === 3 ? a + 1 : a;
            const x = colX(c0);
            const y = slotTop(mid, k);
            const id = cube('splitter', 0, x, y, item);
            track(id);
            const outs = size === 3 ? ['out-0', 'out-1', 'out-2'] : size === 2 ? ['out-1', 'out-2'] : ['out-1'];
            outs.forEach((h, i) => {
              const side: Side = h === 'out-0' ? 'top' : h === 'out-1' ? 'right' : 'bottom';
              toMachine(cubePort(id, h, side, x, y), a + i, k, q, item);
            });
            return { id, x, y, depth: 0 };
          }
          const third = Math.ceil(size / 3);
          const spans: [number, number][] = [];
          for (let s = a; s < b; s += third) spans.push([s, Math.min(b, s + third)]);
          const kids = spans.map(([s, e]) => build(s, e));
          const depth = 1 + Math.max(...kids.map((kd) => kd.depth));
          const x = colX(c0 + depth);
          const mid = kids.length === 3 ? kids[1] : kids[0];
          const y = mid.y;
          const id = cube('splitter', 0, x, y, item);
          track(id);
          const handles = kids.length === 3 ? ['out-0', 'out-1', 'out-2'] : ['out-1', 'out-2'];
          kids.forEach((kd, i) => {
            const h = handles[i];
            const side: Side = h === 'out-0' ? 'top' : h === 'out-1' ? 'right' : 'bottom';
            const from = cubePort(id, h, side, x, y);
            const to = cubePort(kd.id, 'in-0', 'left', kd.x, kd.y);
            belt(from, to, q * (spans[i][1] - spans[i][0]), item, side === 'right' ? undefined : [to.pt.y]);
          });
          return { id, x, y, depth };
        };
        const root = build(lane.from, lane.to);
        band.entries.set(lane.id, cubePort(root.id, 'in-0', 'left', root.x, root.y));
      }
      c += cols;
    }

    /* coleta da saída principal */
    const gapOut = wells.length ? G * (Math.max(...wells) + 2) : O > 1 ? G * (O + 2) : 40;
    const mx0 = machineX + MACH_W + gapOut;
    let right = mx0 + CUBE;
    if (mode === 'manifold') {
      // corrente de mescladores girados 270°: recebe da máquina (esquerda) e de baixo, sai por cima
      let below: string | undefined;
      for (let m = n - 1; m >= 0; m--) {
        const y = outSlotTop(m, 0);
        const id = cube('merger', 270, mx0, y, mainItem);
        track(id);
        const into = cubePort(id, 'in-0', 'left', mx0, y);
        belt(machineOut(m), into, perOut, mainItem, outBends(m, into));
        if (below) belt(cubePort(below, 'out-0', 'top', mx0, outSlotTop(m + 1, 0)), cubePort(id, 'in-1', 'bottom', mx0, y), perOut * (n - m - 1), mainItem);
        below = id;
        if (m === 0) band.source = cubePort(id, 'out-0', 'top', mx0, y);
      }
    } else {
      const build = (a: number, b: number): { id: string; x: number; y: number; depth: number } => {
        const size = b - a;
        if (size <= 3) {
          const mid = size === 3 ? a + 1 : a;
          const x = mx0;
          const y = outSlotTop(mid, 0);
          const id = cube('merger', 0, x, y, mainItem);
          track(id);
          const ins = size === 3 ? ['in-0', 'in-1', 'in-2'] : size === 2 ? ['in-1', 'in-2'] : ['in-1'];
          ins.forEach((h, i) => {
            const side: Side = h === 'in-0' ? 'top' : h === 'in-1' ? 'left' : 'bottom';
            const to = cubePort(id, h, side, x, y);
            belt(machineOut(a + i), to, perOut, mainItem, outBends(a + i, to, side === 'left' ? undefined : [to.pt.x]));
          });
          return { id, x, y, depth: 0 };
        }
        const third = Math.ceil(size / 3);
        const spans: [number, number][] = [];
        for (let s = a; s < b; s += third) spans.push([s, Math.min(b, s + third)]);
        const kids = spans.map(([s, e]) => build(s, e));
        const depth = 1 + Math.max(...kids.map((kd) => kd.depth));
        const x = mx0 + depth * COL;
        const mid = kids.length === 3 ? kids[1] : kids[0];
        const y = mid.y;
        const id = cube('merger', 0, x, y, mainItem);
        track(id);
        right = Math.max(right, x + CUBE);
        const handles = kids.length === 3 ? ['in-0', 'in-1', 'in-2'] : ['in-1', 'in-2'];
        kids.forEach((kd, i) => {
          const h = handles[i];
          const side: Side = h === 'in-0' ? 'top' : h === 'in-1' ? 'left' : 'bottom';
          const to = cubePort(id, h, side, x, y);
          belt(cubePort(kd.id, 'out-0', 'right', kd.x, kd.y), to, perOut * (spans[i][1] - spans[i][0]), mainItem, side === 'left' ? undefined : [to.pt.x]);
        });
        return { id, x, y, depth };
      };
      const root = build(0, n);
      band.source = cubePort(root.id, 'out-0', 'right', root.x, root.y);
      right = Math.max(right, root.x + CUBE);
    }

    /* coleta dos subprodutos: corrente de mescladores por faixa, um degrau abaixo por saída */
    // na árvore a coleta principal pode ocupar várias colunas; os subprodutos ficam depois dela
    let bx = right + 40 + (mode === 'tree' ? CUBE + 40 : 0);
    const bendOut = (k: number) => machineX + MACH_W + G * (k + 1);
    for (const bl of g.byproducts) {
      const k = bl.output;
      const q = bl.amount / (bl.to - bl.from);
      let below: string | undefined;
      for (let m = bl.to - 1; m >= bl.from; m--) {
        const y = outSlotTop(m, k);
        const id = cube('merger', 270, bx, y, bl.item);
        track(id);
        // sai da máquina, desce até o degrau desta saída perto da máquina e segue reto
        const to = cubePort(id, 'in-0', 'left', bx, y);
        belt(machineOut(m, k), to, q, bl.item, [bendOut(k), to.pt.y]);
        if (below) belt(cubePort(below, 'out-0', 'top', bx, outSlotTop(m + 1, k)), cubePort(id, 'in-1', 'bottom', bx, y), q * (bl.to - m - 1), bl.item);
        below = id;
        if (m === bl.from) band.byproductSources.push({ lane: bl, port: cubePort(id, 'out-0', 'top', bx, y) });
      }
      right = Math.max(right, bx + CUBE);
      bx += COL;
    }
    band.right = right;
    return band;
  };

  /* ---------- barramento (modo otimizado): mescladores em linha ---------- */

  /**
   * Fontes de um item juntas antes de dividir: k fontes → k−1 mescladores lado a lado (sem
   * rotação: entram por cima e pela esquerda, saem pela direita). As fontes descem do corredor
   * direto no conector de cima (a 1ª entra pela esquerda do primeiro mesclador).
   */
  const busInputs = new Map<string, Port>();
  const busKey = (bus: string, src: { group: string; output: number; lane?: ByproductLane }) => `${bus}|${src.group}|${src.output}|${src.lane?.from ?? 0}`;
  const layoutBus = (bus: Bus, X0: number) => {
    const y = 0;
    let prev: { id: string; x: number } | undefined;
    let flow = bus.sources[0].amount;
    for (let j = 0; j < bus.sources.length - 1; j++) {
      const x = X0 + j * COL;
      const id = cube('merger', 0, x, y, bus.item);
      if (prev) belt(cubePort(prev.id, 'out-0', 'right', prev.x, y), cubePort(id, 'in-1', 'left', x, y), flow, bus.item);
      else busInputs.set(busKey(bus.id, bus.sources[0]), cubePort(id, 'in-1', 'left', x, y));
      busInputs.set(busKey(bus.id, bus.sources[j + 1]), cubePort(id, 'in-0', 'top', x, y));
      flow += bus.sources[j + 1].amount;
      prev = { id, x };
    }
    const source = cubePort(prev!.id, 'out-0', 'right', prev!.x, y);
    // à direita fica a coluna do divisor que reparte pras faixas (mesmo lugar do modo árvore)
    return { source, top: y, right: prev!.x + CUBE + 40 + CUBE };
  };

  /* ---------- faixas, da esquerda pra direita ---------- */

  type Slot = { level: number; item: string; id: string; group?: Group; bus?: Bus };
  const slots = ([
    ...plan.groups.map((g) => ({ level: g.level, item: g.item, id: g.id, group: g })),
    // barramento com uma fonte só não precisa de mesclador: sai direto da coleta dela
    ...(plan.buses ?? []).filter((b) => b.sources.length > 1).map((b) => ({ level: b.level, item: b.item, id: b.id, bus: b })),
  ] as Slot[]).sort((a, b) => a.level - b.level || a.item.localeCompare(b.item) || Number(!!a.bus) - Number(!!b.bus) || a.id.localeCompare(b.id));
  const bands: Band[] = [];
  const routerCount = (feeds: Lane[]) => (feeds.length > 1 ? 1 + Math.ceil(Math.max(0, feeds.length - 3) / 2) : 0);
  /** saídas que se dividem pras faixas: coleta principal de grupo, barramento ou subproduto reaproveitado */
  interface Emitter {
    source: Port;
    top: number;
    feeds: Lane[];
    item: ItemId;
    demand: number;
  }
  const emitters: Emitter[] = [];
  const busEmitters = new Map<string, Emitter>();
  let X = 0;
  for (const slot of slots) {
    if (slot.bus) {
      const fan = 40 + 20 * routerCount(slot.bus.feeds);
      const b = layoutBus(slot.bus, X + fan);
      busEmitters.set(slot.bus.id, { source: b.source, top: b.top, feeds: slot.bus.feeds, item: slot.bus.item, demand: slot.bus.demand });
      X = b.right + 80 + fan;
      continue;
    }
    const g = slot.group!;
    const fan = 40 + 20 * routerCount(g.feeds);
    const band = layoutGroup(g, X + fan);
    bands.push(band);
    X = band.right + 80 + fan + (mode === 'tree' ? CUBE + 40 : 0);
  }

  // armazéns (produto final e subprodutos), lado a lado, recebendo por cima
  const sinkBand = { left: X, right: X, top: 0 };
  const sinkPorts = new Map<string, Port>();
  plan.sinks.forEach((s, i) => {
    const x = X + 40 + i * (SINK_W + 40);
    const id = addNode({ kind: 'sink', rotation: 90 }, x, 0);
    sinkPorts.set(s.id, { node: id, handle: 'in-0', side: 'top', pt: { x: x + stripOffset(0, 1, SINK_W), y: 0 } });
    sinkBand.right = x + SINK_W;
  });

  const entries = new Map<string, Port>();
  for (const b of bands) for (const [k, v] of b.entries) entries.set(k, v);
  for (const s of plan.sinks) if (s.lane) entries.set(s.lane.id, sinkPorts.get(s.id)!);

  /* ---------- roteamento entre faixas (corredor acima de tudo) ---------- */

  interface Piece {
    from: Port;
    to?: Port;
    flow: number;
    item: ItemId;
    /** x da subida até o trilho (quando a saída é lateral) */
    riseX?: number;
  }
  const pieces: Piece[] = [];
  const routerTops: number[] = [];
  const riseOf = (p: Port) => (p.side === 'right' ? p.pt.x + 40 : undefined);

  for (const band of bands) {
    const g = band.group!;
    let src = band.source!;
    let top = band.top;
    if (g.overflow) {
      // sobra da extração: divisor logo acima da coleta, com uma saída pro armazém
      const rx = src.side === 'top' ? src.pt.x : src.pt.x + 40 + 60;
      const x = rx - 60;
      const y = band.top - 60 - CUBE;
      routerTops.push(y);
      const id = cube('splitter', 270, x, y, g.item);
      belt(src, cubePort(id, 'in-0', 'bottom', x, y), g.demand, g.item, src.side === 'right' ? [rx] : undefined);
      pieces.push({ from: cubePort(id, 'out-0', 'left', x, y), to: sinkPorts.get(g.overflow.sink), flow: g.overflow.amount, item: g.item, riseX: x - 20 });
      src = cubePort(id, 'out-1', 'top', x, y);
      top = y;
    }
    const routed = g.demand - (g.overflow?.amount ?? 0);
    for (const bp of band.byproductSources) {
      const bus = bp.lane.bus ? plan.buses?.find((b) => b.id === bp.lane.bus) : undefined;
      if (bus && bus.sources.length === 1) emitters.push({ source: bp.port, top: band.top, feeds: bus.feeds, item: bus.item, demand: bus.demand });
      else if (bus) pieces.push({ from: bp.port, to: busInputs.get(busKey(bus.id, { group: g.id, output: bp.lane.output, lane: bp.lane })), flow: bp.lane.amount, item: bp.lane.item });
      else pieces.push({ from: bp.port, to: sinkPorts.get(bp.lane.sink!), flow: bp.lane.amount, item: bp.lane.item });
    }
    if (g.bus) {
      const bus = plan.buses?.find((b) => b.id === g.bus);
      if (bus && bus.sources.length === 1) emitters.push({ source: src, top, feeds: bus.feeds, item: bus.item, demand: bus.demand });
      else pieces.push({ from: src, to: busInputs.get(busKey(g.bus, { group: g.id, output: 0 })), flow: routed, item: g.item, riseX: riseOf(src) });
    } else emitters.push({ source: src, top, feeds: g.feeds, item: g.item, demand: routed });
  }
  emitters.push(...busEmitters.values());

  for (const em of emitters) {
    const src = em.source;
    const feeds = [...em.feeds].sort((a, b) => (entries.get(a.id)?.pt.x ?? 0) - (entries.get(b.id)?.pt.x ?? 0));
    if (!feeds.length) continue;
    if (feeds.length === 1) {
      pieces.push({ from: src, to: entries.get(feeds[0].id), flow: feeds[0].demand, item: em.item, riseX: riseOf(src) });
      continue;
    }
    // corrente de divisores girados 270° acima da faixa: entra por baixo, sai pros lados e por cima
    const S = routerCount(feeds);
    const rx = src.side === 'top' ? src.pt.x : src.pt.x + 40 + 60;
    let remaining = [...feeds];
    let prevPort: Port = src;
    let prevFlow = em.demand;
    for (let i = 0; i < S; i++) {
      const x = rx - 60;
      const y = em.top - 60 - CUBE - i * 160;
      routerTops.push(y);
      const id = cube('splitter', 270, x, y, em.item);
      const inPort = cubePort(id, 'in-0', 'bottom', x, y);
      belt(prevPort, inPort, prevFlow, em.item, prevPort.side === 'right' ? [rx] : undefined);
      const last = i === S - 1;
      const take = last ? remaining.length : 2;
      const mine = remaining.slice(0, take);
      remaining = remaining.slice(take);
      const outs: [string, Side][] = [
        ['out-0', 'left'],
        ['out-2', 'right'],
        ['out-1', 'top'],
      ];
      mine.forEach((lane, j) => {
        const [h, side] = outs[j];
        const spread = 20 * (S - 1 - i);
        const riseX = side === 'left' ? x - 20 - spread : side === 'right' ? x + CUBE + 20 + spread : undefined;
        pieces.push({ from: cubePort(id, h, side, x, y), to: entries.get(lane.id), flow: lane.demand, item: em.item, riseX });
      });
      prevPort = cubePort(id, 'out-1', 'top', x, y);
      prevFlow = remaining.reduce((a, l) => a + l.demand, 0);
    }
  }

  // insumos de fora (coletáveis etc.): uma Entrada externa por faixa, com a vazão exata da faixa,
  // lado a lado à esquerda de tudo, minimizada e com a saída por cima (sobe pro corredor como as outras)
  const extLanes = plan.external.flatMap((e) => e.lanes);
  extLanes.forEach((lane, i) => {
    const x = -(extLanes.length - i) * (MACH_W + 40);
    const id = addNode({ kind: 'inbound', item: lane.item, rate: lane.demand, rotation: 270, collapsed: true }, x, 0);
    pieces.push({ from: { node: id, handle: 'out-0', side: 'top', pt: { x: x + stripOffset(0, 1, MACH_W), y: 0 } }, to: entries.get(lane.id), flow: lane.demand, item: lane.item });
  });

  const allTops = [...bands.map((b) => b.top), ...[...busEmitters.values()].map((b) => b.top), sinkBand.top, ...routerTops];
  const corridor = Math.min(...allTops) - 40;
  pieces.forEach((p, t) => {
    const to = p.to;
    if (!to) return;
    const y = corridor - 20 * t;
    const dropX = to.side === 'left' ? to.pt.x - 20 : to.pt.x;
    const bends = p.riseX !== undefined ? [p.riseX, y, dropX] : [y, dropX];
    belt(p.from, to, p.flow, p.item, bends);
  });

  /* ---------- posição final: tudo deslocado pra origem ---------- */

  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y), corridor - 20 * pieces.length);
  const dx = snap(origin.x - minX);
  const dy = snap(origin.y - minY);
  for (const n of nodes) n.position = { x: n.position.x + dx, y: n.position.y + dy };
  // desloca âncoras e viradas; o eixo de cada virada alterna a partir da direção de saída
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const d = e.data!;
    if (!d.bends || !d.anchor) continue;
    const [sx, sy, tx, ty] = d.anchor;
    d.anchor = [sx + dx, sy + dy, tx + dx, ty + dy];
    const startHorizontal = isHorizontalHandle(byId.get(e.source)!, e.sourceHandle!);
    d.bends = d.bends.map((v, i) => v + ((i % 2 === 0) === startHorizontal ? dx : dy));
  }
  return { nodes, edges };
}

/* lado de saída de um conector, considerando o tipo e a rotação do node */
const CLOCKWISE: Side[] = ['left', 'top', 'right', 'bottom'];
const rot = (s: Side, r: Rotation = 0) => CLOCKWISE[(CLOCKWISE.indexOf(s) + r / 90) % 4];
function handleSide(n: ProductionNode, handle: string): Side {
  const d = n.data;
  const r = d.rotation ?? 0;
  if (d.kind === 'splitter') return rot(({ 'in-0': 'left', 'out-0': 'top', 'out-1': 'right', 'out-2': 'bottom' } as Record<string, Side>)[handle], r);
  if (d.kind === 'merger') return rot(({ 'in-0': 'top', 'in-1': 'left', 'in-2': 'bottom', 'out-0': 'right' } as Record<string, Side>)[handle], r);
  return rot(handle.startsWith('in') ? 'left' : 'right', r);
}
const isHorizontalHandle = (n: ProductionNode, handle: string) => {
  const s = handleSide(n, handle);
  return s === 'left' || s === 'right';
};
