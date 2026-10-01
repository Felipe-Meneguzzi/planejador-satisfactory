import { useCallback, useMemo, useRef, type MouseEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { BeltEdge, FactoryNode } from '../game/types';
import { newId } from './storage';

interface Clip {
  nodes: FactoryNode[];
  edges: BeltEdge[];
}

/**
 * Copiar / recortar / colar / duplicar nodes. Copia os nodes selecionados e as esteiras
 * que ligam um ao outro (esteiras que saem pra fora da seleção ficam de fora).
 * Cola com o canto da seleção na posição do mouse; sem mouse no canvas, desloca um pouco.
 */
export function useClipboard(grid: number) {
  const { getNodes, getEdges, setNodes, setEdges, screenToFlowPosition } = useReactFlow<FactoryNode, BeltEdge>();
  const clip = useRef<Clip | null>(null);
  const mouse = useRef({ x: 0, y: 0, inside: false });
  /** colagens seguidas no mesmo lugar vão sendo deslocadas pra não ficarem empilhadas */
  const repeat = useRef({ key: '', count: 0 });

  const snapshotSelection = useCallback((): Clip | null => {
    const nodes = getNodes().filter((n) => n.selected);
    if (!nodes.length) return null;
    const ids = new Set(nodes.map((n) => n.id));
    return structuredClone({
      nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data }) as FactoryNode),
      edges: getEdges()
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map(({ id, type, source, sourceHandle, target, targetHandle, data }) => ({ id, type, source, sourceHandle, target, targetHandle, data })),
    });
  }, [getNodes, getEdges]);

  const insert = useCallback(
    (c: Clip, atMouse: boolean) => {
      const minX = Math.min(...c.nodes.map((n) => n.position.x));
      const minY = Math.min(...c.nodes.map((n) => n.position.y));
      let dx: number;
      let dy: number;
      const key = atMouse && mouse.current.inside ? `${mouse.current.x},${mouse.current.y}` : 'offset';
      repeat.current = { key, count: repeat.current.key === key ? repeat.current.count + 1 : 0 };
      const bump = repeat.current.count * grid * 2;
      if (key !== 'offset') {
        const p = screenToFlowPosition({ x: mouse.current.x, y: mouse.current.y });
        dx = p.x - minX + bump;
        dy = p.y - minY + bump;
      } else {
        dx = dy = grid * 2 + bump;
      }
      // Deslocamento múltiplo do grid: o que estava alinhado continua alinhado
      dx = Math.round(dx / grid) * grid;
      dy = Math.round(dy / grid) * grid;

      const idMap = new Map(c.nodes.map((n) => [n.id, newId(n.data.kind)]));
      const fresh = structuredClone(c);
      setNodes((ns) => [
        ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
        ...fresh.nodes.map((n) => ({ ...n, id: idMap.get(n.id)!, position: { x: n.position.x + dx, y: n.position.y + dy }, selected: true })),
      ]);
      setEdges((es) => [
        ...es.map((e) => (e.selected ? { ...e, selected: false } : e)),
        ...fresh.edges.map((e) => ({ ...e, id: newId('b'), source: idMap.get(e.source)!, target: idMap.get(e.target)! })),
      ]);
    },
    [grid, screenToFlowPosition, setNodes, setEdges],
  );

  const copy = useCallback(() => {
    const c = snapshotSelection();
    if (c) {
      clip.current = c;
      repeat.current = { key: '', count: 0 };
    }
    return !!c;
  }, [snapshotSelection]);

  const paste = useCallback(() => {
    if (!clip.current) return false;
    insert(clip.current, true);
    return true;
  }, [insert]);

  const cut = useCallback(() => {
    if (!copy()) return false;
    const removed = new Set(getNodes().filter((n) => n.selected).map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !removed.has(n.id)));
    setEdges((es) => es.filter((e) => !removed.has(e.source) && !removed.has(e.target)));
    return true;
  }, [copy, getNodes, setNodes, setEdges]);

  /** Duplica a seleção ao lado, sem mexer no que está copiado */
  const duplicate = useCallback(() => {
    const c = snapshotSelection();
    if (c) insert(c, false);
    return !!c;
  }, [snapshotSelection, insert]);

  const trackMouse = useMemo(
    () => ({
      onMouseMove: (e: MouseEvent) => {
        mouse.current = { x: e.clientX, y: e.clientY, inside: true };
      },
      onMouseLeave: () => {
        mouse.current.inside = false;
      },
    }),
    [],
  );

  return useMemo(() => ({ copy, paste, cut, duplicate, trackMouse }), [copy, paste, cut, duplicate, trackMouse]);
}
