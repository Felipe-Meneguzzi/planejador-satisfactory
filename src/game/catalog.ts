import { ALL_RECIPES, EXTRACTORS, GENERATORS, GENERATOR_IDS, ITEMS, MACHINES, MACHINE_IDS, MINER_TIERS, PURITIES, RECIPES, RESOURCES, SINK, WELL, recipesFor, withUnit } from './data';
import { newFrame, newNote } from './annotations';
import type { ExtractorKind, FactoryData, ItemId, Purity } from './types';
import { fmt } from '../format';

/*
 * Catálogo do que dá pra adicionar no canvas: as seções da paleta, a busca da paleta e a
 * lista completa usada pela busca rápida (Ctrl+K).
 */

export interface PaletteEntry {
  key: string;
  label: string;
  sub: string;
  icon: string;
  color: string;
  data: FactoryData;
}

const MINER_COLOR = '#7d5236';

export const minerEntry = (purity: Purity, resource = RESOURCES[0]): PaletteEntry => ({
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
export const extractorEntry = (extractor: ExtractorKind, resource: ItemId, label: string): PaletteEntry => {
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
export const wellEntry = (resource: ItemId, label: string): PaletteEntry => ({
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

export const generatorEntry = (id: string, fuel?: ItemId): PaletteEntry => {
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

export const GROUPS: { title: string; entries: PaletteEntry[] }[] = [
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
  {
    title: 'Entre fábricas',
    entries: [
      {
        key: 'inbound',
        label: 'Entrada externa',
        sub: 'Item de fora ou de outra fábrica (aba)',
        icon: '📥',
        color: '#22707a',
        data: { kind: 'inbound', item: 'iron-ore', rate: 60 },
      },
      { key: 'outbound', label: 'Saída externa', sub: 'Manda o que chega pra outra fábrica', icon: '📤', color: '#8a5a1f', data: { kind: 'outbound' } },
    ],
  },
  {
    title: 'Saída',
    entries: [
      { key: 'sink', label: 'Armazém', sub: 'Consome tudo que chega', icon: '📦', color: '#2f7a52', data: { kind: 'sink' } },
      { key: 'awesome-sink', label: SINK.name, sub: `Só sólidos, vira pontos · ${fmt(SINK.power)} MW`, icon: '♻️', color: '#7d3a8c', data: { kind: 'sink', mode: 'awesome' } },
    ],
  },
  {
    title: 'Organização',
    entries: [
      { key: 'frame', label: 'Moldura', sub: 'Agrupa uma área: título e cor; arrastar leva o que está dentro', icon: '🔲', color: '#3d84c6', data: newFrame() },
      { key: 'note', label: 'Anotação', sub: 'Texto livre no canvas', icon: '📝', color: '#c9a032', data: newNote() },
    ],
  },
];

/** minúsculas e sem acento (busca) */
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Entrada da paleta pra uma receita (vira a máquina dela já com a receita escolhida) */
export const recipeEntry = (r: (typeof ALL_RECIPES)[number]): PaletteEntry => {
  const m = MACHINES[r.machine];
  return {
    key: `recipe-${r.id}`,
    label: r.name,
    sub: `${m.name} · ${r.outputs.map((o) => `${withUnit(fmt(o.rate), o.item)} ${ITEMS[o.item].name}`).join(' + ')}`,
    icon: m.icon,
    color: m.color,
    data: { kind: 'machine', machine: r.machine, recipe: r.id, clock: 100 },
  };
};

/** Busca: receitas pelo nome ou produto, e recursos (vira mineradora daquele recurso) */
export function search(q: string): PaletteEntry[] {
  const t = norm(q.trim());
  const recipes = ALL_RECIPES.filter((r) => norm(r.name).includes(t) || r.outputs.some((o) => norm(ITEMS[o.item].name).includes(t))).map(recipeEntry);
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

/**
 * Tudo que dá pra adicionar, sem repetição (busca rápida): as seções da paleta, cada receita,
 * cada minério (mineradora normal), cada fluido extraível, os poços e os geradores com cada combustível.
 */
export function allEntries(): PaletteEntry[] {
  const seen = new Set<string>();
  const out: PaletteEntry[] = [];
  const push = (e: PaletteEntry) => {
    if (seen.has(e.key)) return;
    seen.add(e.key);
    out.push(e);
  };
  GROUPS.forEach((g) => g.entries.forEach(push));
  ALL_RECIPES.forEach((r) => push(recipeEntry(r)));
  RESOURCES.forEach((id) => push(minerEntry('normal', id)));
  (Object.keys(EXTRACTORS) as ExtractorKind[]).forEach((k) => EXTRACTORS[k].resources.forEach((id) => push(extractorEntry(k, id, ITEMS[id].name))));
  WELL.resources.forEach((id) => push(wellEntry(id, `${ITEMS[id].name} (poço)`)));
  GENERATOR_IDS.forEach((id) => GENERATORS[id].fuels.forEach((f) => push(generatorEntry(id, f.item))));
  return out;
}
