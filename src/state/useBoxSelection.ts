import { useCallback, useEffect } from 'react';
import { useReactFlow, useStore, useStoreApi, type NodeChange } from '@xyflow/react';
import type { BeltEdge, FactoryNode } from '../game/types';

/** Fração mínima da área do node que precisa estar dentro da caixa pra ele ser selecionado */
export const SELECT_OVERLAP = 0.5;

/**
 * Seleção por caixa (Shift + arrastar) mais tolerante: o React Flow só sabe selecionar
 * "node inteiro dentro" ou "encostou". Aqui a seleção é recalculada a cada movimento da
 * caixa pela área de sobreposição, e as mudanças de seleção do próprio React Flow são
 * descartadas enquanto a caixa está ativa (use `filterChanges` no onNodesChange).
 */
export function useBoxSelection() {
  const store = useStoreApi<FactoryNode, BeltEdge>();
  const rect = useStore((s) => s.userSelectionRect);
  const { setNodes } = useReactFlow<FactoryNode, BeltEdge>();

  useEffect(() => {
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    const { transform, nodeLookup } = store.getState();
    const [tx, ty, zoom] = transform;
    // caixa em coordenadas do flow
    const sx = (rect.x - tx) / zoom;
    const sy = (rect.y - ty) / zoom;
    const sw = rect.width / zoom;
    const sh = rect.height / zoom;

    const wanted = new Set<string>();
    for (const [id, n] of nodeLookup) {
      const { x, y } = n.internals.positionAbsolute;
      const w = n.measured.width ?? 0;
      const h = n.measured.height ?? 0;
      if (!w || !h || n.selectable === false) continue;
      const ox = Math.max(0, Math.min(x + w, sx + sw) - Math.max(x, sx));
      const oy = Math.max(0, Math.min(y + h, sy + sh) - Math.max(y, sy));
      if (ox * oy >= SELECT_OVERLAP * w * h) wanted.add(id);
    }
    setNodes((ns) =>
      ns.some((n) => !!n.selected !== wanted.has(n.id))
        ? ns.map((n) => (!!n.selected !== wanted.has(n.id) ? { ...n, selected: wanted.has(n.id) } : n))
        : ns,
    );
  }, [rect, store, setNodes]);

  return useCallback(
    (changes: NodeChange<FactoryNode>[]) => (store.getState().userSelectionRect ? changes.filter((c) => c.type !== 'select') : changes),
    [store],
  );
}
