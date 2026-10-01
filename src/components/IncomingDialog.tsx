import { useEffect } from 'react';
import { countsLabel } from './Backups';
import type { Incoming } from '../state/storage';

const KIND_LABEL: Record<Incoming['kind'], string> = {
  project: 'Projeto',
  factory: 'Fábrica avulsa',
  v1: 'Fábrica do formato antigo (versão 1)',
};

/**
 * Pergunta o que fazer com um projeto/fábrica que chegou (arquivo importado ou link aberto):
 * adicionar como nova(s) fábrica(s) ou substituir o projeto. Nada é apagado sem essa escolha.
 */
export function IncomingDialog(props: {
  incoming: Incoming;
  /** 'file' = arquivo importado; 'link' = link compartilhado */
  source: 'file' | 'link';
  fileName?: string;
  /** fábricas do projeto atual (o que "substituir" apaga) */
  current: number;
  onAdd: () => void;
  onReplace: () => void;
  onCancel: () => void;
}) {
  const { incoming, current } = props;
  const fs = incoming.project.factories;
  const n = fs.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const title = props.source === 'link' ? 'Abrir link compartilhado' : 'Importar arquivo';
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="modal incoming" role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{props.source === 'link' ? '🔗' : '📂'} {title}</h2>
          <button className="modal-x" onClick={props.onCancel} title="Fechar (Esc)">
            ✕
          </button>
        </header>
        <div className="modal-body">
          {props.fileName && <p className="muted incoming-file">{props.fileName}</p>}
          <p>
            <b>{KIND_LABEL[incoming.kind]}</b>
            {incoming.kind === 'project' && ` com ${n} fábrica${n === 1 ? '' : 's'}`} · {countsLabel(incoming.project)}
          </p>
          <ul className="incoming-list">
            {fs.map((f) => (
              <li key={f.id}>
                🏭 <b>{f.name}</b>{' '}
                <small className="muted">
                  {f.nodes.length} itens, {f.edges.length} conexões
                </small>
              </li>
            ))}
          </ul>
          <p className="muted">
            <b>Adicionar</b> mantém tudo o que você já tem e abre {n === 1 ? 'a fábrica nova numa aba' : 'as fábricas novas em abas'}. <b>Substituir</b> troca {current === 1 ? 'a fábrica atual' : `as ${current} fábricas atuais`} por{' '}
            {n === 1 ? 'esta' : 'estas'} (a versão atual fica guardada nas versões anteriores 🕘).
          </p>
        </div>
        <footer className="modal-foot">
          <button onClick={props.onCancel}>Cancelar</button>
          <span className="spacer" />
          <button className="danger" onClick={props.onReplace}>
            Substituir o projeto
          </button>
          <button className="primary" onClick={props.onAdd} autoFocus>
            {n === 1 ? 'Adicionar como nova fábrica' : `Adicionar como ${n} novas fábricas`}
          </button>
        </footer>
      </div>
    </div>
  );
}
