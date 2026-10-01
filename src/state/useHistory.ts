import { useCallback, useEffect, useRef, useState } from 'react';
import type { BeltEdge, FactoryNode } from '../game/types';
import { nodeShape } from '../game/annotations';

export interface Snapshot {
  nodes: FactoryNode[];
  edges: BeltEdge[];
}
interface Entry {
  key: string;
  snap: Snapshot;
}
/** arrastando ou redimensionando: o passo só é gravado ao soltar */
const busy = (nodes: FactoryNode[]) => nodes.some((n) => n.dragging || n.resizing);

/** Pilhas de uma fábrica */
interface Stacks {
  committed: Entry;
  past: Entry[];
  future: Entry[];
}

const LIMIT = 200;
/** Espera o usuário "parar" (digitar, arrastar o slider) antes de gravar um passo */
const SETTLE_MS = 350;

/** Só o que importa pro histórico: seleção, medidas e estado de arraste ficam de fora (o tamanho das molduras entra) */
const keyOf = (nodes: FactoryNode[], edges: BeltEdge[]) =>
  JSON.stringify([
    nodes.map((n) => [n.id, n.type, n.position.x, n.position.y, n.data, n.width, n.height]),
    edges.map((e) => [e.id, e.type, e.source, e.sourceHandle, e.target, e.targetHandle, e.data]),
  ]);

const clean = (nodes: FactoryNode[], edges: BeltEdge[]): Snapshot =>
  structuredClone({
    nodes: nodes.map(nodeShape),
    edges: edges.map(({ id, type, source, sourceHandle, target, targetHandle, data }) => ({ id, type, source, sourceHandle, target, targetHandle, data })),
  });

const entryOf = (nodes: FactoryNode[], edges: BeltEdge[]): Entry => ({ key: keyOf(nodes, edges), snap: clean(nodes, edges) });

/**
 * Histórico de desfazer/refazer por snapshots, separado por fábrica (`scope` = id da fábrica
 * aberta). Cada mudança "assentada" do grafo vira um passo; arrastar um node conta como um
 * passo só (gravado ao soltar), e redimensionar uma moldura também. Trocar de fábrica fecha o passo pendente da anterior.
 */
export function useHistory(scope: string, nodes: FactoryNode[], edges: BeltEdge[], apply: (s: Snapshot) => void) {
  const stacks = useRef(new Map<string, Stacks>());
  const latest = useRef({ scope, nodes, edges });
  const timer = useRef<number>();
  const [, rerender] = useState(0);

  const stackOf = useCallback((s: string, n: FactoryNode[], e: BeltEdge[]) => {
    let st = stacks.current.get(s);
    if (!st) stacks.current.set(s, (st = { committed: entryOf(n, e), past: [], future: [] }));
    return st;
  }, []);
  // a fábrica aberta já tem pilha desde o primeiro render (o estado inicial é o ponto de partida)
  stackOf(scope, nodes, edges);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const { scope, nodes, edges } = latest.current;
    if (busy(nodes)) return;
    const st = stackOf(scope, nodes, edges);
    const key = keyOf(nodes, edges);
    if (key === st.committed.key) return;
    st.past.push(st.committed);
    if (st.past.length > LIMIT) st.past.shift();
    st.future = [];
    st.committed = { key, snap: clean(nodes, edges) };
    rerender((x) => x + 1);
  }, [stackOf]);

  useEffect(() => {
    // trocou de fábrica: o passo pendente é da anterior (com os nodes dela)
    if (latest.current.scope !== scope) flush();
    latest.current = { scope, nodes, edges };
    if (busy(nodes)) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SETTLE_MS);
  }, [scope, nodes, edges, flush]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const move = useCallback(
    (dir: 'undo' | 'redo') => {
      flush();
      const st = stacks.current.get(latest.current.scope);
      if (!st) return;
      const [from, to] = dir === 'undo' ? [st.past, st.future] : [st.future, st.past];
      const entry = from.pop();
      if (!entry) return;
      to.push(st.committed);
      st.committed = entry;
      apply(structuredClone(entry.snap));
      rerender((x) => x + 1);
    },
    [apply, flush],
  );

  const undo = useCallback(() => move('undo'), [move]);
  const redo = useCallback(() => move('redo'), [move]);
  /** esquece o histórico de uma fábrica apagada */
  const forget = useCallback((s: string) => void stacks.current.delete(s), []);

  const st = stacks.current.get(scope);
  return { undo, redo, forget, canUndo: !!st?.past.length, canRedo: !!st?.future.length };
}
