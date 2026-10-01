import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorToast } from './components/ErrorToast';
import { RecoveryPanel } from './components/RecoveryPanel';
import { installGlobalErrorHandlers } from './errors';
import '@xyflow/react/dist/style.css';
import './styles.css';

// erros fora do React: registra no console e mostra um aviso discreto (ErrorToast)
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* último recurso: se o app inteiro quebrar, painel de recuperação em vez de tela branca */}
    <ErrorBoundary name="app" fallback={(crash) => <RecoveryPanel {...crash} />}>
      <App />
    </ErrorBoundary>
    <ErrorToast />
  </React.StrictMode>,
);
