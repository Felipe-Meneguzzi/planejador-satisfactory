import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BELTS, BELT_TIERS, ITEMS, MACHINES, MINER_TIERS, PURITIES, RECIPES } from '../game/data';
import type { BeltTier, ItemId, MinerTier, Purity } from '../game/types';
import { fmt } from '../format';
import { MINE, PLANNABLE_ITEMS, choiceOf, defaultOre, isResource, planLine, recipesProducing, type OreSetting, type Plan } from '../planner/plan';
import type { DistributionMode } from '../planner/layout';
import { itemColor } from './nodes';

interface PlannerSettings {
  item: ItemId;
  rate: number;
  choices: Record<ItemId, string>;
  ores: Record<ItemId, OreSetting>;
  maxClock: number;
  maxBelt: BeltTier;
  mode: DistributionMode;
}

const KEY = 'satisplanner:planner';
const DEFAULTS: PlannerSettings = { item: 'iron-plate', rate: 30, choices: {}, ores: {}, maxClock: 100, maxBelt: 3, mode: 'manifold' };

/** Preferências da janela (só conveniência; se o storage falhar, usa o padrão) */
function loadSettings(): PlannerSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) } as PlannerSettings;
      if (ITEMS[s.item]) return s;
    }
  } catch {
    /* sem storage */
  }
  return DEFAULTS;
}

const pct = (v: number) => `${fmt(Number(v.toFixed(4)))}%`;

