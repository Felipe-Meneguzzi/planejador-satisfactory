import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { parseImport, type FactoryExport, type ImportResult, type ProjectExport } from './storage';

/*
 * Compartilhar por link: a fábrica (ou o projeto) vai comprimida no hash da URL
 * (`#share=...`). O hash não é enviado ao servidor; quem abre o link vê o conteúdo e escolhe
 * se adiciona ou substitui.
 */

export const SHARE_PREFIX = '#share=';
/** acima disso alguns apps (chat, e-mail) cortam ou recusam o link */
export const SHARE_LIMIT = 8000;

/** Texto comprimido que vai no hash */
export const encodeShare = (payload: FactoryExport | ProjectExport) => compressToEncodedURIComponent(JSON.stringify(payload));

/** Link completo a partir do endereço atual (sem o hash antigo) */
export const shareUrl = (payload: FactoryExport | ProjectExport, base: string) => `${base.split('#')[0]}${SHARE_PREFIX}${encodeShare(payload)}`;

/** O hash é de um link compartilhado? */
export const isShareHash = (hash: string) => hash.startsWith(SHARE_PREFIX);

/** Lê o conteúdo de um hash `#share=...` (descomprime e valida como um arquivo importado) */
export function decodeShare(hash: string): ImportResult {
  const data = hash.startsWith(SHARE_PREFIX) ? hash.slice(SHARE_PREFIX.length) : hash;
  let text: string | null = null;
  try {
    text = decompressFromEncodedURIComponent(data);
  } catch {
    text = null;
  }
  if (!text) return { ok: false, error: 'Não dá pra abrir o link: ele está incompleto ou foi cortado no caminho.' };
  try {
    return parseImport(JSON.parse(text), 'Fábrica compartilhada');
  } catch {
    return { ok: false, error: 'Não dá pra abrir o link: o conteúdo não é um JSON válido.' };
  }
}

/** Copia o texto (Clipboard API; sem ela, seleciona num campo temporário e usa o comando antigo) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* sem permissão: tenta o jeito antigo */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
