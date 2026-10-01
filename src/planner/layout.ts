import { BELTS, BELT_TIERS } from '../game/data';
import type { BeltEdge, BeltTier, FactoryData, FactoryNode, Rotation } from '../game/types';
import { newId } from '../state/storage';
import type { Group, Lane, Plan } from './plan';

/*
 * Desenho da linha planejada.
 *
 * Organização (tudo em múltiplos do grid de 20px):
 *  - Cada grupo de máquinas é uma "faixa" vertical; as faixas ficam lado a lado, do
 *    minério (esquerda) ao armazém (direita).
 *  - Dentro da faixa: colunas de distribuição (divisores) | máquinas | coleta (mescladores).
 *    Máquina com várias entradas tem uma coluna de divisores por entrada, cada uma deslocada
 *    140px pra baixo (um "degrau"), e a esteira dela vira só perto da máquina: assim nenhuma
 *    esteira atravessa o divisor de outra entrada.
 *  - Entre faixas, as esteiras sobem pra um "corredor" de trilhos acima de tudo (um trilho
 *    por esteira), andam na horizontal e descem até o destino. Nada cruza máquina.
 *
 * As esteiras que precisam de curvas extras levam `bends` (coordenadas das viradas) e
 * `anchor` (onde estavam as pontas na geração). Se um node for movido, a âncora deixa de
 * bater e a esteira volta pro roteamento automático.
 */

export type DistributionMode = 'manifold' | 'tree';

const G = 20;
const CUBE = 120;
const MACH_W = 240; // máquina minimizada
const MACH_H = 100;
const SINK_W = 280;
const COL = 160; // largura de uma coluna de divisores/mescladores (cubo + folga)
const STEP = 140; // degrau vertical entre colunas de entradas diferentes

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
  source?: Port;
  entries: Map<string, Port>;
}

export interface Layout {
  nodes: FactoryNode[];
  edges: BeltEdge[];
}

