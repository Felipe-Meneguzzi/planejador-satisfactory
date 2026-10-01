import { describe, expect, it } from 'vitest';
import { decompressFromEncodedURIComponent } from 'lz-string';
import { SHARE_LIMIT, SHARE_PREFIX, decodeShare, encodeShare, isShareHash, shareUrl } from '../../src/state/share';
import { demoState, exportFactory, exportProject } from '../../src/state/storage';
import { layoutPlan } from '../../src/planner/layout';
import { planLine } from '../../src/planner/plan';

describe('link compartilhado', () => {
  it('comprime e descomprime a fábrica sem perder nada', () => {
    const demo = demoState();
    const payload = exportFactory(demo.factories[0])!;
    const url = shareUrl(payload, 'http://localhost:5173/app?x=1#qualquer');
    expect(url.startsWith(`http://localhost:5173/app?x=1${SHARE_PREFIX}`)).toBe(true);
    const hash = url.slice(url.indexOf('#'));
    expect(isShareHash(hash)).toBe(true);
    // só caracteres seguros em URL
    expect(hash.slice(SHARE_PREFIX.length)).toMatch(/^[A-Za-z0-9+\-$]*$/);
    expect(JSON.parse(decompressFromEncodedURIComponent(hash.slice(SHARE_PREFIX.length)))).toEqual(payload);
    const r = decodeShare(hash);
    expect(r.ok && r.incoming.kind).toBe('factory');
    expect(r.ok && r.incoming.project.factories[0]).toEqual(demo.factories[0]);
    // bem menor que o JSON no link sem compressão
    expect(encodeShare(payload).length).toBeLessThan(encodeURIComponent(JSON.stringify(payload)).length / 2);
  });

  it('projeto inteiro', () => {
    const demo = demoState();
    const p = { ...demo, factories: [...demo.factories, { ...demo.factories[0], id: 'outra', name: 'Outra' }] };
    const r = decodeShare(SHARE_PREFIX + encodeShare(exportProject(p)!));
    expect(r.ok && r.incoming.kind).toBe('project');
    expect(r.ok && r.incoming.project.factories.map((f) => f.name)).toEqual(['Fábrica 1', 'Outra']);
  });

  it('link cortado ou adulterado vira erro claro', () => {
    const hash = SHARE_PREFIX + encodeShare(exportProject(demoState())!);
    const cut = decodeShare(hash.slice(0, hash.length / 2));
    expect(cut.ok).toBe(false);
    expect(!cut.ok && cut.error).toMatch(/^Não dá pra abrir o link/);
    expect(decodeShare(`${SHARE_PREFIX}@@@`).ok).toBe(false);
    expect(isShareHash('#outra-coisa')).toBe(false);
  });

  it('linha grande passa do limite seguro (o app sugere exportar o arquivo)', () => {
    const plan = planLine({ item: 'computer', rate: 10, choices: {}, ores: {}, maxClock: 100, maxBelt: 3, maxPipe: 1 });
    const { nodes, edges } = layoutPlan(plan, 'manifold', 3, 1, { x: 0, y: 0 });
    const payload = exportFactory({ id: 'f', name: 'Computadores', nodes, edges })!;
    expect(encodeShare(payload).length).toBeGreaterThan(SHARE_LIMIT);
  });
});
