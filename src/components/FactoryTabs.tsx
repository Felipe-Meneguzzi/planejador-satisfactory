import { useEffect, useRef, useState, type DragEvent } from 'react';
import { MenuButton } from './Popover';
import { MAX_NAME } from '../state/storage';

export interface TabInfo {
  id: string;
  name: string;
  errors: number;
  warnings: number;
}

const TAB_DND = 'application/x-satisplanner-tab';

/**
 * Abas das fábricas: clicar abre, duplo clique renomeia, arrastar reordena, ＋ cria.
 * A aba aberta tem o menu ⋯ (renomear, duplicar, mover, apagar).
 */
export function FactoryTabs(props: {
  tabs: TabInfo[];
  active: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** move a aba `id` pra posição `to` */
  onMove: (id: string, to: number) => void;
  onSummary: () => void;
}) {
  const { tabs, active } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // com muitas abas a lista rola: a aba aberta sempre fica à vista
  useEffect(() => {
    listRef.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  const commit = (id: string, value: string) => {
    setEditing(null);
    const name = value.trim().slice(0, MAX_NAME);
    if (name) props.onRename(id, name);
  };

  const onDrop = (e: DragEvent, to: number) => {
    const id = e.dataTransfer.getData(TAB_DND);
    setDragOver(null);
    if (!id) return;
    e.preventDefault();
    props.onMove(id, to);
  };

  return (
    <nav className="tabs" aria-label="Fábricas do projeto">
      <div className="tab-list" role="tablist" ref={listRef}>
        {tabs.map((t, i) => {
          const on = t.id === active;
          const badge = t.errors ? 'err' : t.warnings ? 'warn' : '';
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={on}
              data-factory={t.id}
              className={`tab ${on ? 'active' : ''} ${dragOver === i ? 'drop' : ''}`}
              draggable={editing !== t.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_DND, t.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TAB_DND)) return;
                e.preventDefault();
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
              onDrop={(e) => onDrop(e, i)}
              onClick={() => !on && props.onSelect(t.id)}
              onDoubleClick={() => setEditing(t.id)}
              title={on ? 'Duplo clique renomeia · arraste pra reordenar' : `Abrir "${t.name}"`}
            >
              {editing === t.id ? (
                <input
                  className="tab-edit"
                  aria-label="Nome da fábrica"
                  autoFocus
                  defaultValue={t.name}
                  maxLength={MAX_NAME}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => commit(t.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(t.id, e.currentTarget.value);
                    else if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <span className="tab-name">{t.name}</span>
              )}
              {badge && (
                <span className={`tab-badge ${badge}`} title={`${t.errors} erro(s), ${t.warnings} aviso(s)`}>
                  {t.errors || t.warnings}
                </span>
              )}
              {on && editing !== t.id && (
                <MenuButton
                  className="tab-menu"
                  label="⋯"
                  title="Opções da fábrica"
                  align="left"
                  items={[
                    { label: '✏️ Renomear', onClick: () => setEditing(t.id) },
                    { label: '⧉ Duplicar', onClick: () => props.onDuplicate(t.id) },
                    { label: '◀ Mover pra esquerda', onClick: () => props.onMove(t.id, i - 1), disabled: i === 0, separator: true },
                    { label: 'Mover pra direita ▶', onClick: () => props.onMove(t.id, i + 1), disabled: i === tabs.length - 1 },
                    { label: '🗑 Apagar fábrica…', onClick: () => props.onDelete(t.id), disabled: tabs.length === 1, danger: true, separator: true },
                  ]}
                />
              )}
            </div>
          );
        })}
      </div>
      <button className="tab-add" onClick={props.onAdd} title="Nova fábrica">
        +
      </button>
      <span className="spacer" />
      <button className="tab-summary" onClick={props.onSummary} title="Resumo do projeto: energia, máquinas, o que cada fábrica importa e exporta">
        📊 Projeto
      </button>
    </nav>
  );
}