export function layoutPlan(plan: Plan, mode: DistributionMode, maxBelt: BeltTier, origin: Pt): Layout {
  const nodes: FactoryNode[] = [];
  const edges: BeltEdge[] = [];

  const tierFor = (flow: number) => (BELT_TIERS.find((t) => BELTS[t].rate >= flow - EPS && t <= maxBelt) ?? maxBelt) as BeltTier;

  const addNode = (data: FactoryData, x: number, y: number) => {
    const id = newId(data.kind);
    nodes.push({ id, type: data.kind, position: { x, y }, data } as FactoryNode);
    return id;
  };
  const cube = (kind: 'splitter' | 'merger', rotation: Rotation, x: number, y: number) => addNode({ kind, rotation }, x, y);
  /** conector de um cubo (todos ficam no meio da face) */
  const cubePort = (node: string, handle: string, side: Side, x: number, y: number): Port => ({
    node,
    handle,
    side,
    pt: side === 'left' ? { x, y: y + 60 } : side === 'right' ? { x: x + CUBE, y: y + 60 } : side === 'top' ? { x: x + 60, y } : { x: x + 60, y: y + CUBE },
  });
  const belt = (from: Port, to: Port, flow: number, bends?: number[]) => {
    edges.push({
      id: newId('b'),
      type: 'belt',
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
      data: {
        tier: tierFor(flow),
        ...(bends?.length ? { bends, anchor: [from.pt.x, from.pt.y, to.pt.x, to.pt.y] } : {}),
      },
    });
  };

  /* ---------- faixa de um grupo ---------- */

  const layoutGroup = (g: Group, X0: number): Band => {
    const n = g.count;
    const K = g.recipe?.inputs.length ?? 0;
    const P = Math.max(STEP, STEP * K); // distância vertical entre máquinas
    const yin = (k: number) => stripOffset(k, K, MACH_H);
    const yout = stripOffset(0, 1, MACH_H);
    const base = K ? yin(0) - 60 : 0; // alinha o divisor da 1ª entrada com o conector dela
    const gapIn = K ? G * (K + 2) : 0;
    const slotTop = (m: number, k: number) => m * P + base + STEP * k;
    const slotCy = (m: number, k: number) => slotTop(m, k) + 60;
    const perOut = g.demand / n;

    // colunas de distribuição: por entrada (k), por faixa (lane), e na árvore por profundidade
    const treeDepth = (s: number): number => (s <= 3 ? 0 : 1 + treeDepth(Math.ceil(s / 3)));
    const blocks: { k: number; lane: Lane; cols: number }[] = [];
    for (let k = 0; k < K; k++)
      for (const lane of g.inputLanes[k]) blocks.push({ k, lane, cols: mode === 'tree' ? treeDepth(lane.to - lane.from) + 1 : 1 });
    const F = blocks.reduce((a, b) => a + b.cols, 0);

    const machineX = X0 + 40 + F * COL + gapIn;
    const colX = (c: number) => machineX - gapIn - CUBE - c * COL; // c = 0 é a coluna mais perto da máquina
    const bendX = (k: number) => machineX - G * (K - k + 1);

    const band: Band = { group: g, left: X0, right: 0, top: Infinity, entries: new Map() };
    const track = (id: string) => {
      const nd = nodes.find((x) => x.id === id)!;
      band.top = Math.min(band.top, nd.position.y);
    };

    // máquinas
    const machines: string[] = [];
    for (let m = 0; m < n; m++) {
      const data: FactoryData =
        g.kind === 'miner'
          ? { kind: 'miner', resource: g.item, purity: g.ore!.purity, tier: g.ore!.tier, clock: g.clock, collapsed: true }
          : { kind: 'machine', machine: g.machine!, recipe: g.recipe!.id, clock: g.clock, collapsed: true };
      machines.push(addNode(data, machineX, m * P));
      track(machines[m]);
    }
    const machineIn = (m: number, k: number): Port => ({ node: machines[m], handle: `in-${k}`, side: 'left', pt: { x: machineX, y: m * P + yin(k) } });
    const machineOut = (m: number): Port => ({ node: machines[m], handle: 'out-0', side: 'right', pt: { x: machineX + MACH_W, y: m * P + yout } });

    // esteira de um ponto da coluna da entrada k até a máquina m (vira só perto da máquina)
    const toMachine = (from: Port, m: number, k: number, q: number) => {
      const to = machineIn(m, k);
      const vertical = from.side === 'top' || from.side === 'bottom';
      if (k === 0) belt(from, to, q, vertical ? [to.pt.y] : undefined);
      else belt(from, to, q, vertical ? [slotCy(m, k), bendX(k)] : [bendX(k)]);
    };

    /* distribuição */
    let c = 0;
    for (const { k, lane, cols } of blocks) {
      const q = lane.demand / (lane.to - lane.from);
      if (mode === 'manifold') {
        // corrente de divisores girados 90°: entra por cima, sai pra máquina (direita) e pro próximo (baixo)
        let prev: string | undefined;
        for (let m = lane.from; m < lane.to; m++) {
          const x = colX(c);
          const y = slotTop(m, k);
          const id = cube('splitter', 90, x, y);
          track(id);
          if (prev) belt(cubePort(prev, 'out-1', 'bottom', x, slotTop(m - 1, k)), cubePort(id, 'in-0', 'top', x, y), q * (lane.to - m));
          else band.entries.set(lane.id, cubePort(id, 'in-0', 'top', x, y));
          toMachine(cubePort(id, 'out-0', 'right', x, y), m, k, q);
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
            const id = cube('splitter', 0, x, y);
            track(id);
            const outs = size === 3 ? ['out-0', 'out-1', 'out-2'] : size === 2 ? ['out-1', 'out-2'] : ['out-1'];
            outs.forEach((h, i) => {
              const side: Side = h === 'out-0' ? 'top' : h === 'out-1' ? 'right' : 'bottom';
              toMachine(cubePort(id, h, side, x, y), a + i, k, q);
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
          const id = cube('splitter', 0, x, y);
          track(id);
          const handles = kids.length === 3 ? ['out-0', 'out-1', 'out-2'] : ['out-1', 'out-2'];
          kids.forEach((kd, i) => {
            const h = handles[i];
            const side: Side = h === 'out-0' ? 'top' : h === 'out-1' ? 'right' : 'bottom';
            const from = cubePort(id, h, side, x, y);
            const to = cubePort(kd.id, 'in-0', 'left', kd.x, kd.y);
            const flow = q * (spans[i][1] - spans[i][0]);
            belt(from, to, flow, side === 'right' ? undefined : [to.pt.y]);
          });
          return { id, x, y, depth };
        };
        const root = build(lane.from, lane.to);
        band.entries.set(lane.id, cubePort(root.id, 'in-0', 'left', root.x, root.y));
      }
      c += cols;
    }

    /* coleta */
    const mx0 = machineX + MACH_W + 40;
    let right = mx0 + CUBE;
    if (mode === 'manifold') {
      // corrente de mescladores girados 270°: recebe da máquina (esquerda) e de baixo, sai por cima
      let below: string | undefined;
      for (let m = n - 1; m >= 0; m--) {
        const y = m * P + yout - 60;
        const id = cube('merger', 270, mx0, y);
        track(id);
        belt(machineOut(m), cubePort(id, 'in-0', 'left', mx0, y), perOut);
        if (below) belt(cubePort(below, 'out-0', 'top', mx0, (m + 1) * P + yout - 60), cubePort(id, 'in-1', 'bottom', mx0, y), perOut * (n - m - 1));
        below = id;
        if (m === 0) band.source = cubePort(id, 'out-0', 'top', mx0, y);
      }
    } else {
      const build = (a: number, b: number): { id: string; x: number; y: number; depth: number } => {
        const size = b - a;
        if (size <= 3) {
          const mid = size === 3 ? a + 1 : a;
          const x = mx0;
          const y = mid * P + yout - 60;
          const id = cube('merger', 0, x, y);
          track(id);
          const ins = size === 3 ? ['in-0', 'in-1', 'in-2'] : size === 2 ? ['in-1', 'in-2'] : ['in-1'];
          ins.forEach((h, i) => {
            const side: Side = h === 'in-0' ? 'top' : h === 'in-1' ? 'left' : 'bottom';
            const to = cubePort(id, h, side, x, y);
            belt(machineOut(a + i), to, perOut, side === 'left' ? undefined : [to.pt.x]);
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
        const id = cube('merger', 0, x, y);
        track(id);
        right = Math.max(right, x + CUBE);
        const handles = kids.length === 3 ? ['in-0', 'in-1', 'in-2'] : ['in-1', 'in-2'];
        kids.forEach((kd, i) => {
          const h = handles[i];
          const side: Side = h === 'in-0' ? 'top' : h === 'in-1' ? 'left' : 'bottom';
          const to = cubePort(id, h, side, x, y);
          belt(cubePort(kd.id, 'out-0', 'right', kd.x, kd.y), to, perOut * (spans[i][1] - spans[i][0]), side === 'left' ? undefined : [to.pt.x]);
        });
        return { id, x, y, depth };
      };
      const root = build(0, n);
      band.source = cubePort(root.id, 'out-0', 'right', root.x, root.y);
      right = Math.max(right, root.x + CUBE);
    }
    band.right = right;
    return band;
  };

  /* ---------- faixas, da esquerda pra direita ---------- */

  const ordered = [...plan.groups].sort((a, b) => a.level - b.level || a.item.localeCompare(b.item) || a.id.localeCompare(b.id));
  const bands: Band[] = [];
  const routerCount = (g: Group) => (g.feeds.length > 1 ? 1 + Math.ceil(Math.max(0, g.feeds.length - 3) / 2) : 0);
  let X = 0;
  for (const g of ordered) {
    const fan = 40 + 20 * routerCount(g);
    const band = layoutGroup(g, X + fan);
    bands.push(band);
    X = band.right + 80 + fan + (mode === 'tree' ? CUBE + 40 : 0);
  }

  // armazéns, lado a lado, recebendo por cima
  const sinkBand: Band = { left: X, right: X, top: 0, entries: new Map() };
  plan.sinks.forEach((s, i) => {
    const x = X + 40 + i * (SINK_W + 40);
    const id = addNode({ kind: 'sink', rotation: 90 }, x, 0);
    sinkBand.entries.set(s.lane.id, { node: id, handle: 'in-0', side: 'top', pt: { x: x + stripOffset(0, 1, SINK_W), y: 0 } });
    sinkBand.right = x + SINK_W;
  });

  const entries = new Map<string, Port>();
  for (const b of [...bands, sinkBand]) for (const [k, v] of b.entries) entries.set(k, v);

  /* ---------- roteamento entre faixas (corredor acima de tudo) ---------- */

  interface Piece {
    from: Port;
    lane: Lane;
    /** x da subida até o trilho (quando a saída é lateral) */
    riseX?: number;
  }
  const pieces: Piece[] = [];
  const routerTops: number[] = [];

  for (const band of bands) {
    const g = band.group!;
    const src = band.source!;
    const feeds = [...g.feeds].sort((a, b) => (entries.get(a.id)?.pt.x ?? 0) - (entries.get(b.id)?.pt.x ?? 0));
    if (feeds.length === 1) {
      pieces.push({ from: src, lane: feeds[0], riseX: src.side === 'right' ? src.pt.x + 40 : undefined });
      continue;
    }
    // corrente de divisores girados 270° acima da faixa: entra por baixo, sai pros lados e por cima
    const S = routerCount(g);
    const rx = src.side === 'top' ? src.pt.x : src.pt.x + 40 + 60;
    let remaining = [...feeds];
    let prevPort: Port = src;
    let prevFlow = g.demand;
    for (let i = 0; i < S; i++) {
      const x = rx - 60;
      const y = band.top - 60 - CUBE - i * 160;
      routerTops.push(y);
      const id = cube('splitter', 270, x, y);
      const inPort = cubePort(id, 'in-0', 'bottom', x, y);
      belt(prevPort, inPort, prevFlow, prevPort.side === 'right' ? [rx] : undefined);
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
        pieces.push({ from: cubePort(id, h, side, x, y), lane, riseX });
      });
      prevPort = cubePort(id, 'out-1', 'top', x, y);
      prevFlow = remaining.reduce((a, l) => a + l.demand, 0);
    }
  }

  const allTops = [...bands.map((b) => b.top), sinkBand.top, ...routerTops];
  const corridor = Math.min(...allTops) - 40;
  pieces.forEach((p, t) => {
    const to = entries.get(p.lane.id);
    if (!to) return;
    const y = corridor - 20 * t;
    const dropX = to.side === 'left' ? to.pt.x - 20 : to.pt.x;
    const bends = p.riseX !== undefined ? [p.riseX, y, dropX] : [y, dropX];
    belt(p.from, to, p.lane.demand, bends);
  });

  /* ---------- posição final: tudo deslocado pra origem ---------- */

  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y), corridor - 20 * pieces.length);
  const dx = snap(origin.x - minX);
  const dy = snap(origin.y - minY);
  for (const n of nodes) n.position = { x: n.position.x + dx, y: n.position.y + dy };
  // desloca âncoras e viradas; o eixo de cada virada alterna a partir da direção de saída
  for (const e of edges) {
    const d = e.data!;
    if (!d.bends || !d.anchor) continue;
    const [sx, sy, tx, ty] = d.anchor;
    d.anchor = [sx + dx, sy + dy, tx + dx, ty + dy];
    const startHorizontal = isHorizontalHandle(nodes.find((n) => n.id === e.source)!, e.sourceHandle!);
    d.bends = d.bends.map((v, i) => v + ((i % 2 === 0) === startHorizontal ? dx : dy));
  }
  return { nodes, edges };
}

/* lado de saída de um conector, considerando o tipo e a rotação do node */
const CLOCKWISE: Side[] = ['left', 'top', 'right', 'bottom'];
const rot = (s: Side, r: Rotation = 0) => CLOCKWISE[(CLOCKWISE.indexOf(s) + r / 90) % 4];
function handleSide(n: FactoryNode, handle: string): Side {
  const d = n.data;
  const r = d.rotation ?? 0;
  if (d.kind === 'splitter') return rot(({ 'in-0': 'left', 'out-0': 'top', 'out-1': 'right', 'out-2': 'bottom' } as Record<string, Side>)[handle], r);
  if (d.kind === 'merger') return rot(({ 'in-0': 'top', 'in-1': 'left', 'in-2': 'bottom', 'out-0': 'right' } as Record<string, Side>)[handle], r);
  return rot(handle.startsWith('in') ? 'left' : 'right', r);
}
const isHorizontalHandle = (n: FactoryNode, handle: string) => {
  const s = handleSide(n, handle);
  return s === 'left' || s === 'right';
};
