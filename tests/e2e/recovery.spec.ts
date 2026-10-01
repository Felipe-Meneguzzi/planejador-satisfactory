import type { Page } from '@playwright/test';
import type { BeltEdge, FactoryNode } from '../../src/game/types';
import { expect, nodes, openWith, test } from './fixtures';

/** Chaves do storage (src/state/storage.ts e src/errors.ts) */
const KEY = 'satisplanner:v1';
const CRASH = 'satisplanner:debug-crash';

const plant: { nodes: FactoryNode[]; edges: BeltEdge[] } = {
  nodes: [
    { id: 'miner', type: 'miner', position: { x: 0, y: 0 }, data: { kind: 'miner', resource: 'iron-ore', purity: 'normal', tier: 1, clock: 100 } },
    { id: 'smelter', type: 'machine', position: { x: 400, y: 0 }, data: { kind: 'machine', machine: 'smelter', recipe: 'iron-ingot', clock: 100 } },
    { id: 'store', type: 'sink', position: { x: 800, y: 0 }, data: { kind: 'sink' } },
  ],
  edges: [
    { id: 'b1', type: 'belt', source: 'miner', sourceHandle: 'out-0', target: 'smelter', targetHandle: 'in-0', data: { tier: 1 } },
    { id: 'b2', type: 'belt', source: 'smelter', sourceHandle: 'out-0', target: 'store', targetHandle: 'in-0', data: { tier: 1 } },
  ],
};

/** ids dos nodes do estado salvo no localStorage */
const savedIds = (page: Page) =>
  page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? 'null')?.nodes ?? []).map((n: { id: string }) => n.id).sort(), KEY);

/** Liga/desliga o erro de renderização forçado (só existe em `vite` dev, ver debugCrash) */
const armCrash = (page: Page, where: 'app' | 'canvas' | null) =>
  page.evaluate(([k, w]) => (w ? localStorage.setItem(k, w) : localStorage.removeItem(k)), [CRASH, where] as const);

test('erro de renderização no app mostra o painel de recuperação e não perde a planta', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await openWith(page, plant);

  // uma edição: apaga o armazém e espera o salvamento automático
  await page.locator('.react-flow__node[data-id="store"] .fnode-header').click();
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(2);
  await expect.poll(() => savedIds(page)).toEqual(['miner', 'smelter']);

  await armCrash(page, 'app');
  await page.reload();
  const panel = page.getByRole('alert');
  await expect(panel).toContainText('O planejador travou');
  await expect(panel).toContainText('Erro de teste forçado');
  await expect(page.locator('.react-flow')).toHaveCount(0);
  // detalhes recolhidos até clicar
  await expect(panel.locator('.crash-details pre')).toBeHidden();
  await panel.getByText('Detalhes técnicos').click();
  await expect(panel.locator('.crash-details pre')).toContainText('Planner');

  // passado o debounce do salvamento, a planta salva continua a mesma
  await page.waitForTimeout(600);
  expect(await savedIds(page)).toEqual(['miner', 'smelter']);
  // erro já mostrado pelo painel não vira aviso de segundo plano
  await expect(page.locator('.error-toast')).toHaveCount(0);

  // o backup baixado é a planta boa
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Baixar backup da planta' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^fabrica-backup-.*\.json$/);
  let text = '';
  for await (const chunk of await download.createReadStream()) text += chunk;
  const backup = JSON.parse(text);
  expect(backup.nodes.map((n: { id: string }) => n.id).sort()).toEqual(['miner', 'smelter']);
  expect(backup.edges).toHaveLength(1);

  // sem o erro, "Tentar de novo" volta com a planta
  await armCrash(page, null);
  await panel.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(nodes(page)).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // só o erro forçado chegou ao console
  expect(pageErrors.length).toBeGreaterThan(0);
  expect(pageErrors.filter((m) => !m.includes('Erro de teste forçado'))).toEqual([]);
});

test('erro só no canvas mantém paleta e painel e não salva até o canvas voltar', async ({ page }) => {
  await openWith(page, plant);
  await expect.poll(() => savedIds(page)).toEqual(['miner', 'smelter', 'store']);
  const labels = await page.locator('.belt-label').count();
  expect(labels).toBeGreaterThan(0);

  // quebra no meio do uso: o próximo render do app (aqui, selecionar um node) dispara o erro
  await armCrash(page, 'canvas');
  await page.locator('.react-flow__node[data-id="store"] .fnode-header').click();
  const panel = page.getByRole('alert');
  await expect(panel).toContainText('O canvas travou');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  // a paleta continua funcionando, mas nada é salvo enquanto o canvas está quebrado
  await expect(page.locator('.sidepanel')).toBeVisible();
  await page.locator('.palette .palette-item').first().click();
  await page.waitForTimeout(600);
  expect(await savedIds(page)).toEqual(['miner', 'smelter', 'store']);
  await expect(page.locator('.error-toast')).toHaveCount(0);

  await armCrash(page, null);
  await panel.getByRole('button', { name: 'Tentar de novo' }).click();
  // volta com a planta e o node adicionado, que então é salvo
  await expect(nodes(page)).toHaveCount(4);
  await expect.poll(async () => (await savedIds(page)).length).toBe(4);
  // rótulos das esteiras voltam (o container deles é procurado de novo)
  await expect(page.locator('.belt-label')).toHaveCount(labels);
});

test('erro fora do React vira aviso discreto e o salvamento continua', async ({ page }) => {
  await openWith(page, plant);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('falha num timer');
    });
    void Promise.reject(new Error('falha numa promessa'));
  });
  const toast = page.locator('.error-toast');
  await expect(toast).toContainText('Algo deu errado em segundo plano (2×)');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // o app segue funcionando e salvando
  await page.locator('.react-flow__node[data-id="store"] .fnode-header').click();
  await page.keyboard.press('Delete');
  await expect.poll(() => savedIds(page)).toEqual(['miner', 'smelter']);
  await toast.getByTitle('Fechar aviso').click();
  await expect(toast).toHaveCount(0);
});

test('o botão de versões restaura um backup sem recarregar', async ({ page }) => {
  // uma versão antiga no backup, só com a mineradora
  const old = { version: 1, defaultTier: 1, defaultPipeTier: 1, gridBelts: true, beltLabels: true, nodes: [plant.nodes[0]], edges: [] };
  await page.addInitScript(
    ([state]) => {
      if (!sessionStorage.getItem('seeded')) localStorage.setItem('satisplanner:backups:v1', JSON.stringify([{ savedAt: Date.now() - 600_000, state }]));
    },
    [old] as const,
  );
  await openWith(page, plant);
  // o primeiro salvamento guarda a planta atual como a versão mais nova
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('satisplanner:backups:v1') ?? '[]').length)).toBe(2);

  const open = () => page.getByTitle('Versões anteriores da planta').click();
  const pop = page.locator('.backup-pop');
  await open();
  await expect(pop.locator('.backup-list li')).toHaveCount(2);
  await expect(pop.locator('.backup-list li').nth(1)).toContainText('1 itens, 0 conexões');
  await pop.getByRole('button', { name: 'Restaurar' }).nth(1).click();
  await expect(pop).toHaveCount(0);
  await expect(nodes(page)).toHaveCount(1);
  await expect.poll(() => savedIds(page)).toEqual(['miner']);

  // a planta de antes continua guardada e dá pra voltar pra ela
  await open();
  await expect(pop.locator('.backup-list li').first()).toContainText('3 itens, 2 conexões');
  await pop.getByRole('button', { name: 'Restaurar' }).first().click();
  await expect(nodes(page)).toHaveCount(3);
});
