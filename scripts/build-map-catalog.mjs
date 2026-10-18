// Gera src/map/catalog.json a partir do mapData do satisfactory-calculator.com (uso pessoal).
// Uso: node scripts/build-map-catalog.mjs caminho/para/mapData.json
import fs from 'node:fs';

const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const PREFIX = 'Persistent_Level:PersistentLevel.';
const KEEP = new Set(['hardDrives', 'somersloops', 'mercerSpheres', 'greenSlugs', 'yellowSlugs', 'purpleSlugs', 'paleBerry', 'berylNut', 'baconAgaric', 'caves']);
const COLLECT = new Set(['hardDrives', 'somersloops', 'mercerSpheres', 'greenSlugs', 'yellowSlugs', 'purpleSlugs', 'paleBerry', 'berylNut', 'baconAgaric']);

const layers = [];
const pts = {};
const round = (n) => Math.round(n);
const tail = (p) => (p.startsWith(PREFIX) ? p.slice(PREFIX.length) : p);

for (const tab of src.options) {
  for (const g of tab.options ?? []) {
    for (const l of g.options ?? [g]) {
      if (!l.layerId || !l.markers?.length) continue;
      const isNode = tab.tabId === 'resource_nodes' || tab.tabId === 'resource_wells';
      if (!isNode && !KEEP.has(l.layerId)) continue;
      const kind = isNode ? 'node' : COLLECT.has(l.layerId) ? 'collect' : 'poi';
      layers.push({
        id: l.layerId,
        tab: tab.tabId,
        group: g.name ?? l.name,
        name: l.name,
        kind,
        color: l.outsideColor ?? '#ffffff',
        purity: l.purity?.replace('RP_', '').toLowerCase(),
        count: l.markers.length,
      });
      pts[l.layerId] = l.markers.map((m) => {
        const row = [tail(m.pathName), round(m.x), round(m.y), round(m.z)];
        if (m.itemName) row.push(m.itemName);
        return row;
      });
    }
  }
}
fs.writeFileSync(new URL('../src/map/catalog.json', import.meta.url), JSON.stringify({ build: src.lastBuild, layers, pts }));
console.log(layers.length, 'camadas,', Object.values(pts).reduce((n, a) => n + a.length, 0), 'pontos');
