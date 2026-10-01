import { createPortal } from 'react-dom';
import { BaseEdge, Position, getBezierPath, getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { BELTS, BELT_TIERS, ITEMS, PIPES, PIPE_TIERS } from '../game/data';
import type { BeltEdge, BeltTier, PipeTier } from '../game/types';
import { fmt } from '../format';
import { GRID } from '../grid';
import { useLabelRoot, useSettings } from '../state/settings';
import { useSim } from '../sim/SimContext';
import { itemColor } from './nodes';

const STATUS_COLOR = {
  bottleneck: 'var(--err)',
  'wrong-item': 'var(--err)',
  excess: 'var(--warn)',
  idle: '#4a4f58',
} as const;

const snap = (v: number) => Math.round(v / GRID) * GRID;

/**
 * O React Flow liga a esteira na beirada externa da bolinha do conector (13px, centrada
 * 1px pra dentro da borda de 1px do node): 13/2 - 1 = 5,5px pra fora do node. Trazemos a
 * ponta até a borda do node pra que as viradas perto dele também caiam no grid.
 */
const HANDLE_INSET = 5.5;
/** distância máxima (px) pra ponta da esteira grudar numa linha do grid */
const MAGNET = 4;
const inset = (x: number, y: number, pos: Position) =>
  pos === Position.Left
    ? { x: x + HANDLE_INSET, y }
    : pos === Position.Right
      ? { x: x - HANDLE_INSET, y }
      : pos === Position.Top
        ? { x, y: y + HANDLE_INSET }
        : { x, y: y - HANDLE_INSET };

/**
 * Caminho em ângulos retos: sai do conector andando 1 quadradinho e vira em 90°;
 * os pontos de virada caem em linhas do grid.
 */
type Pt = { x: number; y: number };
const isHorizontal = (pos: Position) => pos === Position.Left || pos === Position.Right;

/** Pontas da esteira na borda do node, sem as frações de pixel das medições do DOM */
function endpoints(p: EdgeProps<BeltEdge>) {
  // Pontas a até MAGNET px de uma linha do grid grudam nela (fica dentro da bolinha do conector);
  // fora disso, só arredonda pro pixel (as frações viravam uma curvinha microscópica)
  const fix = (v: number) => (Math.abs(v - snap(v)) <= MAGNET ? snap(v) : Math.round(v));
  const round = ({ x, y }: Pt) => ({ x: fix(x), y: fix(y) });
  return { s: round(inset(p.sourceX, p.sourceY, p.sourcePosition)), t: round(inset(p.targetX, p.targetY, p.targetPosition)) };
}

function gridPath(p: EdgeProps<BeltEdge>, s: Pt, t: Pt) {
  return getSmoothStepPath({
    sourceX: s.x,
    sourceY: s.y,
    sourcePosition: p.sourcePosition,
    targetX: t.x,
    targetY: t.y,
    targetPosition: p.targetPosition,
    borderRadius: 4,
    offset: GRID,
    centerX: snap((s.x + t.x) / 2),
    centerY: snap((s.y + t.y) / 2),
  });
}

/**
 * Trajeto com viradas planejadas (vindas do gerador): sai pelo eixo do conector de origem,
 * cada número em `bends` é a próxima coordenada, alternando x/y, e no fim chega no destino
 * pelo eixo do conector dele. Cantos levemente arredondados, como no resto.
 */
function bendsPath(p: EdgeProps<BeltEdge>, s: Pt, t: Pt, bends: number[]): [string, number, number] {
  const pts: Pt[] = [s];
  let horizontal = isHorizontal(p.sourcePosition);
  let cur = s;
  for (const v of bends) {
    cur = horizontal ? { x: v, y: cur.y } : { x: cur.x, y: v };
    pts.push(cur);
    horizontal = !horizontal;
  }
  pts.push(isHorizontal(p.targetPosition) ? { x: cur.x, y: t.y } : { x: t.x, y: cur.y }, t);
  // tira pontos repetidos e pontos no meio de um trecho reto
  const clean: Pt[] = [];
  for (const q of pts) {
    const a = clean[clean.length - 2];
    const b = clean[clean.length - 1];
    if (b && b.x === q.x && b.y === q.y) continue;
    if (a && b && ((a.x === b.x && b.x === q.x) || (a.y === b.y && b.y === q.y))) clean[clean.length - 1] = q;
    else clean.push(q);
  }
  let d = `M${clean[0].x} ${clean[0].y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const [a, b, c] = [clean[i - 1], clean[i], clean[i + 1]];
    const r = Math.min(4, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const inX = b.x - Math.sign(b.x - a.x) * r;
    const inY = b.y - Math.sign(b.y - a.y) * r;
    const outX = b.x + Math.sign(c.x - b.x) * r;
    const outY = b.y + Math.sign(c.y - b.y) * r;
    d += ` L${inX} ${inY} Q${b.x} ${b.y} ${outX} ${outY}`;
  }
  const last = clean[clean.length - 1];
  d += ` L${last.x} ${last.y}`;
  // rótulo no meio do comprimento
  const segs = clean.slice(1).map((q, i) => ({ a: clean[i], b: q, len: Math.hypot(q.x - clean[i].x, q.y - clean[i].y) }));
  let half = segs.reduce((acc, g) => acc + g.len, 0) / 2;
  for (const g of segs) {
    if (half <= g.len) return [d, g.a.x + ((g.b.x - g.a.x) * half) / (g.len || 1), g.a.y + ((g.b.y - g.a.y) * half) / (g.len || 1)];
    half -= g.len;
  }
  return [d, last.x, last.y];
}

/** cor da borda do cano quando está tudo certo (aço) */
const PIPE_RIM = '#8fa3b8';

/**
 * Conexão entre máquinas. Esteira (sólidos): linha fina na cor do item com os itens andando.
 * Cano (fluidos): tubo grosso com borda metálica e o fluido correndo por dentro.
 */
function ConveyanceEdge(props: EdgeProps<BeltEdge> & { pipe: boolean }) {
  const { id, data, selected, pipe } = props;
  const sim = useSim();
  const r = sim.edges[id];
  const issues = sim.byTarget[id] ?? [];
  const { updateEdgeData } = useReactFlow();
  const { gridBelts, beltLabels } = useSettings();
  const labelRoot = useLabelRoot();
  const routing = data?.routing ?? (gridBelts ? 'grid' : 'curve');
  const { s: sp, t: tp } = endpoints(props);
  // trajeto do gerador só vale enquanto as pontas estiverem onde estavam quando ele foi feito
  const a = data?.anchor;
  const planned = routing === 'grid' && data?.bends && a && Math.abs(a[0] - sp.x) < 1.5 && Math.abs(a[1] - sp.y) < 1.5 && Math.abs(a[2] - tp.x) < 1.5 && Math.abs(a[3] - tp.y) < 1.5;
  const [path, lx, ly] = planned ? bendsPath(props, sp, tp, data!.bends!) : routing === 'grid' ? gridPath(props, sp, tp) : getBezierPath(props);
  const tier = data?.tier ?? 1;
  const tiers = pipe ? PIPE_TIERS : BELT_TIERS;
  const tierInfo = (t: number) => (pipe ? PIPES[t as PipeTier] : BELTS[t as BeltTier]) ?? (pipe ? PIPES[1] : BELTS[1]);
  const cap = r?.cap ?? tierInfo(tier).rate;
  const status = r?.status ?? 'idle';
  const itemCol = itemColor(r?.item ?? null);
  const color = status === 'ok' ? itemCol : STATUS_COLOR[status];
  const moving = !!r && r.flow > 1e-6;
  const unit = pipe ? ' m³' : '';
  const itemText = r?.item === 'mixed' ? (pipe ? 'fluidos misturados' : 'misturado') : r?.item ? ITEMS[r.item].name : 'vazi' + (pipe ? 'o' : 'a');

  return (
    <>
      {pipe ? (
        <>
          {/* borda do tubo: aço quando ok, cor do problema quando não */}
          <BaseEdge id={id} path={path} style={{ stroke: status === 'ok' || status === 'idle' ? PIPE_RIM : color, strokeWidth: selected ? 13 : 11, strokeLinecap: 'round' }} />
          <path d={path} className="pipe-core" style={{ stroke: status === 'idle' ? '#2a2f37' : itemCol }} />
          {moving && <path d={path} className="pipe-flow" style={{ animationDuration: `${(2.4 / tier).toFixed(2)}s` }} />}
        </>
      ) : (
        <>
          <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: selected ? 6 : 4 }} />
          {moving && <path d={path} className="belt-items" style={{ animationDuration: `${(1.1 / Math.sqrt(tier)).toFixed(2)}s` }} />}
        </>
      )}
      {/* faixa invisível só pra dica ao passar o mouse (útil com os rótulos desligados) */}
      <path d={path} className="belt-hover" data-planned={planned ? '1' : undefined}>
        <title>
          {[
            `${pipe ? 'Cano' : 'Esteira'} ${tierInfo(tier).name} · ${itemText}`,
            `${fmt(r?.flow ?? 0)} / ${fmt(cap)}${unit} por min`,
            ...issues.map((i) => i.message),
          ].join('\n')}
        </title>
      </path>
      {(beltLabels || selected) &&
        labelRoot &&
        createPortal(
          <div
            className={`belt-label nodrag nopan ${pipe ? 'pipe' : ''} ${status} ${selected ? 'selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, borderColor: color }}
            title={issues.map((i) => i.message).join('\n') || undefined}
          >
            {pipe && <span className="pipe-icon">💧</span>}
            <select value={tier} onChange={(e) => updateEdgeData(id, { tier: Number(e.target.value) as BeltTier })} title={pipe ? 'Cano' : 'Esteira'}>
              {tiers.map((t) => (
                <option key={t} value={t}>
                  {tierInfo(t).name}
                </option>
              ))}
            </select>
            <button
              className="belt-route"
              onClick={() => updateEdgeData(id, { routing: routing === 'grid' ? 'curve' : 'grid' })}
              title={routing === 'grid' ? 'Segue o grid — clique pra fazer curva' : 'Faz curva — clique pra seguir o grid'}
            >
              {routing === 'grid' ? '┐' : '∿'}
            </button>
            <span className="belt-rate">
              <span className="dot" style={{ background: itemCol }} />
              {selected && <span className="belt-item-name">{itemText}</span>}
              {fmt(r?.flow ?? 0)}
              <small>
                /{fmt(cap)}
                {unit}
              </small>
            </span>
            {(status === 'bottleneck' || status === 'wrong-item') && <span className="belt-flag">!</span>}
            {status === 'excess' && <span className="belt-flag warn">!</span>}
          </div>,
          labelRoot,
        )}
    </>
  );
}

export const BeltEdgeView = (props: EdgeProps<BeltEdge>) => <ConveyanceEdge {...props} pipe={false} />;
export const PipeEdgeView = (props: EdgeProps<BeltEdge>) => <ConveyanceEdge {...props} pipe />;

export const edgeTypes = { belt: BeltEdgeView, pipe: PipeEdgeView };
