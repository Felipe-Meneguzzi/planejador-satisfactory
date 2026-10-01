import { useEffect } from 'react';
import { ITEMS, withUnit } from '../game/data';
import type { BeltItem } from '../game/types';
import { fmt } from '../format';
import type { ProjectSummary as Summary } from '../sim/project';
import { itemColor } from './nodes';

const name = (item: BeltItem) => (item === 'mixed' ? 'Misturado' : item ? ITEMS[item].name : 'Nada');

function Item({ item, rate }: { item: BeltItem; rate: number }) {
  return (
    <span className="sum-item">
      <span className="dot" style={{ background: itemColor(item) }} />
      {name(item)} <b>{withUnit(fmt(rate), item)}</b>
    </span>
  );
}

/** Energia em MW: "consumo" ou "consumo / geração" (vermelho se faltar) */
function Power({ consumption, generation, generators }: { consumption: number; generation: number; generators: number }) {
  if (!generators) return <>{fmt(consumption)} MW</>;
  const short = consumption > generation + 1e-6;
  return (
    <span className={short ? 'bad' : 'good'}>
      {fmt(consumption)} / {fmt(generation)} MW
    </span>
  );
}

/** Resumo do projeto: por fábrica e no total */
export function ProjectSummary({ summary, active, onOpen, onClose }: { summary: Summary; active: string; onOpen: (id: string) => void; onClose: () => void }) {
  const { total } = summary;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const sunkAny = total.production.some((p) => p.sunk);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal summary" role="dialog" aria-label="Resumo do projeto">
        <header className="modal-head">
          <h2>📊 Resumo do projeto</h2>
          <button className="modal-x" onClick={onClose} title="Fechar (Esc)">
            ✕
          </button>
        </header>
        <div className="modal-body summary-body">
          <div className="summary-chips">
            <span className="chip" title="Consumo / geração somados de todas as fábricas">
              ⚡ <Power {...total} />
            </span>
            <span className="chip">🏭 {total.machines} máquinas</span>
            <span className="chip">{summary.factories.length} fábricas</span>
            {total.points > 0 && <span className="chip">♻️ {fmt(total.points)} pontos/min</span>}
            <span className={`chip ${total.errors ? 'err' : ''}`}>⛔ {total.errors}</span>
            <span className={`chip ${total.warnings ? 'warn' : ''}`}>⚠️ {total.warnings}</span>
          </div>

          <table className="summary-table">
            <thead>
              <tr>
                <th>Fábrica</th>
                <th title="Consumo (/ geração, se tiver geradores)">Energia</th>
                <th>Máquinas</th>
                <th>Importa</th>
                <th>Exporta</th>
                <th title="AWESOME Sink">Pontos/min</th>
              </tr>
            </thead>
            <tbody>
              {summary.factories.map((f) => (
                <tr key={f.id} className={f.id === active ? 'current' : ''} data-factory={f.id}>
                  <td>
                    <button className="link-btn" onClick={() => onOpen(f.id)} title="Abrir essa fábrica">
                      {f.name}
                    </button>
                    {(f.errors > 0 || f.warnings > 0) && (
                      <small className={f.errors ? 'bad' : 'warn-text'}>
                        {' '}
                        {f.errors ? `⛔ ${f.errors}` : ''} {f.warnings ? `⚠️ ${f.warnings}` : ''}
                      </small>
                    )}
                  </td>
                  <td>
                    <Power {...f} />
                  </td>
                  <td>{f.machines}</td>
                  <td>
                    {f.imports.length ? (
                      f.imports.map((t) => (
                        <div key={t.node}>
                          <Item item={t.item} rate={t.rate} /> <small className="muted">← {t.from}</small>
                        </div>
                      ))
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {f.exports.length ? (
                      f.exports.map((t) => (
                        <div key={t.node}>
                          <Item item={t.item} rate={t.rate} /> <small className={t.to.length ? 'muted' : 'warn-text'}>→ {t.to.length ? t.to.join(', ') : 'ninguém'}</small>
                        </div>
                      ))
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{f.points ? fmt(f.points) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="summary-cols">
            <section>
              <h3>Produção final do projeto</h3>
              {total.production.length === 0 ? (
                <p className="muted">Nada sendo produzido ainda.</p>
              ) : (
                <table className="prod">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th title="Chegando em armazéns">Armazém</th>
                      <th title="Saídas de máquinas sem esteira">Livre</th>
                      {sunkAny && <th title="Destruído em AWESOME Sinks">Sink</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {total.production.map((p) => (
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
            <section>
              <h3>Vem de fora do projeto</h3>
              {total.fromOutside.length ? (
                total.fromOutside.map((t) => (
                  <div key={String(t.item)}>
                    <Item {...t} />
                  </div>
                ))
              ) : (
                <p className="muted">Nada: tudo é produzido dentro do projeto.</p>
              )}
              <h3>Exportado sem destino</h3>
              {total.unclaimed.length ? (
                total.unclaimed.map((t) => (
                  <div key={String(t.item)}>
                    <Item {...t} />
                  </div>
                ))
              ) : (
                <p className="muted">Nada: toda Saída externa tem uma entrada ligada.</p>
              )}
            </section>
          </div>
          <p className="muted summary-note">
            Energia somada como se todas as fábricas estivessem na mesma rede. Itens que passam de uma fábrica pra outra (Saída → Entrada externa) não contam
            como produção final.
          </p>
        </div>
      </div>
    </div>
  );
}
