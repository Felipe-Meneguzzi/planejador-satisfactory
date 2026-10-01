import { clickEmpty, edges, expect, nodes, openWith, problems, test } from './fixtures';

test('gera a linha de 10 Modular Frame e o painel fica "Tudo certo"', async ({ page }) => {
  await openWith(page, { nodes: [], edges: [] });
  await page.getByRole('button', { name: /Gerar linha/ }).click();
  const modal = page.getByRole('dialog', { name: 'Gerar linha de produção' });
  await modal.locator('input[list="planner-items"]').fill('Modular Frame');
  await modal.locator('input[type="number"]').fill('10');
  await modal.getByRole('button', { name: 'Gerar ▶' }).click();
  await expect(modal).toHaveCount(0);

  // 5 + 3 + 5 + 7 + 5 + 8 máquinas + 4 mineradoras
  await expect(page.locator('.stats')).toContainText('🏭 37 máquinas');
  await expect(page.locator('.react-flow__node-machine')).toHaveCount(33);
  await expect(page.locator('.react-flow__node-miner')).toHaveCount(4);
  await expect(page.locator('.react-flow__node-sink')).toHaveCount(1);
  await expect(problems(page)).toHaveCount(0);
  await expect(page.locator('.sidepanel .ok-msg')).toContainText('Tudo certo');
  await expect(page.locator('.sidepanel table.prod')).toContainText('Modular Frame');

  // a linha inteira entra como um passo só no histórico
  const total = await nodes(page).count();
  expect(total).toBeGreaterThan(37);
  await clickEmpty(page);
  await page.keyboard.press('Control+z');
  await expect(nodes(page)).toHaveCount(0);
  await expect(edges(page)).toHaveCount(0);
});
