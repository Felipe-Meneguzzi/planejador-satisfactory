import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { GAME_VERSION, GENERATORS, MACHINES } from './game/data';
import { mediumsMatch, portMedium } from './game/ports';
import { isAnnotation, isProduction, type BeltEdge, type BeltTier, type FactoryData, type FactoryNode, type PipeTier } from './game/types';
import { fmt } from './format';
import { GRID } from './grid';
import { ANNOTATION_COLORS, annotationNode, frameMembers, snapGrid } from './game/annotations';

/** diâmetro dos pontos do fundo */
const DOT = 1.2;
import { nextRotation, nodeTypes } from './components/nodes';
import { edgeTypes } from './components/BeltEdge';
import { DND_TYPE, Palette } from './components/Palette';
import { SidePanel } from './components/SidePanel';
import { BeltInspector } from './components/BeltInspector';
import { SimContext } from './sim/SimContext';
import { EMPTY_SIM } from './sim/SimContext';
import { ProjectContext, type ProjectInfo } from './sim/ProjectContext';
import { simulateProject, summarizeProject, type ProjectFactory, type SimCache } from './sim/project';
import type { EnergyResult, Issue, SimEdge } from './sim/simulate';
import {
  applyImport,
  backupNow,
  demoPlant,
  downloadJson,
  exportFactory,
  exportProject,
  loadState,
  newId,
  nextFactoryName,
  parseImport,
  sanitizePlant,
  saveState,
  slug,
  today,
  uniqueName,
  type Factory,
  type Incoming,
  type ProjectState,
} from './state/storage';
import { decodeShare, isShareHash, shareUrl } from './state/share';
import { useHistory, type Snapshot } from './state/useHistory';
import { useClipboard } from './state/useClipboard';
import { useBoxSelection } from './state/useBoxSelection';
import { LabelRootContext, SettingsContext } from './state/settings';
import { PlannerModal } from './components/PlannerModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CanvasCrash } from './components/RecoveryPanel';
import { BackupMenu } from './components/Backups';
import { FactoryTabs } from './components/FactoryTabs';
import { IncomingDialog } from './components/IncomingDialog';
import { ShareDialog, type ShareScope } from './components/ShareDialog';
import { ProjectSummary } from './components/ProjectSummary';
import { MenuButton } from './components/Popover';
import { debugCrash } from './errors';
import { layoutPlan, type DistributionMode } from './planner/layout';
import type { Plan } from './planner/plan';

export default function App() {
  return (
    <ReactFlowProvider>
      <Planner />
    </ReactFlowProvider>
  );
}

/** Erro forçado de teste dentro do canvas (ver debugCrash) */
function CanvasDebugCrash() {
  debugCrash('canvas');
  return null;
}

/** Consumo da planta; com geradores, "consumo / geração" (vermelho se faltar energia) */
function EnergyChip({ energy }: { energy: EnergyResult }) {
  if (!energy.generators)
    return (
      <span className="chip" title="Consumo de energia (sem geradores na planta)">
        ⚡ {fmt(energy.consumption)} MW
      </span>
    );
  const short = energy.consumption > energy.generation + 1e-6;
  return (
    <span
      className={`chip energy-chip ${short ? 'err' : 'ok'}`}
      title={`Consumo / geração${energy.boost > 1e-6 ? ` (com +${fmt(energy.boost)} MW do Alien Power Augmenter)` : ''}${short ? ' — falta energia' : ''}`}
    >
      ⚡ {fmt(energy.consumption)} / {fmt(energy.generation)} MW
    </span>
  );
}

const minimapColor = (n: FactoryNode) => {
  const d = n.data;
  // moldura translúcida (não esconde o que está dentro); anotação com a cor dela
  if (d.kind === 'frame') return `${ANNOTATION_COLORS[d.color]?.base ?? '#6b7686'}40`;
  if (d.kind === 'note') return ANNOTATION_COLORS[d.color]?.base ?? '#6b7686';
  if (d.kind === 'miner') return '#7d5236';
  if (d.kind === 'extractor' || d.kind === 'well') return '#1f5f8b';
  if ((d.kind === 'splitter' || d.kind === 'merger') && d.fluid) return '#3b6f99';
  if (d.kind === 'machine') return MACHINES[d.machine].color;
  if (d.kind === 'sink') return d.mode === 'awesome' ? '#7d3a8c' : '#2f7a52';
  if (d.kind === 'generator') return GENERATORS[d.generator]?.color ?? '#555b66';
  if (d.kind === 'inbound') return '#22707a';
  if (d.kind === 'outbound') return '#8a5a1f';
  return '#555b66';
};


/**
 * true enquanto o Alt estiver pressionado (sincroniza também pelo mouse, caso um keyup se perca).
 * Alt e não Ctrl: Ctrl+clique é a multisseleção do React Flow e as duas coisas brigavam.
 */
function useAltHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent | MouseEvent) => setHeld(e.altKey);
    const onKey = (e: KeyboardEvent) => {
      sync(e);
      // Soltar o Alt sozinho ativa o menu do navegador (Windows) e rouba o foco do teclado
      if (e.key === 'Alt') e.preventDefault();
    };
    const release = () => setHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('mousemove', sync);
    window.addEventListener('mousedown', sync);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('mousemove', sync);
      window.removeEventListener('mousedown', sync);
      window.removeEventListener('blur', release);
    };
  }, []);
  return held;
}

/** Conexão no formato da simulação */
const toSimEdge = (e: BeltEdge): SimEdge => ({
  id: e.id,
  source: e.source,
  sourceHandle: e.sourceHandle,
  target: e.target,
  targetHandle: e.targetHandle,
  tier: e.data?.tier ?? 1,
  medium: e.type === 'pipe' ? 'pipe' : 'belt',
});
/** Só o que afeta o fluxo (arrastar node ou mexer em moldura/anotação não muda): chave do cache da simulação */
const simKeyOf = (nodes: FactoryNode[], edges: BeltEdge[]) =>
  JSON.stringify([
    nodes.filter((n) => isProduction(n.data)).map((n) => [n.id, n.data]),
    edges.map((e) => [e.id, e.type, e.source, e.sourceHandle, e.target, e.targetHandle, e.data?.tier]),
  ]);
const toSimFactory = (f: Factory, key = simKeyOf(f.nodes, f.edges)): ProjectFactory => ({
  id: f.id,
  name: f.name,
  // molduras e anotações ficam de fora (a simulação também as ignora, por garantia)
  nodes: f.nodes.filter((n) => isProduction(n.data)).map((n) => ({ id: n.id, data: n.data })),
  edges: f.edges.map(toSimEdge),
  key,
});
/** Cópia limpa (sem seleção, medidas etc.) de uma planta */
const cleanPlant = (f: Factory) => sanitizePlant(f) ?? structuredClone({ nodes: f.nodes, edges: f.edges });
/** Tira o hash do link compartilhado da URL (sem recarregar nem criar entrada no histórico) */
const clearShareHash = () => {
  if (isShareHash(location.hash)) history.replaceState(null, '', location.pathname + location.search);
};

type Notice = { kind: 'ok' | 'error'; text: string };
type Pending = { incoming: Incoming; source: 'file' | 'link'; fileName?: string };

