import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ALL_RECIPES, ITEMS, MACHINES, RECIPES, withUnit } from '../game/data';
import { fmt } from '../format';
import { CLOCK_MAX, CLOCK_MIN } from '../sim/simulate';
import { computeSheet, isIdle, type Sheet, type SheetInput, type SheetRow } from '../sheet/balance';
import { emptySheet, exportFileName, exportText, loadSheets, newId, newInput, newRow, parseImport, saveSheets, type SheetsState } from '../sheet/storage';
import { itemColor } from './nodes';

const recipeLabel = (id: string) => {
  const r = RECIPES[id];
  return r ? `${r.name} · ${MACHINES[r.machine].name}` : '';
};
const recipeByLabel = new Map(ALL_RECIPES.map((r) => [recipeLabel(r.id).toLowerCase(), r.id]));
const itemByName = new Map(Object.entries(ITEMS).map(([id, i]) => [i.name.toLowerCase(), id]));
const ITEM_IDS = Object.keys(ITEMS);

/** Campo com busca (datalist) que só aceita quando o texto bate com um nome de verdade */
function Pick({ value, label, lookup, list, placeholder, onPick }: { value: string; label: (id: string) => string; lookup: Map<string, string>; list: string; placeholder: string; onPick: (id: string) => void }) {
  const [text, setText] = useState(label(value));
  useEffect(() => setText(label(value)), [value, label]);
  return (
    <input
      list={list}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const id = lookup.get(e.target.value.trim().toLowerCase());
        if (id) onPick(id);
      }}
      onBlur={() => setText(label(value))}
    />
  );
}

const itemLabel = (id: string) => ITEMS[id]?.name ?? '';

function Num({ value, onChange, min = 0, max, step = 1, title }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number | 'any'; title?: string }) {
  return <input className="sh-num" type="number" min={min} max={max} step={step} value={value} title={title} onChange={(e) => onChange(Number(e.target.value))} />;
}

