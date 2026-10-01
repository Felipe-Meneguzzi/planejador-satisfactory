import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react';
import { ANNOTATION_COLORS, ANNOTATION_COLOR_KEYS, FRAME_MIN, MAX_FRAME_TITLE, MAX_NOTE_TEXT, NOTE_MIN } from '../game/annotations';
import type { AnnotationColor, FrameNode, NoteNode } from '../game/types';
import { usePopover } from './Popover';

/*
 * Moldura e anotação: só organização visual. O tamanho é o do próprio node (o NodeResizer
 * muda width/height); o App alinha posição e tamanho ao grid.
 */

/** variáveis de cor usadas pelo CSS (borda, cabeçalho e fundo) */
const colorVars = (c: AnnotationColor) => {
  const info = ANNOTATION_COLORS[c] ?? ANNOTATION_COLORS.slate;
  return { '--ann': info.base, '--ann-fill': info.fill } as CSSProperties;
};

/** Botão redondo com a cor atual; abre as 8 opções */
function ColorPicker({ value, onChange }: { value: AnnotationColor; onChange: (c: AnnotationColor) => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="ann-color nodrag" ref={ref}>
      <button
        className="ann-color-btn"
        style={{ background: ANNOTATION_COLORS[value]?.base }}
        title={`Cor: ${ANNOTATION_COLORS[value]?.name ?? ''}`}
        aria-label="Escolher a cor"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="ann-color-pop" role="listbox" aria-label="Cores">
          {ANNOTATION_COLOR_KEYS.map((k) => (
            <button
              key={k}
              role="option"
              aria-selected={k === value}
              className={`ann-swatch ${k === value ? 'on' : ''}`}
              style={{ background: ANNOTATION_COLORS[k].base }}
              title={ANNOTATION_COLORS[k].name}
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Texto que vira campo ao editar: Enter (ou sair do campo) confirma, Esc cancela */
function useEditable(value: string, commit: (v: string) => void) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const cancelled = useRef(false);
  const start = () => {
    cancelled.current = false;
    setText(value);
    setEditing(true);
  };
  const finish = () => {
    setEditing(false);
    if (!cancelled.current && text !== value) commit(text);
  };
  const cancel = () => {
    cancelled.current = true;
    setEditing(false);
  };
  return { editing, text, setText, start, finish, cancel };
}

export function FrameNodeView({ id, data, selected }: NodeProps<FrameNode>) {
  const { updateNodeData } = useReactFlow();
  const title = useEditable(data.title, (t) => updateNodeData(id, { title: t.trim().slice(0, MAX_FRAME_TITLE) }));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') title.cancel();
  };
  return (
    <div className={`frame ${selected ? 'selected' : ''}`} style={colorVars(data.color)}>
      <NodeResizer isVisible={!!selected} minWidth={FRAME_MIN.width} minHeight={FRAME_MIN.height} color={ANNOTATION_COLORS[data.color]?.base} />
      <div className="frame-header" onDoubleClick={title.start} title="Arraste pra mover a moldura com o que está dentro · duplo clique renomeia">
        {title.editing ? (
          <input
            className="frame-title-input nodrag"
            autoFocus
            value={title.text}
            maxLength={MAX_FRAME_TITLE}
            placeholder="Título da moldura"
            aria-label="Título da moldura"
            onChange={(e) => title.setText(e.target.value)}
            onBlur={title.finish}
            onKeyDown={onKey}
          />
        ) : (
          <span className={`frame-title ${data.title ? '' : 'empty'}`}>{data.title || 'Sem título'}</span>
        )}
        {selected && !title.editing && (
          <>
            <button className="ann-btn nodrag" onClick={title.start} title="Renomear (ou duplo clique no título)" aria-label="Renomear">
              ✎
            </button>
            <ColorPicker value={data.color} onChange={(color) => updateNodeData(id, { color })} />
          </>
        )}
      </div>
    </div>
  );
}

export function NoteNodeView({ id, data, selected }: NodeProps<NoteNode>) {
  const { updateNodeData } = useReactFlow();
  const note = useEditable(data.text, (t) => updateNodeData(id, { text: t.slice(0, MAX_NOTE_TEXT) }));
  const area = useRef<HTMLTextAreaElement>(null);
  // cursor no fim do texto ao começar a editar
  useEffect(() => {
    const el = area.current;
    if (note.editing && el) el.setSelectionRange(el.value.length, el.value.length);
  }, [note.editing]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter quebra linha; Ctrl+Enter ou Esc terminam (Esc descarta)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.blur();
    else if (e.key === 'Escape') note.cancel();
  };
  return (
    <div className={`note-card ${selected ? 'selected' : ''}`} style={colorVars(data.color)} onDoubleClick={note.editing ? undefined : note.start}>
      <NodeResizer isVisible={!!selected} minWidth={NOTE_MIN.width} minHeight={NOTE_MIN.height} color={ANNOTATION_COLORS[data.color]?.base} />
      {note.editing ? (
        <textarea
          ref={area}
          className="note-text note-input nodrag nowheel"
          autoFocus
          value={note.text}
          maxLength={MAX_NOTE_TEXT}
          placeholder="Escreva a anotação…"
          aria-label="Texto da anotação"
          onChange={(e) => note.setText(e.target.value)}
          onBlur={note.finish}
          onKeyDown={onKey}
        />
      ) : (
        <div className={`note-text ${data.text ? '' : 'empty'}`} title="Duplo clique pra editar">
          {data.text || 'Duplo clique pra escrever…'}
        </div>
      )}
      {selected && !note.editing && (
        <div className="note-tools">
          <ColorPicker value={data.color} onChange={(color) => updateNodeData(id, { color })} />
        </div>
      )}
    </div>
  );
}
