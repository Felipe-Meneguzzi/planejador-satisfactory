/*
 * Busca da paleta de comandos (Ctrl+K): sem acento, sem diferenciar maiúsculas e por partes
 * ("iron pl" acha "Iron Plate", "carvao" acha "Carvão", "coal-po" acha "Coal-Powered Generator").
 */

/** minúsculas, sem acento e com pontuação virando espaço */
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();

/** partes da busca (palavras) */
export const tokenize = (q: string) => normalize(q).split(' ').filter(Boolean);

/**
 * Nota de `text` pra busca `query` (maior = melhor) ou null se não bate. Toda parte da busca
 * precisa aparecer no texto; começo de palavra vale mais que meio de palavra, e o texto que
 * começa com a busca inteira ganha um bônus.
 */
export function matchScore(query: string, text: string): number | null {
  const tokens = tokenize(query);
  if (!tokens.length) return 0;
  const hay = normalize(text);
  const words = hay.split(' ');
  let score = 0;
  for (const t of tokens) {
    if (words.some((w) => w === t)) score += 4;
    else if (words.some((w) => w.startsWith(t))) score += 3;
    else if (hay.includes(t)) score += 1;
    else return null;
  }
  if (hay.startsWith(tokens.join(' '))) score += 5;
  // textos mais curtos (mais exatos) primeiro
  return score - hay.length / 1000;
}

export type QuickGroup = 'Ações' | 'Ir para' | 'Adicionar';
/** ordem dos grupos quando empatam (e com a busca vazia) */
const GROUP_ORDER: QuickGroup[] = ['Ações', 'Ir para', 'Adicionar'];

export interface QuickItem {
  id: string;
  group: QuickGroup;
  label: string;
  /** texto menor à direita/abaixo (máquina, fábrica, atalho...) */
  hint?: string;
  icon?: string;
  color?: string;
  /** atalho de teclado mostrado à direita */
  shortcut?: string;
  /** palavras extras que também acham o item (não aparecem) */
  keywords?: string;
  /** item que não deve aparecer com a busca vazia (listas longas) */
  hideWhenEmpty?: boolean;
  run: () => void;
}

export interface QuickSection {
  group: QuickGroup;
  items: QuickItem[];
}

/**
 * Filtra e ordena: cada grupo mostra até `perGroup` itens, com os melhores primeiro; os
 * grupos vêm na ordem da melhor nota de cada um. Busca vazia: a lista padrão, na ordem original.
 */
export function rankQuick(items: QuickItem[], query: string, perGroup = 8): QuickSection[] {
  const empty = !tokenize(query).length;
  const scored = new Map<QuickGroup, { item: QuickItem; score: number }[]>();
  items.forEach((item, i) => {
    if (empty && item.hideWhenEmpty) return;
    const score = empty ? -i : Math.max(matchScore(query, item.label) ?? -Infinity, (matchScore(query, `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`) ?? -Infinity) - 2);
    if (score === -Infinity) return;
    const list = scored.get(item.group) ?? [];
    list.push({ item, score });
    scored.set(item.group, list);
  });
  const sections = [...scored.entries()].map(([group, list]) => {
    const sorted = empty ? list : [...list].sort((a, b) => b.score - a.score);
    return { group, best: sorted[0]?.score ?? -Infinity, items: sorted.slice(0, perGroup).map((x) => x.item) };
  });
  sections.sort((a, b) => (empty ? 0 : b.best - a.best) || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  return sections.filter((s) => s.items.length).map(({ group, items }) => ({ group, items }));
}
