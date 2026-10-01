import type { Page } from '@playwright/test';
import type { FactoryNode } from '../../src/game/types';
import { edges, expect, nodes, openDemo, openProject, problems, tab, tabNames, test, type SeedFactory } from './fixtures';

/*
 * Várias fábricas: abas, copiar/colar entre abas, Entrada/Saída externa, exportar/importar e link.
 * O fixture `errors` (pedido como `_errors`) exige console limpo e aceita as confirmações.
 */

const KEY = 'satisplanner:v1';
/** Buffer do Node (o projeto não instala @types/node; o Playwright roda no Node e aceita o Buffer no upload) */
declare const Buffer: { from(text: string): Uint8Array };

/** Ferro: mineradora (60 minério) → fundidora (30 lingotes) → Saída externa "Lingotes" */
const ferro: SeedFactory = {
  id: 'ferro',
  name: 'Ferro',
  nodes: [
    { id: 'm', type: 'miner', position: { x: 0, y: 0 }, data: { kind: 'miner', resource: 'iron-ore', purity: 'normal', tier: 1, clock: 100 } },
    { id: 's', type: 'machine', position: { x: 400, y: 0 }, data: { kind: 'machine', machine: 'smelter', recipe: 'iron-ingot', clock: 100 } },
    { id: 'out', type: 'outbound', position: { x: 800, y: 0 }, data: { kind: 'outbound', name: 'Lingotes' } },
  ],
  edges: [
    { id: 'b1', type: 'belt', source: 'm', sourceHandle: 'out-0', target: 's', targetHandle: 'in-0', data: { tier: 1 } },
    { id: 'b2', type: 'belt', source: 's', sourceHandle: 'out-0', target: 'out', targetHandle: 'in-0', data: { tier: 1 } },
  ],
};
/** Placas: Entrada externa (manual, 10 lingotes) → Constructor (pede 30) → Armazém */
const placas: SeedFactory = {
  id: 'placas',
  name: 'Placas',
  nodes: [
    { id: 'in', type: 'inbound', position: { x: 0, y: 0 }, data: { kind: 'inbound', item: 'iron-ingot', rate: 10 } },
    { id: 'c', type: 'machine', position: { x: 420, y: 0 }, data: { kind: 'machine', machine: 'constructor', recipe: 'iron-plate', clock: 100 } },
    { id: 'k', type: 'sink', position: { x: 840, y: 0 }, data: { kind: 'sink' } },
  ] as FactoryNode[],
  edges: [
    { id: 'e1', type: 'belt', source: 'in', sourceHandle: 'out-0', target: 'c', targetHandle: 'in-0', data: { tier: 1 } },
    { id: 'e2', type: 'belt', source: 'c', sourceHandle: 'out-0', target: 'k', targetHandle: 'in-0', data: { tier: 1 } },
  ],
};

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const activeTab = (page: Page) => page.locator('.tab.active .tab-name');
const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);

/** Abre o menu 📁 Arquivo e clica no item */
const fileMenu = async (page: Page, item: string | RegExp) => {
  await page.getByRole('button', { name: /Arquivo/ }).click();
  await page.getByRole('menuitem', { name: item }).click();
};

/** Texto de um download */
async function readDownload(download: import('@playwright/test').Download) {
  let text = '';
  for await (const chunk of await download.createReadStream()) text += chunk;
  return text;
}

