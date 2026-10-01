import { BELTS, BELT_TIERS, EXTRACTORS, ITEMS, MACHINES, PIPES, PIPE_TIERS, getRecipe } from '../game/data';
import type { BeltEdge, BeltItem, BeltRouting, BeltTier, FactoryNode, PipeTier } from '../game/types';
import { fmt } from '../format';
import type { EdgeResult, Issue } from '../sim/simulate';
import { itemColor } from './nodes';

const itemLabel = (item: BeltItem) => (item === 'mixed' ? 'Misturado' : item ? ITEMS[item].name : 'Nada passando');

/** Nome curto do node pra mostrar "de onde vem / pra onde vai" */
export function nodeLabel(n?: FactoryNode): string {
  if (!n) return '—';
  const d = n.data;
  switch (d.kind) {
    case 'miner':
      return `Mineradora · ${ITEMS[d.resource].name}`;
    case 'extractor':
      return `${EXTRACTORS[d.extractor].name} · ${ITEMS[d.resource].name}`;
    case 'machine': {
      const r = getRecipe(d);
      return `${MACHINES[d.machine].name} · ${r.name.replace(/^Alternate: /, '')}`;
    }
    case 'splitter':
      return d.fluid ? 'Junção (divide)' : 'Divisor';
    case 'merger':
      return d.fluid ? 'Junção (junta)' : 'Mesclador';
    case 'sink':
      return 'Armazém';
  }
}

/** Qual item a porta do node espera/entrega (só máquinas têm porta "tipada") */
function portItem(n: FactoryNode | undefined, handle?: string | null): string | undefined {
  if (!n || n.data.kind !== 'machine' || !handle) return;
  const r = getRecipe(n.data);
  const idx = Number(handle.split('-')[1]);
  const p = handle.startsWith('in') ? r.inputs[idx] : r.outputs[idx];
  return p && ITEMS[p.item].name;
}

const STATUS_TEXT: Record<EdgeResult['status'], string> = {
  ok: 'Fluindo normalmente',
  idle: 'Parada (nada passando)',
  excess: 'Sobrando item',
  bottleneck: 'Esteira fraca (gargalo)',
  'wrong-item': 'Item errado pro destino',
};

export function BeltInspector(props: {
  edge: BeltEdge;
  result?: EdgeResult;
  issues: Issue[];
  source?: FactoryNode;
  target?: FactoryNode;
  routing: BeltRouting;
  onTier: (tier: BeltTier) => void;
  onRouting: (routing: BeltRouting) => void;
  onFocusNode: (id: string) => void;
}) {
  const { edge, result: r } = props;
  const tier = edge.data?.tier ?? 1;
  const pipe = edge.type === 'pipe';
  const tiers = pipe ? PIPE_TIERS : BELT_TIERS;
  const tierInfo = (t: number) => (pipe ? PIPES[t as PipeTier] : BELTS[t as BeltTier]) ?? (pipe ? PIPES[1] : BELTS[1]);
  const cap = r?.cap ?? tierInfo(tier).rate;
  const unit = pipe ? 'm³/min' : 'por min';
  const per = pipe ? ' m³/min' : '/min';
  const flow = r?.flow ?? 0;
  const use = cap ? flow / cap : 0;
  const status = r?.status ?? 'idle';
  return (
    <section className="belt-inspector">
      <h3>{pipe ? '💧 Cano selecionado' : 'Esteira selecionada'}</h3>

      <div className="bi-item">
        <span className="bi-dot" style={{ background: itemColor(r?.item ?? null) }} />
        <div>
          <b>{itemLabel(r?.item ?? null)}</b>
          <small className={`bi-status ${status}`}>{pipe ? STATUS_TEXT[status].replace('item', 'fluido').replace('Esteira fraca', 'Cano fraco') : STATUS_TEXT[status]}</small>
        </div>
      </div>

      <div className="bi-flow">
        <span className="bi-big">{fmt(flow)}</span>
        <span className="muted">
          / {fmt(cap)} {unit}
        </span>
        <span className="bi-pct">{Math.round(use * 100)}%</span>
      </div>
      <div className="bi-bar" title={`${Math.round(use * 100)}% da capacidade ${pipe ? 'do cano' : 'da esteira'}`}>
        <div style={{ width: `${Math.min(100, use * 100)}%`, background: status === 'ok' || status === 'idle' ? itemColor(r?.item ?? null) : status === 'excess' ? 'var(--warn)' : 'var(--err)' }} />
      </div>

      <table className="prod bi-table">
        <tbody>
          <tr>
            <td>Chegando da origem</td>
            <td>
              {fmt(Math.min(r?.offered ?? 0, cap))}
              {per}
            </td>
          </tr>
          {r && r.offered > cap + 1e-6 && (
            <tr>
              <td>Origem queria mandar</td>
              <td className="warn-text">
                {fmt(r.offered)}
                {per}
              </td>
            </tr>
          )}
          <tr>
            <td>Destino aceita</td>
            <td>
              {fmt(r?.wanted ?? 0)}
              {per}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="bi-route">
        <button className="bi-node" onClick={() => props.source && props.onFocusNode(props.source.id)} title="Ir até a origem">
          <small>De</small>
          <span>{nodeLabel(props.source)}</span>
          {portItem(props.source, edge.sourceHandle) && <small className="muted">saída: {portItem(props.source, edge.sourceHandle)}</small>}
        </button>
        <span className="bi-arrow">↓</span>
        <button className="bi-node" onClick={() => props.target && props.onFocusNode(props.target.id)} title="Ir até o destino">
          <small>Para</small>
          <span>{nodeLabel(props.target)}</span>
          {portItem(props.target, edge.targetHandle) && <small className="muted">entrada: {portItem(props.target, edge.targetHandle)}</small>}
        </button>
      </div>

      {props.issues.map((i) => (
        <p key={i.id} className={`bi-issue ${i.level}`}>
          {i.level === 'error' ? '⛔' : i.level === 'warning' ? '⚠️' : 'ℹ️'} {i.message}
        </p>
      ))}

      <div className="bi-controls">
        <label>
          {pipe ? 'Cano' : 'Esteira'}
          <select value={tier} onChange={(e) => props.onTier(Number(e.target.value) as BeltTier)}>
            {tiers.map((t) => (
              <option key={t} value={t}>
                {tierInfo(t).name} ({tierInfo(t).rate}
                {per})
              </option>
            ))}
          </select>
        </label>
        <div className="seg">
          <button className={props.routing === 'grid' ? 'active' : ''} onClick={() => props.onRouting('grid')}>
            ┐ Grid
          </button>
          <button className={props.routing === 'curve' ? 'active' : ''} onClick={() => props.onRouting('curve')}>
            ∿ Curva
          </button>
        </div>
      </div>
    </section>
  );
}
