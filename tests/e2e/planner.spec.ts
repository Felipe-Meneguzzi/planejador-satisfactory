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

test('modo Otimizado: Aluminum Ingot reaproveita a água da Aluminum Scrap e o painel fica "Tudo certo"', async ({ page }) => {
  await openWith(page, { nodes: [], edges: [] });
  await page.getByRole('button', { name: /Gerar linha/ }).click();
  const modal = page.getByRole('dialog', { name: 'Gerar linha de produção' });
  await modal.getByRole('button', { name: 'Otimizado' }).click();
  await modal.locator('input[list="planner-items"]').fill('Aluminum Ingot');
  await modal.locator('.planner-top input[type="number"]').fill('30');

  const side = modal.locator('.planner-side');
  await expect(side.locator('.opt-recipes')).toContainText('Aluminum Scrap');
  // 15 m³/min de água voltam pra Alumina Solution: só 30 dos 45 saem do chão
  await expect(side.locator('.opt-by tr', { hasText: 'Water' })).toContainText('15 m³/min');
  const cmp = side.getByRole('table', { name: 'Comparação com o plano manual' });
  await expect(cmp.locator('tr', { hasText: 'Water' })).toContainText('45');
  await expect(cmp.locator('tr', { hasText: 'Water' })).toContainText('−15');
  await expect(side.locator('.opt-verdict')).toContainText('fecha em 100%');

  await modal.getByRole('button', { name: 'Gerar ▶' }).click();
  await expect(modal).toHaveCount(0);
  await expect(problems(page)).toHaveCount(0);
  await expect(page.locator('.sidepanel .ok-msg')).toContainText('Tudo certo');
  await expect(page.locator('.sidepanel table.prod')).toContainText('Aluminum Ingot');
  // 1 extrator de água, 3 mineradoras, Silica, Alumina Solution, Aluminum Scrap e Foundry
  await expect(page.locator('.react-flow__node-extractor')).toHaveCount(1);
  await expect(page.locator('.react-flow__node-machine')).toHaveCount(4);
});

test('modo inverso: maximiza Iron Plate com 240 Iron Ore', async ({ page }) => {
  await openWith(page, { nodes: [], edges: [] });
  await page.getByRole('button', { name: /Gerar linha/ }).click();
  const modal = page.getByRole('dialog', { name: 'Gerar linha de produção' });
  await modal.getByRole('button', { name: 'Otimizado' }).click();
  await modal.getByRole('button', { name: 'Maximizar com o que eu tenho' }).click();
  await modal.locator('input[list="planner-items"]').fill('Iron Plate');
  // a quantidade some: quem decide é o otimizador
  await expect(modal.locator('.planner-top input[type="number"]')).toBeHidden();
  await modal.getByLabel('Iron Ore disponível').fill('240');
  await expect(modal.locator('.opt-max')).toContainText('160/min');

  // liberando o Pure Iron Ingot (com água à vontade) o máximo sobe
  await modal.getByRole('button', { name: 'Padrão + alternativas escolhidas' }).click();
  await modal.getByPlaceholder(/Buscar alternativa/).fill('pure iron');
  await modal.getByRole('listitem').filter({ hasText: 'Pure Iron Ingot' }).getByRole('checkbox').check();
  await expect(modal.locator('.opt-max')).toContainText('297,14/min');
  await modal.getByPlaceholder(/Buscar alternativa/).fill('');
  await modal.getByRole('button', { name: 'Desmarcar' }).click();
  await expect(modal.locator('.opt-max')).toContainText('160/min');

  // sem o recurso, a mensagem diz o que falta
  await modal.getByLabel('Iron Ore disponível').fill('');
  await expect(modal.locator('.pl-error')).toContainText('falta Iron Ore');
  await expect(modal.getByRole('button', { name: 'Gerar ▶' })).toBeDisabled();
  await modal.getByLabel('Iron Ore disponível').fill('240');

  await modal.getByRole('button', { name: 'Gerar ▶' }).click();
  await expect(modal).toHaveCount(0);
  await expect(problems(page)).toHaveCount(0);
  await expect(page.locator('.sidepanel .ok-msg')).toContainText('Tudo certo');
  await expect(page.locator('.sidepanel table.prod tr', { hasText: 'Iron Plate' })).toContainText('160/min');
});
