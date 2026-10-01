import type { Page } from '@playwright/test';
import type { BeltEdge, FactoryNode } from '../../src/game/types';
import { clickEmpty, edges, expect, handle, nodes, openProject, openWith, tab, test } from './fixtures';

/* Editor: reconectar pontas, molduras, anotações e a busca rápida (Ctrl+K) */

const KEY = 'satisplanner:v1';
type SavedNode = FactoryNode & { width?: number; height?: number };
/** projeto salvo (espera o salvamento automático) */
const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);
const savedNode = async (page: Page, id: string, factory = 0): Promise<SavedNode | undefined> =>
  (await saved(page))?.factories?.[factory]?.nodes.find((n: SavedNode) => n.id === id);
const savedEdges = async (page: Page): Promise<BeltEdge[]> => (await saved(page))?.factories?.[0]?.edges ?? [];
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

const miner: FactoryNode = {
  id: 'miner',
  type: 'miner',
  position: { x: 0, y: 0 },
  data: { kind: 'miner', resource: 'iron-ore', purity: 'normal', tier: 1, clock: 100 },
};
const sink = (id: string, x: number, y: number): FactoryNode => ({ id, type: 'sink', position: { x, y }, data: { kind: 'sink' } });
const water: FactoryNode = {
  id: 'water',
  type: 'extractor',
  position: { x: 0, y: 420 },
  data: { kind: 'extractor', extractor: 'water', resource: 'water', purity: 'normal', clock: 100 },
};

/**
 * Arrasta a ponta de uma conexão (perto do conector, do lado de fora do node, onde fica a
 * alça de reconectar) até o ponto (x, y) da tela.
 */
async function dragEdgeEnd(page: Page, edgeId: string, end: 'source' | 'target', x: number, y: number) {
  const a = (await page.locator(`.react-flow__edge[data-id="${edgeId}"] .react-flow__edgeupdater-${end}`).boundingBox())!;
  // a alça é um círculo centrado na ponta; o conector cobre a metade de dentro: pega a de fora
  const dx = end === 'target' ? -a.width / 4 : a.width / 4;
  await page.mouse.move(a.x + a.width / 2 + dx, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 15 });
  await page.mouse.up();
}
const centerOf = async (page: Page, nodeId: string, handleId: string) => {
  const b = (await handle(page, nodeId, handleId).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2] as const;
};

test.describe('reconectar a ponta de uma conexão', () => {
  const plant = {
    nodes: [miner, sink('s1', 600, -200), sink('s2', 600, 300), water, { ...miner, id: 'miner2', position: { x: 0, y: -460 } }],
    edges: [{ id: 'e1', type: 'belt' as const, source: 'miner', sourceHandle: 'out-0', target: 's1', targetHandle: 'in-0', data: { tier: 3 as const, routing: 'grid' as const, bends: [300, 100], anchor: [1, 2, 3, 4] as [number, number, number, number] } }],
  };

  test('levar a ponta pra outra entrada muda o destino e mantém o Mk; desfazer volta', async ({ page }) => {
    await openWith(page, plant);
    await dragEdgeEnd(page, 'e1', 'target', ...(await centerOf(page, 's2', 'in-0')));
    await expect.poll(async () => (await savedEdges(page)).map((e) => [e.id, e.source, e.target, e.data?.tier])).toEqual([['e1', 'miner', 's2', 3]]);
    // mantém Mk e rota; o trajeto planejado pelo gerador (bends/anchor) é descartado
    expect((await savedEdges(page))[0].data).toEqual({ tier: 3, routing: 'grid' });
    await expect(edges(page)).toHaveCount(1);
    // o armazém novo recebe o minério
    await expect(node(page, 's2')).toContainText('Iron Ore');

    await clickEmpty(page);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await savedEdges(page)).map((e) => e.target)).toEqual(['s1']);
  });

  test('porta inválida (troca de esteira pra cano) ou soltar no vazio não mudam nada', async ({ page }) => {
    await openWith(page, plant);
    // a ponta de saída da esteira na saída de água: viraria cano → recusado
    await dragEdgeEnd(page, 'e1', 'source', ...(await centerOf(page, 'water', 'out-0')));
    // soltar no vazio: a conexão continua lá (não é apagada)
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await dragEdgeEnd(page, 'e1', 'target', pane.x + pane.width - 60, pane.y + pane.height - 60);
    await page.waitForTimeout(500);
    await expect(edges(page)).toHaveCount(1);
    await expect(page.locator('.react-flow__edge-belt')).toHaveCount(1);
    await expect.poll(async () => (await savedEdges(page)).map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle, e.type])).toEqual([
      ['miner', 'out-0', 's1', 'in-0', 'belt'],
    ]);
    // a mesma ponta de saída numa saída de sólido válida: aí troca (a alça foi pega de verdade)
    await dragEdgeEnd(page, 'e1', 'source', ...(await centerOf(page, 'miner2', 'out-0')));
    await expect.poll(async () => (await savedEdges(page)).map((e) => [e.source, e.target, e.type])).toEqual([['miner2', 's1', 'belt']]);
  });
});

