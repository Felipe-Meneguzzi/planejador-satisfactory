/**
 * Cruza um save do Satisfactory com o catálogo do mapa (todos os itens do mundo, em src/map/catalog.json)
 * e edita os waypoints do save. Trabalha sobre o objeto que o parser devolve, mas só toca no que precisa,
 * então os tipos são mínimos.
 */

/** extensão do mapa em unidades do jogo (cm); X cresce pra direita e Y pra baixo */
export const MAP_BOUNDS = { minX: -324698.832, maxX: 425301.832, minY: -375000, maxY: 375000 };

/** limite de waypoints do jogo */
export const MAX_MARKERS = 250;

// ---------- catálogo ----------

export type LayerKind = 'collect' | 'node' | 'poi';

export interface Layer {
  id: string;
  tab: string;
  /** recurso (nós e poços) ou grupo da camada */
  group: string;
  name: string;
  kind: LayerKind;
  color: string;
  purity?: 'impure' | 'normal' | 'pure';
  count: number;
}

/** [nome da instância sem o prefixo, x, y, z, item (só HDs)] */
export type CatalogRow = [string, number, number, number, string?];

export interface Catalog {
  build: number;
  layers: Layer[];
  pts: Record<string, CatalogRow[]>;
}

const PREFIX = 'Persistent_Level:PersistentLevel.';

// ---------- leitura ----------

export interface Spot {
  id: string;
  layer: Layer;
  x: number;
  y: number;
  z: number;
  /** open: ainda para pegar (ou nó livre); done: já pego (ou nó com extrator) */
  state: 'open' | 'done';
  /** HDs: item que a pesquisa pede */
  item?: string;
}

export interface Waypoint {
  /** identificador estável (o guid do jogo) */
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** cor em #rrggbb (sRGB) */
  color: string;
  iconId: number;
}

export interface MapInfo {
  sessionName: string;
  saveName: string;
  playHours: number;
  spots: Spot[];
  waypoints: Waypoint[];
  player: { x: number; y: number } | null;
  /** ids de ícone usados pelos waypoints que já existem no save */
  iconsInUse: number[];
}

// só o necessário do que o parser devolve
interface Prop {
  value?: any;
  [k: string]: any;
}
interface SaveObject {
  typePath: string;
  instanceName: string;
  properties?: Record<string, Prop>;
  transform?: { translation: { x: number; y: number; z: number } };
}
export interface SaveLike {
  header: { sessionName: string; saveName?: string; playDurationSeconds: number };
  levels: Record<string, { objects: SaveObject[] }>;
}

function* objectsOf(save: SaveLike): Generator<SaveObject> {
  for (const level of Object.values(save.levels)) yield* level.objects;
}

function markerList(save: SaveLike): { values: Prop[] } | null {
  for (const o of objectsOf(save)) {
    if (o.typePath.endsWith('.FGMapManager')) return (o.properties?.mMapMarkers as { values: Prop[] } | undefined) ?? null;
  }
  return null;
}

const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hex2 = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');

/** as cores do save são lineares; devolve #rrggbb de tela */
export function linearToHex(c: { r: number; g: number; b: number }): string {
  return `#${hex2(toSrgb(c.r))}${hex2(toSrgb(c.g))}${hex2(toSrgb(c.b))}`;
}
export function hexToLinear(hex: string): { r: number; g: number; b: number; a: number } {
  const n = (i: number) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255);
  return { r: n(1), g: n(3), b: n(5), a: 1 };
}

const guidKey = (g: number[]) => g.join('-');

function readWaypoint(m: Prop): Waypoint | null {
  const p = m.properties;
  const loc = p?.Location?.value?.properties;
  if (!p || !loc) return null;
  return {
    id: guidKey(p.markerGuid.value),
    name: p.Name?.value ?? '',
    x: loc.X.value,
    y: loc.Y.value,
    z: loc.Z.value,
    color: p.Color?.value ? linearToHex(p.Color.value) : '#ffffff',
    iconId: p.IconID?.value ?? 0,
  };
}

