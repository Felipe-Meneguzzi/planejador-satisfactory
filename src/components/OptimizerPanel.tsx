import { useMemo, useState } from 'react';
import { ALL_RECIPES, ITEMS, MACHINES, withUnit } from '../game/data';
import type { ItemId } from '../game/types';
import { fmt } from '../format';
import { EXTERNAL_WEIGHT, type Objective, type Optimized, type RecipePolicy } from '../planner/optimize';
import { isResource, type Plan } from '../planner/plan';
import { itemColor } from './nodes';

/** Configuração do modo Otimizado (fica junto das preferências da janela) */
export interface OptimizerSettings {
  goal: 'target' | 'maximize';
  objective: Objective;
  policy: RecipePolicy;
  alternates: string[];
  weights: Record<ItemId, number>;
  available: Record<ItemId, number>;
  unlimitedWater: boolean;
}

export const OPTIMIZER_DEFAULTS: OptimizerSettings = {
  goal: 'target',
  objective: 'resources',
  policy: 'standard',
  alternates: [],
  weights: {},
  available: {},
  unlimitedWater: true,
};

/** recursos brutos: minérios, água, petróleo e gás de poço */
export const RAW_RESOURCES: ItemId[] = Object.keys(ITEMS)
  .filter(isResource)
  .sort((a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name));
const ALTERNATES = ALL_RECIPES.filter((r) => r.alternate);
const altName = (name: string) => name.replace(/^Alternate: /, '');

const Dot = ({ item }: { item: ItemId }) => <span className="dot" style={{ background: itemColor(item) }} />;

/* ---------- coluna da esquerda: o que otimizar ---------- */