test('cria, renomeia e troca de aba mantendo o conteúdo e o histórico de cada fábrica', async ({ page, errors: _errors }) => {
  await openDemo(page);
  await expect(tabNames(page)).toHaveText(['Fábrica 1']);

  await page.getByTitle('Nova fábrica').click();
  await expect(tabNames(page)).toHaveText(['Fábrica 1', 'Fábrica 2']);
  await expect(activeTab(page)).toHaveText('Fábrica 2');
  await expect(nodes(page)).toHaveCount(0);

  // um armazém na fábrica nova
  await page.locator('.palette-item', { hasText: 'Armazém' }).click();
  await expect(nodes(page)).toHaveCount(1);

  // renomeia com duplo clique
  await tab(page, 'Fábrica 2').dblclick();
  const input = page.getByRole('textbox', { name: 'Nome da fábrica' });
  await input.fill('Placas');
  await input.press('Enter');
  await expect(tabNames(page)).toHaveText(['Fábrica 1', 'Placas']);

  // a outra aba continua com o exemplo; desfazer é de cada fábrica
  await tab(page, 'Fábrica 1').click();
  await expect(nodes(page)).toHaveCount(7);
  await expect(edges(page)).toHaveCount(7);
  await expect(page.locator('button[title^="Desfazer"]')).toBeDisabled();
  await tab(page, 'Placas').click();
  await expect(nodes(page)).toHaveCount(1);
  await expect(page.locator('button[title^="Desfazer"]')).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(nodes(page)).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(nodes(page)).toHaveCount(1);

  // salvo no formato v2 e reaberto do jeito que estava
  await expect.poll(async () => (await saved(page))?.factories?.map((f: { name: string }) => f.name)).toEqual(['Fábrica 1', 'Placas']);
  await page.reload();
  await expect(tabNames(page)).toHaveText(['Fábrica 1', 'Placas']);
  await expect(activeTab(page)).toHaveText('Placas');
  await expect(nodes(page)).toHaveCount(1);

  // duplica, reordena pelo menu e apaga (com confirmação)
  await page.locator('.tab.active').getByTitle('Opções da fábrica').click();
  await page.getByRole('menuitem', { name: /Duplicar/ }).click();
  await expect(tabNames(page)).toHaveText(['Fábrica 1', 'Placas', 'Placas (cópia)']);
  await expect(nodes(page)).toHaveCount(1);
  await page.locator('.tab.active').getByTitle('Opções da fábrica').click();
  await page.getByRole('menuitem', { name: /Mover pra esquerda/ }).click();
  await expect(tabNames(page)).toHaveText(['Fábrica 1', 'Placas (cópia)', 'Placas']);
  await page.locator('.tab.active').getByTitle('Opções da fábrica').click();
  await page.getByRole('menuitem', { name: /Apagar fábrica/ }).click();
  await expect(tabNames(page)).toHaveText(['Fábrica 1', 'Placas']);
  await expect(activeTab(page)).toHaveText('Fábrica 1');
  await expect(nodes(page)).toHaveCount(7);
});

test('copia numa aba e cola em outra', async ({ page, errors: _errors }) => {
  await openDemo(page);
  await page.locator('.react-flow__node[data-id="smelt1"] .fnode-header').click();
  await page.locator('.react-flow__node[data-id="smelt2"] .fnode-header').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+c');

  await page.getByTitle('Nova fábrica').click();
  await expect(nodes(page)).toHaveCount(0);
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.keyboard.press('Control+v');
  await expect(page.locator('.react-flow__node-machine')).toHaveCount(2);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);

  // a fábrica de origem continua igual
  await tab(page, 'Fábrica 1').click();
  await expect(nodes(page)).toHaveCount(7);
  await tab(page, 'Fábrica 2').click();
  await expect(nodes(page)).toHaveCount(2);
});