test('moldura: cria pela paleta, renomeia, troca a cor, redimensiona no grid, arrasta com o conteúdo e desfaz', async ({ page }) => {
  await openWith(page, {
    nodes: [
      { id: 'fr', type: 'frame', position: { x: -40, y: -80 }, width: 760, height: 440, zIndex: -2000, data: { kind: 'frame', title: 'Andar 1', color: 'blue' } } as FactoryNode,
      miner,
      sink('s1', 400, 0),
      sink('fora', 1100, 0),
    ],
    edges: [],
  });

  // nova moldura pela paleta (seção Organização)
  await page.locator('.palette-item').filter({ hasText: 'Moldura' }).click();
  await expect(nodes(page)).toHaveCount(5);
  const created = page.locator('.react-flow__node-frame.selected');
  await expect(created).toHaveCount(1);
  const newId = (await created.getAttribute('data-id'))!;

  // renomeia (duplo clique no título) e troca a cor
  await created.locator('.frame-header').dblclick();
  const input = created.locator('.frame-title-input');
  await input.fill('Andar 2 — Aço');
  await input.press('Enter');
  await expect(created.locator('.frame-title')).toHaveText('Andar 2 — Aço');
  await created.getByLabel('Escolher a cor').click();
  await created.getByRole('option', { name: 'Laranja' }).click();
  await expect.poll(async () => (await savedNode(page, newId))?.data).toEqual({ kind: 'frame', title: 'Andar 2 — Aço', color: 'orange' });

  // a moldura nova fica atrás das máquinas (z negativo, mesmo selecionada)
  const z = await created.evaluate((el) => Number(getComputedStyle(el).zIndex));
  expect(z).toBeLessThan(0);

  // redimensiona pela alça do canto: tamanho e posição continuam múltiplos de 20
  const corner = (await created.locator('.react-flow__resize-control.handle.bottom.right').boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + 87, corner.y + 53, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await savedNode(page, newId))?.width).toBeGreaterThan(480);
  const resized = (await savedNode(page, newId))!;
  for (const v of [resized.width!, resized.height!, resized.position.x, resized.position.y]) expect(v % 20).toBe(0);

  // apaga a moldura nova (fica só a do teste de arraste)
  await created.locator('.frame-header').click();
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(4);

  // arrastar a moldura pelo cabeçalho leva junto o que está dentro, e só isso
  const before = { miner: (await savedNode(page, 'miner'))!.position, s1: (await savedNode(page, 's1'))!.position, fora: (await savedNode(page, 'fora'))!.position };
  const header = (await node(page, 'fr').locator('.frame-header').boundingBox())!;
  await page.mouse.move(header.x + 300, header.y + 12);
  await page.mouse.down();
  await page.mouse.move(header.x + 300 + 90, header.y + 12 + 70, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await savedNode(page, 'fr'))?.position).not.toEqual({ x: -40, y: -80 });
  const fr = (await savedNode(page, 'fr'))!.position;
  const d = { x: fr.x + 40, y: fr.y + 80 };
  expect(d.x % 20).toBe(0);
  expect(d.y % 20).toBe(0);
  expect((await savedNode(page, 'miner'))!.position).toEqual({ x: before.miner.x + d.x, y: before.miner.y + d.y });
  expect((await savedNode(page, 's1'))!.position).toEqual({ x: before.s1.x + d.x, y: before.s1.y + d.y });
  expect((await savedNode(page, 'fora'))!.position).toEqual(before.fora);

  // um Ctrl+Z desfaz o arraste inteiro (moldura e conteúdo)
  await clickEmpty(page);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await savedNode(page, 'fr'))?.position).toEqual({ x: -40, y: -80 });
  expect((await savedNode(page, 'miner'))!.position).toEqual(before.miner);
  // clicar no meio da moldura não seleciona ela (o clique vai pro canvas)
  const body = (await node(page, 'fr').boundingBox())!;
  await page.mouse.click(body.x + body.width / 2, body.y + body.height - 20);
  await expect(page.locator('.react-flow__node-frame.selected')).toHaveCount(0);
});

