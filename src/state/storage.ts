import { ITEMS } from '../game/data';
import { cleanAnnotationData, nodeShape } from '../game/annotations';
import type { BeltEdge, BeltTier, FactoryData, FactoryNode, PipeTier, Purity } from '../game/types';

/** Chave do salvamento (o nome é da versão 1, mas guarda o projeto atual; plantas v1 antigas são migradas ao ler) */
const KEY = 'satisplanner:v1';
/** Versões boas anteriores (backup rotativo), da mais nova pra mais antiga */
const BACKUP_KEY = 'satisplanner:backups:v1';
/** quantas versões guardar */
export const MAX_BACKUPS = 5;
/** intervalo mínimo entre duas versões do backup (o salvamento normal roda a cada edição) */
export const BACKUP_INTERVAL = 2 * 60_000;
/** tamanho máximo do nome de uma fábrica */
export const MAX_NAME = 60;

/** Nodes e conexões de uma fábrica */
export interface Plant {
  nodes: FactoryNode[];
  edges: BeltEdge[];
}

/** Uma fábrica do projeto (uma aba) */
export interface Factory extends Plant {
  id: string;
  name: string;
}

/** Configurações globais do projeto */
export interface Settings {
  defaultTier: BeltTier;
  /** Mk dos canos novos */
  defaultPipeTier: PipeTier;
  /** padrão das esteiras: seguir o grid com ângulos retos */
  gridBelts: boolean;
  /** mostrar rótulos nas esteiras */
  beltLabels: boolean;
  /** cupons do AWESOME Sink já impressos (pra estimar o custo dos próximos) */
  couponsPrinted?: number;
}

/** Formato antigo (versão 1): uma planta só, com as configurações */
export interface SavedStateV1 extends Plant, Partial<Omit<Settings, 'defaultTier'>> {
  version: 1;
  defaultTier: BeltTier;
}

/** Formato atual (versão 2): projeto com várias fábricas e configurações globais */
export interface ProjectState extends Settings {
  version: 2;
  factories: Factory[];
  /** id da fábrica aberta */
  active: string;
}
export type SavedState = ProjectState;

/** Arquivo/link com uma fábrica só ("fábrica avulsa") */
export interface FactoryExport {
  version: 2;
  type: 'factory';
  factory: Factory;
}
/** Arquivo/link com o projeto inteiro */
export type ProjectExport = ProjectState & { type: 'project' };

