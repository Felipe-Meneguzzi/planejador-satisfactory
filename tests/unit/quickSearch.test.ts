import { describe, expect, it } from 'vitest';
import { matchScore, normalize, rankQuick, tokenize, type QuickItem } from '../../src/state/quickSearch';
import { allEntries, entryKeywords } from '../../src/game/catalog';

/* Busca rápida (Ctrl+K): normalização, nota e agrupamento */

const item = (id: string, group: QuickItem['group'], label: string, extra: Partial<QuickItem> = {}): QuickItem => ({ id, group, label, run: () => {}, ...extra });

describe('normalize / tokenize', () => {
  it('tira acento, maiúsculas e pontuação', () => {
    expect(normalize('Ação — Carvão!')).toBe('acao carvao');
    expect(normalize('Coal-Powered Generator')).toBe('coal powered generator');
    expect(tokenize('  Iron   PL ')).toEqual(['iron', 'pl']);
    // o ponto fica (Mk.2)
    expect(normalize('Esteira Mk.2')).toBe('esteira mk.2');
  });
});

describe('matchScore', () => {
  it('acha por partes, em qualquer ordem, sem acento', () => {
    expect(matchScore('iron pl', 'Iron Plate')).not.toBeNull();
    expect(matchScore('plate iron', 'Iron Plate')).not.toBeNull();
    expect(matchScore('acao', 'Andar 2 — Aço e Ação')).not.toBeNull();
    expect(matchScore('coal-po', 'Coal-Powered Generator')).not.toBeNull();
    expect(matchScore('iron pl', 'Copper Sheet')).toBeNull();
    // toda parte precisa aparecer
    expect(matchScore('iron xyz', 'Iron Plate')).toBeNull();
  });
  it('começo do nome e começo de palavra valem mais que meio de palavra', () => {
    expect(matchScore('iron plate', 'Iron Plate')!).toBeGreaterThan(matchScore('iron plate', 'Reinforced Iron Plate')!);
    expect(matchScore('plate', 'Plate Holder')!).toBeGreaterThan(matchScore('plate', 'Template')!);
  });
  it('busca vazia bate com tudo', () => {
    expect(matchScore('   ', 'qualquer coisa')).toBe(0);
  });
});

describe('rankQuick', () => {
  const items = [
    item('a1', 'Ações', 'Nova fábrica', { keywords: 'aba criar' }),
    item('a2', 'Ações', 'Exportar projeto (.json)', { keywords: 'baixar salvar' }),
    item('g1', 'Ir para', 'Constructor · Iron Plate', { hint: 'Ferro', hideWhenEmpty: true }),
    item('g2', 'Ir para', 'Andar 2 — Aço', { hint: 'Aço', hideWhenEmpty: true }),
    item('n1', 'Adicionar', 'Iron Plate', { hint: 'Constructor' }),
    item('n2', 'Adicionar', 'Reinforced Iron Plate', { hint: 'Assembler', hideWhenEmpty: true }),
  ];

  it('busca vazia mostra só a lista padrão, na ordem dos grupos', () => {
    const r = rankQuick(items, '');
    expect(r.map((s) => s.group)).toEqual(['Ações', 'Adicionar']);
    expect(r[0].items.map((i) => i.id)).toEqual(['a1', 'a2']);
    expect(r[1].items.map((i) => i.id)).toEqual(['n1']);
  });

  it('agrupa os resultados e põe o grupo com o melhor primeiro', () => {
    const r = rankQuick(items, 'iron pl');
    expect(r.map((s) => s.group)).toEqual(['Adicionar', 'Ir para']);
    expect(r[0].items.map((i) => i.id)).toEqual(['n1', 'n2']);
    expect(r[1].items.map((i) => i.id)).toEqual(['g1']);
  });

  it('acha pelas palavras extras e pelo texto de apoio, sem acento', () => {
    expect(rankQuick(items, 'baixar')[0].items.map((i) => i.id)).toEqual(['a2']);
    expect(rankQuick(items, 'andar aco')[0].items.map((i) => i.id)).toEqual(['g2']);
  });

  it('limita a quantidade por grupo', () => {
    const many = Array.from({ length: 20 }, (_, i) => item(`x${i}`, 'Adicionar', `Iron Thing ${i}`));
    expect(rankQuick(many, 'iron', 5)[0].items).toHaveLength(5);
  });
});

describe('catálogo da busca rápida', () => {
  const all = allEntries();
  it('tem tudo da paleta, sem repetição', () => {
    const keys = all.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ['frame', 'note', 'splitter', 'merger', 'sink', 'awesome-sink', 'inbound', 'outbound', 'recipe-iron-plate', 'miner-coal-normal'])
      expect(keys, k).toContain(k);
  });
  it('acha máquinas, extratores, poços e geradores pelo nome', () => {
    const find = (q: string) => all.filter((e) => matchScore(q, `${e.label} ${e.sub} ${entryKeywords(e)}`) !== null).map((e) => e.data.kind);
    expect(find('iron pl')).toContain('machine');
    expect(find('coal powered')).toContain('generator');
    expect(find('nitrogen poco')).toContain('well');
    expect(find('agua')).toContain('extractor');
    expect(find('moldura')).toContain('frame');
    expect(find('anotacao')).toContain('note');
  });
});