export function OptimizerSettingsPanel(props: { value: OptimizerSettings; onChange: (patch: Partial<OptimizerSettings>) => void }) {
  const st = props.value;
  const [search, setSearch] = useState('');
  const chosen = useMemo(() => new Set(st.alternates), [st.alternates]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ALTERNATES;
    return ALTERNATES.filter((r) => [r.name, MACHINES[r.machine].name, ...r.outputs.map((o) => ITEMS[o.item].name)].some((t) => t.toLowerCase().includes(q)));
  }, [search]);
  const setAll = (on: boolean) => {
    const ids = new Set(st.alternates);
    for (const r of shown) {
      if (on) ids.add(r.id);
      else ids.delete(r.id);
    }
    props.onChange({ alternates: [...ids] });
  };

  return (
    <div className="opt-settings">
      <h3>Objetivo</h3>
      <div className="seg" role="group" aria-label="Objetivo">
        {(
          [
            ['resources', 'Menos recursos', 'Soma dos recursos brutos (minério, água, petróleo...) com os pesos abaixo'],
            ['machines', 'Menos máquinas', 'Máquinas + extratores no clock máximo (conta contínua, sem arredondar)'],
            ['power', 'Menos energia', 'MW das máquinas e extratores no clock máximo'],
          ] as [Objective, string, string][]
        ).map(([k, label, title]) => (
          <button key={k} className={st.objective === k ? 'active' : ''} title={title} onClick={() => props.onChange({ objective: k })}>
            {label}
          </button>
        ))}
      </div>

      <h3>Quanto produzir</h3>
      <div className="seg" role="group" aria-label="Quanto produzir">
        <button className={st.goal === 'target' ? 'active' : ''} onClick={() => props.onChange({ goal: 'target' })}>
          A quantidade pedida
        </button>
        <button className={st.goal === 'maximize' ? 'active' : ''} onClick={() => props.onChange({ goal: 'maximize' })}>
          Maximizar com o que eu tenho
        </button>
      </div>
      {st.goal === 'maximize' && (
        <div className="opt-grid" aria-label="Recursos disponíveis">
          <p className="muted opt-hint">Quanto você tem de cada recurso por minuto (vazio = nada). O otimizador acha a maior produção possível.</p>
          {RAW_RESOURCES.map((item) => {
            const water = item === 'water' && st.unlimitedWater;
            return (
              <label key={item} className="opt-row">
                <Dot item={item} />
                <span>{ITEMS[item].name}</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  aria-label={`${ITEMS[item].name} disponível`}
                  disabled={water}
                  placeholder={water ? '∞' : '0'}
                  value={water ? '' : (st.available[item] ?? '')}
                  onChange={(e) => {
                    const v = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value));
                    const next = { ...st.available };
                    if (v === undefined || !Number.isFinite(v)) delete next[item];
                    else next[item] = v;
                    props.onChange({ available: next });
                  }}
                />
              </label>
            );
          })}
          <label className="opt-check">
            <input type="checkbox" checked={st.unlimitedWater} onChange={(e) => props.onChange({ unlimitedWater: e.target.checked })} />
            Água à vontade
          </label>
        </div>
      )}

      <h3>Receitas permitidas</h3>
      <div className="seg" role="group" aria-label="Receitas permitidas">
        {(
          [
            ['standard', 'Só padrão'],
            ['selected', 'Padrão + alternativas escolhidas'],
            ['all', 'Todas'],
          ] as [RecipePolicy, string][]
        ).map(([k, label]) => (
          <button key={k} className={st.policy === k ? 'active' : ''} onClick={() => props.onChange({ policy: k })}>
            {label}
          </button>
        ))}
      </div>
      {st.policy === 'selected' && (
        <div className="opt-alts">
          <div className="opt-alts-bar">
            <input placeholder="Buscar alternativa, máquina ou item…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button onClick={() => setAll(true)}>Marcar todas{search ? ` (${shown.length})` : ''}</button>
            <button onClick={() => setAll(false)}>Desmarcar</button>
          </div>
          <small className="muted">
            {chosen.size} de {ALTERNATES.length} alternativas liberadas
          </small>
          <div className="opt-list" role="list">
            {shown.map((r) => (
              <label key={r.id} className="opt-alt" role="listitem">
                <input
                  type="checkbox"
                  checked={chosen.has(r.id)}
                  onChange={(e) => props.onChange({ alternates: e.target.checked ? [...st.alternates, r.id] : st.alternates.filter((x) => x !== r.id) })}
                />
                <Dot item={r.outputs[0].item} />
                <span className="opt-alt-name">{altName(r.name)}</span>
                <small className="muted">{MACHINES[r.machine].name}</small>
              </label>
            ))}
            {!shown.length && <p className="muted">Nenhuma alternativa com esse nome.</p>}
          </div>
        </div>
      )}

      {st.objective === 'resources' && (
        <details className="opt-weights">
          <summary>Pesos dos recursos</summary>
          <p className="muted opt-hint">
            O objetivo é a soma de (quantidade × peso). Todos começam com peso 1: os dados do wiki não trazem quanto de cada minério existe no mapa (só
            os poços de recurso), então nada é favorecido sem você pedir. Aumente o peso do que é escasso pra você (ex.: SAM, Uranium) e diminua o da
            água. Coletáveis que vêm de fora pesam {fmt(EXTERNAL_WEIGHT)}: só entram quando não há outro jeito.
          </p>
          <div className="opt-grid">
            {RAW_RESOURCES.map((item) => (
              <label key={item} className="opt-row">
                <Dot item={item} />
                <span>{ITEMS[item].name}</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  aria-label={`Peso de ${ITEMS[item].name}`}
                  value={st.weights[item] ?? 1}
                  onChange={(e) => props.onChange({ weights: { ...st.weights, [item]: Math.max(0, Number(e.target.value) || 0) } })}
                />
              </label>
            ))}
          </div>
          <button onClick={() => props.onChange({ weights: {} })}>Voltar todos pra 1</button>
        </details>
      )}
    </div>
  );
}

/* ---------- coluna da direita: o que o otimizador escolheu ---------- */

/** Totais de um plano (o desenhado: máquinas inteiras) pra comparar manual × otimizado */
export function planTotals(plan: Plan) {
  const resources = new Map<ItemId, number>();
  let machines = 0;
  for (const g of plan.groups) {
    machines += g.count + (g.kind === 'well' ? g.wells!.length : 0);
    if (g.kind !== 'machine') resources.set(g.item, (resources.get(g.item) ?? 0) + g.demand);
  }
  for (const e of plan.external) resources.set(e.item, (resources.get(e.item) ?? 0) + e.demand);
  return { resources, raw: [...resources.values()].reduce((a, b) => a + b, 0), machines, power: plan.power };
}

const delta = (manual: number, optimized: number, unit: string) => {
  const d = manual - optimized;
  if (Math.abs(d) < 1e-6) return <span className="muted">igual</span>;
  return <span className={d > 0 ? 'gain' : 'loss'}>{d > 0 ? `−${fmt(d)}${unit}` : `+${fmt(-d)}${unit}`}</span>;
};

