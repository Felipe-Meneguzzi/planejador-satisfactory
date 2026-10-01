import { useState } from 'react';
import { BackupList, countsLabel } from './Backups';
import type { CrashInfo } from './ErrorBoundary';
import { downloadJson, exportProject, lastGoodState, loadBackups, restoreBackup } from '../state/storage';

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

/** Tela de recuperação quando o app inteiro quebra: nunca tela branca, nunca projeto perdido */
export function RecoveryPanel({ error, componentStack, reset }: CrashInfo) {
  // lidos uma vez: com o salvamento pausado, o storage não muda por baixo
  const [good] = useState(lastGoodState);
  const [backups] = useState(loadBackups);

  const download = () => {
    const data = good && exportProject(good);
    if (data) downloadJson(data, `projeto-backup-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.json`);
  };

  return (
    <div className="crash-screen">
      <div className="crash-card" role="alert">
        <h2>⚠️ O planejador travou</h2>
        <p>
          Algo deu errado ao desenhar a tela. <b>Seu projeto não foi perdido</b>: o salvamento automático foi pausado e a última versão boa continua
          guardada no navegador.
        </p>
        <CrashDetails error={error} componentStack={componentStack} />
        <div className="crash-actions">
          <button className="primary" onClick={reset}>
            Tentar de novo
          </button>
          <button onClick={download} disabled={!good} title={good ? countsLabel(good) : 'Nada salvo ainda'}>
            Baixar backup do projeto
          </button>
          <button onClick={reload} title="Recarrega a página com o projeto salvo">
            Voltar pro último estado salvo
          </button>
        </div>
        {backups.length > 0 && (
          <details className="crash-backups">
            <summary>Versões anteriores ({backups.length})</summary>
            <p className="muted">Se o erro voltar com o projeto salvo, restaure uma versão anterior. O projeto atual fica guardado no backup.</p>
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

/** Painel no lugar do canvas quando só ele quebra: paleta e painel lateral continuam funcionando */
export function CanvasCrash({ error, componentStack, reset, onUndo }: CrashInfo & { onUndo?: () => void }) {
  return (
    <div className="crash-screen crash-canvas">
      <div className="crash-card" role="alert">
        <h2>⚠️ O canvas travou</h2>
        <p>
          O resto do app continua funcionando e <b>o projeto salvo está a salvo</b>: o salvamento automático fica pausado até o canvas voltar.
        </p>
        <CrashDetails error={error} componentStack={componentStack} />
        <div className="crash-actions">
          <button className="primary" onClick={reset}>
            Tentar de novo
          </button>
          {onUndo && (
            <button
              onClick={() => {
                onUndo();
                reset();
              }}
              title="Desfaz a última alteração (que pode ter causado o erro) e tenta de novo"
            >
              Desfazer última alteração
            </button>
          )}
          <button onClick={reload} title="Recarrega a página com o projeto salvo">
            Voltar pro último estado salvo
          </button>
        </div>
      </div>
    </div>
  );
}
