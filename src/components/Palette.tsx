import { useMemo, useState, type DragEvent } from 'react';
import { ALL_RECIPES, BELTS, BELT_TIERS, EXTRACTORS, GENERATORS, GENERATOR_IDS, ITEMS, MACHINES, MACHINE_IDS, MINER_TIERS, PIPES, PIPE_TIERS, PURITIES, RECIPES, RESOURCES, WELL, recipesFor, withUnit } from '../game/data';
import type { BeltTier, ExtractorKind, FactoryData, ItemId, PipeTier, Purity } from '../game/types';
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
  refinery: 'plastic',
  packager: 'packaged-water',
};

const machineEntries: PaletteEntry[] = MACHINE_IDS.map((id) => {
  const m = MACHINES[id];
  return {
    key: `machine-${id}`,
    label: m.name,
    sub: `${recipesFor(id).length} receitas · ${m.variablePower ? `${fmt(m.variablePower.min)}–${fmt(m.variablePower.max)}` : fmt(m.power)} MW`,
    icon: m.icon,
    color: m.color,
    data: { kind: 'machine', machine: id, recipe: (RECIPES[DEFAULT_RECIPE[id]] ? DEFAULT_RECIPE[id] : recipesFor(id)[0]?.id) ?? '', clock: 100 },
  };
});

const FLUID_COLOR = '#1f5f8b';
const extractorEntry = (extractor: ExtractorKind, resource: ItemId, label: string): PaletteEntry => {
  const info = EXTRACTORS[extractor];
  return {
    key: `extractor-${extractor}-${resource}`,
    label,
    sub: `${info.name} · ${fmt(info.rate('normal'))} m³/min${info.usesPurity ? ' (normal)' : ''}`,
    icon: extractor === 'water' ? '💧' : '🛢️',
    color: FLUID_COLOR,
    data: { kind: 'extractor', extractor, resource, purity: 'normal', clock: 100 },
  };
};
/** Poço de recurso: pressurizador com um satélite normal pra começar */
const wellEntry = (resource: ItemId, label: string): PaletteEntry => ({
  key: `well-${resource}`,
  label,
  sub: `${WELL.name} · ${fmt(WELL.power)} MW · ${fmt(WELL.rates.normal)} m³/min por satélite normal`,
  icon: '🕳️',
  color: FLUID_COLOR,
  data: { kind: 'well', resource, clock: 100, satellites: ['normal'] },
});
const fluidEntries: PaletteEntry[] = [
  extractorEntry('water', EXTRACTORS.water.resources[0], 'Água'),
  extractorEntry('oil', EXTRACTORS.oil.resources[0], 'Petróleo'),
  wellEntry(WELL.resources.find((r) => r === 'nitrogen-gas') ?? WELL.resources[0], 'Poço de recurso'),
  { key: 'pipe-split', label: 'Junção (divide)', sub: 'Pipeline Junction · 1 cano → 3', icon: '💧', color: '#3b6f99', data: { kind: 'splitter', fluid: true } },
  { key: 'pipe-merge', label: 'Junção (junta)', sub: 'Pipeline Junction · 3 canos → 1', icon: '💧', color: '#3b6f99', data: { kind: 'merger', fluid: true } },
];

/** Combustível inicial de cada gerador (o mais comum); os outros ficam no seletor do node */
const DEFAULT_FUEL: Record<string, ItemId> = {
  'biomass-burner': 'solid-biofuel',
  'coal-powered-generator': 'coal',
  'fuel-powered-generator': 'fuel',
  'nuclear-power-plant': 'uranium-fuel-rod',
};