/** contador da sessão: o gerador cria centenas de ids no mesmo milissegundo */
let idSeq = 0;
export const newId = (prefix = 'n') => `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const KINDS = new Set(['miner', 'extractor', 'well', 'machine', 'splitter', 'merger', 'sink', 'generator', 'inbound', 'outbound', 'frame', 'note']);

/** id, posição numérica e dados com `kind` conhecido: o mínimo pro canvas desenhar o node */
function validNode(n: unknown) {
  if (!(isObj(n) && typeof n.id === 'string' && isObj(n.position) && finite(n.position.x) && finite(n.position.y) && isObj(n.data))) return false;
  const d = n.data;
  if (typeof d.kind !== 'string' || !KINDS.has(d.kind)) return false;
  // a Entrada externa mostra o nome do item: item desconhecido quebraria o desenho
  if (d.kind === 'inbound' && !(typeof d.item === 'string' && ITEMS[d.item])) return false;
  return true;
}

function validEdge(e: unknown) {
  return isObj(e) && typeof e.id === 'string' && typeof e.source === 'string' && typeof e.target === 'string';
}

const PURITY_VALUES: Purity[] = ['impure', 'normal', 'pure'];
const isPurity = (v: unknown): v is Purity => PURITY_VALUES.includes(v as Purity);

/**
 * Migra formatos antigos de node pro atual:
 *  - extrator de poço ('extractor' com extractor 'well', um satélite cujo clock era o do
 *    pressurizador) vira um poço ('well') com aquele único satélite e o mesmo clock. As
 *    conexões continuam valendo: a saída do satélite 1 é a mesma out-0.
 *  - poço com lista de satélites quebrada fica só com as purezas válidas.
 *  - Entrada externa: vazão inválida vira 0 e link quebrado é descartado (fica a vazão manual).
 *  - Moldura/anotação: título/texto cortados, cor desconhecida vira cinza (o tamanho é tratado no nodeShape).
 */
function migrateNode(type: unknown, data: Record<string, unknown>): { type: string; data: FactoryData } {
  if (data.kind === 'extractor' && data.extractor === 'well') {
    const { purity, extractor: _e, ...rest } = data;
    return { type: 'well', data: { ...rest, kind: 'well', satellites: [isPurity(purity) ? purity : 'normal'] } as FactoryData };
  }
  if (data.kind === 'well') {
    const satellites = Array.isArray(data.satellites) ? data.satellites.filter(isPurity) : [];
    return { type: 'well', data: { ...data, satellites } as FactoryData };
  }
  if (data.kind === 'inbound') {
    const { link, rate, ...rest } = data;
    const okLink = isObj(link) && typeof link.factory === 'string' && typeof link.node === 'string';
    return {
      type: 'inbound',
      data: { ...rest, rate: finite(rate) && rate > 0 ? rate : 0, ...(okLink ? { link: { factory: link.factory, node: link.node } } : {}) } as FactoryData,
    };
  }
  if (data.kind === 'frame' || data.kind === 'note') return { type: data.kind, data: cleanAnnotationData(data) };
  if (data.kind === 'outbound') {
    const { name, ...rest } = data;
    const clean = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';
    return { type: 'outbound', data: { ...rest, ...(clean ? { name: clean } : {}) } as FactoryData };
  }
  return { type: typeof type === 'string' ? type : String(data.kind), data: data as FactoryData };
}

/** Nodes e conexões limpos (sem seleção, medidas etc.) ou null se algum estiver quebrado */
export function sanitizePlant(raw: unknown): Plant | null {
  const p = raw as Partial<Plant> | null;
  if (!isObj(p) || !Array.isArray(p.nodes) || !Array.isArray(p.edges)) return null;
  // um node ou esteira quebrado invalida tudo (melhor não salvar do que gravar lixo por cima)
  if (!p.nodes.every(validNode) || !p.edges.every(validEdge)) return null;
  return {
    // nodeShape: molduras e anotações levam o tamanho (múltiplo do grid) e a camada
    nodes: p.nodes.map((n) =>
      nodeShape({ ...n, id: n.id, position: { x: n.position.x, y: n.position.y }, ...migrateNode(n.type, n.data as Record<string, unknown>) } as FactoryNode),
    ),
    edges: p.edges.map((e) => ({
      id: e.id,
      type: e.type === 'pipe' ? ('pipe' as const) : ('belt' as const),
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      data: {
        tier: e.data?.tier ?? 1,
        ...(e.data?.routing ? { routing: e.data.routing } : {}),
        ...(e.data?.bends && e.data.anchor ? { bends: e.data.bends, anchor: e.data.anchor } : {}),
      },
    })),
  };
}

/** Configurações com os padrões no que faltar */
function sanitizeSettings(p: Record<string, unknown>): Settings {
  const coupons = p.couponsPrinted;
  return {
    defaultTier: (p.defaultTier as BeltTier) ?? 1,
    defaultPipeTier: (p.defaultPipeTier as PipeTier) ?? 1,
    gridBelts: (p.gridBelts as boolean) ?? true,
    beltLabels: (p.beltLabels as boolean) ?? true,
    ...(finite(coupons) && coupons > 0 ? { couponsPrinted: Math.floor(coupons) } : {}),
  };
}

const cleanName = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_NAME) : fallback);

/** Id da fábrica criada a partir de uma planta v1 (fixo: migrar de novo dá o mesmo resultado) */
export const MIGRATED_ID = 'fabrica-1';

function sanitizeFactory(raw: unknown, index: number): Factory | string {
  if (!isObj(raw)) return `a fábrica ${index + 1} não é um objeto`;
  if (typeof raw.id !== 'string' || !raw.id) return `a fábrica ${index + 1} está sem id`;
  const plant = sanitizePlant(raw);
  const name = cleanName(raw.name, `Fábrica ${index + 1}`);
  if (!plant) return `a fábrica "${name}" tem node ou conexão inválida`;
  return { id: raw.id, name, ...plant };
}

/** Valida e migra pro formato atual; devolve o motivo quando não dá */
function check(raw: unknown, v1Name = 'Fábrica 1'): ProjectState | string {
  if (!isObj(raw)) return 'o conteúdo não é um objeto JSON do planejador';
  if (raw.version === 1) {
    const plant = sanitizePlant(raw);
    if (!plant) return 'a planta tem node ou conexão inválida';
    return { version: 2, ...sanitizeSettings(raw), factories: [{ id: MIGRATED_ID, name: cleanName(v1Name, 'Fábrica 1'), ...plant }], active: MIGRATED_ID };
  }
  if (raw.version !== 2) return raw.version === undefined ? 'falta o campo "version"' : `versão ${String(raw.version)} não suportada (o app lê as versões 1 e 2)`;
  if (!Array.isArray(raw.factories) || !raw.factories.length) return 'o projeto não tem nenhuma fábrica';
  const factories: Factory[] = [];
  for (const [i, f] of raw.factories.entries()) {
    const ok = sanitizeFactory(f, i);
    if (typeof ok === 'string') return ok;
    if (factories.some((x) => x.id === ok.id)) return `duas fábricas com o mesmo id (${ok.id})`;
    factories.push(ok);
  }
  const active = factories.some((f) => f.id === raw.active) ? (raw.active as string) : factories[0].id;
  return { version: 2, ...sanitizeSettings(raw), factories, active };
}

/** Mantém só o que importa (descarta seleção, medidas etc.) e migra formatos antigos (v1 → v2) */
export function sanitize(raw: unknown): ProjectState | null {
  const r = check(raw);
  return typeof r === 'string' ? null : r;
}

/* ---------- importar (arquivo ou link) ---------- */

/** 'v1' = planta de uma fábrica do formato antigo; 'project' = projeto inteiro; 'factory' = fábrica avulsa */
export type ImportKind = 'v1' | 'project' | 'factory';
export interface Incoming {
  kind: ImportKind;
  /** o conteúdo já validado, como um projeto */
  project: ProjectState;
}
export type ImportResult = { ok: true; incoming: Incoming } | { ok: false; error: string };

/**
 * Detecta o formato (v1, projeto v2 ou fábrica avulsa) e valida tudo com o sanitize.
 * `name` = nome da fábrica quando o conteúdo não traz um (planta v1: o nome do arquivo).
 */
export function parseImport(raw: unknown, name = 'Fábrica importada'): ImportResult {
  const fail = (why: string): ImportResult => ({ ok: false, error: `Não dá pra abrir: ${why}.` });
  if (isObj(raw) && raw.version === 2 && raw.type === 'factory') {
    const f = sanitizeFactory(raw.factory, 0);
    if (typeof f === 'string') return fail(f);
    return { ok: true, incoming: { kind: 'factory', project: { version: 2, ...sanitizeSettings(raw), factories: [f], active: f.id } } };
  }
  const r = check(raw, name);
  if (typeof r === 'string') return fail(r);
  return { ok: true, incoming: { kind: isObj(raw) && raw.version === 1 ? 'v1' : 'project', project: r } };
}

/** Nome que ainda não existe na lista: "Nome", "Nome (2)", "Nome (3)"... */
export function uniqueName(name: string, taken: Iterable<string>) {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let i = 2; ; i++) if (!used.has(`${name} (${i})`)) return `${name} (${i})`;
}

/** Próximo "Fábrica N" livre */
export const nextFactoryName = (factories: { name: string }[]) => {
  const names = new Set(factories.map((f) => f.name));
  let i = factories.length + 1;
  while (names.has(`Fábrica ${i}`)) i++;
  return `Fábrica ${i}`;
};

/**
 * Junta fábricas importadas às existentes: ids que já existem ganham id novo (e as Entradas
 * externas que apontavam pra elas acompanham) e nomes repetidos ganham "(2)", "(3)"...
 */
export function addFactories(existing: Factory[], incoming: Factory[]): { factories: Factory[]; added: Factory[] } {
  const ids = new Set(existing.map((f) => f.id));
  const idMap = new Map<string, string>();
  for (const f of incoming) {
    const id = ids.has(f.id) ? newId('f') : f.id;
    ids.add(id);
    idMap.set(f.id, id);
  }
  const names = existing.map((f) => f.name);
  const added = incoming.map((f): Factory => {
    const name = uniqueName(f.name, names);
    names.push(name);
    return {
      ...structuredClone(f),
      id: idMap.get(f.id)!,
      name,
      nodes: f.nodes.map((n) => {
        const d = n.data;
        if (d.kind !== 'inbound' || !d.link || !idMap.has(d.link.factory)) return structuredClone(n);
        return { ...structuredClone(n), data: { ...d, link: { ...d.link, factory: idMap.get(d.link.factory)! } } } as FactoryNode;
      }),
    };
  });
  return { factories: [...existing, ...added], added };
}

/**
 * Aplica um conteúdo importado (arquivo ou link): 'add' junta as fábricas novas ao projeto
 * (configurações continuam as atuais) e abre a primeira delas; 'replace' troca o projeto
 * inteiro pelo importado (com as configurações dele).
 */
export function applyImport(current: ProjectState, incoming: Incoming, how: 'add' | 'replace'): { project: ProjectState; added: Factory[] } {
  if (how === 'replace') {
    const project = structuredClone(incoming.project);
    return { project, added: project.factories };
  }
  const { factories, added } = addFactories(current.factories, incoming.project.factories);
  return { project: { ...current, factories, active: added[0]?.id ?? current.active }, added };
}

/** Conteúdo do arquivo/link do projeto inteiro */
export function exportProject(p: ProjectState): ProjectExport | null {
  const clean = sanitize(p);
  return clean && { ...clean, type: 'project' };
}

/** Conteúdo do arquivo/link de uma fábrica só */
export function exportFactory(f: Factory): FactoryExport | null {
  const clean = sanitizeFactory(f, 0);
  return typeof clean === 'string' ? null : { version: 2, type: 'factory', factory: clean };
}

/** Quantas fábricas, nodes e conexões (lista de versões, avisos) */
export const projectCounts = (p: ProjectState) => ({
  factories: p.factories.length,
  nodes: p.factories.reduce((a, f) => a + f.nodes.length, 0),
  edges: p.factories.reduce((a, f) => a + f.edges.length, 0),
});

export interface Backup {
  /** horário em que a versão foi guardada (ms) */
  savedAt: number;
  state: ProjectState;
}

/* ---------- trava do salvamento ---------- */

/** Quem está em estado de erro (ex.: o Error Boundary do app ou do canvas): enquanto houver alguém, nada é salvo */
const blockers = new Set<string>();
export const blockSaves = (who: string) => void blockers.add(who);
export const unblockSaves = (who: string) => void blockers.delete(who);
export const savesBlocked = () => blockers.size > 0;

/* ---------- leitura ---------- */

function readMain(): ProjectState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Versões guardadas, da mais nova pra mais antiga (as inválidas são ignoradas; as v1 são migradas) */
export function loadBackups(): Backup[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((b) => {
      const state = isObj(b) && finite(b.savedAt) ? sanitize(b.state) : null;
      return state ? [{ savedAt: b.savedAt as number, state }] : [];
    });
  } catch {
    return [];
  }
}

/** Projeto salvo; se estiver corrompido, a versão mais nova do backup; sem nada, o exemplo */
export function loadState(): ProjectState {
  return readMain() ?? loadBackups()[0]?.state ?? demoState();
}

/** Último projeto bom guardado (o salvo ou, se ele estiver ruim, o backup mais novo) */
export function lastGoodState(): ProjectState | null {
  return readMain() ?? loadBackups()[0]?.state ?? null;
}

/* ---------- gravação ---------- */

function writeBackups(list: Backup[]) {
  // sem espaço: vai largando as versões mais antigas até caber
  for (let n = Math.min(list.length, MAX_BACKUPS); n > 0; n--) {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, n)));
      return;
    } catch {
      /* tenta com menos */
    }
  }
}

/** Conteúdo pra comparar versões: trocar de aba não conta como mudança */
const contentKey = (s: ProjectState) => JSON.stringify({ ...s, active: '' });

/**
 * Guarda a versão no backup rotativo: no máximo uma a cada BACKUP_INTERVAL (ou sempre, com `force`).
 * Projeto sem nenhum node não entra: não há o que restaurar.
 */
function pushBackup(state: ProjectState, now: number, force = false) {
  if (!projectCounts(state).nodes) return;
  const list = loadBackups();
  const latest = list[0];
  if (latest && contentKey(latest.state) === contentKey(state)) return;
  if (latest && !force && now - latest.savedAt < BACKUP_INTERVAL) return;
  writeBackups([{ savedAt: now, state }, ...list]);
}

/**
 * Salva o projeto se ele for válido e nenhum Error Boundary estiver em erro.
 * Retorna se salvou (um estado ruim nunca grava por cima do bom).
 */
export function saveState(s: ProjectState, now = Date.now()): boolean {
  if (savesBlocked()) return false;
  const clean = sanitize(s);
  if (!clean) {
    console.warn('[satisplanner] estado inválido: salvamento automático ignorado');
    return false;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* sem storage, segue sem salvar */
    return false;
  }
  pushBackup(clean, now);
  return true;
}

/** Guarda o projeto atual no backup agora (antes de substituir o projeto por um importado) */
export function backupNow(s: ProjectState, now = Date.now()) {
  if (savesBlocked()) return;
  const clean = sanitize(s);
  if (clean) pushBackup(clean, now, true);
}

/**
 * Volta para uma versão do backup. O projeto atual entra no backup antes, então dá pra desfazer.
 * Retorna o projeto restaurado (null se a versão não existe mais).
 */
export function restoreBackup(savedAt: number, now = Date.now()): ProjectState | null {
  const chosen = loadBackups().find((b) => b.savedAt === savedAt);
  if (!chosen) return null;
  const current = readMain();
  if (current) pushBackup(current, now, true);
  try {
    localStorage.setItem(KEY, JSON.stringify(chosen.state));
  } catch {
    /* sem storage: o app ainda pode aplicar o estado em memória */
  }
  return chosen.state;
}

/** Baixa um conteúdo já validado como .json (Exportar e o backup do painel de erro) */
export function downloadJson(data: object, name: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** "2026-10-01" pro nome dos arquivos */
export const today = () => new Date().toISOString().slice(0, 10);
/** nome de arquivo seguro a partir do nome da fábrica */
export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'fabrica';

const belt = (id: string, source: string, sh: number, target: string, th: number): BeltEdge => ({
  id,
  type: 'belt',
  source,
  sourceHandle: `out-${sh}`,
  target,
  targetHandle: `in-${th}`,
  data: { tier: 1 },
});

/** Exemplo: 60 minério -> 2 fundidoras -> 1 construtora (que só usa 30 lingotes: gera aviso) */
export function demoPlant(): Plant {
  return {
    nodes: [
      { id: 'miner', type: 'miner', position: { x: 0, y: 100 }, data: { kind: 'miner', resource: 'iron-ore', purity: 'normal', tier: 1, clock: 100 } },
      { id: 'split', type: 'splitter', position: { x: 400, y: 220 }, data: { kind: 'splitter' } },
      { id: 'smelt1', type: 'machine', position: { x: 640, y: -170 }, data: { kind: 'machine', machine: 'smelter', recipe: 'iron-ingot', clock: 100 } },
      { id: 'smelt2', type: 'machine', position: { x: 640, y: 450 }, data: { kind: 'machine', machine: 'smelter', recipe: 'iron-ingot', clock: 100 } },
      { id: 'merge', type: 'merger', position: { x: 1080, y: 220 }, data: { kind: 'merger' } },
      { id: 'cons', type: 'machine', position: { x: 1320, y: 110 }, data: { kind: 'machine', machine: 'constructor', recipe: 'iron-plate', clock: 100 } },
      { id: 'store', type: 'sink', position: { x: 1720, y: 270 }, data: { kind: 'sink' } },
    ],
    edges: [
      belt('b1', 'miner', 0, 'split', 0),
      belt('b2', 'split', 0, 'smelt1', 0),
      belt('b3', 'split', 2, 'smelt2', 0),
      belt('b4', 'smelt1', 0, 'merge', 0),
      belt('b5', 'smelt2', 0, 'merge', 2),
      belt('b6', 'merge', 0, 'cons', 0),
      belt('b7', 'cons', 0, 'store', 0),
    ],
  };
}

/** Projeto do exemplo: uma fábrica com a planta de exemplo */
export function demoState(): ProjectState {
  return {
    version: 2,
    defaultTier: 1,
    defaultPipeTier: 1,
    gridBelts: true,
    beltLabels: true,
    factories: [{ id: MIGRATED_ID, name: 'Fábrica 1', ...demoPlant() }],
    active: MIGRATED_ID,
  };
}
