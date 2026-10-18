import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as RPointerEvent } from 'react';
import {
  DISTANCES,
  MAP_BOUNDS,
  MAX_MARKERS,
  addWaypoints,
  hasWaypoint,
  readMap,
  removeWaypoint,
  waypointName,
  type Catalog,
  type Distance,
  type Layer,
  type MapInfo,
  type SaveLike,
  type Spot,
  type Waypoint,
} from '../map/saveMap';
import { ICONS, iconName, iconSrc } from '../map/icons';

const { minX, maxX, minY, maxY } = MAP_BOUNDS;
const WORLD_W = maxX - minX;
const STYLE_KEY = 'satisplanner:map-styles';
const MAP_IMAGE = `${import.meta.env.BASE_URL}map.jpg`;

// ---------- linhas do filtro ----------

interface Row {
  key: string;
  label: string;
  section: string;
  color: string;
  layers: Layer[];
}

const SECTIONS = ['Coletáveis', 'Lesmas', 'Consumíveis', 'Nós de recursos', 'Poços e gêiseres', 'Locais'];
const ON_BY_DEFAULT = new Set(['Coletáveis', 'Lesmas']);

function sectionOf(l: Layer): string {
  if (l.tab === 'resource_nodes') return 'Nós de recursos';
  if (l.tab === 'resource_wells') return 'Poços e gêiseres';
  if (l.tab === 'power_slugs') return 'Lesmas';
  if (l.kind === 'poi') return 'Locais';
  return ['paleBerry', 'berylNut', 'baconAgaric'].includes(l.id) ? 'Consumíveis' : 'Coletáveis';
}

/** nós e poços agrupam as purezas numa linha só; o resto é uma linha por camada */
const rowKeyOf = (l: Layer) => (l.kind === 'node' ? l.group : l.id);

function buildRows(layers: Layer[]): Row[] {
  const rows = new Map<string, Row>();
  for (const l of layers) {
    const key = rowKeyOf(l);
    const row = rows.get(key);
    if (row) row.layers.push(l);
    else rows.set(key, { key, label: l.kind === 'node' ? l.group : l.name, section: sectionOf(l), color: l.color, layers: [l] });
  }
  return [...rows.values()];
}

// ---------- estilo dos waypoints ----------

interface Style {
  icon: number;
  distance: Distance;
  color: string;
}

const DEFAULT_ICONS: Record<string, number> = {
  hardDrives: 652,
  somersloops: 661,
  mercerSpheres: 656,
  greenSlugs: 663,
  yellowSlugs: 663,
  purpleSlugs: 663,
  paleBerry: 662,
  berylNut: 662,
  baconAgaric: 662,
  caves: 651,
};

function defaultStyle(row: Row): Style {
  const l = row.layers[0];
  const icon = DEFAULT_ICONS[row.key] ?? (l.kind === 'node' ? (l.tab === 'resource_wells' ? 657 : 660) : 349);
  return { icon, distance: 'CVD_Mid', color: row.color };
}

