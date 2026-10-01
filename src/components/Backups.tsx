import type { Backup } from '../state/storage';

const when = (t: number) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Lista das versões guardadas no backup rotativo, com o botão de restaurar cada uma */
export function BackupList({ backups, onRestore }: { backups: Backup[]; onRestore: (b: Backup) => void }) {
  if (!backups.length) return <p className="muted">Nenhuma versão anterior guardada ainda.</p>;
  return (
    <ul className="backup-list">
      {backups.map((b) => (
        <li key={b.savedAt}>
          <span>
            {when(b.savedAt)} <small className="muted">· {b.state.nodes.length} itens, {b.state.edges.length} conexões</small>
          </span>
          <button onClick={() => onRestore(b)}>Restaurar</button>
        </li>
      ))}
    </ul>
  );
}
