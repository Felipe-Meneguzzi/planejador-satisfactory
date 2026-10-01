import type { ReactNode } from 'react';
import { BELTS, ITEMS, PIPES, withUnit } from '../game/data';
import type { PipeTier } from '../game/types';
import { fmt } from '../format';
import type { Issue, SimResult } from '../sim/simulate';

const ICON = { error: '⛔', warning: '⚠️', info: 'ℹ️' } as const;

export function SidePanel(props: {
  sim: SimResult;
  onFocus: (i: Issue) => void;
  onFixBelt: (edgeId: string, tier: Issue['fixTier']) => void;
  /** detalhes da esteira selecionada, mostrados no topo do painel */
  beltDetails?: ReactNode;
}) {
  const { sim } = props;
  const problems = sim.issues.filter((i) => i.level !== 'info');
  const infos = sim.issues.filter((i) => i.level === 'info');
  return (
    <aside className="sidepanel">
      {props.beltDetails}
      <section>
        <h3>Produção final</h3>
        {sim.production.length === 0 ? (
          <p className="muted">Nada sendo produzido ainda.</p>
        ) : (
          <table className="prod">
            <thead>
              <tr>
                <th>Item</th>
                <th title="Chegando em armazéns">Armazém</th>
                <th title="Saídas de máquinas sem esteira">Livre</th>
              </tr>
            </thead>
            <tbody>
              {sim.production.map((p) => (
                <tr key={p.item}>
                  <td>
                    <span className="dot" style={{ background: ITEMS[p.item].color }} />
                    {ITEMS[p.item].name}
                  </td>
                  <td>{p.stored ? withUnit(fmt(p.stored), p.item) : '—'}</td>
                  <td>{p.loose ? withUnit(fmt(p.loose), p.item) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="issues">
        <h3>
          Problemas <span className="count">{problems.length}</span>
        </h3>
        {problems.length === 0 && <p className="ok-msg">✅ Tudo certo — nenhum gargalo ou sobra.</p>}
        {problems.map((i) => (
          <IssueItem key={i.id} issue={i} {...props} />
        ))}
        {infos.length > 0 && (
          <details>
            <summary>Informações ({infos.length})</summary>
            {infos.map((i) => (
              <IssueItem key={i.id} issue={i} {...props} />
            ))}
          </details>
        )}
      </section>

      <section className="legend">
        <h3>Legenda das esteiras</h3>
        <div><span className="swatch" style={{ background: 'var(--err)' }} /> Esteira fraca / item errado</div>
        <div><span className="swatch" style={{ background: 'var(--warn)' }} /> Sobrando item (produz &gt; consome)</div>
        <div><span className="swatch" style={{ background: '#4a4f58' }} /> Parada</div>
        <div><span className="swatch" style={{ background: ITEMS['iron-ore'].color }} /> OK (cor do item)</div>
        <div><span className="swatch pipe-swatch" /> Cano (fluido, m³/min)</div>
        <div><span className="swatch round" style={{ background: 'var(--port-in)' }} /> Conector de entrada</div>
        <div><span className="swatch round" style={{ background: 'var(--port-out)' }} /> Conector de saída</div>
        <div><span className="swatch square" /> Conector quadrado = fluido</div>
      </section>
    </aside>
  );
}

function IssueItem({ issue, onFocus, onFixBelt }: { issue: Issue; onFocus: (i: Issue) => void; onFixBelt: (edgeId: string, tier: Issue['fixTier']) => void }) {
  return (
    <div className={`issue ${issue.level}`} onClick={() => onFocus(issue)}>
      <span>{ICON[issue.level]}</span>
      <span className="issue-msg">{issue.message}</span>
      {issue.fixTier && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFixBelt(issue.target.id, issue.fixTier);
          }}
        >
          Usar {issue.fixPipe ? `cano ${PIPES[issue.fixTier as PipeTier].name}` : BELTS[issue.fixTier].name}
        </button>
      )}
    </div>
  );
}