test('Entrada externa ligada na Saída externa de outra aba recebe o que chega nela', async ({ page, errors: _errors }) => {
  await openProject(page, [ferro, placas], 'placas');
  // manual: só 10 dos 30 lingotes
  await expect(problems(page).filter({ hasText: 'Falta Iron Ingot: recebe 10 de 30/min' })).toHaveCount(1);
  await expect(node(page, 'in').locator('.port-value')).toContainText('10');

  await node(page, 'in').locator('select.ext-link').selectOption({ label: 'Lingotes · 30/min' });
  await expect(node(page, 'in').locator('.ext-status')).toContainText('ligada');
  await expect(node(page, 'in').locator('.port-value')).toHaveText(/^30 \/ 30\/min$/);
  await expect(problems(page)).toHaveCount(0);
  await expect(page.locator('.sidepanel table.prod')).toContainText('20/min');
  await expect(page.locator('.sidepanel .transfers')).toContainText('← Ferro');

  // do outro lado, a saída mostra pra onde vai e abre a fábrica de destino
  await tab(page, 'Ferro').click();
  await expect(node(page, 'out').locator('.ext-dests')).toContainText('Placas');
  await expect(node(page, 'out').locator('.ext-dests')).toContainText('30/min');
  await expect(problems(page).filter({ hasText: 'Nenhuma Entrada externa' })).toHaveCount(0);

  // menos produção em Ferro chega menor em Placas, com o aviso na entrada
  await node(page, 's').locator('.clock-row input.num').first().fill('50');
  await node(page, 's').locator('.clock-row input.num').first().press('Enter');
  await node(page, 'out').getByRole('button', { name: /Placas/ }).click();
  await expect(activeTab(page)).toHaveText('Placas');
  await expect(node(page, 'in').locator('.port-value')).toHaveText(/^15 \/ 15\/min$/);
  await expect(problems(page).filter({ hasText: 'Pede 30/min, mas a saída "Lingotes" (Ferro) só manda 15/min' })).toHaveCount(1);

  // resumo do projeto
  await page.getByRole('button', { name: /Projeto/ }).click();
  const summary = page.getByRole('dialog', { name: 'Resumo do projeto' });
  await expect(summary.locator('tr[data-factory="placas"]')).toContainText('Iron Ingot 15/min ← Ferro');
  await expect(summary.locator('tr[data-factory="ferro"]')).toContainText('Iron Ingot 15/min → Placas');
  await expect(summary).toContainText('3 máquinas');
  await summary.getByRole('button', { name: 'Ferro' }).click();
  await expect(summary).toHaveCount(0);
  await expect(activeTab(page)).toHaveText('Ferro');
});

test('exporta projeto e fábrica, importa como nova fábrica ou substituindo o projeto', async ({ page, errors: _errors }) => {
  await openProject(page, [ferro, placas]);

  const [projDl] = await Promise.all([page.waitForEvent('download'), fileMenu(page, /Exportar projeto/)]);
  expect(projDl.suggestedFilename()).toMatch(/^projeto-satisfactory-\d{4}-\d{2}-\d{2}\.json$/);
  const projText = await readDownload(projDl);
  const proj = JSON.parse(projText);
  expect(proj).toMatchObject({ version: 2, type: 'project', active: 'ferro' });
  expect(proj.factories.map((f: { name: string }) => f.name)).toEqual(['Ferro', 'Placas']);

  const [facDl] = await Promise.all([page.waitForEvent('download'), fileMenu(page, /Exportar só esta fábrica/)]);
  expect(facDl.suggestedFilename()).toMatch(/^fabrica-ferro-\d{4}-\d{2}-\d{2}\.json$/);
  const facText = await readDownload(facDl);
  expect(JSON.parse(facText)).toMatchObject({ version: 2, type: 'factory', factory: { name: 'Ferro' } });

  const upload = (name: string, text: string) => page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

  // fábrica avulsa → adicionar
  await upload('ferro.json', facText);
  const dialog = page.getByRole('dialog', { name: 'Importar arquivo' });
  await expect(dialog).toContainText('Fábrica avulsa');
  await expect(dialog).toContainText('Ferro');
  await dialog.getByRole('button', { name: 'Adicionar como nova fábrica' }).click();
  await expect(tabNames(page)).toHaveText(['Ferro', 'Placas', 'Ferro (2)']);
  await expect(activeTab(page)).toHaveText('Ferro (2)');
  await expect(nodes(page)).toHaveCount(3);

  // projeto → substituir (o atual vai pro backup)
  await upload('projeto.json', projText);
  await expect(dialog).toContainText('Projeto com 2 fábricas');
  await dialog.getByRole('button', { name: 'Substituir o projeto' }).click();
  await expect(tabNames(page)).toHaveText(['Ferro', 'Placas']);
  await expect(page.locator('.notice')).toContainText('Projeto substituído');
  const backups = await page.evaluate(() => JSON.parse(localStorage.getItem('satisplanner:backups:v1') ?? '[]'));
  expect(backups[0].state.factories.map((f: { name: string }) => f.name)).toEqual(['Ferro', 'Placas', 'Ferro (2)']);

  // planta do formato antigo (v1) também entra, com o nome do arquivo
  await upload('antiga.json', JSON.stringify({ version: 1, defaultTier: 1, nodes: [placas.nodes[2]], edges: [] }));
  await expect(dialog).toContainText('formato antigo');
  await dialog.getByRole('button', { name: 'Adicionar como nova fábrica' }).click();
  await expect(tabNames(page)).toHaveText(['Ferro', 'Placas', 'antiga']);

  // arquivo quebrado: mensagem clara e nada muda
  await upload('quebrado.json', '{"version": 2, "factories": []}');
  await expect(page.getByRole('alert')).toContainText('quebrado.json: Não dá pra abrir: o projeto não tem nenhuma fábrica.');
  await upload('lixo.json', 'isto não é json');
  await expect(page.getByRole('alert')).toContainText('não é um arquivo JSON válido');
  await expect(tabNames(page)).toHaveCount(3);
});

