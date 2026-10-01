import { expect, test as base, type Page } from '@playwright/test';
import type { BeltEdge, FactoryNode } from '../../src/game/types';

/** Chave do estado salvo (src/state/storage.ts) */
const KEY = 'satisplanner:v1';

/**
 * Página com coleta de erros: todo teste termina exigindo console limpo
 * (erros e avisos, menos o aviso de atribuição do React Flow).
 */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('attribution')) errors.push(m.text());
    });
    // "Limpar" e "Exemplo" pedem confirmação
    page.on('dialog', (d) => d.accept());
    await use(errors);
    expect(errors, 'erros no console').toEqual([]);
  },
});
export { expect };

/** Abre o app com um estado salvo (antes de qualquer script da página rodar) */
export async function openWith(page: Page, state: { nodes: FactoryNode[]; edges: BeltEdge[] }) {
  await page.addInitScript(
    ([key, value]) => {
      // só na primeira carga: depois o app salva o que o usuário fizer
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(key, value);
      }
    },
    [KEY, JSON.stringify({ version: 1, defaultTier: 1, defaultPipeTier: 1, gridBelts: true, beltLabels: true, ...state })] as const,
  );
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(state.nodes.length);
}

/** Abre o app no exemplo padrão (storage vazio) */
export async function openDemo(page: Page) {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(7);
}

export const handle = (page: Page, node: string, id: string) =>
  page.locator(`.react-flow__node[data-id="${node}"] .react-flow__handle[data-handleid="${id}"]`);

/** Arrasta de um conector de saída até um de entrada */
export async function connect(page: Page, source: string, sourceHandle: string, target: string, targetHandle: string) {
  const a = await handle(page, source, sourceHandle).boundingBox();
  const b = await handle(page, target, targetHandle).boundingBox();
  if (!a || !b) throw new Error('conector não encontrado');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}

/** Clica num espaço vazio do canvas (tira o foco de campos e limpa a seleção) */
export const clickEmpty = (page: Page) => page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });

export const nodes = (page: Page) => page.locator('.react-flow__node');
export const edges = (page: Page) => page.locator('.react-flow__edge');
/** problemas listados no painel (erros e avisos, sem as informações) */
export const problems = (page: Page) => page.locator('.sidepanel .issue:not(.info)');
