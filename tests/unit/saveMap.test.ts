// o projeto não usa os tipos do Node; só este teste lê um arquivo do disco
// @ts-ignore
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Parser } from '@etothepii/satisfactory-file-parser';
import catalogJson from '../../src/map/catalog.json';
import {
  MAX_MARKERS,
  addWaypoints,
  hasWaypoint,
  hexToLinear,
  linearToHex,
  readMap,
  removeWaypoint,
  waypointName,
  type Catalog,
  type NewWaypoint,
  type SaveLike,
} from '../../src/map/saveMap';

const P = 'Persistent_Level:PersistentLevel.';

const marker = (name: string, x: number, y: number, guid: number) => ({
  type: 'MapMarker',
  properties: {
    markerGuid: { value: [guid, 2, 3, 4] },
    Location: { value: { properties: { X: { value: x }, Y: { value: y }, Z: { value: 5 } } } },
    Name: { value: name },
    CategoryName: { value: '' },
    MapMarkerType: { value: { value: 'ERepresentationType::RT_MapMarker' } },
    IconID: { value: 349 },
    Color: { value: { r: 1, g: 0, b: 0, a: 1 } },
    Scale: { value: 1 },
    CompassViewDistance: { value: { value: 'ECompassViewDistance::CVD_Far' } },
  },
});

const catalog: Catalog = {
  build: 1,
  layers: [
    { id: 'hardDrives', tab: 'collectibles', group: 'Cápsulas', name: 'Disco rígido', kind: 'collect', color: '#f8d450', count: 2 },
    { id: 'ironPure', tab: 'resource_nodes', group: 'Minério de ferro', name: 'Minério de Ferro (Puro)', kind: 'node', color: '#ccc', purity: 'pure', count: 2 },
  ],
  pts: {
    hardDrives: [
      ['BP_DropPod1_1', 100, 200, 3, 'Cooling'],
      ['BP_DropPod2_2', 300, 400, 3],
    ],
    ironPure: [
      ['BP_ResourceNode1', 10, 20, 3],
      ['BP_ResourceNode2', 30, 40, 3],
    ],
  },
};

const fake = (markers: any[] = [marker('Aço', 0, 0, 1)]): SaveLike => ({
  header: { sessionName: 'Teste', saveName: 's', playDurationSeconds: 7200 },
  levels: {
    a: {
      objects: [
        { typePath: '/x/BP_DropPod.BP_DropPod_C', instanceName: P + 'BP_DropPod1_1' },
        { typePath: '/x/Char_Player.Char_Player_C', instanceName: 'pl', transform: { translation: { x: 1, y: 2, z: 3 } } },
        { typePath: '/x/Build_MinerMk1.Build_MinerMk1_C', instanceName: 'm', properties: { mExtractableResource: { value: { pathName: P + 'BP_ResourceNode2' } } } },
        { typePath: '/Script/FactoryGame.FGMapManager', instanceName: 'mm', properties: { mMapMarkers: { values: markers } } },
      ],
    },
  },
});

const style = (over: Partial<NewWaypoint> = {}): NewWaypoint => ({ name: 'X', x: 0, y: 0, z: 0, color: '#5fb0e6', iconId: 652, distance: 'CVD_Near', ...over });