export function OptimizerResults(props: { opt: Optimized; plan: Plan; manual?: Plan; item: ItemId; goal: 'target' | 'maximize'; maxClock: number }) {
  const { opt, plan, manual } = props;
  const mine = planTotals(plan);
  const theirs = manual && !manual.error ? planTotals(manual) : undefined;
  const allResources = [...new Set([...mine.resources.keys(), ...(theirs?.resources.keys() ?? [])])].sort((a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name));
  const recipes = [...opt.recipes].sort((a, b) => (props.plan.levels[a.recipe.outputs[0].item] ?? 0) - (props.plan.levels[b.recipe.outputs[0].item] ?? 0));

  return (
    <div className="opt-results">
      {props.goal === 'maximize' && (
        <p className="opt-max">
          Máximo: <b>{withUnit(fmt(opt.rate), props.item)}</b> de {ITEMS[props.item].name}
        </p>
      )}

      <h3>Receitas escolhidas</h3>
      <table className="prod opt-recipes">
        <thead>
          <tr>
            <th>Receita</th>
            <th>Taxa</th>
            <th title={`Máquinas equivalentes no clock máximo (${props.maxClock}%), sem arredondar`}>Máq.</th>
          </tr>
        </thead>
        <tbody>
          {recipes.map(({ recipe, machines }) => (
            <tr key={recipe.id}>
              <td>
                <Dot item={recipe.outputs[0].item} />
                {recipe.alternate ? <span title="Alternativa">★ </span> : null}
                {altName(recipe.name)}
                <small className="muted"> · {MACHINES[recipe.machine].name}</small>
              </td>
              <td>{withUnit(fmt(recipe.outputs[0].rate * machines), recipe.outputs[0].item)}</td>
              <td>{fmt(machines / (props.maxClock / 100))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Recursos usados</h3>
      <table className="prod">
        <tbody>
          {Object.entries(opt.extraction).map(([item, v]) => (
            <tr key={item}>
              <td>
                <Dot item={item} />
                {ITEMS[item].name}
                {opt.overflow[item] ? <small className="muted" title="Uma máquina no clock mínimo já tira mais que o necessário: a diferença vai pra um armazém"> (mín. de 1 máquina)</small> : null}
              </td>
              <td>{withUnit(fmt(v), item)}</td>
            </tr>
          ))}
          {Object.entries(opt.external).map(([item, v]) => (
            <tr key={item}>
              <td>
                <Dot item={item} />
                {ITEMS[item].name} <small className="muted">(de fora)</small>
              </td>
              <td>{withUnit(fmt(v), item)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {opt.byproducts.length > 0 && (
        <>
          <h3>Subprodutos</h3>
          <table className="prod opt-by">
            <thead>
              <tr>
                <th>Item</th>
                <th>Reaproveitado</th>
                <th>Armazém</th>
              </tr>
            </thead>
            <tbody>
              {opt.byproducts.map((b) => (
                <tr key={b.item}>
                  <td>
                    <Dot item={b.item} />
                    {ITEMS[b.item].name}
                  </td>
                  <td className={b.reused > 1e-6 ? 'gain' : 'muted'}>{withUnit(fmt(b.reused), b.item)}</td>
                  <td>{withUnit(fmt(b.stored), b.item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {theirs && (
        <>
          <h3>Comparação com o plano manual</h3>
          <table className="prod opt-cmp" aria-label="Comparação com o plano manual">
            <thead>
              <tr>
                <th />
                <th>Manual</th>
                <th>Otimizado</th>
                <th>Economia</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Recursos (soma/min)</td>
                <td>{fmt(theirs.raw)}</td>
                <td>{fmt(mine.raw)}</td>
                <td>{delta(theirs.raw, mine.raw, '')}</td>
              </tr>
              {allResources.map((item) => (
                <tr key={item} className="opt-sub">
                  <td>
                    <Dot item={item} />
                    {ITEMS[item].name}
                  </td>
                  <td>{fmt(theirs.resources.get(item) ?? 0)}</td>
                  <td>{fmt(mine.resources.get(item) ?? 0)}</td>
                  <td>{delta(theirs.resources.get(item) ?? 0, mine.resources.get(item) ?? 0, '')}</td>
                </tr>
              ))}
              <tr>
                <td>Máquinas</td>
                <td>{theirs.machines}</td>
                <td>{mine.machines}</td>
                <td>{delta(theirs.machines, mine.machines, '')}</td>
              </tr>
              <tr>
                <td>Energia</td>
                <td>{fmt(theirs.power)} MW</td>
                <td>{fmt(mine.power)} MW</td>
                <td>{delta(theirs.power, mine.power, ' MW')}</td>
              </tr>
            </tbody>
          </table>
          <small className="muted">Manual = as receitas da aba "Eu escolho as receitas" na mesma quantidade; as duas contam as máquinas inteiras da linha desenhada.</small>
        </>
      )}
      {opt.dropped.length > 0 && (
        <p className="pl-note muted">
          Fora da conta por formarem laço que não dá partida sozinho: {[...new Set(opt.dropped)].length} receita(s).
        </p>
      )}
    </div>
  );
}