export function readMap(save: SaveLike, catalog: Catalog): MapInfo {
  // o que existe no mundo, e quais recursos já têm extrator em cima
  const live = new Set<string>();
  const mined = new Set<string>();
  let player: MapInfo['player'] = null;
  for (const o of objectsOf(save)) {
    live.add(o.instanceName);
    const res = o.properties?.mExtractableResource?.value?.pathName;
    if (res) mined.add(res);
    const t = o.transform?.translation;
    if (t && o.typePath.endsWith('.Char_Player_C')) player ??= { x: t.x, y: t.y };
  }

  const spots: Spot[] = [];
  for (const layer of catalog.layers) {
    for (const [name, x, y, z, item] of catalog.pts[layer.id] ?? []) {
      const full = PREFIX + name;
      // coletável: o objeto some do mundo quando é pego
      const done = layer.kind === 'collect' ? !live.has(full) : layer.kind === 'node' ? mined.has(full) : false;
      spots.push({ id: full, layer, x, y, z, state: done ? 'done' : 'open', item });
    }
  }

  const waypoints = (markerList(save)?.values ?? []).map(readWaypoint).filter((w): w is Waypoint => w !== null);
  return {
    sessionName: save.header.sessionName,
    saveName: save.header.saveName ?? '',
    playHours: save.header.playDurationSeconds / 3600,
    spots,
    waypoints,
    player,
    iconsInUse: [...new Set(waypoints.map((w) => w.iconId))],
  };
}

// ---------- waypoints ----------

/** nome do waypoint de um ponto: o da camada e, nos HDs, o item que a pesquisa pede */
export function waypointName(s: Spot): string {
  return s.item ? `${s.layer.name} (${s.item})` : s.layer.name;
}

/** Já existe um waypoint com o nome da camada em cima do ponto? (evita duplicar ao criar em lote) */
export function hasWaypoint(s: Spot, waypoints: Waypoint[]): boolean {
  return waypoints.some((w) => w.name.startsWith(s.layer.name) && Math.hypot(w.x - s.x, w.y - s.y) < 300);
}

export const DISTANCES = [
  { id: 'CVD_Off', label: 'Desligada' },
  { id: 'CVD_Near', label: 'Perto' },
  { id: 'CVD_Mid', label: 'Média' },
  { id: 'CVD_Far', label: 'Longe' },
] as const;
export type Distance = (typeof DISTANCES)[number]['id'];

/** ícones 650–663 são "carimbos" no jogo; os outros são marcadores comuns */
export const isStampIcon = (id: number) => id >= 650 && id <= 663;

export interface NewWaypoint {
  name: string;
  x: number;
  y: number;
  z: number;
  /** #rrggbb */
  color: string;
  iconId: number;
  distance: Distance;
}

function randomGuid(): number[] {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return Array.from(a);
}

/**
 * Cria waypoints no save (alterando o objeto). Usa um waypoint que já existe como molde, porque o
 * parser precisa do mesmo formato. Devolve quantos criou ou o motivo de não ter conseguido.
 */
export function addWaypoints(save: SaveLike, items: NewWaypoint[]): { ok: true; added: number } | { ok: false; error: string } {
  const list = markerList(save);
  if (!list) return { ok: false, error: 'Este save não tem o gerenciador de mapa; abra o jogo e salve de novo.' };
  const template = list.values[0];
  if (!template) return { ok: false, error: 'Crie um waypoint qualquer no jogo e salve; ele serve de molde para os novos.' };
  if (list.values.length + items.length > MAX_MARKERS) {
    return { ok: false, error: `O jogo aceita no máximo ${MAX_MARKERS} waypoints; este save tem ${list.values.length} e você pediu mais ${items.length}.` };
  }
  for (const it of items) {
    const m = structuredClone(template) as Prop;
    const p = m.properties;
    p.markerGuid.value = randomGuid();
    p.Name.value = it.name;
    p.CategoryName.value = '';
    const loc = p.Location.value.properties;
    loc.X.value = it.x;
    loc.Y.value = it.y;
    loc.Z.value = it.z;
    p.Color.value = hexToLinear(it.color);
    p.IconID.value = it.iconId;
    p.MapMarkerType.value = { value: `ERepresentationType::${isStampIcon(it.iconId) ? 'RT_Stamp' : 'RT_MapMarker'}` };
    if (p.CompassViewDistance) p.CompassViewDistance.value = { value: `ECompassViewDistance::${it.distance}` };
    if (p.Scale) p.Scale.value = 1;
    list.values.push(m);
  }
  return { ok: true, added: items.length };
}

export function removeWaypoint(save: SaveLike, id: string): boolean {
  const list = markerList(save);
  if (!list) return false;
  const i = list.values.findIndex((m) => m.properties?.markerGuid && guidKey(m.properties.markerGuid.value) === id);
  if (i < 0) return false;
  list.values.splice(i, 1);
  return true;
}
