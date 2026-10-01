import { useEffect, useState } from 'react';
import { onBackgroundError } from '../errors';

/** Aviso discreto de erro em segundo plano (fora do React): o app segue funcionando */
export function ErrorToast() {
  const [last, setLast] = useState<{ message: string; count: number } | null>(null);
  useEffect(() => onBackgroundError((message) => setLast((l) => ({ message, count: (l?.count ?? 0) + 1 }))), []);
  if (!last) return null;
  return (
    <div className="error-toast" role="status">
      <span>
        ⚠️ Algo deu errado em segundo plano{last.count > 1 ? ` (${last.count}×)` : ''}: <b>{last.message}</b>. A planta continua salva; detalhes no
        console.
      </span>
      <button className="modal-x" onClick={() => setLast(null)} title="Fechar aviso">
        ✕
      </button>
    </div>
  );
}
