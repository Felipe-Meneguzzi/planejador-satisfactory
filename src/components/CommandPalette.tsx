import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { rankQuick, type QuickItem } from '../state/quickSearch';

/**
 * Busca rápida (Ctrl+K), estilo paleta de comandos: adicionar nodes, ir para nodes/molduras
 * (inclusive de outras fábricas) e ações do app. ↑/↓ navegam, Enter escolhe, Esc fecha.
 */
export function CommandPalette({ items, onClose }: { items: QuickItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => rankQuick(items, query), [items, query]);
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // busca nova: volta pro primeiro resultado
  useEffect(() => setActive(0), [query]);
  // o item ativo sempre visível na lista
  useEffect(() => {
    listRef.current?.querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active, sections]);

  const choose = (it: QuickItem | undefined) => {
    if (!it) return;
    onClose();
    it.run();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + dir + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let index = 0;
  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Busca rápida" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="cmdk-input"
          autoFocus
          value={query}
          placeholder="Adicionar máquina, ir para um node ou moldura, ação…"
          aria-label="Buscar"
          aria-controls="cmdk-list"
          aria-activedescendant={flat[active] ? `cmdk-${flat[active].id}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {sections.map((s) => (
            <div key={s.group} className="cmdk-group" role="group" aria-label={s.group}>
              <div className="cmdk-group-title">{s.group}</div>
              {s.items.map((it) => {
                const i = index++;
                return (
                  <div
                    key={it.id}
                    id={`cmdk-${it.id}`}
                    role="option"
                    aria-selected={i === active}
                    className={`cmdk-item ${i === active ? 'active' : ''}`}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => choose(it)}
                  >
                    <span className="cmdk-icon" style={it.color ? { background: it.color } : undefined}>
                      {it.icon}
                    </span>
                    <span className="cmdk-label">{it.label}</span>
                    {it.hint && <span className="cmdk-hint">{it.hint}</span>}
                    {it.shortcut && <kbd className="cmdk-kbd">{it.shortcut}</kbd>}
                  </div>
                );
              })}
            </div>
          ))}
          {!flat.length && <div className="cmdk-empty">Nada encontrado pra “{query}”.</div>}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navegar
          </span>
          <span>
            <kbd>Enter</kbd> escolher
          </span>
          <span>
            <kbd>Esc</kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
}
