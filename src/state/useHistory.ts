import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { BeltEdge, FactoryNode } from '../game/types';

export interface Snapshot {
  nodes: FactoryNode[];
  edges: BeltEdge[];
}
interface Entry {
  key: string;
  snap: Snapshot;
}

const LIMIT = 200;
/** Espera o usuário "parar" (digitar, arrastar o slider) antes de gravar um passo */
const SETTLE_MS = 350;

/** Só o que importa pro histórico: seleção, medidas e estado de arraste ficam de fora */
const keyOf = (nodes: FactoryNode[], edges: BeltEdge[]) =>
  JSON.stringify([
    nodes.map((n) => [n.id, n.type, n.position.x, n.position.y, n.data]),
    edges.map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle, e.data]),
  ]);

const clean = (nodes: FactoryNode[], edges: BeltEdge[]): Snapshot =>
  structuredClone({
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data }) as FactoryNode),
    edges: edges.map(({ id, type, source, sourceHandle, target, targetHandle, data }) => ({ id, type, source, sourceHandle, target, targetHandle, data })),
  });

/**
 * Histórico de desfazer/refazer por snapshots. Cada mudança "assentada" do grafo vira
 * um passo; arrastar um node conta como um passo só (gravado ao soltar).
 */
export function useHistory(nodes: FactoryNode[], edges: BeltEdge[], apply: (s: Snapshot) => void) {
  const committed = useRef<Entry>({ key: keyOf(nodes, edges), snap: clean(nodes, edges) });
  const past = useRef<Entry[]>([]);
  const future = useRef<Entry[]>([]);
  const latest = useRef({ nodes, edges });
  const timer = useRef<number>();
  const [, rerender] = useState(0);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const { nodes, edges } = latest.current;
    if (nodes.some((n) => n.dragging)) return;
    const key = keyOf(nodes, edges);
    if (key === committed.current.key) return;
    past.current.push(committed.current);
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
    committed.current = { key, snap: clean(nodes, edges) };
    rerender((x) => x + 1);
  }, []);

  useEffect(() => {
    latest.current = { nodes, edges };
    if (nodes.some((n) => n.dragging)) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SETTLE_MS);
  }, [nodes, edges, flush]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const move = useCallback(
    (from: MutableRefObject<Entry[]>, to: MutableRefObject<Entry[]>) => {
      flush();
      const entry = from.current.pop();
      if (!entry) return;
      to.current.push(committed.current);
      committed.current = entry;
      apply(structuredClone(entry.snap));
      rerender((x) => x + 1);
    },
    [apply, flush],
  );

  const undo = useCallback(() => move(past, future), [move]);
  const redo = useCallback(() => move(future, past), [move]);

  return { undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
