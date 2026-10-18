import { AMPLIFICATION, MACHINES, RECIPES } from '../game/data';
import type { ItemId } from '../game/types';
import { clampClock, powerAt } from '../sim/simulate';

/*
 * Planilha de fábrica: você diz o que entra, quais receitas roda e quantas máquinas de cada,
 * e ela soma o que sai e o que sobra de cada item. Conta nominal (como uma planilha): toda máquina
 * roda cheia; item que falta aparece com saldo negativo em vez de frear as máquinas.
 */

export interface SheetInput {
  id: string;
  item: ItemId;
  /** itens (ou m³) por minuto */
  rate: number;
}

export interface SheetRow {
  id: string;
  recipe: string;
  /** quantidade de máquinas */
  count: number;
  /** clock de todas elas, em % */
  clock: number;
  /** Somersloops por máquina */
  sloops: number;
}

export interface Sheet {
  id: string;
  name: string;
  inputs: SheetInput[];
  rows: SheetRow[];
}

export interface RowResult {
  /** receita existe */
  valid: boolean;
  /** máquinas inteiras (pra contar custo) */
  machines: number;
  power: number;
  inputs: { item: ItemId; rate: number }[];
  outputs: { item: ItemId; rate: number }[];
}

export interface ItemBalance {
  item: ItemId;
  /** entra de fora */
  supplied: number;
  /** soma das saídas das receitas */
  produced: number;
  /** soma das entradas das receitas */
  consumed: number;
  /** supplied + produced − consumed: positivo = sobra, negativo = falta */
  balance: number;
}

export interface SheetResult {
  rows: Record<string, RowResult>;
  items: ItemBalance[];
  machines: number;
  power: number;
}

const EPS = 1e-6;
const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Quantidade de máquinas aceita: inteiro ≥ 0 */
export const countOf = (n: number) => Math.floor(nonNeg(n));

/** Somersloops efetivos, limitados aos slots da máquina */
const sloopsFor = (machine: string, sloops: number) => Math.max(0, Math.min(MACHINES[machine]?.sloopSlots ?? 0, Math.floor(nonNeg(sloops))));

export function rowResult(row: SheetRow): RowResult {
  const recipe = RECIPES[row.recipe];
  if (!recipe) return { valid: false, machines: 0, power: 0, inputs: [], outputs: [] };
  const count = countOf(row.count);
  const clock = clampClock(row.clock);
  const k = (clock / 100) * count;
  const slots = MACHINES[recipe.machine]?.sloopSlots ?? 0;
  const amp = slots ? 1 + sloopsFor(recipe.machine, row.sloops) / slots : 1;
  const power = count * powerAt(recipe.power ?? MACHINES[recipe.machine].power, clock) * Math.pow(amp, AMPLIFICATION.powerExponent);
  return {
    valid: true,
    machines: count,
    power,
    inputs: recipe.inputs.map((p) => ({ item: p.item, rate: p.rate * k })),
    outputs: recipe.outputs.map((p) => ({ item: p.item, rate: p.rate * k * amp })),
  };
}

export function computeSheet(sheet: Pick<Sheet, 'inputs' | 'rows'>): SheetResult {
  const rows: Record<string, RowResult> = {};
  const acc = new Map<ItemId, ItemBalance>();
  const get = (item: ItemId) => {
    let b = acc.get(item);
    if (!b) acc.set(item, (b = { item, supplied: 0, produced: 0, consumed: 0, balance: 0 }));
    return b;
  };

  for (const i of sheet.inputs) if (i.item) get(i.item).supplied += nonNeg(i.rate);

  let machines = 0;
  let power = 0;
  for (const row of sheet.rows) {
    const r = rowResult(row);
    rows[row.id] = r;
    machines += r.machines;
    power += r.power;
    for (const p of r.inputs) get(p.item).consumed += p.rate;
    for (const p of r.outputs) get(p.item).produced += p.rate;
  }

  const items = [...acc.values()];
  for (const b of items) b.balance = Math.abs(b.supplied + b.produced - b.consumed) < EPS ? 0 : b.supplied + b.produced - b.consumed;
  return { rows, items, machines, power };
}

/** Item sem nada acontecendo (entrada zerada e nenhuma receita mexendo nele) */
export const isIdle = (b: ItemBalance) => b.supplied < EPS && b.produced < EPS && b.consumed < EPS;
