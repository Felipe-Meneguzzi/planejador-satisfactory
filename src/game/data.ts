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
  /** geradores a combustível; energy = MJ por item (ou por m³ de fluido) */
  generators: {
    name: string;
    power: number;
    overclockable: boolean;
    /** água em m³/min a 100% */
    water?: number;
    fuels: { item: string; energy: number; waste?: { item: string; perItem: number } }[];
  }[];
  geothermal: { name: string; overclockable: boolean; purities: Record<Purity, { min: number; max: number; avg: number }> };
  augmenter: { name: string; power: number; overclockable: boolean; fuel: { item: string; rate: number }; boost: { unfueled: number; fueled: number } };
  pressurizer: {
    name: string;
    power: number;
    overclockable: boolean;
    powerExponent: number;
    extractor: { name: string; power: number; overclockable: boolean };
    rates: Record<Purity, number>;
    resources: string[];
    wellsInWorld: Record<string, { wells: number; satellites: Record<Purity, number> }>;
  };
  sink: {
    name: string;
    power: number;
    acceptsFluids: boolean;
    points: Record<string, number>;
    cannotBeSunk: string[];
    dnaCapsule: { item: string; points: number };
    coupons: { firstCount: number; firstCost: number; base: number; factor: number; capFrom: number; capCost: number };
  };
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
// combustíveis e resíduos dos geradores (quase todos já aparecem nas receitas)
for (const g of data.generators ?? []) for (const f of g.fuels) [f.item, f.waste?.item].forEach((n) => n && itemNames.add(n));
if (data.augmenter) itemNames.add(data.augmenter.fuel.item);

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
  /** aceita overclock no próprio extrator */
  overclockable: boolean;
  /** o clock vem do pressurizador do poço (vale pra todos os extratores dele) */
  clockByPressurizer: boolean;
  rate: (purity: Purity) => number;
  /** MW a 100% (o poço é alimentado pelo pressurizador, que entra separado) */
  power: number;
}
const ex = data.extractors;
export const EXTRACTORS: Record<ExtractorKind, ExtractorInfo> = {
  water: { kind: 'water', name: ex.water.name, resources: [slug(ex.water.resource)], usesPurity: false, overclockable: ex.water.overclockable, clockByPressurizer: false, rate: () => ex.water.rate, power: ex.water.power },
  oil: { kind: 'oil', name: ex.oil.name, resources: [slug(ex.oil.resource)], usesPurity: true, overclockable: ex.oil.overclockable, clockByPressurizer: false, rate: (p) => ex.oil.rates[p], power: ex.oil.power },
  well: { kind: 'well', name: ex.well.name, resources: ex.well.resources.map(slug), usesPurity: true, overclockable: ex.well.overclockable, clockByPressurizer: true, rate: (p) => ex.well.rates[p], power: ex.well.power },
};
export const WELL_PRESSURIZER_NAME = ex.well.pressurizerName;
/** dá pra mudar o clock (no extrator, ou no pressurizador no caso do poço) */
export const extractorClockable = (k: ExtractorKind) => EXTRACTORS[k].overclockable || EXTRACTORS[k].clockByPressurizer;
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

/* ---------- energia ---------- */

export type GeneratorId = string;

export interface FuelInfo {
  item: ItemId;
  /** MJ por item (sólido) ou por m³ (fluido); 0 = não gera energia (Alien Power Matrix) */
  energy: number;
  /** consumo por minuto a 100% (= potência × 60 / energia) */
  rate: number;
  /** resíduo por minuto a 100% (Nuclear Power Plant) */
  waste?: { item: ItemId; rate: number };
}

export interface GeneratorInfo {
  id: GeneratorId;
  name: string;
  icon: string;
  color: string;
  /** MW a 100% (no geotérmico, a média da pureza normal) */
  power: number;
  overclockable: boolean;
  /** água em m³/min a 100% */
  water?: number;
  /** combustíveis aceitos (vazio = não consome nada) */
  fuels: FuelInfo[];
  /** o combustível é opcional (Alien Power Augmenter) */
  optionalFuel?: boolean;
  /** geotérmico: MW por pureza do gêiser (mín./máx./média) */
  geothermal?: Record<Purity, { min: number; max: number; avg: number }>;
  /** Alien Power Augmenter: bônus na rede sem e com combustível */
  boost?: { unfueled: number; fueled: number };
}