describe('mapa do save', () => {
  it('cruza o catálogo com o save: o que sumiu do mundo foi pego, nó com extrator está ocupado', () => {
    const m = readMap(fake(), catalog);
    const state = (id: string) => m.spots.find((s) => s.id === P + id)!.state;
    expect(state('BP_DropPod1_1')).toBe('open');
    expect(state('BP_DropPod2_2')).toBe('done');
    expect(state('BP_ResourceNode1')).toBe('open');
    expect(state('BP_ResourceNode2')).toBe('done');
    expect(m.player).toEqual({ x: 1, y: 2 });
    expect(m.playHours).toBe(2);
    expect(m.waypoints).toHaveLength(1);
    expect(m.waypoints[0].color).toBe('#ff0000');
    expect(m.iconsInUse).toEqual([349]);
  });

  it('cria waypoints com o ícone, o tipo e a distância pedidos, sem duplicar', () => {
    const save = fake();
    const hd = readMap(save, catalog).spots.find((s) => s.layer.id === 'hardDrives')!;
    expect(waypointName(hd)).toBe('Disco rígido (Cooling)');
    expect(addWaypoints(save, [style({ name: waypointName(hd), x: hd.x, y: hd.y, z: hd.z })])).toEqual({ ok: true, added: 1 });
    const after = readMap(save, catalog);
    expect(after.waypoints).toHaveLength(2);
    expect(hasWaypoint(hd, after.waypoints)).toBe(true);
    expect(after.waypoints[1]).toMatchObject({ iconId: 652, color: '#5fb0e6' });
    expect(new Set(after.waypoints.map((w) => w.id)).size).toBe(2);
    // ícone 652 é carimbo; os outros são marcadores comuns
    const list = (save.levels.a.objects[3].properties!.mMapMarkers as any).values;
    expect(list[1].properties.MapMarkerType.value.value).toBe('ERepresentationType::RT_Stamp');
    expect(list[1].properties.CompassViewDistance.value.value).toBe('ECompassViewDistance::CVD_Near');
    addWaypoints(save, [style({ iconId: 352, distance: 'CVD_Off' })]);
    expect(list[2].properties.MapMarkerType.value.value).toBe('ERepresentationType::RT_MapMarker');
    expect(list[2].properties.CompassViewDistance.value.value).toBe('ECompassViewDistance::CVD_Off');
  });

  it('apaga waypoint pelo id', () => {
    const save = fake();
    const id = readMap(save, catalog).waypoints[0].id;
    expect(removeWaypoint(save, id)).toBe(true);
    expect(removeWaypoint(save, id)).toBe(false);
    expect(readMap(save, catalog).waypoints).toHaveLength(0);
  });

  it('recusa passar do limite do jogo e sem molde', () => {
    const many = Array.from({ length: MAX_MARKERS }, (_, i) => marker('x', i, i, i));
    expect(addWaypoints(fake(many), [style()]).ok).toBe(false);
    expect(addWaypoints(fake([]), [style()]).ok).toBe(false);
  });

  it('converte cor sRGB <-> linear', () => {
    expect(linearToHex(hexToLinear('#5fb0e6'))).toBe('#5fb0e6');
  });
});

const SAVE = new URL('../../saves_example/r.sav', import.meta.url);
describe.skipIf(!existsSync(SAVE))('save real', () => {
  it('lê o catálogo inteiro, cria waypoint, escreve e lê de novo', () => {
    const buf: Uint8Array = readFileSync(SAVE);
    const save = Parser.ParseSave('r', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as unknown as SaveLike;
    const cat = catalogJson as unknown as Catalog;
    const info = readMap(save, cat);
    const of = (id: string) => info.spots.filter((s) => s.layer.id === id);
    // totais do jogo; o que já foi pego não está mais no save
    expect(of('hardDrives')).toHaveLength(118);
    expect(of('somersloops')).toHaveLength(106);
    expect(of('mercerSpheres')).toHaveLength(298);
    expect(of('hardDrives').filter((s) => s.state === 'open')).toHaveLength(45);
    expect(of('mercerSpheres').filter((s) => s.state === 'open')).toHaveLength(82);
    expect(info.spots.filter((s) => s.layer.kind === 'node' && s.state === 'done').length).toBeGreaterThan(20);
    expect(info.waypoints).toHaveLength(11);

    const p = of('hardDrives').find((s) => s.state === 'open')!;
    expect(addWaypoints(save, [style({ name: waypointName(p), x: p.x, y: p.y, z: p.z })]).ok).toBe(true);
    const parts: Uint8Array[] = [];
    Parser.WriteSave(save as never, (h) => parts.push(h), (c) => parts.push(c));
    const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
    parts.reduce((at, a) => (out.set(a, at), at + a.length), 0);
    const again = readMap(Parser.ParseSave('r', out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)) as unknown as SaveLike, cat);
    expect(again.waypoints).toHaveLength(12);
    expect(again.waypoints[11]).toMatchObject({ iconId: 652, name: waypointName(p) });
    expect(hasWaypoint(p, again.waypoints)).toBe(true);
  }, 60_000);
});
