import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Handle, Position, useNodeId, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { AMPLIFICATION, EXTRACTORS, ITEMS, MACHINES, MINER_TIERS, PURITIES, RECIPES, RESOURCES, WELL_PRESSURIZER_NAME, WELL_PRESSURIZER_POWER, getRecipe, isFluid, recipesFor } from '../game/data';
import type {
  BeltItem,
  ExtractorKind,
  ExtractorNode,
  ItemId,
  MachineNode,
  MergerNode,
  MinerNode,
  MinerTier,
  Purity,
  Rotation,
  SinkNode,
  SplitterNode,
} from '../game/types';
import { fmt } from '../format';
import { GRID, snapUp } from '../grid';
import { useSim } from '../sim/SimContext';
import { CLOCK_MAX, CLOCK_MIN, ampOf, clampClock, extractorRate, minerRate, shardsFor, sloopsOf, type Issue } from '../sim/simulate';

export const itemColor = (item: BeltItem) => (item && item !== 'mixed' ? ITEMS[item].color : item === 'mixed' ? '#d46ad8' : '#5b616b');

function useNodeSim(id: string) {
  const sim = useSim();
  return { r: sim.nodes[id], issues: sim.byTarget[id] ?? [] };
}

/* ---------- rotação ---------- */

/** Faces no sentido horário: girar 90° leva cada face para a próxima */
const CLOCKWISE = [Position.Left, Position.Top, Position.Right, Position.Bottom];
export const rotatePos = (p: Position, rotation: Rotation = 0) => CLOCKWISE[(CLOCKWISE.indexOf(p) + rotation / 90) % 4];
export const nextRotation = (r: Rotation = 0, dir: 1 | -1 = 1) => (((r + 90 * dir) % 360) + 360) % 360 as Rotation;
const isVertical = (p: Position) => p === Position.Top || p === Position.Bottom;

/* Remedição dos conectores. O React Flow já mede cada node ao montar; remedir de novo em
   todo node que aparece custava N × (varrer o DOM + redesenhar tudo) e travava linhas grandes.
   Então só remede quando algo muda DEPOIS de montado, e junta os pedidos numa chamada só. */
const pendingRemeasure = new Set<string>();
function scheduleRemeasure(id: string, update: (ids: string[]) => void) {
  pendingRemeasure.add(id);
  if (pendingRemeasure.size === 1)
    queueMicrotask(() => {
      const ids = [...pendingRemeasure];
      pendingRemeasure.clear();
      update(ids);
    });
}

/** Pede pro React Flow remedir os conectores do node quando `key` muda (não na montagem) */
function useRemeasureOnChange(id: string | null, key: string) {
  const updateNodeInternals = useUpdateNodeInternals();
  const prev = useRef<string>();
  useEffect(() => {
    if (id && prev.current !== undefined && prev.current !== key) scheduleRemeasure(id, updateNodeInternals);
    prev.current = key;
  }, [id, key, updateNodeInternals]);
}

function useRotation(id: string, rotation: Rotation = 0, collapsed = false) {
  const { updateNodeData } = useReactFlow();
  // conectores mudam de lugar ao girar/minimizar
  useRemeasureOnChange(id, `${rotation}|${collapsed}`);
  return () => updateNodeData(id, { rotation: nextRotation(rotation) });
}

interface StripPort {
  type: 'in' | 'out';
  /** porta de fluido (cano): conector quadrado */
  fluid?: boolean;
  handle: string;
  title: string;
}

/**
 * Conectores distribuídos ao longo de uma borda (node girado na vertical ou minimizado).
 * A posição é arredondada pro grid, pra esteira sair em cima de uma linha do grid.
 */
