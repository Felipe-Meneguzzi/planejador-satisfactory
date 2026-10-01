import type { FactoryNode } from '../../src/game/types';
import { clickEmpty, connect, edges, expect, nodes, openDemo, openWith, problems, test } from './fixtures';

const minerPure: FactoryNode = {
  id: 'miner',
  type: 'miner',
  position: { x: 0, y: 0 },
  data: { kind: 'miner', resource: 'iron-ore', purity: 'pure', tier: 1, clock: 100 },
};
const store: FactoryNode = { id: 'store', type: 'sink', position: { x: 600, y: 0 }, data: { kind: 'sink' } };

test('carrega o exemplo sem erros e mostra a sobra no painel', async ({ page, errors }) => {
  await openDemo(page);
  await expect(edges(page)).toHaveCount(7);
  await expect(problems(page)).toHaveCount(2);
  await expect(page.locator('.sidepanel')).toContainText('Sobrando 30/min de Iron Ingot: produz 60/min, consome 30/min');
  await expect(page.locator('.stats')).toContainText('🏭 4 máquinas');
  expect(errors).toEqual([]);
});

test('conexão arrastada acusa esteira fraca e "Usar Mk.2" corrige', async ({ page }) => {
  await openWith(page, { nodes: [minerPure, store], edges: [] });
  await connect(page, 'miner', 'out-0', 'store', 'in-0');
  await expect(edges(page)).toHaveCount(1);

  const issue = problems(page).filter({ hasText: 'precisa levar 120/min, aguenta 60/min' });
  await expect(issue).toHaveCount(1);
  await expect(issue).toHaveClass(/error/);
  await issue.getByRole('button', { name: 'Usar Mk.2' }).click();

  await expect(problems(page)).toHaveCount(0);
  await expect(page.locator('.sidepanel .ok-msg')).toContainText('Tudo certo');
  // o armazém recebe os 120/min
  await expect(page.locator('.sidepanel table.prod')).toContainText('120/min');
});

test('desfaz e refaz (atalhos e botões)', async ({ page }) => {
  await openDemo(page);
  const undo = page.locator('button[title^="Desfazer"]');
  const redo = page.locator('button[title^="Refazer"]');
  await expect(undo).toBeDisabled();

  // apaga o armazém (e a esteira que chega nele)
  await page.locator('.react-flow__node[data-id="store"] .fnode-header').click();
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(6);
  await expect(edges(page)).toHaveCount(6);
  await expect(undo).toBeEnabled();

  await clickEmpty(page);
  await page.keyboard.press('Control+z');
  await expect(nodes(page)).toHaveCount(7);
  await expect(edges(page)).toHaveCount(7);
  await expect(redo).toBeEnabled();

  await page.keyboard.press('Control+y');
  await expect(nodes(page)).toHaveCount(6);

  await undo.click();
  await expect(nodes(page)).toHaveCount(7);
  await redo.click();
  await expect(nodes(page)).toHaveCount(6);
  await expect(redo).toBeDisabled();
});

test('copia e cola a seleção com as esteiras internas', async ({ page }) => {
  await openDemo(page);
  // seleciona divisor, as 2 fundidoras e o mesclador (Ctrl+clique)
  await page.locator('.react-flow__node[data-id="split"] .cube').click();
  for (const sel of ['[data-id="smelt1"] .fnode-header', '[data-id="smelt2"] .fnode-header', '[data-id="merge"] .cube'])
    await page.locator(`.react-flow__node${sel}`).click({ modifiers: ['Control'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(4);

  await page.keyboard.press('Control+c');
  // cola onde o mouse está, num canto vazio do canvas
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.move(pane.x + pane.width - 300, pane.y + pane.height - 200);
  await page.keyboard.press('Control+v');

  // +4 nodes e +4 esteiras (as que ligam os nodes copiados entre si)
  await expect(nodes(page)).toHaveCount(11);
  await expect(edges(page)).toHaveCount(11);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(4);
  // a cópia entra solta: o divisor colado fica sem entrada
  await expect(page.locator('.sidepanel details')).toContainText('Divisor sem entrada');
});

test('fluido não liga em entrada de sólido', async ({ page }) => {
  await openWith(page, {
    nodes: [
      { id: 'water', type: 'extractor', position: { x: 0, y: 0 }, data: { kind: 'extractor', extractor: 'water', resource: 'water', purity: 'normal', clock: 100 } },
      { id: 'smelter', type: 'machine', position: { x: 500, y: -200 }, data: { kind: 'machine', machine: 'smelter', recipe: 'iron-ingot', clock: 100 } },
      { ...store, position: { x: 500, y: 250 } },
    ],
    edges: [],
  });
  // água → entrada de minério da fundidora: recusado
  await connect(page, 'water', 'out-0', 'smelter', 'in-0');
  await expect(edges(page)).toHaveCount(0);
  // água → armazém (aceita qualquer coisa): vira cano
  await connect(page, 'water', 'out-0', 'store', 'in-0');
  await expect(page.locator('.react-flow__edge-pipe')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge-belt')).toHaveCount(0);
});
