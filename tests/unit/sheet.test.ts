import { describe, expect, it } from 'vitest';
import { computeSheet } from '../../src/sheet/balance';
import { normalize } from '../../src/sheet/storage';

const row = (id: string, recipe: string, count: number, clock = 100, sloops = 0) => ({ id, recipe, count, clock, sloops });
const bal = (r: ReturnType<typeof computeSheet>, item: string) => r.items.find((b) => b.item === item)!;

describe('planilha de fábrica', () => {
  // 600 Iron Ore → 20 Smelters (30/min cada) → 600 Iron Ingot; 4 Iron Plate (30 ingot → 20 plate) e 4 Iron Rod (15 → 15)
  it('soma produção, consumo e sobra de cada item', () => {
    const r = computeSheet({
      inputs: [{ id: 'i', item: 'iron-ingot', rate: 600 }],
      rows: [row('a', 'iron-plate', 4), row('b', 'iron-rod', 4)],
    });
    expect(bal(r, 'iron-plate').produced).toBeCloseTo(80);
    expect(bal(r, 'iron-rod').produced).toBeCloseTo(60);
    expect(bal(r, 'iron-ingot').consumed).toBeCloseTo(120 + 60);
    expect(bal(r, 'iron-ingot').balance).toBeCloseTo(600 - 180);
    expect(r.machines).toBe(8);
  });

  it('encadeia: placa reforçada gasta placa e parafuso e a sobra desce', () => {
    const r = computeSheet({
      inputs: [{ id: 'i', item: 'iron-ingot', rate: 600 }],
      rows: [row('a', 'iron-plate', 4), row('b', 'screw', 2), row('c', 'reinforced-iron-plate', 1)],
    });
    // 1 Assembler: 5 Reinforced/min = 30 plate + 60 screw por min
    expect(bal(r, 'reinforced-iron-plate').produced).toBeCloseTo(5);
    expect(bal(r, 'iron-plate').balance).toBeCloseTo(80 - 30);
  });

  it('item que falta fica negativo; clock e sloops escalam', () => {
    const r = computeSheet({ inputs: [], rows: [row('a', 'iron-plate', 1, 200)] });
    expect(bal(r, 'iron-ingot').balance).toBeCloseTo(-60);
    expect(bal(r, 'iron-plate').produced).toBeCloseTo(40);
    const s = computeSheet({ inputs: [], rows: [row('a', 'iron-plate', 1, 100, 1)] });
    expect(bal(s, "iron-plate").produced).toBeCloseTo(40); // 1 slot: ×2
    expect(bal(computeSheet({ inputs: [], rows: [row("a", "iron-plate", 1, 100, 9)] }), "iron-plate").produced).toBeCloseTo(40);
  });

  it('receita desconhecida e storage ruim não quebram', () => {
    expect(computeSheet({ inputs: [], rows: [row('a', 'nao-existe', 3)] }).machines).toBe(0);
    expect(normalize('lixo').sheets).toHaveLength(1);
    expect(normalize({ sheets: [{ id: 'x', name: 'A', inputs: [{ item: 'nope', rate: -5 }], rows: [{ recipe: 'nope', count: 2.7 }] }], active: 'x' }).sheets[0].rows[0].count).toBe(2);
  });
});

describe('exportar e importar planilhas', () => {
  const sheet = { id: 'a', name: 'Mega', inputs: [{ id: 'i', item: 'iron-ingot', rate: 600 }], rows: [row('r', 'iron-plate', 4)] };

  it('exporta e volta igual, com ids novos, sem tocar nas existentes', async () => {
    const { exportText, parseImport } = await import('../../src/sheet/storage');
    const r = parseImport(exportText([sheet]), ['Mega']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sheets[0].name).toBe('Mega (importada)');
    expect(r.sheets[0].id).not.toBe('a');
    expect(r.sheets[0].rows[0]).toMatchObject({ recipe: 'iron-plate', count: 4 });
    expect(r.sheets[0].inputs[0]).toMatchObject({ item: 'iron-ingot', rate: 600 });
    expect(r.blank).toBe(0);
  });

  it('recusa arquivo que não é de planilha e conta o que ficou em branco', async () => {
    const { exportText, parseImport } = await import('../../src/sheet/storage');
    expect(parseImport('não é json', [])).toMatchObject({ ok: false });
    expect(parseImport('{"sheets":[]}', [])).toMatchObject({ ok: false });
    expect(parseImport(JSON.stringify({ nodes: [] }), [])).toMatchObject({ ok: false });
    const bad = exportText([{ ...sheet, rows: [row('r', 'receita-que-nao-existe', 1)] }]);
    expect(parseImport(bad, [])).toMatchObject({ ok: true, blank: 1 });
  });
});