function PortStrip({ side, ports }: { side: Position; ports: StripPort[] }) {
  if (!ports.length) return null;
  return (
    <div className={`port-strip ${side}`}>
      {ports.map((p, i) => (
        <Handle
          key={p.handle}
          type={p.type === 'in' ? 'target' : 'source'}
          position={side}
          id={p.handle}
          className={`port-handle ${p.type} ${p.fluid ? 'fluid' : ''}`}
          // -0.5px desempata quando cai exatamente no meio de dois quadradinhos (sempre pro de cima/esquerda)
          style={{ [isVertical(side) ? 'left' : 'top']: `round(nearest, calc(${((i + 1) / (ports.length + 1)) * 100}% - 0.5px), ${GRID}px)` }}
          title={p.title}
        />
      ))}
    </div>
  );
}

/* ---------- peças compartilhadas ---------- */

/** borda do .fnode em px (entra na conta da altura) */
const NODE_BORDER = 1;

function NodeCard(props: {
  icon: string;
  title: string;
  subtitle?: string;
  color: string;
  selected?: boolean;
  issues: Issue[];
  power?: number;
  className?: string;
  /** girar 90° no sentido horário */
  onRotate?: () => void;
  /** faixas de conectores nas bordas (node girado na vertical ou minimizado) */
  strips?: ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  children: ReactNode;
}) {
  const { issues, collapsed } = props;
  const flagged = issues.filter((i) => i.level !== 'info');
  const worst = issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warning') ? 'warning' : '';

  // Altura sempre múltipla do grid: mede o conteúdo e arredonda pra cima
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // usa a medida que o próprio ResizeObserver entrega (chega antes da pintura): ler
    // offsetHeight aqui forçava um recálculo de layout por node e travava linhas grandes
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      setHeight(snapUp(h + 2 * NODE_BORDER));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`fnode ${props.className ?? ''} ${props.selected ? 'selected' : ''} ${worst} ${collapsed ? 'collapsed' : ''}`}
      style={{ height }}
      title={collapsed && issues.length ? issues.map((i) => i.message).join('\n') : undefined}
    >
      {props.strips}
      <div ref={contentRef}>
        <div className="fnode-header" style={{ background: props.color }}>
          <span className="fnode-icon">{props.icon}</span>
          <span className="fnode-title">
            {props.title}
            {props.subtitle && <small>{props.subtitle}</small>}
          </span>
          {collapsed && flagged.length > 0 && <span className={`issue-count ${worst}`}>{flagged.length}</span>}
          {props.power !== undefined && <span className="fnode-power">⚡ {fmt(props.power)} MW</span>}
          {props.onToggleCollapse && (
            <button className="rotate-btn nodrag" onClick={props.onToggleCollapse} title={collapsed ? 'Expandir' : 'Minimizar'}>
              {collapsed ? '▸' : '▾'}
            </button>
          )}
          {props.onRotate && (
            <button className="rotate-btn nodrag" onClick={props.onRotate} title="Girar 90° (R)">
              ⟳
            </button>
          )}
        </div>
        <div className="fnode-body">{props.children}</div>
        {!collapsed && issues.length > 0 && (
          <ul className="fnode-issues">
            {issues.map((i) => (
              <li key={i.id} className={i.level}>
                {i.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
    </div>
  );
}

function Seg<T extends string | number>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg nodrag">
      {props.options.map((o) => (
        <button key={String(o.value)} className={o.value === props.value ? 'active' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Campo numérico que não reformata enquanto o usuário digita */
function NumInput(props: { value: number; min: number; max: number; decimals?: number; onChange: (v: number) => void; className?: string }) {
  const show = (v: number) => String(Number(v.toFixed(props.decimals ?? 4)));
  const [text, setText] = useState(show(props.value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(props.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  const parse = (t: string) => parseFloat(t.replace(',', '.'));
  const commit = () => {
    const n = parse(text);
    if (Number.isFinite(n)) props.onChange(Math.min(props.max, Math.max(props.min, n)));
    else setText(show(props.value));
  };
  return (
    <input
      className={`nodrag num ${props.className ?? ''}`}
      inputMode="decimal"
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (n >= props.min && n <= props.max) props.onChange(n);
      }}
      onBlur={() => {
        focused.current = false;
        commit();
        setText(show(props.value));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/**
 * Igual à tela de clock do jogo: slider, clock em % e produção alvo por minuto.
 * `baseRate` = produção do item principal a 100%.
 */
function ClockControl(props: { clock: number; baseRate: number; item: ItemId; onChange: (clock: number) => void }) {
  const { clock, baseRate, onChange } = props;
  const c = clampClock(clock);
  const shards = shardsFor(c);
  return (
    <div className="clock-ctl">
      <div className="clock-row">
        <span className="field-label">Clock</span>
        <NumInput value={c} min={CLOCK_MIN} max={CLOCK_MAX} onChange={onChange} />
        <span className="unit">%</span>
        <span className={`shards ${shards ? 'on' : ''}`} title="Power Shards necessários">
          ◆ {shards}
        </span>
      </div>
      <input
        type="range"
        className="nodrag clock-slider"
        min={CLOCK_MIN}
        max={CLOCK_MAX}
        step={1}
        value={c}
        list="clock-marks"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="clock-row">
        <span className="field-label">Produzir</span>
        <NumInput
          value={(baseRate * c) / 100}
          min={(baseRate * CLOCK_MIN) / 100}
          max={(baseRate * CLOCK_MAX) / 100}
          onChange={(rate) => onChange((rate / baseRate) * 100)}
        />
        <span className="unit" title={ITEMS[props.item].name}>
          {isFluid(props.item) ? 'm³/min' : '/min'}
        </span>
      </div>
    </div>
  );
}

/** Slots de Somersloop: clicar num slot preenche até ele; clicar no último preenchido esvazia ele */
function SloopControl({ slots, value, onChange }: { slots: number; value: number; onChange: (n: number) => void }) {
  const amp = 1 + value / slots;
  return (
    <div className="sloop-ctl">
      <span className="field-label">Somersloop</span>
      <div className="sloop-slots nodrag">
        {Array.from({ length: slots }, (_, i) => (
          <button
            key={i}
            className={`sloop ${i < value ? 'on' : ''}`}
            title={i < value ? 'Remover Somersloop' : 'Inserir Somersloop'}
            onClick={() => onChange(value === i + 1 ? i : i + 1)}
          >
            {i < value ? 'S' : ''}
          </button>
        ))}
      </div>
      <span className={`sloop-info ${value ? 'on' : ''}`}>
        {value ? (
          <>
            +{fmt((amp - 1) * 100)}% · ⚡×{fmt(amp ** AMPLIFICATION.powerExponent)}
          </>
        ) : (
          `${slots} slot${slots > 1 ? 's' : ''}`
        )}
      </span>
    </div>
  );
}

/**
 * Linha de uma porta (item e taxa). O conector fica na lateral da própria linha quando a
 * face é esquerda/direita; nas faces de cima/baixo ele vai pra PortStrip.
 */
function PortRow(props: { type: 'in' | 'out'; handle: string; side: Position; item: BeltItem; label?: string; value: ReactNode; stripped?: boolean }) {
  const isIn = props.type === 'in';
  return (
    <div className={`port-row ${props.type}`}>
      {!props.stripped && !isVertical(props.side) && (
        <Handle type={isIn ? 'target' : 'source'} position={props.side} id={props.handle} className={`port-handle ${props.type} ${isFluid(props.item) ? 'fluid' : ''}`} />
      )}
      <span className="dot" style={{ background: itemColor(props.item) }} />
      {props.label && <span className="port-item">{props.label}</span>}
      <span className="port-value">{props.value}</span>
    </div>
  );
}

/**
 * Meia linha da grade de portas: entradas numa coluna e saídas na outra, lado a lado,
 * pra entrada e saída ficarem na mesma altura (esteira passa reto entre máquinas alinhadas).
 */
function PortCell(props: {
  type: 'in' | 'out';
  handle: string;
  side: Position;
  stripped: boolean;
  item: ItemId;
  port?: { actual: number; max: number };
  fallbackMax: number;
}) {
  const edge = props.side === Position.Right ? 'right' : 'left';
  return (
    <div className={`port-cell ${props.type} at-${edge}`} title={ITEMS[props.item].name}>
      {!props.stripped && !isVertical(props.side) && (
        <Handle type={props.type === 'in' ? 'target' : 'source'} position={props.side} id={props.handle} className={`port-handle ${props.type} ${isFluid(props.item) ? 'fluid' : ''}`} />
      )}
      <span className="port-cell-name">
        <span className="dot" style={{ background: itemColor(props.item) }} />
        {ITEMS[props.item].name}
      </span>
      <span className="port-cell-rate">{rate(props.port?.actual ?? 0, props.port?.max ?? props.fallbackMax, props.item)}</span>
    </div>
  );
}

function UtilBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 99.5 ? 'var(--ok)' : pct > 0 ? 'var(--warn)' : 'var(--muted)';
  return (
    <div className="util" title="Utilização">
      <div className="util-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      <span>{pct}% em uso</span>
    </div>
  );
}

/** "atual / máximo" com a unidade do item (m³/min pra fluido) */
const rate = (actual: number, max: number, item?: BeltItem) => (
  <>
    <b>{fmt(actual)}</b>
    <small>
      {' '}
      / {fmt(max)}
      {isFluid(item) ? ' m³/min' : '/min'}
    </small>
  </>
);

/** Altura de cada linha de porta; com o espaçamento de 6px entre linhas dá 40px = 2 quadradinhos */
const PORT_ROW_H = 34;

/**
 * Agrupa as linhas de porta e empurra o bloco pra que o centro de cada linha (onde fica o
 * conector) caia numa linha do grid. Assim a esteira sai do node já em cima do grid.
 */
function PortBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const nodeId = useNodeId();
  const [pad, setPad] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const card = el?.closest('.fnode') as HTMLElement | null;
    if (!el || !card) return;
    const cardRect = card.getBoundingClientRect();
    const scale = card.offsetHeight ? cardRect.height / card.offsetHeight : 1; // zoom do canvas
    const natural = (el.getBoundingClientRect().top - cardRect.top) / scale - pad;
    const center = natural + PORT_ROW_H / 2;
    // Tolerância de 1px: o navegador arredonda posições em frações de pixel (pior com zoom
    // afastado); sem ela, um centro em 260,00 x 260,01 alternava o ajuste entre 0 e 20 pra sempre
    const next = snapUp(center - 1) - center;
    if (Math.abs(next - pad) > 1) setPad(next);
  });
  useRemeasureOnChange(nodeId, String(pad));
  return (
    <div ref={ref} className="port-block" style={{ marginTop: pad }}>
      {children}
    </div>
  );
}

/** Conteúdo do node minimizado: só o essencial */
function CollapsedSummary(props: {
  line: ReactNode;
  outputs: { item: ItemId; actual: number; max: number }[];
  util: number;
  chips?: ReactNode;
  hideName?: boolean;
}) {
  const pct = Math.round(props.util * 100);
  return (
    <div className="collapsed-body">
      <div className="collapsed-line">
        {props.line}
        {props.chips}
      </div>
      {props.outputs.map((o) => (
        <div key={o.item} className="collapsed-out">
          <span className="dot" style={{ background: itemColor(o.item) }} />
          {/* não repete o nome quando ele já é o da receita/linha de cima */}
          <span className="port-item">{props.hideName ? '' : ITEMS[o.item].name}</span>
          <span className="port-value">{rate(o.actual, o.max, o.item)}</span>
        </div>
      ))}
      <div className="util-thin" title={`${pct}% em uso`}>
        <div style={{ width: `${Math.min(100, pct)}%`, background: pct >= 99.5 ? 'var(--ok)' : pct > 0 ? 'var(--warn)' : 'var(--muted)' }} />
      </div>
    </div>
  );
}

const clockChip = (clock: number) =>
  Math.abs(clampClock(clock) - 100) > 1e-9 && <span className="mini-chip">{fmt(clampClock(clock))}%</span>;

/* ---------- nodes ---------- */

const PURITY_OPTIONS = (Object.keys(PURITIES) as Purity[]).map((p) => ({ value: p, label: PURITIES[p].name }));
const TIER_OPTIONS = ([1, 2, 3] as MinerTier[]).map((t) => ({ value: t, label: MINER_TIERS[t].name }));

export function MinerNodeView({ id, data, selected }: NodeProps<MinerNode>) {
  const { updateNodeData } = useReactFlow();
  const { r, issues } = useNodeSim(id);
  const max = minerRate(data);
  const out = r?.outputs[0];
  const collapsed = !!data.collapsed;
  const rotate = useRotation(id, data.rotation, collapsed);
  const outSide = rotatePos(Position.Right, data.rotation);
  const stripped = collapsed || isVertical(outSide);
  const strips = stripped && <PortStrip side={outSide} ports={[{ type: 'out', handle: 'out-0', title: ITEMS[data.resource].name }]} />;
  const card = {
    icon: '⛏️',
    title: 'Mineradora',
    subtitle: MINER_TIERS[data.tier].name,
    color: '#7d5236',
    selected,
    issues,
    power: r?.power,
    onRotate: rotate,
    strips,
    collapsed,
    onToggleCollapse: () => updateNodeData(id, { collapsed: !collapsed }),
  };
  if (collapsed)
    return (
      <NodeCard {...card}>
        <CollapsedSummary
          line={`${ITEMS[data.resource].name} · ${PURITIES[data.purity].name}`}
          chips={clockChip(data.clock)}
          outputs={[{ item: data.resource, actual: out?.actual ?? max, max }]}
          util={r?.util ?? 1}
        />
      </NodeCard>
    );
  return (
    <NodeCard {...card}>
      <Field label="Nó">
        <select className="nodrag" value={data.resource} onChange={(e) => updateNodeData(id, { resource: e.target.value as ItemId })}>
          {RESOURCES.map((it) => (
            <option key={it} value={it}>
              {ITEMS[it].name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Pureza">
        <Seg value={data.purity} options={PURITY_OPTIONS} onChange={(purity) => updateNodeData(id, { purity })} />
      </Field>
      <Field label="Modelo">
        <Seg value={data.tier} options={TIER_OPTIONS} onChange={(tier) => updateNodeData(id, { tier })} />
      </Field>
      <ClockControl clock={data.clock} baseRate={minerRate({ ...data, clock: 100 })} item={data.resource} onChange={(clock) => updateNodeData(id, { clock })} />
      <PortBlock>
        <PortRow type="out" handle="out-0" side={outSide} stripped={stripped} item={data.resource} label={ITEMS[data.resource].name} value={rate(out?.actual ?? max, max, data.resource)} />
      </PortBlock>
      <UtilBar value={r?.util ?? 1} />
    </NodeCard>
  );
}

const extractorResourceOptions = (kind: ExtractorKind) => EXTRACTORS[kind].resources.map((it) => ({ value: it, label: ITEMS[it].name }));

export function ExtractorNodeView({ id, data, selected }: NodeProps<ExtractorNode>) {
  const { updateNodeData } = useReactFlow();
  const { r, issues } = useNodeSim(id);
  const info = EXTRACTORS[data.extractor];
  const max = extractorRate(data);
  const out = r?.outputs[0];
  const collapsed = !!data.collapsed;
  const rotate = useRotation(id, data.rotation, collapsed);
  const outSide = rotatePos(Position.Right, data.rotation);
  const stripped = collapsed || isVertical(outSide);
  const strips = stripped && <PortStrip side={outSide} ports={[{ type: 'out', handle: 'out-0', title: ITEMS[data.resource].name, fluid: true }]} />;
  const card = {
    icon: data.extractor === 'water' ? '💧' : data.extractor === 'oil' ? '🛢️' : '🕳️',
    title: info.name,
    color: '#1f5f8b',
    selected,
    issues,
    power: r?.power,
    onRotate: rotate,
    strips,
    collapsed,
    onToggleCollapse: () => updateNodeData(id, { collapsed: !collapsed }),
  };
  if (collapsed)
    return (
      <NodeCard {...card}>
        <CollapsedSummary
          line={info.usesPurity ? `${ITEMS[data.resource].name} · ${PURITIES[data.purity].name}` : ITEMS[data.resource].name}
          chips={clockChip(data.clock)}
          outputs={[{ item: data.resource, actual: out?.actual ?? max, max }]}
          util={r?.util ?? 1}
        />
      </NodeCard>
    );
  return (
    <NodeCard {...card}>
      {info.resources.length > 1 && (
        <Field label="Recurso">
          <select className="nodrag" value={data.resource} onChange={(e) => updateNodeData(id, { resource: e.target.value as ItemId })}>
            {extractorResourceOptions(data.extractor).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {info.usesPurity && (
        <Field label="Pureza">
          <Seg value={data.purity} options={PURITY_OPTIONS} onChange={(purity) => updateNodeData(id, { purity })} />
        </Field>
      )}
      {data.extractor === 'well' && (
        <div className="note">
          Fica num nó-satélite do poço e não tem clock nem consumo próprio: quem consome ({fmt(WELL_PRESSURIZER_POWER)} MW) e faz overclock é o {WELL_PRESSURIZER_NAME}, que não entra na conta.
        </div>
      )}
      {info.overclockable && (
        <ClockControl clock={data.clock} baseRate={info.rate(data.purity)} item={data.resource} onChange={(clock) => updateNodeData(id, { clock })} />
      )}
      <PortBlock>
        <PortRow type="out" handle="out-0" side={outSide} stripped={stripped} item={data.resource} label={ITEMS[data.resource].name} value={rate(out?.actual ?? max, max, data.resource)} />
      </PortBlock>
      <UtilBar value={r?.util ?? 1} />
    </NodeCard>
  );
}

const handleIndex = (h?: string | null) => Number(h?.split('-')[1]);

export function MachineNodeView({ id, data, selected }: NodeProps<MachineNode>) {
  const { updateNodeData, setEdges } = useReactFlow();
  const { r, issues } = useNodeSim(id);
  const m = MACHINES[data.machine];
  const recipe = getRecipe(data);
  const recipes = recipesFor(data.machine);
  const sloops = sloopsOf(data);
  const amp = ampOf(data);
  useRemeasureOnChange(id, recipe.id);
  const collapsed = !!data.collapsed;
  const rotate = useRotation(id, data.rotation, collapsed);
  const inSide = rotatePos(Position.Left, data.rotation);
  const outSide = rotatePos(Position.Right, data.rotation);
  const stripped = collapsed || isVertical(inSide);
  const strips = stripped && (
    <>
      <PortStrip side={inSide} ports={recipe.inputs.map((p, i) => ({ type: 'in', handle: `in-${i}`, title: ITEMS[p.item].name, fluid: isFluid(p.item) }))} />
      <PortStrip side={outSide} ports={recipe.outputs.map((p, i) => ({ type: 'out', handle: `out-${i}`, title: ITEMS[p.item].name, fluid: isFluid(p.item) }))} />
    </>
  );

  const changeRecipe = (rid: string) => {
    const next = RECIPES[rid];
    updateNodeData(id, { recipe: rid });
    // Esteiras ligadas em portas que deixam de existir com a nova receita são removidas
    setEdges((es) =>
      es.filter(
        (e) =>
          !(e.target === id && handleIndex(e.targetHandle) >= next.inputs.length) &&
          !(e.source === id && handleIndex(e.sourceHandle) >= next.outputs.length),
      ),
    );
  };

  const options = (alt: boolean) =>
    recipes
      .filter((rc) => rc.alternate === alt)
      .map((rc) => (
        <option key={rc.id} value={rc.id}>
          {rc.name.replace(/^Alternate: /, '')}
        </option>
      ));

  const card = {
    icon: m.icon,
    title: m.name,
    color: m.color,
    selected,
    issues,
    power: r?.power,
    className: sloops ? 'amplified' : '',
    onRotate: rotate,
    strips,
    collapsed,
    onToggleCollapse: () => updateNodeData(id, { collapsed: !collapsed }),
  };
  if (collapsed)
    return (
      <NodeCard {...card}>
        <CollapsedSummary
          line={
            <span className="collapsed-recipe" title={recipe.name}>
              {recipe.name.replace(/^Alternate: /, '')}
              {recipe.alternate && <span className="mini-chip alt">alt</span>}
            </span>
          }
          chips={
            <>
              {clockChip(data.clock)}
              {sloops > 0 && <span className="mini-chip sloop">S×{sloops}</span>}
            </>
          }
          outputs={recipe.outputs.map((p, i) => ({ item: p.item, actual: r?.outputs[i]?.actual ?? 0, max: r?.outputs[i]?.max ?? p.rate }))}
          hideName={recipe.outputs.length === 1 && ITEMS[recipe.outputs[0].item].name === recipe.name}
          util={r?.util ?? 0}
        />
      </NodeCard>
    );
  return (
    <NodeCard {...card}>
      <Field label="Receita">
        <select className="nodrag" value={recipe.id} onChange={(e) => changeRecipe(e.target.value)}>
          <optgroup label="Padrão">{options(false)}</optgroup>
          {recipes.some((rc) => rc.alternate) && <optgroup label="Alternativas">{options(true)}</optgroup>}
        </select>
      </Field>
      {recipe.alternate && <div className="alt-badge">Receita alternativa</div>}
      <ClockControl clock={data.clock} baseRate={recipe.outputs[0].rate * amp} item={recipe.outputs[0].item} onChange={(clock) => updateNodeData(id, { clock })} />
      {m.sloopSlots > 0 && <SloopControl slots={m.sloopSlots} value={sloops} onChange={(n) => updateNodeData(id, { sloops: n })} />}
      <PortBlock>
        {Array.from({ length: Math.max(recipe.inputs.length, recipe.outputs.length) }, (_, i) => {
          const inp = recipe.inputs[i];
          const out = recipe.outputs[i];
          const inCell = inp ? (
            <PortCell key="in" type="in" handle={`in-${i}`} side={inSide} stripped={stripped} item={inp.item} port={r?.inputs[i]} fallbackMax={inp.rate} />
          ) : (
            <div key="in" className="port-cell empty" />
          );
          const outCell = out ? (
            <PortCell key="out" type="out" handle={`out-${i}`} side={outSide} stripped={stripped} item={out.item} port={r?.outputs[i]} fallbackMax={out.rate} />
          ) : (
            <div key="out" className="port-cell empty" />
          );
          // a coluna de entradas fica do lado em que os conectores de entrada estão
          return (
            <div key={i} className="port-pair">
              {inSide === Position.Right ? [outCell, inCell] : [inCell, outCell]}
            </div>
          );
        })}
      </PortBlock>
      <UtilBar value={r?.util ?? 0} />
    </NodeCard>
  );
}

/*
 * Divisor e Mesclador são cubos, como no jogo:
 *  - Divisor: entrada atrás (esquerda), saídas nas outras 3 faces (cima, frente/direita, baixo)
 *  - Mesclador: entradas em 3 faces (cima, esquerda, baixo), saída na frente (direita)
 * Os ids das portas não mudam (out-0..2 / in-0..2) pra manter compatibilidade com plantas salvas.
 */
interface CubePort {
  type: 'in' | 'out';
  handle: string;
  position: Position;
}
const SPLITTER_PORTS: CubePort[] = [
  { type: 'in', handle: 'in-0', position: Position.Left },
  { type: 'out', handle: 'out-0', position: Position.Top },
  { type: 'out', handle: 'out-1', position: Position.Right },
  { type: 'out', handle: 'out-2', position: Position.Bottom },
];
const MERGER_PORTS: CubePort[] = [
  { type: 'in', handle: 'in-0', position: Position.Top },
  { type: 'in', handle: 'in-1', position: Position.Left },
  { type: 'in', handle: 'in-2', position: Position.Bottom },
  { type: 'out', handle: 'out-0', position: Position.Right },
];

function LogisticCube({ id, selected, kind, rotation, fluid }: { id: string; selected?: boolean; kind: 'splitter' | 'merger'; rotation?: Rotation; fluid?: boolean }) {
  const { r, issues } = useNodeSim(id);
  const rotate = useRotation(id, rotation);
  const ports = kind === 'splitter' ? SPLITTER_PORTS : MERGER_PORTS;
  const portOf = (p: CubePort) => (p.type === 'in' ? r?.inputs : r?.outputs)?.find((x) => x.handle === p.handle);
  const through = (kind === 'splitter' ? r?.inputs[0] : r?.outputs[0])?.actual ?? 0;
  const worst = issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warning') ? 'warning' : '';
  const flagged = issues.filter((i) => i.level !== 'info');
  return (
    <div className={`cube ${kind} ${fluid ? 'fluid' : ''} ${selected ? 'selected' : ''} ${worst}`} title={issues.map((i) => i.message).join('\n') || undefined}>
      {ports.map((p) => {
        const port = portOf(p);
        const side = rotatePos(p.position, rotation);
        return (
          <div key={p.handle}>
            <Handle type={p.type === 'in' ? 'target' : 'source'} position={side} id={p.handle} className={`port-handle ${p.type} ${fluid ? 'fluid' : ''}`} />
            {port?.connected && <span className={`cube-flow ${side}`}>{fmt(port.actual)}</span>}
          </div>
        );
      })}
      <div className="cube-center">
        <span className="cube-icon">{fluid ? '💧' : kind === 'splitter' ? '🔀' : '🔁'}</span>
        <b>{fluid ? 'Junção' : kind === 'splitter' ? 'Divisor' : 'Mesclador'}</b>
        {fluid && <small className="cube-sub">{kind === 'splitter' ? 'divide' : 'junta'}</small>}
        <small>
          {fmt(through)}
          {fluid ? ' m³/min' : '/min'}
        </small>
      </div>
      {flagged.length > 0 && <span className={`cube-badge ${worst}`}>!</span>}
      <button className="rotate-btn cube-rotate nodrag" onClick={rotate} title="Girar 90° (R)">
        ⟳
      </button>
    </div>
  );
}

export function SplitterNodeView({ id, data, selected }: NodeProps<SplitterNode>) {
  return <LogisticCube id={id} selected={selected} kind="splitter" rotation={data.rotation} fluid={data.fluid} />;
}

export function MergerNodeView({ id, data, selected }: NodeProps<MergerNode>) {
  return <LogisticCube id={id} selected={selected} kind="merger" rotation={data.rotation} fluid={data.fluid} />;
}

export function SinkNodeView({ id, data, selected }: NodeProps<SinkNode>) {
  const { r, issues } = useNodeSim(id);
  const inp = r?.inputs[0];
  const item = inp?.item ?? null;
  const rotate = useRotation(id, data.rotation);
  const inSide = rotatePos(Position.Left, data.rotation);
  const strips = isVertical(inSide) && <PortStrip side={inSide} ports={[{ type: 'in', handle: 'in-0', title: 'Entrada' }]} />;
  return (
    <NodeCard icon="📦" title="Armazém" subtitle="Saída final" color="#2f7a52" selected={selected} issues={issues} onRotate={rotate} strips={strips}>
      <PortBlock>
        <PortRow
          type="in"
          handle="in-0"
          side={inSide}
          item={item}
          label={item === 'mixed' ? 'Misturado' : item ? ITEMS[item].name : 'Nada'}
          value={
            <>
              <b>{fmt(inp?.actual ?? 0)}</b>
              <small>{isFluid(item) ? ' m³/min' : '/min'}</small>
            </>
          }
        />
      </PortBlock>
    </NodeCard>
  );
}

export const nodeTypes = {
  miner: MinerNodeView,
  extractor: ExtractorNodeView,
  machine: MachineNodeView,
  splitter: SplitterNodeView,
  merger: MergerNodeView,
  sink: SinkNodeView,
};