test('link compartilhado: gera, abre, adiciona como nova fábrica, cancela ou substitui', async ({ page, errors: _errors }) => {
  await openProject(page, [ferro, placas]);
  await page.getByRole('button', { name: /Compartilhar/ }).click();
  const share = page.getByRole('dialog', { name: 'Compartilhar por link' });
  const link = await share.getByRole('textbox', { name: 'Link' }).inputValue();
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#share=/);
  await share.getByRole('button', { name: /Projeto inteiro/ }).click();
  const projectLink = await share.getByRole('textbox', { name: 'Link' }).inputValue();
  expect(projectLink.length).toBeGreaterThan(link.length);
  await share.getByRole('button', { name: 'Copiar link' }).click();
  await expect(share).toContainText(/Copiado|Não deu pra copiar/);
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);

  // abrir o link (com o app já aberto): pergunta antes de mexer em qualquer coisa
  await page.goto(link);
  const dialog = page.getByRole('dialog', { name: 'Abrir link compartilhado' });
  await expect(dialog).toContainText('Fábrica avulsa');
  await expect(dialog).toContainText('Ferro');
  await expect(tabNames(page)).toHaveText(['Ferro', 'Placas']);
  await dialog.getByRole('button', { name: 'Adicionar como nova fábrica' }).click();
  await expect(tabNames(page)).toHaveText(['Ferro', 'Placas', 'Ferro (2)']);
  await expect(activeTab(page)).toHaveText('Ferro (2)');
  await expect(nodes(page)).toHaveCount(3);
  // o hash some da barra de endereço
  expect(new URL(page.url()).hash).toBe('');

  // abrir o link do zero (outra aba do navegador) e cancelar: nada muda
  await page.goto('about:blank');
  await page.goto(projectLink);
  await expect(dialog).toContainText('Projeto com 2 fábricas');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tabNames(page)).toHaveText(['Ferro', 'Placas', 'Ferro (2)']);
  expect(new URL(page.url()).hash).toBe('');

  // substituir troca o projeto inteiro
  await page.goto(projectLink);
  await dialog.getByRole('button', { name: 'Substituir o projeto' }).click();
  await expect(tabNames(page)).toHaveText(['Ferro', 'Placas']);
  await expect(activeTab(page)).toHaveText('Ferro');
});
