import { useState } from 'react';
import { BackupList } from './Backups';
import type { CrashInfo } from './ErrorBoundary';
import { downloadJson, lastGoodState, loadBackups, restoreBackup } from '../state/storage';

const reload = () => location.reload();

/** Detalhes técnicos recolhíveis (mensagem, pilha do JS e dos componentes) */
function CrashDetails({ error, componentStack }: Pick<CrashInfo, 'error' | 'componentStack'>) {
  return (
    <>
      <p className="crash-msg">{error.message || String(error)}</p>
      <details className="crash-details">
        <summary>Detalhes técnicos</summary>
        <pre>
          {error.stack}
          {componentStack && `\n\nComponentes:${componentStack}`}
        </pre>
      </details>
    </>
  );
}

/** Tela de recuperação quando o app inteiro quebra: nunca tela branca, nunca planta perdida */
export function RecoveryPanel({ error, componentStack, reset }: CrashInfo) {
  // lidos uma vez: com o salvamento pausado, o storage não muda por baixo
  const [good] = useState(lastGoodState);
  const [backups] = useState(loadBackups);

  const download = () => good && downloadJson(good, `fabrica-backup-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.json`);

  return (
    <div className="crash-screen">
      <div className="crash-card" role="alert">
        <h2>⚠️ O planejador travou</h2>
        <p>
          Algo deu errado ao desenhar a tela. <b>Sua planta não foi perdida</b>: o salvamento automático foi pausado e a última versão boa continua
          guardada no navegador.
        </p>
        <CrashDetails error={error} componentStack={componentStack} />
        <div className="crash-actions">
          <button className="primary" onClick={reset}>
            Tentar de novo
          </button>
          <button onClick={download} disabled={!good} title={good ? `${good.nodes.length} itens, ${good.edges.length} conexões` : 'Nada salvo ainda'}>
            Baixar backup da planta
          </button>
          <button onClick={reload} title="Recarrega a página com a planta salva">
            Voltar pro último estado salvo
          </button>
        </div>
        {backups.length > 0 && (
          <details className="crash-backups">
            <summary>Versões anteriores ({backups.length})</summary>
            <p className="muted">Se o erro voltar com a planta salva, restaure uma versão anterior. A planta atual fica guardada no backup.</p>
            <BackupList
              backups={backups}
              onRestore={(b) => {
                restoreBackup(b.savedAt);
                reload();
              }}
            />
          </details>
        )}
      </div>
    </div>
  );
}
