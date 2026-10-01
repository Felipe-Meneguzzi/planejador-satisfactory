/// <reference types="vite/client" />

/** Erros já mostrados por um Error Boundary (em dev o React também os repassa pro window.onerror) */
const handled = new WeakSet<object>();
export const markHandled = (e: unknown) => {
  if (typeof e === 'object' && e !== null) handled.add(e);
};
export const wasHandled = (e: unknown) => typeof e === 'object' && e !== null && handled.has(e);

export const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

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
