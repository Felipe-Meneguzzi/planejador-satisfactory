import type { FactoryNode } from '../../src/game/types';
import { connect, edges, expect, openWith, problems, test } from './fixtures';

const coalMiner: FactoryNode = {
  id: 'coal',
  type: 'miner',
  position: { x: 0, y: 0 },
  data: { kind: 'miner', resource: 'coal', purity: 'normal', tier: 1, clock: 100 },
};
const water: FactoryNode = {
  id: 'water',
  type: 'extractor',
  position: { x: 0, y: 420 },
  data: { kind: 'extractor', extractor: 'water', resource: 'water', purity: 'normal', clock: 100 },
};
const node = (page: import('@playwright/test').Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test('extrator de água + carvão → Coal-Powered Generator: saldo de energia na barra e no painel', async ({ page }) => {
  await openWith(page, {
    nodes: [
      coalMiner,
      water,
      { id: 'gen', type: 'generator', position: { x: 520, y: 160 }, data: { kind: 'generator', generator: 'coal-powered-generator', fuel: 'coal', clock: 100 } },
    ],
    edges: [],
  });
  // sem combustível: 0 de 75 MW, e a rede (mineradora 5 + extrator 20) fica sem energia
  await expect(page.locator('.stats .energy-chip')).toHaveText('⚡ 25 / 0 MW');
  await expect(page.locator('.stats .energy-chip')).toHaveClass(/err/);
  await expect(problems(page).filter({ hasText: 'Falta energia' })).toHaveCount(1);

  await connect(page, 'coal', 'out-0', 'gen', 'in-0');
  await connect(page, 'water', 'out-0', 'gen', 'in-1');
  await expect(edges(page)).toHaveCount(2);
  await expect(page.locator('.react-flow__edge-pipe')).toHaveCount(1);

  await expect(page.locator('.stats .energy-chip')).toHaveText('⚡ 25 / 75 MW');
  await expect(page.locator('.stats .energy-chip')).not.toHaveClass(/err/);
  await expect(node(page, 'gen').locator('.gen-output')).toContainText('75');
  const energy = page.locator('.sidepanel section.energy');
  await expect(energy).toContainText('1× Coal-Powered Generator');
  await expect(energy).toContainText('+50 MW');
  await expect(energy).toContainText('33% da rede em uso');
  // insumos: 15 Coal/min e 45 m³/min de água
  await expect(energy.locator('.energy-fuel')).toContainText('15/min');
  await expect(energy.locator('.energy-fuel')).toContainText('45 m³/min');
  await expect(problems(page).filter({ hasText: 'Falta energia' })).toHaveCount(0);
});

test('AWESOME Sink: mostra pontos/min, recusa cano e aparece na paleta', async ({ page }) => {
  await openWith(page, {
    nodes: [
      { ...coalMiner, id: 'ore', data: { kind: 'miner', resource: 'iron-ore', purity: 'normal', tier: 1, clock: 100 } },
      water,
      { id: 'store', type: 'sink', position: { x: 560, y: 160 }, data: { kind: 'sink' } },
    ],
    edges: [],
  });
  await expect(page.locator('.palette section').filter({ has: page.getByRole('heading', { name: 'Saída', exact: true }) })).toContainText('AWESOME Sink');

  // vira AWESOME Sink pelo seletor do próprio node
  await node(page, 'store').getByRole('button', { name: 'AWESOME Sink' }).click();
  await expect(node(page, 'store').locator('.fnode-title')).toContainText('AWESOME Sink');

  // água (cano) não liga no Sink; minério (esteira) liga
  await connect(page, 'water', 'out-0', 'store', 'in-0');
  await expect(edges(page)).toHaveCount(0);
  await connect(page, 'ore', 'out-0', 'store', 'in-0');
  await expect(edges(page)).toHaveCount(1);

  // 60 Iron Ore/min × 1 ponto
  await expect(node(page, 'store').locator('.sink-points')).toContainText('60');
  const panel = page.locator('.sidepanel .sink-section');
  await expect(panel).toContainText('Pontos por hora');
  await expect(panel).toContainText('3.600');
  // mineradora 5 + extrator 20 + Sink recebendo 30
  await expect(page.locator('.stats')).toContainText('⚡ 55 MW');
});

test('extrator de poço salvo no formato antigo abre como poço e ganha satélites', async ({ page }) => {
  await openWith(page, {
    nodes: [
      // formato antigo: um extrator 'well' com o clock do pressurizador
      { id: 'old', type: 'extractor', position: { x: 0, y: 0 }, data: { kind: 'extractor', extractor: 'well', resource: 'nitrogen-gas', purity: 'pure', clock: 100 } } as unknown as FactoryNode,
    ],
    edges: [],
  });
  const well = node(page, 'old');
  await expect(page.locator('.react-flow__node-well')).toHaveCount(1);
  await expect(well.locator('.well-sat')).toHaveCount(1);
  await expect(page.locator('.stats')).toContainText('⚡ 150 MW');
  await well.getByRole('button', { name: '+ Resource Well Extractor' }).click();
  await expect(well.locator('.well-sat')).toHaveCount(2);
  // o consumo do pressurizador não muda com mais satélites
  await expect(page.locator('.stats')).toContainText('⚡ 150 MW');
  await well.getByTitle('Remover o Satélite 1').click();
  await expect(well.locator('.well-sat')).toHaveCount(1);
});
