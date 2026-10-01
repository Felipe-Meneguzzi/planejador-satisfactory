import raw from './gamedata.json';
import type { BeltTier, ItemId, MachineData, MachineId, MinerTier, Purity } from './types';

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
  machines: { name: string; power: number; inputs: number; outputs: number; somersloopSlots: number }[];
  amplification: { powerExponent: number };
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
};

const hashColor = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 62%)`;
};

const itemNames = new Set<string>(data.resources);
for (const r of recipesData) for (const p of [...r.inputs, ...r.outputs]) itemNames.add(p.item);

export const ITEMS: Record<ItemId, { name: string; color: string }> = Object.fromEntries(
  [...itemNames].sort().map((name) => {
    const id = slug(name);
    return [id, { name, color: ITEM_COLORS[id] ?? hashColor(id) }];
  }),
);

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

export const OVERCLOCK = data.overclock;

/** Amplificação por Somersloop: produção × (1 + n/slots), energia × (1 + n/slots)^expoente */
export const AMPLIFICATION = data.amplification;

/* ---------- máquinas e receitas ---------- */

const MACHINE_STYLE: Record<string, { icon: string; color: string; pt: string }> = {
  smelter: { icon: '🔥', color: '#b85a26', pt: 'Fundidora' },
  foundry: { icon: '🏭', color: '#8f3b2a', pt: 'Fundição' },
  constructor: { icon: '🔧', color: '#2f6fae', pt: 'Construtora' },
  assembler: { icon: '⚙️', color: '#2f8f8a', pt: 'Montadora' },
  manufacturer: { icon: '🏗️', color: '#6b46b5', pt: 'Fabricante' },
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
}
export const MACHINES: Record<MachineId, MachineInfo> = Object.fromEntries(
  data.machines.map((m) => {
    const id = slug(m.name);
    const style = MACHINE_STYLE[id] ?? { icon: '🏭', color: '#555b66' };
    return [id, { id, name: m.name, icon: style.icon, color: style.color, power: m.power, inputs: m.inputs, outputs: m.outputs, sloopSlots: m.somersloopSlots ?? 0 }];
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

export const RECIPES: Record<string, Recipe> = Object.fromEntries(
  recipesData.map((r) => {
    const id = slug(r.name);
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
