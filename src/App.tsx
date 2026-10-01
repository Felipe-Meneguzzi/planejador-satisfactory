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
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import { BELTS, BELT_TIERS, GAME_VERSION, MACHINES } from './game/data';
import type { BeltEdge, BeltTier, FactoryData, FactoryNode } from './game/types';
import { fmt } from './format';
import { GRID } from './grid';

/** diâmetro dos pontos do fundo */
const DOT = 1.2;
import { nextRotation, nodeTypes } from './components/nodes';
import { edgeTypes } from './components/BeltEdge';
import { DND_TYPE, Palette } from './components/Palette';
import { SidePanel } from './components/SidePanel';
import { BeltInspector } from './components/BeltInspector';
import { SimContext } from './sim/SimContext';
import { simulate, type Issue } from './sim/simulate';
import { demoState, loadState, newId, sanitize, saveState } from './state/storage';
import { useHistory, type Snapshot } from './state/useHistory';
import { useClipboard } from './state/useClipboard';
import { useBoxSelection } from './state/useBoxSelection';
import { LabelRootContext, SettingsContext } from './state/settings';
import { PlannerModal } from './components/PlannerModal';
import { layoutPlan, type DistributionMode } from './planner/layout';
import type { Plan } from './planner/plan';

export default function App() {
  return (
    <ReactFlowProvider>
      <Planner />
    </ReactFlowProvider>
  );
}

