import { useEffect, useMemo, useState } from 'react';
import { SHARE_LIMIT, copyText } from '../state/share';
import { fmt } from '../format';

export type ShareScope = 'factory' | 'project';

/** Gera o link da fábrica atual ou do projeto e copia; link grande demais sugere exportar o arquivo */
export function ShareDialog(props: {
  factoryName: string;
  factories: number;
  makeLink: (scope: ShareScope) => string | null;
  onExport: (scope: ShareScope) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<ShareScope>('factory');
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const { makeLink } = props;
  const link = useMemo(() => makeLink(scope), [makeLink, scope]);
  const big = !!link && link.length > SHARE_LIMIT;

  useEffect(() => setCopied(null), [scope]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal share" role="dialog" aria-label="Compartilhar por link">
        <header className="modal-head">
          <h2>🔗 Compartilhar por link</h2>
          <button className="modal-x" onClick={props.onClose} title="Fechar (Esc)">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <div className="seg share-scope">
            <button className={scope === 'factory' ? 'active' : ''} onClick={() => setScope('factory')}>
              Fábrica atual ({props.factoryName})
            </button>
            <button className={scope === 'project' ? 'active' : ''} onClick={() => setScope('project')}>
              Projeto inteiro ({props.factories} fábrica{props.factories === 1 ? '' : 's'})
            </button>
          </div>
          <p className="muted">
            O conteúdo vai comprimido no próprio link (nada é enviado pra servidor). Quem abrir escolhe se adiciona como fábrica nova ou substitui o projeto dele.
          </p>
          {link ? (
            <>
              <textarea className="share-link" readOnly value={link} rows={3} onFocus={(e) => e.target.select()} aria-label="Link" />
              <div className="share-row">
                <span className={`muted ${big ? 'warn-text' : ''}`}>{fmt(link.length)} caracteres</span>
                <span className="spacer" />
                {copied === 'ok' && <span className="ok-text">Copiado ✓</span>}
                {copied === 'fail' && <span className="warn-text">Não deu pra copiar: selecione o link e use Ctrl+C</span>}
                <button
                  className="primary"
                  onClick={async () => setCopied((await copyText(link)) ? 'ok' : 'fail')}
                >
                  Copiar link
                </button>
              </div>
              {big && (
                <p className="share-warn" role="alert">
                  ⚠ Link grande demais ({fmt(link.length)} caracteres, o limite seguro é ~{fmt(SHARE_LIMIT)}): chats e e-mails costumam cortar links assim. Prefira{' '}
                  <button className="link-btn" onClick={() => props.onExport(scope)}>
                    exportar o arquivo .json
                  </button>
                  .
                </p>
              )}
            </>
          ) : (
            <p className="share-warn">Não deu pra gerar o link: o conteúdo atual tem algum node inválido.</p>
          )}
        </div>
      </div>
    </div>
  );
}
