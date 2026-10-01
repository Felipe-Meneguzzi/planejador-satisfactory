import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RecoveryPanel } from './components/RecoveryPanel';
import '@xyflow/react/dist/style.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* último recurso: se o app inteiro quebrar, painel de recuperação em vez de tela branca */}
    <ErrorBoundary name="app" fallback={(crash) => <RecoveryPanel {...crash} />}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
