import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

/** Aberto/fechado de um menu suspenso: fecha com clique fora e Esc */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', outside);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export interface MenuItem {
  label: ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  danger?: boolean;
  /** linha separando do item anterior */
  separator?: boolean;
}

/**
 * Botão com menu suspenso de ações. O menu usa posição fixa (calculada do botão) pra não ser
 * cortado quando o botão está dentro de algo com rolagem (as abas).
 */
export function MenuButton({ label, title, items, align = 'right', className }: { label: ReactNode; title?: string; items: MenuItem[]; align?: 'left' | 'right'; className?: string }) {
  const { open, setOpen, ref } = usePopover();
  const [pos, setPos] = useState<CSSProperties>({});
  const toggle = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setPos(align === 'right' ? { top: r.bottom + 6, right: window.innerWidth - r.right } : { top: r.bottom + 6, left: r.left });
    setOpen((o) => !o);
  };
  return (
    <div className={`menu ${className ?? ''}`} ref={ref}>
      <button onClick={toggle} title={title} aria-haspopup="menu" aria-expanded={open}>
        {label}
      </button>
      {open && (
        <div className="menu-pop" role="menu" style={pos}>
          {items.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              className={`${it.separator ? 'sep' : ''} ${it.danger ? 'danger' : ''}`}
              disabled={it.disabled}
              title={it.title}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
