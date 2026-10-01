import { useMemo, useState, type DragEvent } from 'react';
import { ALL_RECIPES, ITEMS, MACHINES, MACHINE_IDS, MINER_TIERS, PURITIES, RECIPES, RESOURCES, recipesFor } from '../game/data';
import type { FactoryData, Purity } from '../game/types';
import { fmt } from '../format';

export interface PaletteEntry {
  key: string;
  label: string;
  sub: string;
  icon: string;
  color: string;
  data: FactoryData;
}

const MINER_COLOR = '#7d5236';

const minerEntry = (purity: Purity, resource = RESOURCES[0]): PaletteEntry => ({
  key: `miner-${resource}-${purity}`,
  label: `${ITEMS[resource].name} · ${PURITIES[purity].name}`,
  sub: `Mineradora · ${fmt(MINER_TIERS[1].base * PURITIES[purity].mult)}/min (Mk.1)`,
  icon: '⛏️',
  color: MINER_COLOR,
  data: { kind: 'miner', resource, purity, tier: 1, clock: 100 },
});

/** Receita inicial ao adicionar a máquina pela paleta (a mais comum de cada uma) */
const DEFAULT_RECIPE: Record<string, string> = {
  smelter: 'iron-ingot',
  foundry: 'steel-ingot',
  constructor: 'iron-plate',
  assembler: 'reinforced-iron-plate',
  manufacturer: 'computer',
};

const machineEntries: PaletteEntry[] = MACHINE_IDS.map((id) => {
  const m = MACHINES[id];
  return {
    key: `machine-${id}`,
    label: m.name,
    sub: `${recipesFor(id).length} receitas · ${fmt(m.power)} MW`,
    icon: m.icon,
    color: m.color,
    data: { kind: 'machine', machine: id, recipe: (RECIPES[DEFAULT_RECIPE[id]] ? DEFAULT_RECIPE[id] : recipesFor(id)[0]?.id) ?? '', clock: 100 },
  };
});

const GROUPS: { title: string; entries: PaletteEntry[] }[] = [
  { title: 'Nós de recurso', entries: (['impure', 'normal', 'pure'] as Purity[]).map((p) => minerEntry(p)) },
  { title: 'Máquinas', entries: machineEntries },
  {
    title: 'Logística',
    entries: [
      { key: 'splitter', label: 'Divisor', sub: 'Splitter · 1 entrada → 3 saídas', icon: '🔀', color: '#555b66', data: { kind: 'splitter' } },
      { key: 'merger', label: 'Mesclador', sub: 'Merger · 3 entradas → 1 saída', icon: '🔁', color: '#555b66', data: { kind: 'merger' } },
    ],
  },
  { title: 'Saída', entries: [{ key: 'sink', label: 'Armazém', sub: 'Consome tudo que chega', icon: '📦', color: '#2f7a52', data: { kind: 'sink' } }] },
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Busca: receitas pelo nome ou produto, e recursos (vira mineradora daquele recurso) */
function search(q: string): PaletteEntry[] {
  const t = norm(q.trim());
  const recipes = ALL_RECIPES.filter((r) => norm(r.name).includes(t) || r.outputs.some((o) => norm(ITEMS[o.item].name).includes(t))).map(
    (r): PaletteEntry => {
      const m = MACHINES[r.machine];
      return {
        key: `recipe-${r.id}`,
        label: r.name,
        sub: `${m.name} · ${r.outputs.map((o) => `${fmt(o.rate)} ${ITEMS[o.item].name}`).join(' + ')}/min`,
        icon: m.icon,
        color: m.color,
        data: { kind: 'machine', machine: r.machine, recipe: r.id, clock: 100 },
      };
    },
  );
  const ores = RESOURCES.filter((id) => norm(ITEMS[id].name).includes(t)).map((id) => minerEntry('normal', id));
  return [...ores, ...recipes];
}

export const DND_TYPE = 'application/x-satisplanner';

export function Palette({ onAdd, version, onOpenPlanner }: { onAdd: (data: FactoryData) => void; version: string; onOpenPlanner: () => void }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => (query.trim() ? search(query) : null), [query]);

  const item = (en: PaletteEntry) => (
    <div
      key={en.key}
      className="palette-item"
      draggable
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(DND_TYPE, JSON.stringify(en.data));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onAdd(en.data)}
      title="Arraste para o canvas ou clique para adicionar"
    >
      <span className="palette-icon" style={{ background: en.color }}>
        {en.icon}
      </span>
      <span className="palette-text">
        <b>{en.label}</b>
        <small>{en.sub}</small>
      </span>
    </div>
  );

  return (
    <aside className="palette">
      <button className="planner-btn" onClick={onOpenPlanner} title="Escolha um produto e a quantidade: monta a linha inteira com 100% de eficiência">
        🏭 Gerar linha
      </button>
      <input
        className="palette-search"
        placeholder="Buscar receita, item ou minério…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      {results ? (
        <section>
          <h3>{results.length} resultado(s)</h3>
          {results.map(item)}
        </section>
      ) : (
        GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            {g.entries.map(item)}
          </section>
        ))
      )}
      <section className="help">
        <h3>Como usar</h3>
        <ul>
          <li>Arraste da paleta pro canvas (ou clique)</li>
          <li>Ligue a <b>saída</b> (direita) numa <b>entrada</b> (esquerda) pra criar uma esteira</li>
          <li>Troque o Mk da esteira no rótulo dela</li>
          <li><kbd>Del</kbd> apaga o selecionado</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz, <kbd>Ctrl</kbd>+<kbd>Y</kbd> refaz</li>
          <li><kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> copia, recorta e cola (no mouse); <kbd>Ctrl</kbd>+<kbd>D</kbd> duplica</li>
          <li><kbd>R</kbd> gira o selecionado (<kbd>Shift</kbd>+<kbd>R</kbd> ao contrário)</li>
          <li><kbd>Alt</kbd> + arrastar alinha ao grid</li>
          <li><kbd>Shift</kbd> + arrastar seleciona vários</li>
        </ul>
        <p className="version">Dados: Satisfactory {version} · satisfactory.wiki.gg</p>
      </section>
    </aside>
  );
}