function Planner() {
  debugCrash('app');
  const initial = useMemo(loadState, []);
  // fábricas do projeto; a aberta vive no estado do React Flow (nodes/edges) e a cópia dela aqui fica pra trás até trocar de aba
  const [factories, setFactories] = useState<Factory[]>(initial.factories);
  const [activeId, setActiveId] = useState(initial.active);
  const initialActive = initial.factories.find((f) => f.id === initial.active) ?? initial.factories[0];
  const [nodes, setNodes, onNodesChange] = useNodesState<FactoryNode>(initialActive.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BeltEdge>(initialActive.edges);
  const [defaultTier, setDefaultTier] = useState<BeltTier>(initial.defaultTier);
  const [defaultPipeTier, setDefaultPipeTier] = useState<PipeTier>(initial.defaultPipeTier ?? 1);
  const [gridBelts, setGridBelts] = useState(initial.gridBelts ?? true);
  const [beltLabels, setBeltLabels] = useState(initial.beltLabels ?? true);
  const [couponsPrinted, setCouponsPrinted] = useState(initial.couponsPrinted ?? 0);
  const settings = useMemo(() => ({ gridBelts, beltLabels }), [gridBelts, beltLabels]);
  // muda quando o canvas é remontado depois de um erro ("Tentar de novo")
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  // container dos rótulos das esteiras: procurado de novo sempre que o canvas (re)monta
  const [labelRoot, setLabelRoot] = useState<Element | null>(null);
  useEffect(() => {
    let raf = 0;
    const find = () => {
      const el = canvasRef.current?.querySelector('.react-flow__edgelabel-renderer') ?? null;
      if (el) setLabelRoot(el);
      else raf = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [canvasEpoch]);
  const snapping = useAltHeld();
  const snappingRef = useRef(snapping);
  snappingRef.current = snapping;
  const { screenToFlowPosition, setCenter, setViewport, getViewport, fitView, getNode, getNodes } = useReactFlow<FactoryNode, BeltEdge>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // avisos de sucesso somem sozinhos; erros ficam até fechar
  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /* ---------- projeto e simulação ---------- */

  /** fábricas com a aberta atualizada */
  const live = useMemo(() => factories.map((f) => (f.id === activeId ? { ...f, nodes, edges } : f)), [factories, activeId, nodes, edges]);
  const active = live.find((f) => f.id === activeId)!;
  const project = useCallback(
    (): ProjectState => ({ version: 2, factories: live, active: activeId, defaultTier, defaultPipeTier, gridBelts, beltLabels, couponsPrinted }),
    [live, activeId, defaultTier, defaultPipeTier, gridBelts, beltLabels, couponsPrinted],
  );

  // Só recalcula quando muda algo que afeta o fluxo (arrastar node não recalcula); as fábricas
  // fechadas só mudam ao trocar de aba, e o cache evita simular de novo as que não mudaram
  const activeKey = simKeyOf(nodes, edges);
  const closed = useMemo(() => new Map(factories.filter((f) => f.id !== activeId).map((f) => [f.id, toSimFactory(f)])), [factories, activeId]);
  const simCache = useRef<SimCache>(new Map());
  const psim = useMemo(
    () =>
      simulateProject(
        factories.map((f) => (f.id === activeId ? toSimFactory({ ...f, nodes, edges }, activeKey) : closed.get(f.id)!)),
        simCache.current,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closed, activeKey],
  );
  const sim = psim.results[activeId] ?? EMPTY_SIM;
  const summary = useMemo(() => summarizeProject(factories, psim), [factories, psim]);

  /*
   * Arrastar uma moldura leva junto o que está dentro dela. Escolha: as posições continuam
   * absolutas (sem parentId/sub-flow do React Flow), e os nodes de dentro são calculados no
   * começo do arraste e deslocados junto. Assim copiar/colar, gerador, simulação, salvamento e
   * a seleção por caixa não precisam saber de moldura, e um node "entra" ou "sai" de uma moldura
   * só por estar (ou não) em cima dela.
   */
  const frameDrag = useRef<{ start: Map<string, { x: number; y: number }>; members: Map<string, { frame: string; x: number; y: number }> } | null>(null);
  const onNodeDragStart = useCallback(
    (_e: unknown, _n: FactoryNode, dragged: FactoryNode[]) => {
      const frames = dragged.filter((n) => n.data.kind === 'frame');
      if (!frames.length) return void (frameDrag.current = null);
      const all = getNodes();
      const moving = new Set(dragged.map((n) => n.id));
      const members = new Map<string, { frame: string; x: number; y: number }>();
      for (const f of frames)
        for (const m of frameMembers(f, all)) if (!moving.has(m.id) && !members.has(m.id)) members.set(m.id, { frame: f.id, ...m.position });
      frameDrag.current = { start: new Map(frames.map((f) => [f.id, { ...f.position }])), members };
    },
    [getNodes],
  );
  const onNodeDragStop = useCallback(() => void (frameDrag.current = null), []);

  // Encaixe no grid feito aqui (e não pelo snapToGrid do React Flow) pra valer
  // mesmo quando o Alt é apertado no meio do arraste. Molduras e anotações ficam sempre no grid
  // (posição e tamanho, inclusive ao redimensionar).
  const filterBoxSelection = useBoxSelection();
  const onNodesChangeSnapped = useCallback(
    (changes: NodeChange<FactoryNode>[]) => {
      changes = filterBoxSelection(changes);
      const annotation = (id: string) => {
        const n = getNode(id);
        return !!n && isAnnotation(n.data);
      };
      changes = changes.map((c) => {
        if (c.type === 'position' && c.position && (snappingRef.current || annotation(c.id)))
          return { ...c, position: { x: snapGrid(c.position.x), y: snapGrid(c.position.y) } };
        if (c.type === 'dimensions' && c.dimensions && annotation(c.id))
          return { ...c, dimensions: { width: snapGrid(c.dimensions.width), height: snapGrid(c.dimensions.height) } };
        return c;
      });
      // o que está dentro da moldura arrastada anda o mesmo tanto que ela
      const fd = frameDrag.current;
      if (fd) {
        const extra: NodeChange<FactoryNode>[] = [];
        for (const c of changes) {
          const s = c.type === 'position' && c.position ? fd.start.get(c.id) : undefined;
          if (!s || c.type !== 'position' || !c.position) continue;
          const dx = c.position.x - s.x;
          const dy = c.position.y - s.y;
          for (const [mid, m] of fd.members) if (m.frame === c.id) extra.push({ type: 'position', id: mid, position: { x: m.x + dx, y: m.y + dy } });
        }
        changes = [...changes, ...extra];
      }
      onNodesChange(changes);
    },
    [onNodesChange, filterBoxSelection, getNode],
  );

  /* ---------- desfazer / refazer (um histórico por fábrica) ---------- */

  const applySnapshot = useCallback(
    (s: Snapshot) => {
      setNodes(s.nodes);
      setEdges(s.edges);
    },
    [setNodes, setEdges],
  );
  const { undo, redo, forget, canUndo, canRedo } = useHistory(activeId, nodes, edges, applySnapshot);
  // o "copiado" fica no Planner: copia numa aba e cola em outra
  const clipboard = useClipboard(GRID);
  const [plannerOpen, setPlannerOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      // Dentro de campos de texto o Ctrl+Z nativo do campo continua valendo
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
      else if (k === 'c' && !e.shiftKey) {
        if (!clipboard.copy()) return;
      } else if (k === 'x' && !e.shiftKey) {
        if (!clipboard.cut()) return;
      } else if (k === 'v' && !e.shiftKey) clipboard.paste();
      else if (k === 'd' && !e.shiftKey) clipboard.duplicate();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, clipboard]);

  // R gira os nodes selecionados 90° no sentido horário; Shift+R no anti-horário
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'r') return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.preventDefault();
      setNodes((ns) =>
        ns.map((n) =>
          // moldura e anotação não giram
          n.selected && isProduction(n.data) ? ({ ...n, data: { ...n.data, rotation: nextRotation(n.data.rotation, e.shiftKey ? -1 : 1) } } as FactoryNode) : n,
        ),
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setNodes]);

  /* ---------- viewport por fábrica ---------- */

  /** zoom/posição de cada fábrica, lembrados ao trocar de aba */
  const viewports = useRef(new Map<string, Viewport>());
  /** enquadrar tudo assim que os nodes da fábrica aberta forem medidos (primeira carga, aba nova) */
  const pendingFit = useRef(true);
  useEffect(() => {
    if (!pendingFit.current) return;
    if (!nodes.length) {
      pendingFit.current = false;
      setViewport({ x: 0, y: 0, zoom: 1 });
    } else if (nodes.every((n) => n.measured?.width)) {
      pendingFit.current = false;
      fitView({ padding: 0.15, maxZoom: 1 });
    }
  }, [nodes, fitView, setViewport]);

  // salvamento automático do projeto inteiro (pausado enquanto algum Error Boundary estiver em erro);
  // canvasEpoch: salva o que foi feito com o canvas quebrado assim que ele volta
  useEffect(() => {
    const t = setTimeout(() => saveState(project()), 300);
    return () => clearTimeout(t);
  }, [project, canvasEpoch]);
  // fechar/recarregar a página logo depois de uma edição: salva na hora em vez de esperar o debounce
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    const flush = () => saveState(projectRef.current());
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  /* ---------- abas ---------- */

  /** Abre a fábrica `id` de `list` (que vira a lista de fábricas) */
  const open = (list: Factory[], id: string, opts: { refit?: boolean } = {}) => {
    const target = list.find((f) => f.id === id) ?? list[0];
    if (target.id !== activeId) viewports.current.set(activeId, getViewport());
    setFactories(list);
    setActiveId(target.id);
    setNodes(target.nodes);
    setEdges(target.edges);
    const vp = viewports.current.get(target.id);
    if (vp && !opts.refit && target.id !== activeId) setViewport(vp);
    else pendingFit.current = true;
  };

  const selectFactory = (id: string) => id !== activeId && factories.some((f) => f.id === id) && open(live, id);
  // os nodes de Saída externa abrem a fábrica de destino: sempre com a versão mais nova da função
  const selectRef = useRef(selectFactory);
  selectRef.current = selectFactory;
  const openFactory = useCallback((id: string) => selectRef.current(id), []);

  const addFactory = (plant: { nodes: FactoryNode[]; edges: BeltEdge[] } = { nodes: [], edges: [] }, name = nextFactoryName(factories)) => {
    const f: Factory = { id: newId('f'), name: uniqueName(name, factories.map((x) => x.name)), ...plant };
    open([...live, f], f.id);
  };

  const duplicateFactory = (id: string) => {
    const list = live;
    const i = list.findIndex((f) => f.id === id);
    const src = list[i];
    const copy: Factory = { id: newId('f'), name: uniqueName(`${src.name} (cópia)`, list.map((f) => f.name)), ...cleanPlant(src) };
    open([...list.slice(0, i + 1), copy, ...list.slice(i + 1)], copy.id);
  };

  const deleteFactory = (id: string) => {
    if (factories.length <= 1) return;
    const list = live;
    const f = list.find((x) => x.id === id)!;
    // Entradas externas de outras fábricas que puxam desta
    const links = list.filter((x) => x.id !== id).flatMap((x) => x.nodes.filter((n) => n.data.kind === 'inbound' && n.data.link?.factory === id)).length;
    const msg =
      `Apagar a fábrica "${f.name}" (${f.nodes.length} itens, ${f.edges.length} conexões)?` +
      (links ? `\n\n${links} Entrada(s) externa(s) de outras fábricas puxam dela e vão passar a usar a vazão manual.` : '') +
      '\n\nDá pra voltar pelas versões anteriores (🕘).';
    if (!confirm(msg)) return;
    backupNow(project());
    const rest = list.filter((x) => x.id !== id);
    forget(id);
    viewports.current.delete(id);
    if (id !== activeId) setFactories((fs) => fs.filter((x) => x.id !== id));
    else open(rest, rest[Math.max(0, list.findIndex((x) => x.id === id) - 1)].id);
  };

  const renameFactory = (id: string, name: string) => setFactories((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)));

  const moveFactory = (id: string, to: number) =>
    setFactories((fs) => {
      const from = fs.findIndex((f) => f.id === id);
      const dest = Math.max(0, Math.min(fs.length - 1, to));
      if (from < 0 || from === dest) return fs;
      const list = [...fs];
      const [f] = list.splice(from, 1);
      list.splice(dest, 0, f);
      return list;
    });

  /* ---------- conexões ---------- */

  /** meio da porta de origem: fluido vira cano, sólido vira esteira */
  const sourceMedium = useCallback(
    (c: Connection | Edge) => {
      const n = getNode(c.source);
      return n ? portMedium(n.data, c.sourceHandle) : 'solid';
    },
    [getNode],
  );

  /** conexão sendo reconectada (arrastando uma das pontas): as portas dela não contam como ocupadas */
  const reconnecting = useRef<BeltEdge | null>(null);

  /**
   * Valida uma conexão (nova ou reconectada): saída → entrada de nodes diferentes, mesmo meio,
   * portas livres. `moving` = a conexão que está sendo reconectada (ela mesma não ocupa porta e
   * não pode trocar de esteira pra cano, nem o contrário).
   */
  const connectionOk = useCallback(
    (c: Connection | Edge, list: BeltEdge[], moving: BeltEdge | null) => {
      const src = getNode(c.source);
      const tgt = getNode(c.target);
      if (!src || !tgt || c.source === c.target || !c.sourceHandle?.startsWith('out') || !c.targetHandle?.startsWith('in')) return false;
      // fluido só liga em fluido (cano); sólido só em sólido (esteira)
      if (!mediumsMatch(portMedium(src.data, c.sourceHandle), portMedium(tgt.data, c.targetHandle))) return false;
      if (moving && (portMedium(src.data, c.sourceHandle) === 'fluid') !== (moving.type === 'pipe')) return false;
      return !list.some(
        (e) => e.id !== moving?.id && ((e.source === c.source && e.sourceHandle === c.sourceHandle) || (e.target === c.target && e.targetHandle === c.targetHandle)),
      );
    },
    [getNode],
  );

  const isValidConnection = useCallback((c: Connection | Edge) => connectionOk(c, edges, reconnecting.current), [connectionOk, edges]);

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) => {
        const taken = eds.some(
          (e) => (e.source === c.source && e.sourceHandle === c.sourceHandle) || (e.target === c.target && e.targetHandle === c.targetHandle),
        );
        if (taken) return eds;
        const pipe = sourceMedium(c) === 'fluid';
        return [...eds, { ...c, id: newId('b'), type: pipe ? 'pipe' : 'belt', data: { tier: pipe ? defaultPipeTier : defaultTier } }];
      }),
    [setEdges, defaultTier, defaultPipeTier, sourceMedium],
  );

  /*
   * Reconectar: arrastar a ponta de uma conexão pra outra porta. Vale a mesma validação de uma
   * conexão nova; a conexão continua a mesma (id, Mk, rota), só o trajeto planejado pelo gerador
   * (bends/anchor) é descartado. Soltar no vazio ou numa porta inválida não muda nada.
   */
  const onReconnectStart = useCallback((_e: unknown, edge: BeltEdge) => void (reconnecting.current = edge), []);
  const onReconnectEnd = useCallback(() => void (reconnecting.current = null), []);
  const onReconnect = useCallback(
    (old: BeltEdge, c: Connection) =>
      setEdges((eds) => {
        if (!connectionOk(c, eds, old)) return eds;
        const same = c.source === old.source && c.sourceHandle === old.sourceHandle && c.target === old.target && c.targetHandle === old.targetHandle;
        if (same) return eds;
        return eds.map((e) => {
          if (e.id !== old.id) return e;
          const { bends: _b, anchor: _a, ...data } = e.data ?? { tier: 1 };
          return { ...e, source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle, data };
        });
      }),
    [setEdges, connectionOk],
  );

  /* ---------- adicionar nodes ---------- */

  const addNode = useCallback(
    (data: FactoryData, position?: { x: number; y: number }) => {
      let pos = position;
      if (!pos) {
        const rect = canvasRef.current!.getBoundingClientRect();
        pos = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        pos = { x: pos.x - 120 + Math.random() * 40, y: pos.y - 80 + Math.random() * 40 };
      }
      const node = isAnnotation(data)
        ? annotationNode(newId(data.kind), structuredClone(data), pos)
        : ({ id: newId(data.kind), type: data.kind, position: pos, data: structuredClone(data) } as FactoryNode);
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    },
    [screenToFlowPosition, setNodes],
  );

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DND_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };
  const onDrop = (e: DragEvent) => {
    const raw = e.dataTransfer.getData(DND_TYPE);
    if (!raw) return;
    e.preventDefault();
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(JSON.parse(raw) as FactoryData, { x: pos.x - 110, y: pos.y - 40 });
  };

  /* ---------- painel lateral ---------- */

  const focusIssue = useCallback(
    (issue: Issue) => {
      const { kind, id } = issue.target;
      const center = (nid: string) => {
        const n = getNode(nid);
        if (!n) return null;
        return { x: n.position.x + (n.measured?.width ?? 220) / 2, y: n.position.y + (n.measured?.height ?? 150) / 2 };
      };
      let pt: { x: number; y: number } | null = null;
      if (kind === 'node') {
        pt = center(id);
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
        setEdges((es) => es.map((e) => ({ ...e, selected: false })));
      } else {
        const edge = edges.find((e) => e.id === id);
        const a = edge && center(edge.source);
        const b = edge && center(edge.target);
        if (a && b) pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        setEdges((es) => es.map((e) => ({ ...e, selected: e.id === id })));
        setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
      }
      if (pt) setCenter(pt.x, pt.y, { zoom: 1.1, duration: 400 });
    },
    [edges, getNode, setCenter, setEdges, setNodes],
  );

  const fixBelt = useCallback(
    (edgeId: string, tier?: BeltTier) => tier && setEdges((es) => es.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, tier } } : e))),
    [setEdges],
  );

  /* ---------- gerador de linha (entra na fábrica aberta) ---------- */

  const generateLine = useCallback(
    (plan: Plan, mode: DistributionMode, maxBelt: BeltTier, maxPipe: PipeTier) => {
      // à direita do que já existe, alinhado ao topo
      const current = getNodes();
      const origin = current.length
        ? {
            x: Math.max(...current.map((n) => n.position.x + (n.measured?.width ?? 280))) + 200,
            y: Math.min(...current.map((n) => n.position.y)),
          }
        : { x: 0, y: 0 };
      const { nodes: newNodes, edges: newEdges } = layoutPlan(plan, mode, maxBelt, maxPipe, origin);
      setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), ...newNodes.map((n) => ({ ...n, selected: true }))]);
      setEdges((es) => [...es.map((e) => (e.selected ? { ...e, selected: false } : e)), ...newEdges]);
      setPlannerOpen(false);
      // espera os nodes novos serem medidos antes de enquadrar (senão o zoom corta a ponta)
      const fit = () => fitView({ nodes: newNodes.map((n) => ({ id: n.id })), padding: 0.1, duration: 400 });
      setTimeout(fit, 150);
      setTimeout(fit, 600);
    },
    [getNodes, setNodes, setEdges, fitView],
  );

  /* ---------- projeto inteiro: substituir, importar, exportar, compartilhar ---------- */

  /** Troca o projeto inteiro (importado, versão anterior). `backup`: guarda o atual antes */
  const replaceProject = (p: ProjectState, backup = true) => {
    if (backup) backupNow(project());
    setDefaultTier(p.defaultTier);
    setDefaultPipeTier(p.defaultPipeTier);
    setGridBelts(p.gridBelts);
    setBeltLabels(p.beltLabels);
    setCouponsPrinted(p.couponsPrinted ?? 0);
    viewports.current.clear();
    open(p.factories, p.active, { refit: true });
  };

  const accept = (how: 'add' | 'replace') => {
    if (!pending) return;
    const inc = pending.incoming;
    const n = inc.project.factories.length;
    const { project: next, added } = applyImport(project(), inc, how);
    if (how === 'replace') {
      replaceProject(next);
      setNotice({ kind: 'ok', text: `Projeto substituído (${n} fábrica${n === 1 ? '' : 's'}). O anterior ficou nas versões anteriores 🕘.` });
    } else {
      open(next.factories, next.active);
      setNotice({ kind: 'ok', text: n === 1 ? `Fábrica "${added[0].name}" adicionada.` : `${n} fábricas adicionadas: ${added.map((f) => f.name).join(', ')}.` });
    }
    if (pending.source === 'link') clearShareHash();
    setPending(null);
  };
  const cancelIncoming = () => {
    if (pending?.source === 'link') clearShareHash();
    setPending(null);
  };

  // link compartilhado (#share=...): mostra o que veio e pergunta o que fazer
  useEffect(() => {
    const check = () => {
      if (!isShareHash(location.hash)) return;
      const r = decodeShare(location.hash);
      if (r.ok) setPending({ incoming: r.incoming, source: 'link' });
      else {
        setNotice({ kind: 'error', text: r.error });
        clearShareHash();
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  const importJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setNotice({ kind: 'error', text: `Não dá pra abrir "${file.name}": não é um arquivo JSON válido.` });
      return;
    }
    const r = parseImport(raw, file.name.replace(/\.json$/i, ''));
    if (r.ok) setPending({ incoming: r.incoming, source: 'file', fileName: file.name });
    else setNotice({ kind: 'error', text: `${file.name}: ${r.error}` });
  };

  const exportFile = (scope: ShareScope) => {
    const data = scope === 'project' ? exportProject(project()) : exportFactory(active);
    if (!data) return setNotice({ kind: 'error', text: 'Não deu pra exportar: há algum node ou conexão inválida.' });
    downloadJson(data, scope === 'project' ? `projeto-satisfactory-${today()}.json` : `fabrica-${slug(active.name)}-${today()}.json`);
  };

  const makeLink = useCallback(
    (scope: ShareScope) => {
      const data = scope === 'project' ? exportProject(project()) : exportFactory(live.find((f) => f.id === activeId)!);
      return data ? shareUrl(data, location.href) : null;
    },
    [project, live, activeId],
  );

  /* ---------- minimizar ---------- */

  const collapsible = (n: FactoryNode) => ['machine', 'miner', 'generator', 'well', 'inbound'].includes(n.data.kind);
  const anyExpanded = nodes.some((n) => collapsible(n) && !(n.data as { collapsed?: boolean }).collapsed);
  const toggleCollapseAll = () => {
    // Com seleção, age só nos selecionados; sem seleção, em tudo
    const targets = nodes.some((n) => n.selected && collapsible(n)) ? (n: FactoryNode) => !!n.selected : () => true;
    const collapse = nodes.some((n) => collapsible(n) && targets(n) && !(n.data as { collapsed?: boolean }).collapsed);
    setNodes((ns) => ns.map((n) => (collapsible(n) && targets(n) ? ({ ...n, data: { ...n.data, collapsed: collapse } } as FactoryNode) : n)));
  };

  // esteira selecionada (a última clicada, se houver várias)
  const selectedEdge = [...edges].reverse().find((e) => e.selected);

  const errors = sim.issues.filter((i) => i.level === 'error').length;
  const warnings = sim.issues.filter((i) => i.level === 'warning').length;

  const projectInfo = useMemo<ProjectInfo>(
    () => ({ factoryId: activeId, feeds: psim.feeds[activeId] ?? {}, destinations: psim.destinations[activeId] ?? {}, outbounds: psim.outbounds, openFactory }),
    [psim, activeId, openFactory],
  );
  const tabs = summary.factories.map((f) => ({ id: f.id, name: f.name, errors: f.errors, warnings: f.warnings }));
  const activeSummary = summary.factories.find((f) => f.id === activeId);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="logo">⚙️</span> Planejador <b>Satisfactory</b>
        </div>
        <div className="stats">
          <EnergyChip energy={sim.energy} />
          <span className="chip">🏭 {sim.machines} máquinas</span>
          {sim.sloops > 0 && (
            <span className="chip sloop-chip" title="Somersloops em uso (existem 106 no mapa)">
              <b>S</b> {sim.sloops} / 106
            </span>
          )}
          <span className={`chip ${errors ? 'err' : ''}`}>⛔ {errors}</span>
          <span className={`chip ${warnings ? 'warn' : ''}`}>⚠️ {warnings}</span>
        </div>
        <div className="actions">
          <button onClick={toggleCollapseAll} title="Minimizar ou expandir todas as máquinas e mineradoras (ou só as selecionadas)">
            {anyExpanded ? '▾ Minimizar' : '▸ Expandir'}
          </button>
          <div className="history">
            <button onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)">
              ↶
            </button>
            <button onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Y / Ctrl+Shift+Z)">
              ↷
            </button>
          </div>
          <button
            className={`toggle ${gridBelts ? 'on' : ''}`}
            onClick={() => setGridBelts((g) => !g)}
            title="Padrão das esteiras: seguir o grid com ângulos retos ou fazer curva. Cada esteira também pode ser trocada no próprio rótulo."
          >
            {gridBelts ? '┐ Grid' : '∿ Curva'}
          </button>
          <button
            className={`toggle ${beltLabels ? 'on' : ''}`}
            onClick={() => setBeltLabels((v) => !v)}
            title="Mostrar o rótulo (Mk e fluxo) em cima das esteiras. Desligado, a esteira selecionada continua mostrando o dela."
          >
            🏷 Rótulos
          </button>
          <MenuButton
            label="📁 Arquivo ▾"
            title="Exportar, importar, exemplo e limpar"
            items={[
              { label: '⬇ Exportar projeto (.json)', onClick: () => exportFile('project'), title: 'Todas as fábricas e configurações' },
              { label: '⬇ Exportar só esta fábrica (.json)', onClick: () => exportFile('factory'), title: `Só "${active.name}"` },
              { label: '⬆ Importar arquivo…', onClick: () => fileRef.current?.click(), title: 'Projeto, fábrica avulsa ou planta do formato antigo' },
              { label: '🧪 Exemplo numa fábrica nova', onClick: () => addFactory(demoPlant(), 'Exemplo'), separator: true },
              {
                label: '🗑 Limpar esta fábrica…',
                danger: true,
                onClick: () => {
                  if (!confirm(`Apagar tudo da fábrica "${active.name}"? (Ctrl+Z desfaz)`)) return;
                  setNodes([]);
                  setEdges([]);
                  setViewport({ x: 0, y: 0, zoom: 1 });
                },
              },
            ]}
          />
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importJson} data-testid="import-file" />
          <button onClick={() => setShareOpen(true)} title="Gerar um link com esta fábrica ou o projeto inteiro">
            🔗 Compartilhar
          </button>
          <BackupMenu onRestore={(s) => replaceProject(s, false)} />
        </div>
      </header>

      <FactoryTabs
        tabs={tabs}
        active={activeId}
        onSelect={selectFactory}
        onAdd={() => addFactory()}
        onRename={renameFactory}
        onDuplicate={duplicateFactory}
        onDelete={deleteFactory}
        onMove={moveFactory}
        onSummary={() => setSummaryOpen(true)}
      />

      {plannerOpen && <PlannerModal onClose={() => setPlannerOpen(false)} onGenerate={generateLine} />}
      {pending && (
        <IncomingDialog
          incoming={pending.incoming}
          source={pending.source}
          fileName={pending.fileName}
          current={factories.length}
          onAdd={() => accept('add')}
          onReplace={() => accept('replace')}
          onCancel={cancelIncoming}
        />
      )}
      {shareOpen && <ShareDialog factoryName={active.name} factories={factories.length} makeLink={makeLink} onExport={exportFile} onClose={() => setShareOpen(false)} />}
      {summaryOpen && (
        <ProjectSummary
          summary={summary}
          active={activeId}
          onOpen={(id) => {
            setSummaryOpen(false);
            selectFactory(id);
          }}
          onClose={() => setSummaryOpen(false)}
        />
      )}
      <datalist id="clock-marks">
        <option value="100" />
        <option value="150" />
        <option value="200" />
      </datalist>

      <div className="main">
        <Palette
          onAdd={addNode}
          version={GAME_VERSION}
          onOpenPlanner={() => setPlannerOpen(true)}
          defaults={{ belt: defaultTier, pipe: defaultPipeTier }}
          onDefaults={(d) => {
            if (d.belt) setDefaultTier(d.belt);
            if (d.pipe) setDefaultPipeTier(d.pipe);
          }}
        />
        <div className="canvas" ref={canvasRef} onDragOver={onDragOver} onDrop={onDrop} {...clipboard.trackMouse}>
          {notice && (
            <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              <span>{notice.text}</span>
              <button className="modal-x" onClick={() => setNotice(null)} title="Fechar aviso">
                ✕
              </button>
            </div>
          )}
          {/* se só o canvas quebrar, paleta e painel lateral continuam usáveis */}
          <ErrorBoundary
            name="canvas"
            onReset={() => setCanvasEpoch((e) => e + 1)}
            fallback={(crash) => <CanvasCrash {...crash} onUndo={canUndo ? undo : undefined} />}
          >
          <CanvasDebugCrash />
          <SettingsContext.Provider value={settings}>
          <LabelRootContext.Provider value={labelRoot}>
            <ProjectContext.Provider value={projectInfo}>
            <SimContext.Provider value={sim}>
              <ReactFlow<FactoryNode, BeltEdge>
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChangeSnapped}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                selectionMode={SelectionMode.Partial}
                connectionLineType={gridBelts ? ConnectionLineType.Step : ConnectionLineType.Bezier}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onReconnect={onReconnect}
                onReconnectStart={onReconnectStart}
                onReconnectEnd={onReconnectEnd}
                isValidConnection={isValidConnection}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={{ type: 'belt' }}
                colorMode="dark"
                deleteKeyCode={['Backspace', 'Delete']}
                minZoom={0.05}
              >
                {/* O React Flow desenha os pontos meio quadrado deslocados; o offset põe cada ponto num múltiplo exato do grid */}
                <Background id="dots" variant={BackgroundVariant.Dots} gap={GRID} size={DOT} offset={DOT / 2 - GRID / 2} color="#3a3f48" />
                {snapping && (
                  <>
                    {/* Um quadradinho = uma unidade do grid: todo node ocupa um número inteiro deles */}
                    <Background id="grid" variant={BackgroundVariant.Lines} gap={GRID} lineWidth={1} color="#353b46" />
                    <Panel position="top-center" className="snap-badge">
                      ⊞ Alinhando ao grid ({GRID}px)
                    </Panel>
                  </>
                )}
                <Controls />
                <MiniMap pannable zoomable nodeColor={minimapColor} maskColor="rgba(15,17,21,0.7)" />
              </ReactFlow>
            </SimContext.Provider>
            </ProjectContext.Provider>
          </LabelRootContext.Provider>
          </SettingsContext.Provider>
          </ErrorBoundary>
        </div>
        <SidePanel
          sim={sim}
          onFocus={focusIssue}
          onFixBelt={fixBelt}
          couponsPrinted={couponsPrinted}
          onCouponsPrinted={setCouponsPrinted}
          transfers={activeSummary}
          beltDetails={
            selectedEdge && (
              <BeltInspector
                edge={selectedEdge}
                result={sim.edges[selectedEdge.id]}
                issues={sim.byTarget[selectedEdge.id] ?? []}
                source={nodes.find((n) => n.id === selectedEdge.source)}
                target={nodes.find((n) => n.id === selectedEdge.target)}
                routing={selectedEdge.data?.routing ?? (gridBelts ? 'grid' : 'curve')}
                onTier={(tier) => fixBelt(selectedEdge.id, tier)}
                onRouting={(routing) => setEdges((es) => es.map((e) => (e.id === selectedEdge.id ? { ...e, data: { ...e.data!, routing } } : e)))}
                onFocusNode={(id) => focusIssue({ id, level: 'info', message: '', target: { kind: 'node', id } })}
              />
            )
          }
        />
      </div>
    </div>
  );
}
