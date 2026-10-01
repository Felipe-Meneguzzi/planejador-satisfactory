import { describe, expect, it } from 'vitest';
import { FRAME_MIN, FRAME_SIZE, FRAME_Z, NOTE_SIZE, frameMembers, nodeShape } from '../../src/game/annotations';
import type { FactoryNode } from '../../src/game/types';
import { simulate, type SimNode } from '../../src/sim/simulate';
import { simulateProject, summarizeProject } from '../../src/sim/project';
import { parseImport, sanitize, sanitizePlant } from '../../src/state/storage';
import { belt, machine, miner, sink } from './helpers';

/* Molduras e anotações: salvas no projeto, mas fora da simulação e do resumo */

const frame = (id: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'frame', position: { x, y }, width, height, data: { kind: 'frame', title: 'Andar 2 — Aço', color: 'teal', ...extra } }) as FactoryNode;
const note = (id: string, text: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'note', position: { x: 0, y: 0 }, width: 220, height: 120, data: { kind: 'note', text, color: 'amber', ...extra } }) as FactoryNode;
const placed = (id: string, x: number, y: number, w = 280, h = 200) =>
  ({ id, type: 'sink', position: { x, y }, measured: { width: w, height: h }, data: { kind: 'sink' } }) as FactoryNode;

describe('molduras e anotações no salvamento', () => {
  it('sanitize guarda título, cor, texto, tamanho (no grid) e a camada da moldura', () => {
    const plant = sanitizePlant({
      nodes: [frame('f', 0, 0, 503, 311, { selected: true }), note('n', 'linha 1\nlinha 2')],
      edges: [],
    })!;
    expect(plant).not.toBeNull();
    const [f, n] = plant.nodes;
    expect(f).toEqual({ id: 'f', type: 'frame', position: { x: 0, y: 0 }, width: 500, height: 320, zIndex: FRAME_Z, data: { kind: 'frame', title: 'Andar 2 — Aço', color: 'teal' } });
    expect(n).toEqual({ id: 'n', type: 'note', position: { x: 0, y: 0 }, width: 220, height: 120, data: { kind: 'note', text: 'linha 1\nlinha 2', color: 'amber' } });
  });

  it('dados quebrados viram padrões em vez de recusar a planta', () => {
    const plant = sanitizePlant({
      nodes: [
        { id: 'f', type: 'frame', position: { x: 0, y: 0 }, width: 'x', height: -5, data: { kind: 'frame', title: 42, color: 'rosa-choque' } },
        { id: 'g', type: 'frame', position: { x: 0, y: 0 }, width: 20, height: 20, data: { kind: 'frame', title: 'x'.repeat(500), color: 'red' } },
        { id: 'n', type: 'note', position: { x: 0, y: 0 }, data: { kind: 'note' } },
      ],
      edges: [],
    })!;
    const [f, g, n] = plant.nodes;
    expect(f.data).toEqual({ kind: 'frame', title: 'Moldura', color: 'slate' });
    expect([f.width, f.height]).toEqual([FRAME_SIZE.width, FRAME_SIZE.height]);
    // pequeno demais: sobe pro mínimo; título longo é cortado
    expect([g.width, g.height]).toEqual([FRAME_MIN.width, FRAME_MIN.height]);
    expect((g.data as { title: string }).title).toHaveLength(80);
    expect(n.data).toEqual({ kind: 'note', text: '', color: 'slate' });
    expect([n.width, n.height]).toEqual([NOTE_SIZE.width, NOTE_SIZE.height]);
  });

  it('node de tipo desconhecido continua sendo recusado', () => {
    expect(sanitizePlant({ nodes: [{ id: 'x', type: 'post-it', position: { x: 0, y: 0 }, data: { kind: 'post-it' } }], edges: [] })).toBeNull();
  });

  it('projeto v2 e fábrica avulsa importada mantêm as molduras', () => {
    const f = { id: 'a', name: 'A', nodes: [frame('f', 20, 40, 400, 300), note('n', 'oi')], edges: [] };
    const p = sanitize({ version: 2, factories: [f], active: 'a' })!;
    expect(p.factories[0].nodes.map((n) => n.type)).toEqual(['frame', 'note']);
    const r = parseImport({ version: 2, type: 'factory', factory: f });
    expect(r.ok && r.incoming.project.factories[0].nodes[0].width).toBe(400);
  });

  it('nodeShape tira seleção e medidas e mantém o tamanho só das molduras/anotações', () => {
    const m = { ...placed('s', 0, 0), selected: true, width: 999 } as FactoryNode;
    expect(nodeShape(m)).toEqual({ id: 's', type: 'sink', position: { x: 0, y: 0 }, data: { kind: 'sink' } });
  });
});

describe('molduras e anotações na simulação', () => {
  const nodes: SimNode[] = [miner('m'), machine('s', 'smelter', 'iron-ingot'), sink('k')];
  const edges = [belt('b1', 'm', 0, 's', 0), belt('b2', 's', 0, 'k', 0)];
  const extras: SimNode[] = [
    { id: 'f', data: { kind: 'frame', title: 'Andar 1', color: 'blue' } },
    { id: 'n', data: { kind: 'note', text: 'lembrar do carvão', color: 'amber' } },
  ];

  it('simulate ignora molduras e anotações (mesmo resultado, nenhum aviso sobre elas)', () => {
    const base = simulate(nodes, edges);
    const withExtras = simulate([extras[0], ...nodes, extras[1]], [...edges, belt('fantasma', 'f', 0, 'n', 0)]);
    expect(withExtras.nodes).toEqual(base.nodes);
    expect(withExtras.issues).toEqual(base.issues);
    expect(withExtras.machines).toBe(base.machines);
    expect(withExtras.energy).toEqual(base.energy);
    expect(withExtras.nodes.f).toBeUndefined();
    expect(withExtras.edges.fantasma).toBeUndefined();
  });

  it('o projeto e o resumo não contam molduras e anotações', () => {
    const psim = simulateProject([{ id: 'a', name: 'A', nodes: [...nodes, ...extras], edges }], new Map());
    const plain = simulateProject([{ id: 'a', name: 'A', nodes, edges }], new Map());
    const s = summarizeProject([{ id: 'a', name: 'A' }], psim);
    expect(s).toEqual(summarizeProject([{ id: 'a', name: 'A' }], plain));
    expect(s.factories[0].machines).toBe(2); // mineradora + fundidora
  });
});

describe('frameMembers', () => {
  const f = frame('f', 0, 0, 600, 400);
  it('leva quem tem pelo menos metade da área dentro da moldura', () => {
    const inside = placed('in', 40, 40);
    const half = placed('half', 460, 40); // 140 de 280 dentro: metade exata
    const out = placed('out', 500, 40); // só 100 de 280
    const far = placed('far', 1000, 1000);
    expect(frameMembers(f, [f, inside, half, out, far]).map((n) => n.id)).toEqual(['in', 'half']);
  });
  it('outra moldura só vai junto se estiver inteira dentro', () => {
    const small = { ...frame('small', 20, 20, 200, 200), measured: { width: 200, height: 200 } } as FactoryNode;
    const big = { ...frame('big', 20, 20, 700, 300), measured: { width: 700, height: 300 } } as FactoryNode;
    expect(frameMembers(f, [small, big]).map((n) => n.id)).toEqual(['small']);
    // a menor não leva a maior, mesmo com a maior quase toda por cima
    expect(frameMembers(small, [f])).toEqual([]);
  });
});