export function PlannerModal(props: { onClose: () => void; onGenerate: (plan: Plan, mode: DistributionMode, maxBelt: BeltTier) => void }) {
  const [st, setSt] = useState<PlannerSettings>(loadSettings);
  const [itemText, setItemText] = useState(ITEMS[st.item]?.name ?? '');
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());
  const set = (patch: Partial<PlannerSettings>) => setSt((s) => ({ ...s, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch {
      /* sem storage */
    }
  }, [st]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const plan = useMemo(() => planLine(st), [st]);
  const groupsByItem = useMemo(() => {
    const m = new Map<ItemId, Plan['groups']>();
    for (const g of plan.groups) m.set(g.item, [...(m.get(g.item) ?? []), g]);
    return m;
  }, [plan]);

  const nameToItem = useMemo(() => new Map(PLANNABLE_ITEMS.map((id) => [ITEMS[id].name.toLowerCase(), id])), []);
  const machineCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of plan.groups) {
      const k = g.kind === 'miner' ? `Mineradora ${MINER_TIERS[g.ore!.tier].name}` : MACHINES[g.machine!].name;
      m.set(k, (m.get(k) ?? 0) + g.count);
    }
    return [...m.entries()];
  }, [plan]);
  const ores = useMemo(() => [...new Set(plan.groups.filter((g) => g.kind === 'miner').map((g) => g.item))], [plan]);
  const beltMax = useMemo(() => {
    const flows = plan.groups.flatMap((g) => [g.demand, ...g.inputLanes.flat().map((l) => l.demand)]);
    const top = Math.max(0, ...flows);
    return BELT_TIERS.find((t) => BELTS[t].rate >= top - 1e-6);
  }, [plan]);
  const lines = plan.sinks.length;

  /* ---------- árvore ---------- */

  const row = (item: ItemId, rate: number, depth: number, path: string): ReactNode => {
    const choice = choiceOf(item, st.choices);
    const recipe = choice && choice !== MINE ? RECIPES[choice] : undefined;
    const options = recipesProducing(item);
    const groups = groupsByItem.get(item) ?? [];
    const external = !choice;
    const looped = path.split('/').slice(0, -1).some((seg) => seg.split(':').pop() === item);
    const children = recipe && !looped ? recipe.inputs.map((inp) => ({ item: inp.item, rate: (rate * inp.rate) / recipe.outputs[0].rate })) : [];
    const closed = collapsedRows.has(path);
    const total = groups.reduce((a, g) => a + g.count, 0);
    return (
      <Fragment key={path}>
        <div className={`tree-row ${external ? 'external' : ''}`} style={{ paddingLeft: 8 + depth * 18 }}>
          <button
            className="tree-toggle"
            disabled={!children.length}
            onClick={() =>
              setCollapsedRows((s) => {
                const n = new Set(s);
                if (n.has(path)) n.delete(path);
                else n.add(path);
                return n;
              })
            }
          >
            {children.length ? (closed ? '▸' : '▾') : '·'}
          </button>
          <span className="dot" style={{ background: itemColor(item) }} />
          <span className="tree-item">{ITEMS[item].name}</span>
          <span className="tree-rate">{fmt(rate)}/min</span>
          {external ? (
            <span className="tree-ext">⚠ fornecer de fora</span>
          ) : (
            <select value={choice} onChange={(e) => set({ choices: { ...st.choices, [item]: e.target.value } })}>
              {isResource(item) && <option value={MINE}>⛏ Minerar</option>}
              {options.some((r) => !r.alternate) && (
                <optgroup label="Padrão">
                  {options.filter((r) => !r.alternate).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {MACHINES[r.machine].name}
                    </option>
                  ))}
                </optgroup>
              )}
              {options.some((r) => r.alternate) && (
                <optgroup label="Alternativas">
                  {options.filter((r) => r.alternate).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name.replace(/^Alternate: /, '')} · {MACHINES[r.machine].name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          {groups.length > 0 && (
            <span className="tree-machines" title={groups.map((g) => `${g.count}× @ ${pct(g.clock)}`).join(' + ')}>
              {groups.length > 1 ? `${groups.length} linhas · ` : ''}
              {/* item compartilhado por vários ramos: o grupo é um só, então mostra o total */}
              {Math.abs(groups.reduce((a, g) => a + g.demand, 0) - rate) > 1e-6 ? 'total ' : ''}
              {total}× @ {groups.length > 1 && groups.some((g) => Math.abs(g.clock - groups[0].clock) > 1e-6) ? groups.map((g) => pct(g.clock)).join(' / ') : pct(groups[0].clock)}
            </span>
          )}
        </div>
        {!closed && children.map((c, i) => row(c.item, c.rate, depth + 1, `${path}/${i}:${c.item}`))}
      </Fragment>
    );
  };

  const ore = (item: ItemId) => st.ores[item] ?? defaultOre();
  const setOre = (item: ItemId, patch: Partial<OreSetting>) => set({ ores: { ...st.ores, [item]: { ...ore(item), ...patch } } });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal planner" role="dialog" aria-label="Gerar linha de produção">
        <header className="modal-head">
          <h2>🏭 Gerar linha de produção</h2>
          <button className="modal-x" onClick={props.onClose} title="Fechar (Esc)">
            ✕
          </button>
        </header>

        <div className="planner-top">
          <label className="pl-field grow">
            <span>Produto</span>
            <input
              list="planner-items"
              value={itemText}
              placeholder="Buscar item…"
              onChange={(e) => {
                setItemText(e.target.value);
                const id = nameToItem.get(e.target.value.trim().toLowerCase());
                if (id) set({ item: id });
              }}
            />
            <datalist id="planner-items">
              {PLANNABLE_ITEMS.map((id) => (
                <option key={id} value={ITEMS[id].name} />
              ))}
            </datalist>
          </label>
          <label className="pl-field">
            <span>Quantidade</span>
            <span className="pl-inline">
              <input type="number" min={0} step="any" value={st.rate} onChange={(e) => set({ rate: Number(e.target.value) })} />
              /min
            </span>
          </label>
          <label className="pl-field">
            <span>Clock máximo</span>
            <select value={st.maxClock} onChange={(e) => set({ maxClock: Number(e.target.value) })}>
              <option value={100}>100% (sem shards)</option>
              <option value={150}>150% (1 shard)</option>
              <option value={200}>200% (2 shards)</option>
              <option value={250}>250% (3 shards)</option>
            </select>
          </label>
          <label className="pl-field">
            <span>Esteira máx. liberada</span>
            <select value={st.maxBelt} onChange={(e) => set({ maxBelt: Number(e.target.value) as BeltTier })}>
              {BELT_TIERS.map((t) => (
                <option key={t} value={t}>
                  {BELTS[t].name} ({BELTS[t].rate}/min)
                </option>
              ))}
            </select>
          </label>
          <div className="pl-field">
            <span>Distribuição</span>
            <div className="seg">
              <button className={st.mode === 'manifold' ? 'active' : ''} onClick={() => set({ mode: 'manifold' })} title="Esteira passa ao lado das máquinas com um divisor em frente a cada uma">
                Manifold
              </button>
              <button className={st.mode === 'tree' ? 'active' : ''} onClick={() => set({ mode: 'tree' })} title="Divisores em cascata que repartem igual desde o começo">
                Árvore
              </button>
            </div>
          </div>
        </div>

        <div className="planner-body">
          <section className="planner-tree">
            <h3>Receitas</h3>
            <div className="tree">
              {ITEMS[st.item] && row(st.item, st.rate || 0, 0, st.item)}
            </div>
          </section>

          <aside className="planner-side">
            {plan.error ? (
              <p className="pl-error">⛔ {plan.error}</p>
            ) : (
              <>
                <h3>Resumo</h3>
                <table className="prod">
                  <tbody>
                    {machineCounts.map(([k, v]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td>{v}×</td>
                      </tr>
                    ))}
                    <tr>
                      <td>Energia</td>
                      <td>⚡ {fmt(plan.power)} MW</td>
                    </tr>
                    <tr>
                      <td>Power Shards</td>
                      <td>◆ {plan.shards}</td>
                    </tr>
                    <tr>
                      <td>Maior esteira usada</td>
                      <td>{beltMax ? BELTS[beltMax].name : '—'}</td>
                    </tr>
                    {lines > 1 && (
                      <tr>
                        <td>Linhas paralelas</td>
                        <td>{lines} armazéns</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {ores.length > 0 && (
                  <>
                    <h3>Minério</h3>
                    {ores.map((item) => {
                      const gs = groupsByItem.get(item) ?? [];
                      return (
                        <div key={item} className="ore-row">
                          <div className="ore-name">
                            <span className="dot" style={{ background: itemColor(item) }} />
                            {ITEMS[item].name}
                            <small>{fmt(gs.reduce((a, g) => a + g.demand, 0))}/min</small>
                          </div>
                          <div className="seg">
                            {(Object.keys(PURITIES) as Purity[]).map((p) => (
                              <button key={p} className={ore(item).purity === p ? 'active' : ''} onClick={() => setOre(item, { purity: p })}>
                                {PURITIES[p].name}
                              </button>
                            ))}
                          </div>
                          <div className="seg">
                            {([1, 2, 3] as MinerTier[]).map((t) => (
                              <button key={t} className={ore(item).tier === t ? 'active' : ''} onClick={() => setOre(item, { tier: t })}>
                                {MINER_TIERS[t].name}
                              </button>
                            ))}
                          </div>
                          <small className="muted">
                            {gs.reduce((a, g) => a + g.count, 0)} mineradora(s) @ {gs.map((g) => pct(g.clock)).join(' / ')}
                          </small>
                        </div>
                      );
                    })}
                  </>
                )}

                {plan.external.length > 0 && (
                  <>
                    <h3>Fornecer de fora</h3>
                    {plan.external.map((e) => (
                      <p key={e.item} className="pl-warn">
                        ⚠ {ITEMS[e.item].name}: {fmt(e.demand)}/min — não dá pra produzir aqui (fluido ou coletável); a entrada fica aberta pra você ligar.
                      </p>
                    ))}
                  </>
                )}
              </>
            )}
          </aside>
        </div>

        <footer className="modal-foot">
          <span className="muted">Todas as máquinas de cada etapa ficam no mesmo clock. A linha entra minimizada e selecionada; Ctrl+Z desfaz.</span>
          <button onClick={props.onClose}>Cancelar</button>
          <button className="primary" disabled={!!plan.error || !plan.groups.length} onClick={() => props.onGenerate(plan, st.mode, st.maxBelt)}>
            Gerar ▶
          </button>
        </footer>
      </div>
    </div>
  );
}
