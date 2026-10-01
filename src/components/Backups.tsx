import { useEffect, useRef, useState } from 'react';
import { BACKUP_INTERVAL, MAX_BACKUPS, loadBackups, projectCounts, restoreBackup, type Backup, type ProjectState } from '../state/storage';

const when = (t: number) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** "3 itens, 2 conexões" (e quantas fábricas, quando há mais de uma) */
export function countsLabel(p: ProjectState) {
  const c = projectCounts(p);
  return `${c.factories > 1 ? `${c.factories} fábricas · ` : ''}${c.nodes} itens, ${c.edges} conexões`;
}

/** Lista das versões guardadas no backup rotativo, com o botão de restaurar cada uma */
export function BackupList({ backups, onRestore }: { backups: Backup[]; onRestore: (b: Backup) => void }) {
  if (!backups.length) return <p className="muted">Nenhuma versão anterior guardada ainda.</p>;
  return (
    <ul className="backup-list">
      {backups.map((b) => (
        <li key={b.savedAt}>
          <span>
            {when(b.savedAt)} <small className="muted">· {countsLabel(b.state)}</small>
          </span>
          <button onClick={() => onRestore(b)}>Restaurar</button>
        </li>
      ))}
    </ul>
  );
}

/** Botão discreto na barra de cima: abre as versões anteriores pra restaurar sem recarregar */
export function BackupMenu({ onRestore }: { onRestore: (s: ProjectState) => void }) {
  // null = fechado; a lista é lida do storage ao abrir
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!backups) return;
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setBackups(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setBackups(null);
    window.addEventListener('mousedown', outside);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', esc);
    };
  }, [backups]);

  return (
    <div className="backup-menu" ref={ref}>
      <button onClick={() => setBackups((b) => (b ? null : loadBackups()))} title="Versões anteriores do projeto (backup automático)">
        🕘
      </button>
      {backups && (
        <div className="backup-pop">
          <h3>Versões anteriores</h3>
          <p className="muted">
            Guardadas sozinhas (as últimas {MAX_BACKUPS}, no máximo uma a cada {BACKUP_INTERVAL / 60_000} min). Restaurar guarda o projeto atual antes.
          </p>
          <BackupList
            backups={backups}
            onRestore={(b) => {
              const s = restoreBackup(b.savedAt);
              setBackups(null);
              if (s) onRestore(s);
            }}
          />
        </div>
      )}
    </div>
  );
}
