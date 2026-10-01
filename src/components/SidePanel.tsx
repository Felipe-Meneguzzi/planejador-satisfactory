import type { ReactNode } from 'react';
import { BELTS, GENERATORS, ITEMS, PIPES, SINK, couponCost, couponsFor, withUnit } from '../game/data';
import type { PipeTier } from '../game/types';
import { fmt } from '../format';
import type { EnergyResult, Issue, SimResult } from '../sim/simulate';

const ICON = { error: '⛔', warning: '⚠️', info: 'ℹ️' } as const;

export function SidePanel(props: {
  sim: SimResult;
  onFocus: (i: Issue) => void;
  onFixBelt: (edgeId: string, tier: Issue['fixTier']) => void;
  /** detalhes da esteira selecionada, mostrados no topo do painel */
  beltDetails?: ReactNode;
  couponsPrinted: number;
  onCouponsPrinted: (n: number) => void;
}) {
  const { sim } = props;
  const problems = sim.issues.filter((i) => i.level !== 'info');
  const sunkAny = sim.production.some((p) => p.sunk);
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
                {sunkAny && <th title={`Destruído em ${SINK.name}s`}>Sink</th>}
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
                  {sunkAny && <td>{p.sunk ? withUnit(fmt(p.sunk), p.item) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {sim.sink.count > 0 && <SinkSection sink={sim.sink} printed={props.couponsPrinted} onPrinted={props.onCouponsPrinted} />}

      <EnergySection energy={sim.energy} />

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

/** Geração por tipo, consumo, saldo, uso da rede e insumos dos geradores */
function EnergySection({ energy: e }: { energy: EnergyResult }) {
  if (!e.generators)
    return (
      <section className="energy">
        <h3>Energia</h3>
        <p className="muted">
          Consumo: <b>{fmt(e.consumption)} MW</b>. Sem geradores na planta — a energia vem de fora.
        </p>
      </section>
    );
  const balance = e.generation - e.consumption;
  const short = balance < -1e-6;
  const usage = e.usage ?? 0;
  const pct = Number.isFinite(usage) ? Math.round(usage * 100) : null;
  return (
    <section className="energy">
      <h3>Energia</h3>
      <table className="energy-table">
        <tbody>
          {e.byType.map((t) => (
            <tr key={t.generator}>
              <td>
                {t.count}× {GENERATORS[t.generator]?.name ?? t.generator}
              </td>
              <td title="real / nominal no clock escolhido">
                {fmt(t.generated)}
                {Math.abs(t.nominal - t.generated) > 1e-6 && <small> / {fmt(t.nominal)}</small>} MW
              </td>
            </tr>
          ))}
          {e.boostRate > 0 && (
            <tr>
              <td title="(geração + 500 MW de cada APA) × (1 + bônus)">Bônus do Alien Power Augmenter (+{fmt(e.boostRate * 100)}%)</td>
              <td>+{fmt(e.boost)} MW</td>
            </tr>
          )}
          <tr className="total">
            <td>Geração</td>
            <td>{fmt(e.generation)} MW</td>
          </tr>
          <tr>
            <td>Consumo</td>
            <td>{fmt(e.consumption)} MW</td>
          </tr>
          <tr className={`total ${short ? 'bad' : 'good'}`}>
            <td>Saldo</td>
            <td>
              {balance >= 0 ? '+' : '−'}
              {fmt(Math.abs(balance))} MW
            </td>
          </tr>
        </tbody>
      </table>
      <div className="util energy-usage" title="Consumo ÷ geração">
        <div className="util-fill" style={{ width: `${Math.min(100, pct ?? 100)}%`, background: short ? 'var(--err)' : 'var(--ok)' }} />
        <span>{pct === null ? 'sem geração' : `${pct}% da rede em uso`}</span>
      </div>
      {e.fuel.length > 0 && (
        <>
          <h4>Insumos dos geradores</h4>
          <ul className="energy-fuel">
            {e.fuel.map((f) => (
              <li key={f.item}>
                <span className="dot" style={{ background: ITEMS[f.item].color }} />
                {ITEMS[f.item].name}
                <b>{withUnit(fmt(f.rate), f.item)}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Pontos/min e /hora dos AWESOME Sinks e a estimativa de cupons */
function SinkSection({ sink, printed, onPrinted }: { sink: SimResult['sink']; printed: number; onPrinted: (n: number) => void }) {
  const perHour = sink.points * 60;
  const est = couponsFor(perHour, printed);
  const nextCost = couponCost(printed + 1);
  return (
    <section className="sink-section">
      <h3>{SINK.name}</h3>
      <table className="energy-table">
        <tbody>
          <tr>
            <td>Pontos por minuto</td>
            <td>{fmt(sink.points)}</td>
          </tr>
          <tr className="total">
            <td>Pontos por hora</td>
            <td>{fmt(perHour)}</td>
          </tr>
          {sink.dna > 0 && (
            <tr>
              <td title="Alien DNA Capsule: contador separado">Pontos de DNA por hora</td>
              <td>{fmt(sink.dna * 60)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <label className="coupons">
        Cupons já impressos
        <input
          type="number"
          min={0}
          step={1}
          value={printed}
          onChange={(e) => onPrinted(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
      </label>
      <p className="muted">
        O próximo cupom custa <b>{fmt(nextCost)}</b> pontos
        {sink.points > 0 ? ` (~${fmt(Math.ceil(nextCost / sink.points))} min)` : ''}. Nesse ritmo: <b>≈ {fmt(est.count)}</b> cupom(ns) na próxima hora.
      </p>
    </section>
  );
}