const minimapColor = (n: FactoryNode) => {
  const d = n.data;
  if (d.kind === 'miner') return '#7d5236';
  if (d.kind === 'machine') return MACHINES[d.machine].color;
  if (d.kind === 'sink') return '#2f7a52';
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

function Planner() {
  const initial = useMemo(loadState, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<FactoryNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BeltEdge>(initial.edges);
  const [defaultTier, setDefaultTier] = useState<BeltTier>(initial.defaultTier);
  const [gridBelts, setGridBelts] = useState(initial.gridBelts ?? true);
  const [beltLabels, setBeltLabels] = useState(initial.beltLabels ?? true);
  const settings = useMemo(() => ({ gridBelts, beltLabels }), [gridBelts, beltLabels]);
  // container dos rótulos das esteiras: procurado uma vez, depois que o canvas monta
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
  }, []);
  const snapping = useAltHeld();
  const snappingRef = useRef(snapping);
  snappingRef.current = snapping;
  const { screenToFlowPosition, setCenter, setViewport, fitView, getNode, getNodes } = useReactFlow<FactoryNode, BeltEdge>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Só recalcula quando muda algo que afeta o fluxo (arrastar node não recalcula)
  const simKey = JSON.stringify([
    nodes.map((n) => [n.id, n.data]),
    edges.map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle, e.data?.tier]),
  ]);
  const sim = useMemo(
    () =>
      simulate(
        nodes.map((n) => ({ id: n.id, data: n.data })),
        edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle, tier: e.data?.tier ?? 1 })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simKey],
  );

  // Encaixe no grid feito aqui (e não pelo snapToGrid do React Flow) pra valer
  // mesmo quando o Alt é apertado no meio do arraste
  const filterBoxSelection = useBoxSelection();
  const onNodesChangeSnapped = useCallback(
    (changes: NodeChange<FactoryNode>[]) => {
      changes = filterBoxSelection(changes);
      if (snappingRef.current) {
        const snap = (v: number) => Math.round(v / GRID) * GRID;
        changes = changes.map((c) =>
          c.type === 'position' && c.position ? { ...c, position: { x: snap(c.position.x), y: snap(c.position.y) } } : c,
        );
      }
      onNodesChange(changes);
    },
    [onNodesChange, filterBoxSelection],
  );

  /* ---------- desfazer / refazer ---------- */

  const applySnapshot = useCallback(
    (s: Snapshot) => {
      setNodes(s.nodes);
      setEdges(s.edges);
    },
    [setNodes, setEdges],
  );
  const { undo, redo, canUndo, canRedo } = useHistory(nodes, edges, applySnapshot);
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
        ns.map((n) => (n.selected ? ({ ...n, data: { ...n.data, rotation: nextRotation(n.data.rotation, e.shiftKey ? -1 : 1) } } as FactoryNode) : n)),
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setNodes]);

  // Enquadra tudo assim que os nodes forem medidos na primeira carga
  const nodesReady = useNodesInitialized();
  const didFit = useRef(false);
  useEffect(() => {
    if (nodesReady && !didFit.current) {
      didFit.current = true;
      fitView({ padding: 0.15, maxZoom: 1 });
    }
  }, [nodesReady, fitView]);

  useEffect(() => {
    const t = setTimeout(() => saveState({ version: 1, nodes, edges, defaultTier, gridBelts, beltLabels }), 300);
    return () => clearTimeout(t);
  }, [nodes, edges, defaultTier, gridBelts, beltLabels]);

  /* ---------- conexões ---------- */

  const isValidConnection = useCallback(
    (c: Connection | Edge) =>
      c.source !== c.target &&
      !!c.sourceHandle?.startsWith('out') &&
      !!c.targetHandle?.startsWith('in') &&
      !edges.some(
        (e) => (e.source === c.source && e.sourceHandle === c.sourceHandle) || (e.target === c.target && e.targetHandle === c.targetHandle),
      ),
    [edges],
  );

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) => {
        const taken = eds.some(
          (e) => (e.source === c.source && e.sourceHandle === c.sourceHandle) || (e.target === c.target && e.targetHandle === c.targetHandle),
        );
        if (taken) return eds;
        return [...eds, { ...c, id: newId('b'), type: 'belt', data: { tier: defaultTier } }];
      }),
    [setEdges, defaultTier],
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
      const node = { id: newId(data.kind), type: data.kind, position: pos, data: structuredClone(data) } as FactoryNode;
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

  /* ---------- gerador de linha ---------- */

  const generateLine = useCallback(
    (plan: Plan, mode: DistributionMode, maxBelt: BeltTier) => {
      // à direita do que já existe, alinhado ao topo
      const current = getNodes();
      const origin = current.length
        ? {
            x: Math.max(...current.map((n) => n.position.x + (n.measured?.width ?? 280))) + 200,
            y: Math.min(...current.map((n) => n.position.y)),
          }
        : { x: 0, y: 0 };
      const { nodes: newNodes, edges: newEdges } = layoutPlan(plan, mode, maxBelt, origin);
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

  /* ---------- toolbar ---------- */

  const replaceAll = (s: { nodes: FactoryNode[]; edges: BeltEdge[]; defaultTier: BeltTier; gridBelts?: boolean; beltLabels?: boolean }) => {
    setNodes(s.nodes);
    setEdges(s.edges);
    setDefaultTier(s.defaultTier);
    if (s.gridBelts !== undefined) setGridBelts(s.gridBelts);
    if (s.beltLabels !== undefined) setBeltLabels(s.beltLabels);
    setTimeout(() => (s.nodes.length ? fitView({ padding: 0.15, maxZoom: 1, duration: 300 }) : setViewport({ x: 0, y: 0, zoom: 1 })), 50);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(sanitize({ version: 1, nodes, edges, defaultTier, gridBelts, beltLabels }), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fabrica-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const s = sanitize(JSON.parse(await file.text()));
      if (!s) throw new Error('formato inválido');
      replaceAll(s);
    } catch (err) {
      alert(`Não consegui importar: ${(err as Error).message}`);
    }
  };

  /* ---------- minimizar ---------- */

  const collapsible = (n: FactoryNode) => n.data.kind === 'machine' || n.data.kind === 'miner';
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

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="logo">⚙️</span> Planejador <b>Satisfactory</b>
        </div>
        <div className="stats">
          <span className="chip">⚡ {fmt(sim.power)} MW</span>
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
          <label className="belt-default" title="Mk usado nas esteiras novas">
            Esteira
            <select value={defaultTier} onChange={(e) => setDefaultTier(Number(e.target.value) as BeltTier)}>
              {BELT_TIERS.map((t) => (
                <option key={t} value={t}>
                  {BELTS[t].name} ({BELTS[t].rate}/min)
                </option>
              ))}
            </select>
          </label>
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
          <button onClick={() => confirm('Substituir o plano atual pelo exemplo?') && replaceAll(demoState())}>Exemplo</button>
          <button onClick={() => confirm('Apagar tudo?') && replaceAll({ nodes: [], edges: [], defaultTier })}>Limpar</button>
          <button onClick={exportJson}>Exportar</button>
          <button onClick={() => fileRef.current?.click()}>Importar</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
        </div>
      </header>

      {plannerOpen && <PlannerModal onClose={() => setPlannerOpen(false)} onGenerate={generateLine} />}
      <datalist id="clock-marks">
        <option value="100" />
        <option value="150" />
        <option value="200" />
      </datalist>

      <div className="main">
        <Palette onAdd={addNode} version={GAME_VERSION} onOpenPlanner={() => setPlannerOpen(true)} />
        <div className="canvas" ref={canvasRef} onDragOver={onDragOver} onDrop={onDrop} {...clipboard.trackMouse}>
          <SettingsContext.Provider value={settings}>
          <LabelRootContext.Provider value={labelRoot}>
            <SimContext.Provider value={sim}>
              <ReactFlow<FactoryNode, BeltEdge>
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChangeSnapped}
                selectionMode={SelectionMode.Partial}
                connectionLineType={gridBelts ? ConnectionLineType.Step : ConnectionLineType.Bezier}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
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
          </LabelRootContext.Provider>
          </SettingsContext.Provider>
        </div>
        <SidePanel
          sim={sim}
          onFocus={focusIssue}
          onFixBelt={fixBelt}
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