test('anotação: cria, escreve várias linhas, troca a cor e entra no desfazer', async ({ page }) => {
  await openWith(page, { nodes: [miner], edges: [] });
  await page.locator('.palette-item').filter({ hasText: 'Anotação' }).click();
  const note = page.locator('.react-flow__node-note');
  await expect(note).toHaveCount(1);
  const id = (await note.getAttribute('data-id'))!;

  await note.locator('.note-card').dblclick();
  const area = note.locator('textarea');
  await area.fill('Lembrar:\ncarvão vem da Fábrica 2');
  await clickEmpty(page);
  await expect(note.locator('.note-text')).toHaveText('Lembrar:\ncarvão vem da Fábrica 2');
  await expect.poll(async () => (await savedNode(page, id))?.data).toEqual({ kind: 'note', text: 'Lembrar:\ncarvão vem da Fábrica 2', color: 'amber' });
  const s = (await savedNode(page, id))!;
  expect(s.width! % 20).toBe(0);
  expect(s.height! % 20).toBe(0);

  await note.locator('.note-card').click();
  await note.getByLabel('Escolher a cor').click();
  await note.getByRole('option', { name: 'Verde' }).click();
  await expect.poll(async () => (await savedNode(page, id))?.data).toMatchObject({ color: 'green' });

  // a anotação não entra na contagem de máquinas nem gera aviso
  await expect(page.locator('.stats')).toContainText('🏭 1 máquinas');

  await clickEmpty(page);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await savedNode(page, id))?.data).toMatchObject({ color: 'amber' });
});

test.describe('busca rápida (Ctrl+K)', () => {
  test('adiciona a receita escolhida e abre até com o foco num campo', async ({ page }) => {
    await openWith(page, { nodes: [miner], edges: [] });
    // foco na busca da paleta: o Ctrl+K abre mesmo assim
    await page.locator('.palette-search').focus();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Busca rápida' });
    await expect(dialog).toBeVisible();
    await page.keyboard.type('iron pl');
    await expect(dialog.getByRole('option').first()).toContainText('Iron Plate');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(nodes(page)).toHaveCount(2);
    const added = page.locator('.react-flow__node-machine.selected');
    await expect(added).toContainText('Constructor');
    await expect(added.locator('select').first()).toHaveValue('iron-plate');

    // Esc fecha sem fazer nada; setas navegam
    await page.keyboard.press('Control+k');
    await page.keyboard.type('moldura');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(nodes(page)).toHaveCount(2);
  });

  test('"ir para" troca de aba e centraliza no node (e acha moldura pelo título)', async ({ page }) => {
    await openProject(page, [
      { id: 'a', name: 'Ferro', nodes: [miner], edges: [] },
      {
        id: 'b',
        name: 'Aço',
        nodes: [
          { id: 'fr', type: 'frame', position: { x: -2000, y: -2000 }, width: 400, height: 300, zIndex: -2000, data: { kind: 'frame', title: 'Andar 2 — Aço', color: 'teal' } } as FactoryNode,
          { id: 'far', type: 'machine', position: { x: 3000, y: 2000 }, data: { kind: 'machine', machine: 'foundry', recipe: 'steel-ingot', clock: 100 } },
        ],
        edges: [],
      },
    ]);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('foundry steel');
    const option = page.getByRole('option').filter({ hasText: 'Foundry · Steel Ingot' }).filter({ hasText: 'Aço' });
    await expect(option).toHaveCount(1);
    await option.click();

    await expect(tab(page, 'Aço')).toHaveAttribute('aria-selected', 'true');
    await expect(node(page, 'far')).toHaveClass(/selected/);
    // centralizado: o meio do node perto do meio do canvas
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await expect
      .poll(async () => {
        const b = (await node(page, 'far').boundingBox())!;
        return Math.hypot(b.x + b.width / 2 - (pane.x + pane.width / 2), b.y + b.height / 2 - (pane.y + pane.height / 2));
      })
      .toBeLessThan(40);

    // moldura pelo título, sem acento
    await page.keyboard.press('Control+k');
    await page.keyboard.type('andar 2 aco');
    await page.keyboard.press('Enter');
    await expect(node(page, 'fr')).toHaveClass(/selected/);
    await expect(node(page, 'fr')).toBeInViewport();
  });
});