const GENERATOR_STYLE: Record<string, { icon: string; color: string }> = {
  'biomass-burner': { icon: '🌿', color: '#4f7a2a' },
  'coal-powered-generator': { icon: '🪨', color: '#4a4f5a' },
  'fuel-powered-generator': { icon: '⛽', color: '#a0601c' },
  'nuclear-power-plant': { icon: '☢️', color: '#3c7f3a' },
  'geothermal-generator': { icon: '🌋', color: '#9a3c26' },
  'alien-power-augmenter': { icon: '👽', color: '#6a3fa0' },
};
const genStyle = (id: string) => GENERATOR_STYLE[id] ?? { icon: '⚡', color: '#555b66' };

const fuelGenerators: GeneratorInfo[] = (data.generators ?? []).map((g) => {
  const id = slug(g.name);
  return {
    id,
    name: g.name,
    ...genStyle(id),
    power: g.power,
    overclockable: g.overclockable,
    water: g.water,
    fuels: g.fuels.map((f) => {
      const rate = (g.power * 60) / f.energy;
      return { item: slug(f.item), energy: f.energy, rate, waste: f.waste && { item: slug(f.waste.item), rate: rate * f.waste.perItem } };
    }),
  };
});
const geo = data.geothermal;
const aug = data.augmenter;
export const GENERATORS: Record<GeneratorId, GeneratorInfo> = Object.fromEntries(
  [
    ...fuelGenerators,
    { id: slug(geo.name), name: geo.name, ...genStyle(slug(geo.name)), power: geo.purities.normal.avg, overclockable: geo.overclockable, fuels: [], geothermal: geo.purities },
    {
      id: slug(aug.name),
      name: aug.name,
      ...genStyle(slug(aug.name)),
      power: aug.power,
      overclockable: aug.overclockable,
      fuels: [{ item: slug(aug.fuel.item), energy: 0, rate: aug.fuel.rate }],
      optionalFuel: true,
      boost: aug.boost,
    },
  ].map((g) => [g.id, g]),
);
export const GENERATOR_IDS = Object.keys(GENERATORS);
/** combustível escolhido no gerador (cai no primeiro aceito se o salvo não servir) */
export const fuelOf = (generator: GeneratorId, fuel?: ItemId): FuelInfo | undefined => {
  const g = GENERATORS[generator];
  return g?.fuels.find((f) => f.item === fuel) ?? g?.fuels[0];
};

/* ---------- poço de recurso ---------- */

const pr = data.pressurizer;
/**
 * Limite de extratores-satélite por poço usado no gerador de linha: média de satélites por
 * poço daquele recurso no mapa (wellsInWorld), arredondada pra cima.
 */
const satelliteLimit = Object.fromEntries(
  Object.entries(pr.wellsInWorld).map(([name, w]) => {
    const total = Object.values(w.satellites).reduce((a, b) => a + b, 0);
    return [slug(name), Math.ceil(total / w.wells)];
  }),
) as Record<ItemId, number>;
export const WELL = {
  name: pr.name,
  extractorName: pr.extractor.name,
  /** MW do pressurizador a 100% (os satélites não consomem) */
  power: pr.power,
  powerExponent: pr.powerExponent,
  overclockable: pr.overclockable,
  /** m³/min de cada satélite a 100% do pressurizador */
  rates: pr.rates,
  resources: pr.resources.map(slug) as ItemId[],
  satelliteLimit,
  /** maior limite entre os recursos (teto do botão de adicionar satélite) */
  maxSatellites: Math.max(...Object.values(satelliteLimit)),
  wellsInWorld: Object.fromEntries(Object.entries(pr.wellsInWorld).map(([name, w]) => [slug(name), w])) as Record<ItemId, { wells: number; satellites: Record<Purity, number> }>,
};

/* ---------- AWESOME Sink ---------- */

const sk = data.sink;
export const SINK = {
  name: sk.name,
  /** MW enquanto recebe itens (parado não consome) */
  power: sk.power,
  /** pontos por item (só sólidos) */
  points: Object.fromEntries(Object.entries(sk.points).map(([name, p]) => [slug(name), p])) as Record<ItemId, number>,
  /** Alien DNA Capsule: contador de pontos separado */
  dna: { item: slug(sk.dnaCapsule.item), points: sk.dnaCapsule.points },
};
/** pontos de um item no AWESOME Sink (undefined = não pode ser destruído lá) */
export const sinkPoints = (item: ItemId): number | undefined => SINK.points[item];

/** Pontos pra imprimir o n-ésimo cupom (n começa em 1) */
export function couponCost(n: number): number {
  const c = sk.coupons;
  if (n <= c.firstCount) return c.firstCost;
  if (n >= c.capFrom) return c.capCost;
  return c.factor * (Math.ceil(n / 3) - 1) ** 2 + c.base;
}
