import raw from './gamedata.json';
import type { BeltItem, BeltTier, ExtractorKind, ItemId, MachineData, MachineId, MinerTier, PipeTier, Purity } from './types';

/*
 * Dados do jogo vêm de gamedata.json (extraído do wiki oficial, satisfactory.wiki.gg).
 * Aqui só convertemos pro formato usado pelo app: ids em slug e taxas por minuto.
 */

interface RawData {
  version: string;
  sources: string[];
  belts: { tier: number; rate: number }[];
  purities: Record<Purity, number>;
  miners: { tier: number; rate: number; power: number }[];
  overclock: { min: number; max: number; shards: { upTo: number; shards: number }[]; powerExponent: number };
  resources: string[];
  machines: {
    name: string;
    power: number;
    inputs: number;
    outputs: number;
    somersloopSlots: number;
    /** consumo variável (Particle Accelerator, Converter, Quantum Encoder): varia por receita */
    variablePower?: { min: number; max: number };
    solidInputs?: number;
    fluidInputs?: number;
    solidOutputs?: number;
    fluidOutputs?: number;
  }[];
  amplification: { powerExponent: number };
  /** itens que são fluido (líquido ou gás) */
  fluids: { name: string; form: 'liquid' | 'gas' }[];
  pipes: { tier: number; rate: number }[];
  extractors: {
    water: { name: string; resource: string; rate: number; power: number; overclockable: boolean };
    oil: { name: string; resource: string; rates: Record<Purity, number>; power: number; overclockable: boolean };
    well: { name: string; resources: string[]; rates: Record<Purity, number>; power: number; overclockable: boolean; pressurizerName: string; pressurizerPower: number };
  };
  recipes: {
    name: string;
    alternate: boolean;
    machine: string;
    duration: number;
    inputs: { item: string; amount: number }[];
    outputs: { item: string; amount: number }[];
    /** receitas sazonais (FICSMAS) */
    event?: string;
    /** consumo variável em MW (ex.: Ballistic Warp Drive) */
    variablePower?: { min: number; max: number };
  }[];
}
const data = raw as unknown as RawData;

/** Receitas de eventos sazonais ficam de fora do planejador */
const recipesData = data.recipes.filter((r) => !r.event);

export const GAME_VERSION = data.version;

export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/^alternate:\s*/, 'alt-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/* ---------- itens ---------- */

/** Cores fixas pros itens mais comuns; o resto ganha uma cor estável pelo nome */
const ITEM_COLORS: Record<string, string> = {
  'iron-ore': '#c8714f',
  'iron-ingot': '#a3adb8',
  'iron-plate': '#5fb0e6',
  'copper-ore': '#d9824a',
  'copper-ingot': '#e8955a',
  'limestone': '#d8cfb0',
  'coal': '#55585e',
  'caterium-ore': '#e3c45a',
  'caterium-ingot': '#f0d36b',
  'raw-quartz': '#e5a8d6',
  'sulfur': '#d8d84a',
  'bauxite': '#c9614b',
  'uranium': '#7bd05a',
  'sam': '#a46be0',
  'steel-ingot': '#7f8a99',
  'concrete': '#bdb8aa',
  // fluidos (cores parecidas com as do jogo)
  'water': '#3d9df2',
  'crude-oil': '#1c1a17',
  'heavy-oil-residue': '#7a3a86',
  'fuel': '#e8a33a',
  'turbofuel': '#d0402f',
  'liquid-biofuel': '#58b04c',
  'alumina-solution': '#cfd3d6',
  'sulfuric-acid': '#e2e046',
  'nitric-acid': '#d8c46a',
  'nitrogen-gas': '#9aa9b5',
  'rocket-fuel': '#ff6a3d',
  'ionized-fuel': '#ffb3e6',
  'dissolved-silica': '#e8d8ff',
  'dark-matter-residue': '#5a2a6e',
  'excited-photonic-matter': '#f5f0a0',
};

