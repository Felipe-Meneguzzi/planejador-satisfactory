import { afterEach, describe, expect, it, vi } from 'vitest';

/* Nomes oficiais em português (Docs/pt-BR.json do jogo): o idioma é lido na carga do módulo */

const load = async (lang?: string) => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => lang ?? null, setItem: () => {}, removeItem: () => {} });
  return import('../../src/game/data');
};
afterEach(() => vi.unstubAllGlobals());

describe('idioma dos nomes', () => {
  it('padrão em inglês', async () => {
    const d = await load();
    expect(d.ITEMS['iron-plate'].name).toBe('Iron Plate');
    expect(d.MACHINES['constructor'].name).toBe('Constructor');
  });

  it('PT-BR traduz itens, máquinas, geradores, receitas e o Sink, sem mexer nos ids', async () => {
    const d = await load('pt-BR');
    expect(d.ITEMS['iron-plate'].name).toBe('Chapa de Ferro');
    expect(d.ITEMS['water'].name).toBe('Água');
    expect(d.MACHINES['constructor'].name).toBe('Construtor');
    expect(d.GENERATORS['coal-powered-generator'].name).toBe('Gerador a Carvão');
    expect(d.SINK.name).toBe('Triturador SUPIMPA');
    expect(d.RECIPES['alt-pure-iron-ingot'].name).toBe('Alternativa: Lingote de Ferro puro');
    expect(d.plainRecipeName(d.RECIPES['alt-pure-iron-ingot'].name)).toBe('Lingote de Ferro puro');
    expect(d.RECIPES['iron-plate'].name).toBe('Chapa de Ferro');
  });

  it('todo item e receita tem nome (o que não tem tradução fica em inglês)', async () => {
    const d = await load('pt-BR');
    for (const i of Object.values(d.ITEMS)) expect(i.name).toBeTruthy();
    const en = Object.values((await load()).RECIPES).length;
    expect(Object.values(d.RECIPES)).toHaveLength(en);
  });
});
