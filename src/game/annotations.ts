import { GRID } from '../grid';
import type { AnnotationColor, FactoryData, FactoryNode, FrameData, NoteData } from './types';

/*
 * Molduras e anotações: organização visual do canvas.
 * Não têm conectores e não produzem nada: a simulação, o resumo e o gerador ignoram.
 * O tamanho fica no próprio node (width/height do React Flow), sempre múltiplo do grid.
 */

/** Paleta pensada pro tema escuro: `base` = borda/cabeçalho, `fill` = fundo translúcido */
export const ANNOTATION_COLORS: Record<AnnotationColor, { name: string; base: string; fill: string }> = {
  slate: { name: 'Cinza', base: '#6b7686', fill: 'rgba(107, 118, 134, 0.10)' },
  blue: { name: 'Azul', base: '#3d84c6', fill: 'rgba(61, 132, 198, 0.10)' },
  teal: { name: 'Turquesa', base: '#2a9d8f', fill: 'rgba(42, 157, 143, 0.10)' },
  green: { name: 'Verde', base: '#4f9d4a', fill: 'rgba(79, 157, 74, 0.10)' },
  amber: { name: 'Âmbar', base: '#c9a032', fill: 'rgba(201, 160, 50, 0.10)' },
  orange: { name: 'Laranja', base: '#d9782d', fill: 'rgba(217, 120, 45, 0.10)' },
  red: { name: 'Vermelho', base: '#c75450', fill: 'rgba(199, 84, 80, 0.10)' },
  purple: { name: 'Roxo', base: '#8f63c9', fill: 'rgba(143, 99, 201, 0.10)' },
};
export const ANNOTATION_COLOR_KEYS = Object.keys(ANNOTATION_COLORS) as AnnotationColor[];
const isColor = (v: unknown): v is AnnotationColor => typeof v === 'string' && v in ANNOTATION_COLORS;

/** tamanhos (px, múltiplos do grid): padrão ao criar e mínimo ao redimensionar */
export const FRAME_SIZE = { width: 480, height: 320 };
export const FRAME_MIN = { width: 160, height: 80 };
export const NOTE_SIZE = { width: 220, height: 120 };
export const NOTE_MIN = { width: 100, height: 60 };
/** tamanho máximo aceito ao carregar (evita moldura gigante vinda de arquivo quebrado) */
const MAX_SIZE = 40_000;
export const MAX_FRAME_TITLE = 80;
export const MAX_NOTE_TEXT = 4000;

/**
 * Moldura sempre atrás de tudo. O React Flow soma 1000 ao zIndex do node selecionado:
 * com -2000, a moldura selecionada continua atrás das máquinas (que ficam em 0).
 */
export const FRAME_Z = -2000;

export const snapGrid = (v: number) => Math.round(v / GRID) * GRID;

export const minSizeOf = (kind: 'frame' | 'note') => (kind === 'frame' ? FRAME_MIN : NOTE_MIN);
export const defaultSizeOf = (kind: 'frame' | 'note') => (kind === 'frame' ? FRAME_SIZE : NOTE_SIZE);

/** Tamanho válido: número finito, múltiplo do grid, entre o mínimo e o máximo */
export function cleanSize(kind: 'frame' | 'note', width: unknown, height: unknown) {
  const min = minSizeOf(kind);
  const def = defaultSizeOf(kind);
  const fix = (v: unknown, lo: number, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(MAX_SIZE, Math.max(lo, snapGrid(v))) : d);
  return { width: fix(width, min.width, def.width), height: fix(height, min.height, def.height) };
}

/** Dados de moldura/anotação limpos (título/texto cortados, cor conhecida) */
export function cleanAnnotationData(d: Record<string, unknown>): FrameData | NoteData {
  const color = isColor(d.color) ? d.color : 'slate';
  if (d.kind === 'frame') return { kind: 'frame', title: typeof d.title === 'string' ? d.title.slice(0, MAX_FRAME_TITLE) : 'Moldura', color };
  return { kind: 'note', text: typeof d.text === 'string' ? d.text.slice(0, MAX_NOTE_TEXT) : '', color };
}

/** Dados de uma moldura nova */
export const newFrame = (title = 'Moldura', color: AnnotationColor = 'blue'): FrameData => ({ kind: 'frame', title, color });
/** Dados de uma anotação nova */
export const newNote = (text = '', color: AnnotationColor = 'amber'): NoteData => ({ kind: 'note', text, color });

/**
 * Campos do node que valem a pena guardar (salvar, desfazer, copiar): id, tipo, posição e dados;
 * molduras e anotações levam também o tamanho e a camada.
 */
export function nodeShape(n: FactoryNode): FactoryNode {
  const { id, type, position, data } = n;
  if (data.kind !== 'frame' && data.kind !== 'note') return { id, type, position, data } as FactoryNode;
  const size = cleanSize(data.kind, n.width, n.height);
  return { id, type, position, data, ...size, ...(data.kind === 'frame' ? { zIndex: FRAME_Z } : {}) } as FactoryNode;
}

/** Node novo de moldura/anotação (tamanho padrão e camada certa) */
export function annotationNode(id: string, data: FactoryData, position: { x: number; y: number }): FactoryNode {
  return nodeShape({ id, type: data.kind, position: { x: snapGrid(position.x), y: snapGrid(position.y) }, data } as FactoryNode);
}

/* ---------- o que está dentro de uma moldura ---------- */

/** Fração mínima da área de um node que precisa estar dentro da moldura pra ir junto com ela */
export const INSIDE_FRACTION = 0.5;

type Box = { x: number; y: number; w: number; h: number };
const boxOf = (n: FactoryNode): Box => ({
  x: n.position.x,
  y: n.position.y,
  w: n.measured?.width ?? n.width ?? 0,
  h: n.measured?.height ?? n.height ?? 0,
});

/**
 * Nodes "dentro" da moldura: os que têm pelo menos metade da área nela (outra moldura só
 * conta se estiver inteira dentro, pra uma moldura grande não ser levada por uma menor).
 */
export function frameMembers(frame: FactoryNode, nodes: FactoryNode[]): FactoryNode[] {
  const f = boxOf(frame);
  return nodes.filter((n) => {
    if (n.id === frame.id) return false;
    const b = boxOf(n);
    if (!b.w || !b.h) return false;
    if (n.data.kind === 'frame') return b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h;
    const ox = Math.max(0, Math.min(b.x + b.w, f.x + f.w) - Math.max(b.x, f.x));
    const oy = Math.max(0, Math.min(b.y + b.h, f.y + f.h) - Math.max(b.y, f.y));
    return ox * oy >= INSIDE_FRACTION * b.w * b.h;
  });
}

/** Texto curto de uma anotação (primeira linha não vazia) */
export const noteSummary = (text: string, max = 60) => {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
