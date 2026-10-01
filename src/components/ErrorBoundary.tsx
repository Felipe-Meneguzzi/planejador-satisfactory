import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { markHandled, toError } from '../errors';
import { blockSaves, unblockSaves } from '../state/storage';

export interface CrashInfo {
  error: Error;
  /** pilha de componentes do React (onde quebrou) */
  componentStack: string;
  /** remonta o trecho protegido do zero */
  reset: () => void;
}

interface Props {
  /** identifica o boundary na trava do salvamento e no console */
  name: string;
  fallback: (crash: CrashInfo) => ReactNode;
  /** chamado depois de "Tentar de novo" */
  onReset?: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string;
  /** muda a cada "Tentar de novo" pra remontar os filhos */
  attempt: number;
}

/**
 * Segura erros de renderização dos filhos: mostra o `fallback` em vez de tela branca
 * e pausa o salvamento automático enquanto estiver em erro (o estado bom continua guardado).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '', attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    blockSaves(this.props.name);
    markHandled(error);
    this.setState({ componentStack: info.componentStack ?? '' });
    console.error(`[satisplanner] "${this.props.name}" quebrou; salvamento automático pausado.`, error);
  }

  componentWillUnmount() {
    unblockSaves(this.props.name);
  }

  reset = () => {
    unblockSaves(this.props.name);
    this.setState((s) => ({ error: null, componentStack: '', attempt: s.attempt + 1 }));
    this.props.onReset?.();
  };

  render() {
    const { error, componentStack, attempt } = this.state;
    if (error) return this.props.fallback({ error, componentStack, reset: this.reset });
    return <Fragment key={attempt}>{this.props.children}</Fragment>;
  }
}