export function SheetModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<SheetsState>(loadSheets);
  const sheet = state.sheets.find((s) => s.id === state.active) ?? state.sheets[0];

  useEffect(() => saveSheets(state), [state]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target instanceof HTMLInputElement && e.target.list) && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patchSheet = (patch: Partial<Sheet>) => setState((st) => ({ ...st, sheets: st.sheets.map((s) => (s.id === st.active ? { ...s, ...patch } : s)) }));
  const patchInput = (id: string, patch: Partial<SheetInput>) => patchSheet({ inputs: sheet.inputs.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const patchRow = (id: string, patch: Partial<SheetRow>) => patchSheet({ rows: sheet.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const addSheet = () => {
    const s = emptySheet(`Fábrica ${state.sheets.length + 1}`);
    setState((st) => ({ sheets: [...st.sheets, s], active: s.id }));
  };
  const duplicate = () => {
    const copy: Sheet = { ...sheet, id: newId(), name: `${sheet.name} (cópia)`, inputs: sheet.inputs.map((i) => ({ ...i, id: newId() })), rows: sheet.rows.map((r) => ({ ...r, id: newId() })) };
    setState((st) => ({ sheets: [...st.sheets, copy], active: copy.id }));
  };
  const remove = () => {
    if (!confirm(`Apagar a planilha "${sheet.name}"?`)) return;
    setState((st) => {
      const sheets = st.sheets.filter((s) => s.id !== st.active);
      return sheets.length ? { sheets, active: sheets[0].id } : { sheets: [emptySheet()], active: '' };
    });
  };
  useEffect(() => {
    // depois de apagar a última, aponta pra planilha vazia criada
    if (!state.sheets.some((s) => s.id === state.active)) setState((st) => ({ ...st, active: st.sheets[0].id }));
  }, [state]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const download = (sheets: Sheet[], fileName: string) => {
    const url = URL.createObjectURL(new Blob([exportText(sheets)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
    a.click();
    URL.revokeObjectURL(url);
  };
  // importar só acrescenta: as planilhas que você já tem não são tocadas
  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const r = parseImport(await file.text(), state.sheets.map((s) => s.name));
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setState((st) => ({ sheets: [...st.sheets, ...r.sheets], active: r.sheets[0].id }));
    setMsg({ ok: true, text: `${r.sheets.length} planilha(s) adicionada(s)${r.blank ? `; ${r.blank} item(ns)/receita(s) desconhecidos ficaram em branco` : ''}. As que você já tinha continuam como estavam.` });
  };

  const result = useMemo(() => computeSheet(sheet), [sheet]);
  const shown = result.items.filter((b) => !isIdle(b)).sort((a, b) => Number(b.balance < 0) - Number(a.balance < 0) || ITEMS[a.item].name.localeCompare(ITEMS[b.item].name));
  const lacking = shown.filter((b) => b.balance < 0).length;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sheet" role="dialog" aria-label="Planilha de fábrica">
        <header className="modal-head">
          <h2>📋 Planilha de fábrica</h2>
          <button className="modal-x" onClick={onClose} title="Fechar (Esc)">
            ✕
          </button>
        </header>

        <div className="sh-bar">
          <select value={sheet.id} onChange={(e) => setState((st) => ({ ...st, active: e.target.value }))} aria-label="Planilha">
            {state.sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input className="sh-name" value={sheet.name} onChange={(e) => patchSheet({ name: e.target.value })} aria-label="Nome da planilha" />
          <button onClick={addSheet} title="Nova planilha">
            ＋ Nova
          </button>
          <button onClick={duplicate}>⧉ Duplicar</button>
          <button onClick={remove}>🗑 Apagar</button>
          <button onClick={() => download([sheet], exportFileName(sheet.name))} title="Baixar esta planilha como arquivo">
            ⬇ Exportar esta
          </button>
          <button onClick={() => download(state.sheets, exportFileName('todas'))} title="Baixar todas as planilhas num arquivo só (backup)">
            ⬇ Exportar todas
          </button>
          <button onClick={() => fileRef.current?.click()} title="Adiciona as planilhas do arquivo; não substitui nem apaga as que você já tem">
            ⬆ Importar
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
          <span className="sh-chips">
            <span className="chip">🏭 {result.machines} máquinas</span>
            <span className="chip">⚡ {fmt(result.power)} MW</span>
            <span className={`chip ${lacking ? 'err' : ''}`}>{lacking ? `⛔ ${lacking} item(ns) faltando` : '✔ nada faltando'}</span>
          </span>
        </div>

        {msg && (
          <div className={`sh-msg ${msg.ok ? 'good' : 'bad'}`} onClick={() => setMsg(null)} title="Clique pra fechar">
            {msg.text}
          </div>
        )}

        <div className="modal-body sh-body">
          <div className="sh-left">
            <section>
              <h3>Entrada de recursos</h3>
              <table className="sh-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Por minuto</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sheet.inputs.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Pick value={i.item} label={itemLabel} lookup={itemByName} list="sh-items" placeholder="Item…" onPick={(item) => patchInput(i.id, { item })} />
                      </td>
                      <td>
                        <Num value={i.rate} step="any" onChange={(rate) => patchInput(i.id, { rate })} title="Itens por minuto (m³/min se for fluido)" />
                      </td>
                      <td>
                        <button className="sh-x" onClick={() => patchSheet({ inputs: sheet.inputs.filter((x) => x.id !== i.id) })} title="Remover">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => patchSheet({ inputs: [...sheet.inputs, newInput()] })}>＋ Entrada</button>
            </section>

            <section>
              <h3>Receitas e máquinas</h3>
              <table className="sh-table">
                <thead>
                  <tr>
                    <th>Receita</th>
                    <th title="Quantidade de máquinas">Máq.</th>
                    <th title="Clock de todas as máquinas da linha">Clock %</th>
                    <th title="Somersloops por máquina">Sloops</th>
                    <th title="Consumo e produção da linha inteira, por minuto">Produz / consome</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row) => {
                    const r = result.rows[row.id];
                    const slots = RECIPES[row.recipe] ? MACHINES[RECIPES[row.recipe].machine].sloopSlots : 0;
                    return (
                      <tr key={row.id}>
                        <td>
                          <Pick value={row.recipe} label={recipeLabel} lookup={recipeByLabel} list="sh-recipes" placeholder="Receita…" onPick={(recipe) => patchRow(row.id, { recipe })} />
                        </td>
                        <td>
                          <Num value={row.count} onChange={(count) => patchRow(row.id, { count })} />
                        </td>
                        <td>
                          <Num value={row.clock} min={CLOCK_MIN} max={CLOCK_MAX} step="any" onChange={(clock) => patchRow(row.id, { clock })} />
                        </td>
                        <td>
                          <Num value={slots ? row.sloops : 0} max={slots} onChange={(sloops) => patchRow(row.id, { sloops })} title={slots ? `Até ${slots}` : 'Essa máquina não aceita Somersloop'} />
                        </td>
                        <td className="sh-io">
                          {r?.valid && (
                            <>
                              {r.outputs.map((p) => (
                                <span key={'o' + p.item} className="good">
                                  +{fmt(p.rate)} {ITEMS[p.item].name}
                                </span>
                              ))}
                              {r.inputs.map((p) => (
                                <span key={'i' + p.item} className="muted">
                                  −{fmt(p.rate)} {ITEMS[p.item].name}
                                </span>
                              ))}
                            </>
                          )}
                        </td>
                        <td>
                          <button className="sh-x" onClick={() => patchSheet({ rows: sheet.rows.filter((x) => x.id !== row.id) })} title="Remover">
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button onClick={() => patchSheet({ rows: [...sheet.rows, newRow()] })}>＋ Receita</button>
            </section>
          </div>

          <section className="sh-right">
            <h3>Balanço por item</h3>
            {shown.length === 0 ? (
              <p className="muted">Adicione uma entrada de recurso e uma receita pra ver o balanço.</p>
            ) : (
              <table className="sh-table sh-balance">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th title="Entrada de fora">Entra</th>
                    <th title="Soma das saídas das receitas">Produzido</th>
                    <th title="Soma das entradas das receitas">Consumido</th>
                    <th title="Entra + produzido − consumido">Sobra</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((b) => (
                    <tr key={b.item} className={b.balance < 0 ? 'short' : ''}>
                      <td>
                        <span className="dot" style={{ background: itemColor(b.item) }} /> {ITEMS[b.item].name}
                      </td>
                      <td>{b.supplied ? fmt(b.supplied) : ''}</td>
                      <td>{b.produced ? fmt(b.produced) : ''}</td>
                      <td>{b.consumed ? fmt(b.consumed) : ''}</td>
                      <td className={b.balance < 0 ? 'bad' : b.balance > 0 ? 'good' : 'muted'}>
                        <b>{b.balance < 0 ? `falta ${withUnit(fmt(-b.balance), b.item)}` : withUnit(fmt(b.balance), b.item)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted sh-note">Conta nominal: toda máquina roda cheia no clock escolhido. Item com "falta" quer dizer que as receitas pedem mais do que entra + é produzido — na prática essas máquinas rodariam mais devagar.</p>
          </section>
        </div>

        <datalist id="sh-items">
          {ITEM_IDS.map((id) => (
            <option key={id} value={ITEMS[id].name} />
          ))}
        </datalist>
        <datalist id="sh-recipes">
          {ALL_RECIPES.map((r) => (
            <option key={r.id} value={recipeLabel(r.id)} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
