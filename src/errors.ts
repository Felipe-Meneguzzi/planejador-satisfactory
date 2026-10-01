/// <reference types="vite/client" />

export const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

/**
 * Mensagens de erros já mostrados por um Error Boundary, com o horário. Em dev o React também repassa
 * esses erros pro window.onerror, e cada nova tentativa de render lança um objeto novo: por isso a mensagem.
 */
const handled = new Map<string, number>();
const HANDLED_TTL = 5_000;
export const markHandled = (e: unknown) => void handled.set(toError(e).message, Date.now());
export const wasHandled = (e: unknown) => Date.now() - (handled.get(toError(e).message) ?? -Infinity) < HANDLED_TTL;

/**
 * Erro de renderização de propósito, só pra testes (E2E) e só em `npm run dev`:
 * com `localStorage['satisplanner:debug-crash']` = 'app' ou 'canvas', esse trecho quebra ao renderizar.
 * No build de produção a checagem some (import.meta.env.DEV é false), então nenhum usuário ativa sem querer.
 */
export const DEBUG_CRASH_KEY = 'satisplanner:debug-crash';
export function debugCrash(where: 'app' | 'canvas') {
  if (!import.meta.env.DEV) return;
  let armed: string | null = null;
  try {
    armed = localStorage.getItem(DEBUG_CRASH_KEY);
  } catch {
    /* sem storage, sem erro de teste */
  }
  if (armed === where) throw new Error(`Erro de teste forçado (${DEBUG_CRASH_KEY}=${where})`);
}

/* ---------- erros fora do React (eventos, timers, promessas) ---------- */

type Listener = (message: string) => void;
const listeners = new Set<Listener>();
/** Avisa a UI de erros em segundo plano; retorna a função que cancela */
export function onBackgroundError(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Tempo pro React terminar de tratar o erro: se um Error Boundary pegou, o painel dele já avisa */
const SETTLE_MS = 300;

/**
 * Registra no console os erros que o React não pega e avisa quem estiver ouvindo.
 * Não mexe no estado nem no salvamento (que continua validando tudo antes de gravar).
 */
export function installGlobalErrorHandlers() {
  const report = (err: unknown, origin: string) =>
    setTimeout(() => {
      if (wasHandled(err)) return;
      console.error(`[satisplanner] erro não tratado (${origin}):`, err);
      const message = toError(err).message || 'erro desconhecido';
      listeners.forEach((l) => {
        try {
          l(message);
        } catch {
          /* aviso nunca derruba nada */
        }
      });
    }, SETTLE_MS);
  window.addEventListener('error', (e) => report(e.error ?? e.message, 'evento'));
  window.addEventListener('unhandledrejection', (e) => report(e.reason, 'promessa'));
}
