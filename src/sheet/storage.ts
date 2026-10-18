import { ITEMS, RECIPES } from '../game/data';
import type { Sheet, SheetInput, SheetRow } from './balance';

const KEY = 'satisplanner:sheets';

export interface SheetsState {
  sheets: Sheet[];
  active: string;
}

let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const emptySheet = (name = 'Fábrica 1'): Sheet => ({ id: newId(), name, inputs: [], rows: [] });
export const newInput = (): SheetInput => ({ id: newId(), item: '', rate: 0 });
export const newRow = (recipe = ''): SheetRow => ({ id: newId(), recipe, count: 1, clock: 100, sloops: 0 });

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Aceita qualquer coisa vinda do storage e devolve só o que ainda existe no jogo */
export function normalize(raw: unknown): SheetsState {
  const sheets: Sheet[] = [];
  const list = (raw as { sheets?: unknown })?.sheets;
  if (Array.isArray(list)) {
    for (const s of list) {
      if (!s || typeof s !== 'object') continue;
      const o = s as Record<string, unknown>;
      const inputs = (Array.isArray(o.inputs) ? o.inputs : [])
        .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
        .map((i) => ({ id: typeof i.id === 'string' ? i.id : newId(), item: typeof i.item === 'string' && ITEMS[i.item] ? i.item : '', rate: Math.max(0, num(i.rate, 0)) }));
      const rows = (Array.isArray(o.rows) ? o.rows : [])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({
          id: typeof r.id === 'string' ? r.id : newId(),
          recipe: typeof r.recipe === 'string' && RECIPES[r.recipe] ? r.recipe : '',
          count: Math.max(0, Math.floor(num(r.count, 1))),
          clock: num(r.clock, 100),
          sloops: Math.max(0, Math.floor(num(r.sloops, 0))),
        }));
      sheets.push({ id: typeof o.id === 'string' ? o.id : newId(), name: typeof o.name === 'string' && o.name.trim() ? o.name : `Fábrica ${sheets.length + 1}`, inputs, rows });
    }
  }
  if (!sheets.length) sheets.push(emptySheet());
  const active = (raw as { active?: unknown })?.active;
  return { sheets, active: sheets.some((s) => s.id === active) ? (active as string) : sheets[0].id };
}

export function loadSheets(): SheetsState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    // JSON ruim: o salvamento automático vai sobrescrever a chave, então guarda uma cópia antes
    try {
      if (raw) localStorage.setItem(`${KEY}:corrompido`, raw);
    } catch {
      /* sem storage */
    }
  }
  return normalize(null);
}

export function saveSheets(state: SheetsState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* sem storage */
  }
}

/* ---------- exportar e importar ---------- */

const FILE_TYPE = 'satisplanner-planilhas';

export const exportFileName = (name: string) => `planilha-${slug(name)}-${new Date().toISOString().slice(0, 10)}.json`;
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'fabricas';

export function exportText(sheets: Sheet[]): string {
  return JSON.stringify({ type: FILE_TYPE, version: 1, sheets }, null, 2);
}

export type ImportResult = { ok: true; sheets: Sheet[]; blank: number } | { ok: false; error: string };

/** Lê um arquivo exportado. Nada é gravado aqui: quem chama só acrescenta as planilhas novas às que já existem. */
export function parseImport(text: string, existingNames: string[]): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' };
  }
  const o = raw as { type?: unknown; sheets?: unknown };
  if (!o || o.type !== FILE_TYPE || !Array.isArray(o.sheets) || !o.sheets.length) return { ok: false, error: 'Esse arquivo não é uma exportação de planilhas deste app.' };

  const clean = normalize({ sheets: o.sheets }).sheets;
  // linhas e entradas que apontavam pra algo que não existe mais no jogo ficam em branco
  const rawCount = (o.sheets as { inputs?: { item?: unknown }[]; rows?: { recipe?: unknown }[] }[]).flatMap((s) => [
    ...(s?.inputs ?? []).filter((i) => i?.item),
    ...(s?.rows ?? []).filter((r) => r?.recipe),
  ]).length;
  const kept = clean.flatMap((s) => [...s.inputs.filter((i) => i.item), ...s.rows.filter((r) => r.recipe)]).length;

  const taken = new Set(existingNames);
  const sheets = clean.map((s) => {
    let name = s.name;
    if (taken.has(name)) name = `${name} (importada)`;
    taken.add(name);
    return { ...s, id: newId(), name, inputs: s.inputs.map((i) => ({ ...i, id: newId() })), rows: s.rows.map((r) => ({ ...r, id: newId() })) };
  });
  return { ok: true, sheets, blank: rawCount - kept };
}