const hashColor = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 62%)`;
};

const fluidForm = new Map((data.fluids ?? []).map((f) => [slug(f.name), f.form]));

const itemNames = new Set<string>(data.resources);
for (const r of recipesData) for (const p of [...r.inputs, ...r.outputs]) itemNames.add(p.item);
for (const f of data.fluids ?? []) itemNames.add(f.name);

export interface ItemInfo {
  name: string;
  color: string;
  /** fluido (líquido ou gás): anda em cano e é medido em m³/min */
  fluid: boolean;
  form?: 'liquid' | 'gas';
}
export const ITEMS: Record<ItemId, ItemInfo> = Object.fromEntries(
  [...itemNames].sort().map((name) => {
    const id = slug(name);
    return [id, { name, color: ITEM_COLORS[id] ?? hashColor(id), fluid: fluidForm.has(id), form: fluidForm.get(id) }];
  }),
);

export const isFluid = (item: BeltItem | undefined) => !!item && item !== 'mixed' && !!ITEMS[item]?.fluid;
/** unidade de vazão do item: fluidos em m³/min, sólidos em itens/min */
export const unitOf = (item: BeltItem | undefined) => (isFluid(item) ? 'm³/min' : '/min');
/** "30/min" pra sólido, "30 m³/min" pra fluido (o número já formatado) */
export const withUnit = (value: string, item: BeltItem | undefined) => (isFluid(item) ? `${value} m³/min` : `${value}/min`);

/** Recursos sólidos mineráveis pela Mineradora */
export const RESOURCES: ItemId[] = data.resources.map(slug);

/* ---------- extração e logística ---------- */

const PURITY_NAMES: Record<Purity, string> = { impure: 'Impuro', normal: 'Normal', pure: 'Puro' };
export const PURITIES = Object.fromEntries(
  (Object.keys(PURITY_NAMES) as Purity[]).map((p) => [p, { name: PURITY_NAMES[p], mult: data.purities[p] }]),
) as Record<Purity, { name: string; mult: number }>;

/** base = itens/min em nó normal a 100% */
export const MINER_TIERS = Object.fromEntries(
  data.miners.map((m) => [m.tier, { name: `Mk.${m.tier}`, base: m.rate, power: m.power }]),
) as Record<MinerTier, { name: string; base: number; power: number }>;

export const BELTS = Object.fromEntries(data.belts.map((b) => [b.tier, { name: `Mk.${b.tier}`, rate: b.rate }])) as Record<
  BeltTier,
  { name: string; rate: number }
>;
export const BELT_TIERS = data.belts.map((b) => b.tier) as BeltTier[];

/** Canos (vazão em m³/min) */
export const PIPES = Object.fromEntries((data.pipes ?? []).map((p) => [p.tier, { name: `Mk.${p.tier}`, rate: p.rate }])) as Record<
  PipeTier,
  { name: string; rate: number }
>;
export const PIPE_TIERS = (data.pipes ?? []).map((p) => p.tier) as PipeTier[];

/** Extratores de fluido. `rate(pureza)` = m³/min a 100% de clock */
export interface ExtractorInfo {
  kind: ExtractorKind;
  name: string;
  resources: ItemId[];
  usesPurity: boolean;
  /** aceita overclock (o extrator de poço não: quem tem clock é o pressurizador) */
  overclockable: boolean;
  rate: (purity: Purity) => number;
  /** MW a 100% (o poço é alimentado pelo pressurizador, que entra separado) */
  power: number;
}
const ex = data.extractors;
export const EXTRACTORS: Record<ExtractorKind, ExtractorInfo> = {
  water: { kind: 'water', name: ex.water.name, resources: [slug(ex.water.resource)], usesPurity: false, overclockable: ex.water.overclockable, rate: () => ex.water.rate, power: ex.water.power },
  oil: { kind: 'oil', name: ex.oil.name, resources: [slug(ex.oil.resource)], usesPurity: true, overclockable: ex.oil.overclockable, rate: (p) => ex.oil.rates[p], power: ex.oil.power },
  well: { kind: 'well', name: ex.well.name, resources: ex.well.resources.map(slug), usesPurity: true, overclockable: ex.well.overclockable, rate: (p) => ex.well.rates[p], power: ex.well.power },
};
export const WELL_PRESSURIZER_NAME = ex.well.pressurizerName;
/** consumo do pressurizador de poço (um por poço, alimenta todos os extratores dele) */
export const WELL_PRESSURIZER_POWER = ex.well.pressurizerPower;

export const OVERCLOCK = data.overclock;

/** Amplificação por Somersloop: produção × (1 + n/slots), energia × (1 + n/slots)^expoente */
export const AMPLIFICATION = data.amplification;

/* ---------- máquinas e receitas ---------- */

const MACHINE_STYLE: Record<string, { icon: string; color: string }> = {
  smelter: { icon: '🔥', color: '#b85a26' },
  foundry: { icon: '🏭', color: '#8f3b2a' },
  constructor: { icon: '🔧', color: '#2f6fae' },
  assembler: { icon: '⚙️', color: '#2f8f8a' },
  manufacturer: { icon: '🏗️', color: '#6b46b5' },
  refinery: { icon: '🛢️', color: '#7a4e2a' },
  blender: { icon: '🧪', color: '#1f7a8c' },
  packager: { icon: '📦', color: '#5c6b7a' },
  'particle-accelerator': { icon: '⚛️', color: '#8e44ad' },
  converter: { icon: '🔄', color: '#a8325e' },
  'quantum-encoder': { icon: '🌀', color: '#2c3e94' },
};

export interface MachineInfo {
  id: MachineId;
  name: string;
  icon: string;
  color: string;
  power: number;
  inputs: number;
  outputs: number;
  /** slots de Somersloop (0 = não amplifica) */
  sloopSlots: number;
  /** consumo varia por receita (o `power` é a média) */
  variablePower?: { min: number; max: number };
}
export const MACHINES: Record<MachineId, MachineInfo> = Object.fromEntries(
  data.machines.map((m) => {
    const id = slug(m.name);
    const style = MACHINE_STYLE[id] ?? { icon: '🏭', color: '#555b66' };
    return [
      id,
      { id, name: m.name, icon: style.icon, color: style.color, power: m.power, inputs: m.inputs, outputs: m.outputs, sloopSlots: m.somersloopSlots ?? 0, variablePower: m.variablePower },
    ];
  }),
);
export const MACHINE_IDS = Object.keys(MACHINES);

export interface Recipe {
  id: string;
  name: string;
  alternate: boolean;
  machine: MachineId;
  /** taxas em itens/min a 100% de clock */
  inputs: { item: ItemId; rate: number }[];
  outputs: { item: ItemId; rate: number }[];
  /** consumo próprio da receita em MW a 100% (substitui o da máquina); consumo variável usa a média */
  power?: number;
}

const perMin = (amount: number, duration: number) => (amount * 60) / duration;

// Nomes repetidos em máquinas diferentes (ex.: Turbo Rifle Ammo na Manufacturer e na Blender)
// ganham o nome da máquina no id pra não se sobrescreverem
const nameCount = new Map<string, number>();
for (const r of recipesData) nameCount.set(r.name, (nameCount.get(r.name) ?? 0) + 1);

export const RECIPES: Record<string, Recipe> = Object.fromEntries(
  recipesData.map((r) => {
    const id = (nameCount.get(r.name) ?? 0) > 1 ? slug(`${r.name} ${r.machine}`) : slug(r.name);
    return [
      id,
      {
        id,
        name: r.name,
        alternate: r.alternate,
        machine: slug(r.machine),
        inputs: r.inputs.map((p) => ({ item: slug(p.item), rate: perMin(p.amount, r.duration) })),
        outputs: r.outputs.map((p) => ({ item: slug(p.item), rate: perMin(p.amount, r.duration) })),
        power: r.variablePower && (r.variablePower.min + r.variablePower.max) / 2,
      },
    ];
  }),
);

const byName = (a: Recipe, b: Recipe) => Number(a.alternate) - Number(b.alternate) || a.name.localeCompare(b.name);
export const recipesFor = (machine: MachineId) => Object.values(RECIPES).filter((r) => r.machine === machine).sort(byName);
export const ALL_RECIPES = Object.values(RECIPES).sort(byName);

export const getRecipe = (d: MachineData): Recipe => {
  const r = RECIPES[d.recipe];
  return r && r.machine === d.machine ? r : recipesFor(d.machine)[0];
};