const generatorEntry = (id: string, fuel?: ItemId): PaletteEntry => {
  const g = GENERATORS[id];
  const f = g.fuels.find((x) => x.item === (fuel ?? DEFAULT_FUEL[id])) ?? g.fuels[0];
  const sub = g.geothermal
    ? `${fmt(g.geothermal.impure.avg)}–${fmt(g.geothermal.pure.avg)} MW conforme a pureza`
    : g.boost
      ? `${fmt(g.power)} MW + ${fmt(g.boost.unfueled * 100)}–${fmt(g.boost.fueled * 100)}% na rede`
      : `${fmt(g.power)} MW · ${withUnit(fmt(f.rate), f.item)} ${ITEMS[f.item].name}${g.water ? ` + ${withUnit(fmt(g.water), 'water')} Water` : ''}`;
  return {
    key: `generator-${id}-${f?.item ?? ''}`,
    label: g.name,
    sub,
    icon: g.icon,
    color: g.color,
    data: { kind: 'generator', generator: id, ...(f ? { fuel: f.item } : {}), clock: 100, ...(g.geothermal ? { purity: 'normal' as Purity } : {}) },
  };
};
const generatorEntries = GENERATOR_IDS.map((id) => generatorEntry(id));

const GROUPS: { title: string; entries: PaletteEntry[] }[] = [
  { title: 'Nós de recurso', entries: (['impure', 'normal', 'pure'] as Purity[]).map((p) => minerEntry(p)) },
  { title: 'Fluidos', entries: fluidEntries },
  { title: 'Máquinas', entries: machineEntries },
  { title: 'Energia', entries: generatorEntries },
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
        sub: `${m.name} · ${r.outputs.map((o) => `${withUnit(fmt(o.rate), o.item)} ${ITEMS[o.item].name}`).join(' + ')}`,
        icon: m.icon,
        color: m.color,
        data: { kind: 'machine', machine: r.machine, recipe: r.id, clock: 100 },
      };
    },
  );
  const ores = RESOURCES.filter((id) => norm(ITEMS[id].name).includes(t)).map((id) => minerEntry('normal', id));
  // fluidos extraídos (água, petróleo, nitrogênio...) viram o extrator certo
  const fluidSources = (Object.keys(EXTRACTORS) as ExtractorKind[]).flatMap((k) =>
    EXTRACTORS[k].resources.filter((id) => norm(ITEMS[id].name).includes(t)).map((id) => extractorEntry(k, id, ITEMS[id].name)),
  );
  const wells = WELL.resources.filter((id) => norm(ITEMS[id].name).includes(t) || norm('poco de recurso resource well').includes(t)).map((id) => wellEntry(id, `${ITEMS[id].name} (poço)`));
  // geradores pelo nome ou pelo combustível (ex.: "coal" acha o Coal-Powered Generator com Coal)
  const generators = GENERATOR_IDS.flatMap((id) => {
    const g = GENERATORS[id];
    if (norm(g.name).includes(t)) return [generatorEntry(id)];
    return g.fuels.filter((f) => !g.optionalFuel && norm(ITEMS[f.item].name).includes(t)).map((f) => generatorEntry(id, f.item));
  });
  return [...ores, ...fluidSources, ...wells, ...generators, ...recipes];
}

export const DND_TYPE = 'application/x-satisplanner';

export function Palette({
  onAdd,
  version,
  onOpenPlanner,
  defaults,
  onDefaults,
}: {
  onAdd: (data: FactoryData) => void;
  version: string;
  onOpenPlanner: () => void;
  /** Mk usado nas conexões novas */
  defaults: { belt: BeltTier; pipe: PipeTier };
  onDefaults: (d: { belt?: BeltTier; pipe?: PipeTier }) => void;
}) {
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
      <div className="palette-defaults" title="Mk usado quando você cria uma conexão nova">
        <label>
          Esteira
          <select value={defaults.belt} onChange={(e) => onDefaults({ belt: Number(e.target.value) as BeltTier })}>
            {BELT_TIERS.map((t) => (
              <option key={t} value={t}>
                {BELTS[t].name} ({BELTS[t].rate})
              </option>
            ))}
          </select>
        </label>
        <label>
          Cano
          <select value={defaults.pipe} onChange={(e) => onDefaults({ pipe: Number(e.target.value) as PipeTier })}>
            {PIPE_TIERS.map((t) => (
              <option key={t} value={t}>
                {PIPES[t].name} ({PIPES[t].rate})
              </option>
            ))}
          </select>
        </label>
      </div>
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
