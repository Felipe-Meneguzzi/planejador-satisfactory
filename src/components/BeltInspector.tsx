import { BELTS, BELT_TIERS, ITEMS, MACHINES, getRecipe } from '../game/data';
import type { BeltEdge, BeltItem, BeltRouting, BeltTier, FactoryNode } from '../game/types';
import { fmt } from '../format';
import type { EdgeResult, Issue } from '../sim/simulate';
import { itemColor } from './nodes';

const itemLabel = (item: BeltItem) => (item === 'mixed' ? 'Itens misturados' : item ? ITEMS[item].name : 'Nada (esteira vazia)');

/** Nome curto do node pra mostrar "de onde vem / pra onde vai" */
export function nodeLabel(n?: FactoryNode): string {
  if (!n) return '—';
  const d = n.data;
  switch (d.kind) {
    case 'miner':
      return `Mineradora · ${ITEMS[d.resource].name}`;
    case 'machine': {
      const r = getRecipe(d);
      return `${MACHINES[d.machine].name} · ${r.name.replace(/^Alternate: /, '')}`;
    }
    case 'splitter':
      return 'Divisor';
    case 'merger':
      return 'Mesclador';
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
  const cap = r?.cap ?? BELTS[tier].rate;
  const flow = r?.flow ?? 0;
  const use = cap ? flow / cap : 0;
  const status = r?.status ?? 'idle';
  return (
    <section className="belt-inspector">
      <h3>Esteira selecionada</h3>

      <div className="bi-item">
        <span className="bi-dot" style={{ background: itemColor(r?.item ?? null) }} />
        <div>
          <b>{itemLabel(r?.item ?? null)}</b>
          <small className={`bi-status ${status}`}>{STATUS_TEXT[status]}</small>
        </div>
      </div>

      <div className="bi-flow">
        <span className="bi-big">{fmt(flow)}</span>
        <span className="muted">/ {fmt(cap)} por min</span>
        <span className="bi-pct">{Math.round(use * 100)}%</span>
      </div>
      <div className="bi-bar" title={`${Math.round(use * 100)}% da capacidade da esteira`}>
        <div style={{ width: `${Math.min(100, use * 100)}%`, background: status === 'ok' || status === 'idle' ? itemColor(r?.item ?? null) : status === 'excess' ? 'var(--warn)' : 'var(--err)' }} />
      </div>

      <table className="prod bi-table">
        <tbody>
          <tr>
            <td>Chegando da origem</td>
            <td>{fmt(Math.min(r?.offered ?? 0, cap))}/min</td>
          </tr>
          {r && r.offered > cap + 1e-6 && (
            <tr>
              <td>Origem queria mandar</td>
              <td className="warn-text">{fmt(r.offered)}/min</td>
            </tr>
          )}
          <tr>
            <td>Destino aceita</td>
            <td>{fmt(r?.wanted ?? 0)}/min</td>
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
          Esteira
          <select value={tier} onChange={(e) => props.onTier(Number(e.target.value) as BeltTier)}>
            {BELT_TIERS.map((t) => (
              <option key={t} value={t}>
                {BELTS[t].name} ({BELTS[t].rate}/min)
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