function loadStyles(): Record<string, Partial<Style>> {
  try {
    return JSON.parse(localStorage.getItem(STYLE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

// ---------- desenho ----------

interface View {
  /** centro, em unidades do jogo */
  x: number;
  y: number;
  /** pixels por unidade */
  k: number;
}

const PURITY_R = { impure: 3.5, normal: 5, pure: 6.5 } as const;
const radiusOf = (l: Layer) => (l.purity ? PURITY_R[l.purity] : l.kind === 'poi' ? 4 : 5);
const MAX_K = 0.08;

type Hit = { type: 'spot'; spot: Spot } | { type: 'wp'; wp: Waypoint };
type Selection = { type: 'spot' | 'wp'; id: string } | null;

export function MapModal({ onClose }: { onClose: () => void }) {
  const saveRef = useRef<SaveLike | null>(null);
  const fileName = useRef('save.sav');
  const catalogRef = useRef<Catalog | null>(null);
  const [info, setInfo] = useState<MapInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [purities, setPurities] = useState({ impure: true, normal: true, pure: true });
  const [showDone, setShowDone] = useState(true);
  const [showWaypoints, setShowWaypoints] = useState(true);
  const [selected, setSelected] = useState<Selection>(null);
  const [styles, setStyles] = useState(loadStyles);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: (minX + maxX) / 2, y: 0, k: 0.001 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const iconCache = useRef(new Map<number, HTMLImageElement>());
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const refresh = () => {
    if (saveRef.current && catalogRef.current) setInfo(readMap(saveRef.current, catalogRef.current));
  };

  const styleOf = useCallback((row: Row): Style => ({ ...defaultStyle(row), ...styles[row.key] }), [styles]);
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  const setStyle = (key: string, patch: Partial<Style>) => {
    setStyles((cur) => {
      const next = { ...cur, [key]: { ...cur[key], ...patch } };
      try {
        localStorage.setItem(STYLE_KEY, JSON.stringify(next));
      } catch {
        /* sem armazenamento: vale só nesta sessão */
      }
      return next;
    });
  };

  // ---------- abrir o save ----------
  const openSave = async (file: File) => {
    setError(null);
    setBusy('Lendo o save…');
    try {
      const bytes = await file.arrayBuffer();
      // deixa a mensagem aparecer antes do parse travar a thread por ~1s
      await new Promise((r) => setTimeout(r, 30));
      const [{ Parser }, cat] = await Promise.all([import('@etothepii/satisfactory-file-parser'), import('../map/catalog.json')]);
      const catalog = (cat.default ?? cat) as unknown as Catalog;
      const save = Parser.ParseSave(file.name, bytes) as unknown as SaveLike;
      saveRef.current = save;
      catalogRef.current = catalog;
      fileName.current = file.name;
      const r = buildRows(catalog.layers);
      setRows(r);
      setOn(Object.fromEntries(r.map((x) => [x.key, ON_BY_DEFAULT.has(x.section)])));
      setEdits(0);
      setSelected(null);
      refresh();
    } catch (e) {
      saveRef.current = null;
      setInfo(null);
      setError(`Não consegui ler este arquivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void openSave(f);
  };

  // ---------- criar e apagar waypoints ----------
  const createFor = (spots: Spot[]) => {
    const save = saveRef.current;
    if (!save || !spots.length) return;
    if (spots.length > 40 && !window.confirm(`Criar ${spots.length} waypoints no save?`)) return;
    const r = addWaypoints(
      save,
      spots.map((s) => {
        const st = styleOf(rowByKey.get(rowKeyOf(s.layer))!);
        return { name: waypointName(s), x: s.x, y: s.y, z: s.z, color: st.color, iconId: st.icon, distance: st.distance };
      }),
    );
    if (!r.ok) return setError(r.error);
    setError(null);
    setEdits((n) => n + r.added);
    refresh();
  };

  const deleteWaypoint = (id: string) => {
    const save = saveRef.current;
    if (!save || !removeWaypoint(save, id)) return;
    setEdits((n) => n + 1);
    setSelected(null);
    refresh();
  };

  const download = async () => {
    const save = saveRef.current;
    if (!save) return;
    setBusy('Gerando o save…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { Parser } = await import('@etothepii/satisfactory-file-parser');
      const parts: BlobPart[] = [];
      Parser.WriteSave(
        save as never,
        (h) => parts.push(h as BlobPart),
        (c) => parts.push(c as BlobPart),
      );
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.current;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setEdits(0);
    } catch (e) {
      setError(`Não consegui gerar o save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // ---------- o que está visível ----------
  const visibleSpots = useMemo(
    () =>
      info
        ? info.spots.filter((s) => on[rowKeyOf(s.layer)] && (!s.layer.purity || purities[s.layer.purity]) && (showDone || s.state === 'open'))
        : [],
    [info, on, purities, showDone],
  );

  /** por linha: quantos ainda faltam e quais desses ainda não têm waypoint */
  const counts = useMemo(() => {
    const c = new Map<string, { total: number; open: number; todo: Spot[] }>();
    if (!info) return c;
    for (const s of info.spots) {
      const k = rowKeyOf(s.layer);
      const e = c.get(k) ?? { total: 0, open: 0, todo: [] };
      e.total++;
      if (s.state === 'open') {
        e.open++;
        if (!hasWaypoint(s, info.waypoints) && (!s.layer.purity || purities[s.layer.purity])) e.todo.push(s);
      }
      c.set(k, e);
    }
    return c;
  }, [info, purities]);

  const markAllSelected = () => createFor(rows.filter((r) => on[r.key]).flatMap((r) => counts.get(r.key)?.todo ?? []));

  // ---------- geometria ----------
  const toScreen = useCallback((x: number, y: number) => [(x - view.x) * view.k + size.w / 2, (y - view.y) * view.k + size.h / 2], [view, size]);

  const fit = useCallback(() => {
    const k = Math.min(size.w, size.h) / (maxY - minY);
    setView({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, k });
  }, [size]);

  const minK = Math.min(size.w, size.h) / (maxY - minY) / 1.2;

  // o canvas acompanha o tamanho do painel
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [info]);

  // enquadra o mapa inteiro na primeira vez que o tamanho é conhecido
  const fitted = useRef(false);
  useEffect(() => {
    if (info && !fitted.current && size.w > 50) {
      fitted.current = true;
      fit();
    }
  }, [info, size, fit]);

  // imagem do mapa
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      bgRef.current = img;
      setTick((t) => t + 1);
    };
    img.src = MAP_IMAGE;
  }, []);

  const iconImage = useCallback((id: number) => {
    let img = iconCache.current.get(id);
    if (!img) {
      img = new Image();
      img.onload = () => setTick((t) => t + 1);
      img.src = iconSrc(id);
      iconCache.current.set(id, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }, []);

  // ---------- desenhar ----------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !info) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1c2a30';
    ctx.fillRect(0, 0, size.w, size.h);

    const [x0, y0] = toScreen(minX, minY);
    const w = WORLD_W * view.k;
    if (bgRef.current) ctx.drawImage(bgRef.current, x0, y0, w, w);
    else {
      ctx.strokeStyle = '#353a44';
      ctx.strokeRect(x0, y0, w, w);
    }

    const onScreen = (sx: number, sy: number) => sx > -12 && sy > -12 && sx < size.w + 12 && sy < size.h + 12;
    const sel = selected;

    for (const s of visibleSpots) {
      const [sx, sy] = toScreen(s.x, s.y);
      if (!onScreen(sx, sy)) continue;
      const r = radiusOf(s.layer);
      const done = s.state === 'done';
      ctx.globalAlpha = done ? 0.4 : 1;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = done ? '#9aa0a8' : s.layer.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (sel?.type === 'spot' && sel.id === s.id) {
        ctx.beginPath();
        ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (showWaypoints) {
      for (const wp of info.waypoints) {
        const [sx, sy] = toScreen(wp.x, wp.y);
        if (!onScreen(sx, sy)) continue;
        const isSel = sel?.type === 'wp' && sel.id === wp.id;
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.fillStyle = wp.color;
        ctx.fill();
        ctx.lineWidth = isSel ? 3 : 1.5;
        ctx.strokeStyle = isSel ? '#fff' : '#000';
        ctx.stroke();
        const img = iconImage(wp.iconId);
        if (img) ctx.drawImage(img, sx - 7, sy - 7, 14, 14);
      }
    }

    if (info.player) {
      const [sx, sy] = toScreen(info.player.x, info.player.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#f39c3c';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#f39c3c';
      ctx.fill();
    }
  }, [info, visibleSpots, view, size, selected, showWaypoints, toScreen, iconImage, tick]);

  // ---------- mouse ----------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left - size.w / 2;
      const my = e.clientY - rect.top - size.h / 2;
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(minK, v.k * Math.exp(-e.deltaY * 0.0015)));
        // o ponto sob o cursor fica parado
        return { k, x: v.x + mx / v.k - mx / k, y: v.y + my / v.k - my / k };
      });
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [info, size, minK]);

  const hitAt = (clientX: number, clientY: number): Hit | null => {
    const cv = canvasRef.current;
    if (!cv || !info) return null;
    const rect = cv.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    // waypoints têm prioridade sobre os pontos que ficam embaixo deles
    let best: Hit | null = null;
    let bestD = 11;
    if (showWaypoints) {
      for (const wp of info.waypoints) {
        const [sx, sy] = toScreen(wp.x, wp.y);
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestD) {
          bestD = d;
          best = { type: 'wp', wp };
        }
      }
    }
    if (best) return best;
    bestD = 10;
    for (const s of visibleSpots) {
      const [sx, sy] = toScreen(s.x, s.y);
      if (Math.abs(sx - px) > bestD || Math.abs(sy - py) > bestD) continue;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) {
        bestD = d;
        best = { type: 'spot', spot: s };
      }
    }
    return best;
  };

  const stateText = (s: Spot) => (s.state === 'done' ? (s.layer.kind === 'node' ? ' · ocupado' : ' · já pego') : '');
  const hitText = (h: Hit) => (h.type === 'wp' ? `⚑ ${h.wp.name || '(sem nome)'}` : `${waypointName(h.spot)}${stateText(h.spot)}`);

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setHover(null);
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) {
      const h = hitAt(e.clientX, e.clientY);
      const rect = e.currentTarget.getBoundingClientRect();
      setHover(h ? { x: e.clientX - rect.left, y: e.clientY - rect.top, text: hitText(h) } : null);
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (!d.moved) return;
    d.x = e.clientX;
    d.y = e.clientY;
    setView((v) => ({ ...v, x: v.x - dx / v.k, y: v.y - dy / v.k }));
  };
  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const h = hitAt(e.clientX, e.clientY);
    if (!h) return setSelected(null);
    setSelected(h.type === 'wp' ? { type: 'wp', id: h.wp.id } : { type: 'spot', id: h.spot.id });
  };

  const zoomTo = (x: number, y: number) => setView({ x, y, k: 0.012 });

  // ---------- seleção ----------
  const sel = useMemo(() => {
    if (!info || !selected) return null;
    if (selected.type === 'spot') {
      const s = info.spots.find((x) => x.id === selected.id);
      return s ? { spot: s } : null;
    }
    const w = info.waypoints.find((x) => x.id === selected.id);
    return w ? { wp: w } : null;
  }, [info, selected]);

  const close = useCallback(() => {
    if (edits > 0 && !window.confirm('Você tem alterações que ainda não foram baixadas. Fechar mesmo assim?')) return;
    onClose();
  }, [edits, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const editRow = editKey ? rowByKey.get(editKey) : undefined;
  const editStyle = editRow ? styleOf(editRow) : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal map-modal" role="dialog" aria-label="Mapa do save">
        <div className="modal-head">
          <h2>🗺 Mapa do save</h2>
          <button className="modal-x" onClick={close} aria-label="Fechar">
            ✕
          </button>
        </div>

        {!info ? (
          <div className="map-empty">
            <p>Abra o seu save mais recente (<code>.sav</code>) para ver onde estão HDs, Somersloops, Esferas de Mercer, lesmas e nós de recurso, e o que você já pegou.</p>
            <p className="muted">O arquivo é lido aqui no navegador e não é enviado para lugar nenhum. No Windows os saves ficam em <code>%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\</code>.</p>
            <label className="map-btn primary">
              Escolher save…
              <input type="file" accept=".sav" hidden onChange={onFile} data-testid="map-save-file" />
            </label>
            {busy && <p>{busy}</p>}
            {error && <p className="map-error">{error}</p>}
          </div>
        ) : (
          <div className="map-body">
            <aside className="map-side">
              <div className="map-session">
                <strong>{info.sessionName}</strong>
                <span className="muted">
                  {info.saveName} · {info.playHours.toFixed(1)} h de jogo
                </span>
                <label className="map-link">
                  Trocar save…
                  <input type="file" accept=".sav" hidden onChange={onFile} />
                </label>
              </div>

              <button
                className="map-btn primary"
                title="Cria um waypoint em cada item que ainda falta e que está marcado nos filtros abaixo"
                disabled={!rows.some((r) => on[r.key] && counts.get(r.key)?.todo.length)}
                onClick={markAllSelected}
                data-testid="map-create-all"
              >
                ⚑ Marcar automaticamente todos os itens
              </button>

              <div className="map-opts">
                <label>
                  <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Mostrar já pegos / ocupados
                </label>
                <label>
                  <input type="checkbox" checked={showWaypoints} onChange={(e) => setShowWaypoints(e.target.checked)} /> ⚑ Waypoints ({info.waypoints.length}/{MAX_MARKERS})
                </label>
              </div>

              {SECTIONS.map((sec) => {
                const secRows = rows.filter((r) => r.section === sec);
                if (!secRows.length) return null;
                return (
                  <div key={sec} className="map-group">
                    <h3>
                      {sec}
                      {sec === 'Nós de recursos' && (
                        <span className="map-purity">
                          {(['impure', 'normal', 'pure'] as const).map((p) => (
                            <label key={p} title={{ impure: 'Impuro', normal: 'Normal', pure: 'Puro' }[p]}>
                              <input type="checkbox" checked={purities[p]} onChange={(e) => setPurities({ ...purities, [p]: e.target.checked })} />
                              {{ impure: 'Imp', normal: 'Nor', pure: 'Pur' }[p]}
                            </label>
                          ))}
                        </span>
                      )}
                    </h3>
                    {secRows.map((r) => {
                      const c = counts.get(r.key) ?? { total: 0, open: 0, todo: [] };
                      const isNode = r.layers[0].kind === 'node';
                      return (
                        <div key={r.key} className="map-kind">
                          <label>
                            <input type="checkbox" checked={!!on[r.key]} onChange={(e) => setOn({ ...on, [r.key]: e.target.checked })} />
                            <i style={{ background: r.color }} />
                            {r.label}
                          </label>
                          <span className="muted" title={isNode ? 'Livres / total' : 'Faltam pegar / total'}>
                            {c.open}/{c.total}
                          </span>
                          <div className="map-kind-actions">
                            <button
                              className="map-mini"
                              disabled={!c.todo.length}
                              title={c.todo.length ? `Cria um waypoint em cada um dos ${c.todo.length} que ainda não têm` : 'Nada a marcar'}
                              onClick={() => createFor(c.todo)}
                              data-testid={`map-create-${r.key}`}
                            >
                              ⚑ Marcar todos ({c.todo.length})
                            </button>
                            <button
                              className={`map-mini ${editKey === r.key ? 'on' : ''}`}
                              title="Escolher ícone, distância e cor dos waypoints deste item"
                              onClick={() => setEditKey(editKey === r.key ? null : r.key)}
                            >
                              <img className="map-ico" src={iconSrc(styleOf(r).icon)} alt="" /> ⚙
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {editRow && editStyle && (
                <div className="map-card map-style" data-testid="map-style">
                  <strong>Waypoints de “{editRow.label}”</strong>
                  <span className="muted">Ícone</span>
                  <div className="map-icons">
                    {[...new Set([...info.iconsInUse, ...ICONS.map((i) => i.id)])].map((id) => (
                      <button
                        key={id}
                        className={id === editStyle.icon ? 'on' : ''}
                        title={`${iconName(id)}${info.iconsInUse.includes(id) ? ' (já usado no seu save)' : ''}`}
                        onClick={() => setStyle(editRow.key, { icon: id })}
                      >
                        <img src={iconSrc(id)} alt={iconName(id)} />
                      </button>
                    ))}
                  </div>
                  <label className="map-field">
                    Visível na bússola
                    <select value={editStyle.distance} onChange={(e) => setStyle(editRow.key, { distance: e.target.value as Distance })}>
                      {DISTANCES.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="map-field">
                    Cor
                    <input type="color" value={editStyle.color} onChange={(e) => setStyle(editRow.key, { color: e.target.value })} />
                  </label>
                </div>
              )}

              {sel?.spot && (
                <div className="map-card">
                  <strong>{waypointName(sel.spot)}</strong>
                  <span className="muted">
                    {sel.spot.state === 'done' ? (sel.spot.layer.kind === 'node' ? 'Ocupado por um extrator' : 'Já pego') : sel.spot.layer.kind === 'node' ? 'Livre' : 'Ainda não pego'} · X {Math.round(sel.spot.x)} · Y {Math.round(sel.spot.y)} · Z {Math.round(sel.spot.z)}
                  </span>
                  <button className="map-btn" disabled={hasWaypoint(sel.spot, info.waypoints)} onClick={() => createFor([sel.spot!])}>
                    {hasWaypoint(sel.spot, info.waypoints) ? 'Já tem waypoint' : '⚑ Criar waypoint aqui'}
                  </button>
                </div>
              )}
              {sel?.wp && (
                <div className="map-card">
                  <strong>⚑ {sel.wp.name || '(sem nome)'}</strong>
                  <span className="muted">
                    {iconName(sel.wp.iconId)} · X {Math.round(sel.wp.x)} · Y {Math.round(sel.wp.y)} · Z {Math.round(sel.wp.z)}
                  </span>
                  <button className="map-btn danger" onClick={() => deleteWaypoint(sel.wp!.id)}>
                    Apagar waypoint
                  </button>
                </div>
              )}

              <details className="map-group">
                <summary>Meus waypoints ({info.waypoints.length})</summary>
                <ul className="map-wps">
                  {info.waypoints.map((w) => (
                    <li key={w.id}>
                      <button
                        onClick={() => {
                          setSelected({ type: 'wp', id: w.id });
                          zoomTo(w.x, w.y);
                        }}
                      >
                        <i style={{ background: w.color }} />
                        {w.name || '(sem nome)'}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>

              {error && <p className="map-error">{error}</p>}
            </aside>

            <div className="map-stage" ref={stageRef}>
              <canvas
                ref={canvasRef}
                style={{ width: size.w, height: size.h }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={() => setHover(null)}
                data-testid="map-canvas"
              />
              {hover && (
                <div className="map-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
                  {hover.text}
                </div>
              )}
              <button className="map-reset" onClick={fit} title="Ver o mapa inteiro">
                ⤢
              </button>
              <div className="map-hint">Arraste para mover · roda do mouse para zoom · ◎ você</div>
            </div>
          </div>
        )}

        {info && (
          <div className="modal-foot">
            <span className="muted">
              {edits > 0
                ? `${edits} alteração(ões) ainda não baixada(s). O arquivo baixado substitui o save: faça uma cópia do original antes e feche o jogo.`
                : 'Sem alterações. Crie waypoints e baixe o save para jogar com eles.'}
            </span>
            <button className="map-btn primary" disabled={!edits || !!busy} onClick={download} data-testid="map-download">
              ⬇ Baixar save editado
            </button>
            {busy && <span>{busy}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
