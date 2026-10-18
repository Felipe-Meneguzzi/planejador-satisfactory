// Gera src/game/ptbr.json com os nomes em português do próprio jogo (CommunityResources/Docs/pt-BR.json),
// cruzados com o en-US pelo ClassName. Só entra o que o app usa (src/game/gamedata.json).
// Uso: node scripts/build-ptbr.mjs "<pasta do jogo>/CommunityResources/Docs"
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('Passe a pasta CommunityResources/Docs do jogo');
const load = (f) => JSON.parse(readFileSync(join(dir, f)).toString('utf16le').replace(/^﻿/, ''));
const names = (docs, prefixes) => {
  const m = new Map();
  for (const g of docs) for (const c of g.Classes) if (c.mDisplayName && prefixes.some((p) => c.ClassName.startsWith(p))) m.set(c.ClassName, c.mDisplayName);
  return m;
};
const en = load('en-US.json');
const pt = load('pt-BR.json');
const data = JSON.parse(readFileSync('src/game/gamedata.json', 'utf8'));

// itens, fluidos, máquinas, extratores, geradores: por nome em inglês (classes Desc_ e Build_)
const enThings = names(en, ['Desc_', 'Build_']);
const ptThings = names(pt, ['Desc_', 'Build_']);
const byEn = new Map();
for (const [cls, e] of enThings) if (ptThings.has(cls) && !byEn.has(e)) byEn.set(e, ptThings.get(cls));

const wanted = new Set([
  ...data.resources,
  ...data.machines.map((m) => m.name),
  ...data.fluids.map((f) => f.name),
  ...data.generators.map((g) => g.name),
  ...data.generators.flatMap((g) => g.fuels.flatMap((f) => [f.item, f.waste?.item])),
  data.geothermal.name,
  data.augmenter.name,
  data.augmenter.fuel.item,
  data.extractors.water.name,
  data.extractors.oil.name,
  data.pressurizer.name,
  data.pressurizer.extractor.name,
  data.sink.name,
  ...data.recipes.flatMap((r) => [...r.inputs, ...r.outputs].map((p) => p.item)),
].filter(Boolean));

const out = { names: {}, recipes: {} };
const missing = [];
for (const n of [...wanted].sort()) (byEn.has(n) ? (out.names[n] = byEn.get(n)) : missing.push(n));

// receitas: por ClassName
const enRec = names(en, ['Recipe_']);
const ptRec = names(pt, ['Recipe_']);
for (const r of data.recipes) {
  const p = ptRec.get(r.className);
  if (p) out.recipes[r.className] = p;
  else missing.push(`receita ${r.name}`);
}

writeFileSync('src/game/ptbr.json', JSON.stringify(out, null, 1) + '\n');
console.log(`${Object.keys(out.names).length} nomes, ${Object.keys(out.recipes).length} receitas`);
console.log('sem tradução (ficam em inglês):', missing.join(' | ') || 'nenhum');
