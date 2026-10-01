import { ITEMS, withUnit } from '../game/data';
import type { BeltItem, InboundData, ItemId, OutboundData } from '../game/types';
import { fmt } from '../format';
import { inboundRate, simulate, type Issue, type IssueLevel, type SimEdge, type SimNode, type SimResult } from './simulate';

/*
 * Simulação do projeto (várias fábricas)
 * --------------------------------------
 * Cada fábrica é simulada sozinha (simulate). A ligação entre elas é a Entrada externa que
 * aponta pra uma Saída externa de outra fábrica: a entrada recebe o que efetivamente chega
 * naquela saída. Por isso as fábricas são simuladas na ordem das dependências (quem manda
 * antes de quem recebe). Fábricas em ciclo (A manda pra B que manda pra A) não têm ordem:
 * nesse caso a entrada usa a vazão manual e avisa.
 *
 * Simplificações: a Saída externa leva tudo o que chega (como um armazém), sem back-pressure
 * da fábrica de destino; e quando várias entradas puxam da mesma saída, a vazão é dividida
 * igualmente entre elas.
 */

export interface ProjectFactory {
  id: string;
  name: string;
  nodes: SimNode[];
  edges: SimEdge[];
  /** conteúdo da fábrica em texto (pro cache): sem ele a fábrica é sempre simulada de novo */
  key?: string;
}

/**
 * manual = sem link; linked = recebendo da saída ligada; cycle = link em ciclo (usa a manual);
 * missing = a saída ligada não existe mais (usa a manual); mismatch = item diferente; empty = nada chegando na saída
 */
export type FeedStatus = 'manual' | 'linked' | 'cycle' | 'missing' | 'mismatch' | 'empty';

/** Como uma Entrada externa foi alimentada na simulação */
export interface Feed {
  /** vazão usada na simulação */
  rate: number;
  status: FeedStatus;
  /** saída ligada, quando ela existe */
  source?: { factory: string; factoryName: string; node: string; label: string };
  /** o que chega na saída ligada (vazão total, antes de dividir entre as entradas) */
  delivered?: { item: BeltItem; rate: number };
  /** quantas entradas dividem a mesma saída */
  sharedBy?: number;
}

/** Saída externa disponível pra ser ligada */
export interface OutboundInfo {
  factory: string;
  factoryName: string;
  node: string;
  label: string;
  item: BeltItem;
  rate: number;
}

/** Entrada externa ligada numa saída (o "pra onde vai" da saída) */
export interface Destination {
  factory: string;
  factoryName: string;
  node: string;
  rate: number;
  status: FeedStatus;
}

export interface ProjectSim {
  /** resultado de cada fábrica, já com os avisos entre fábricas */
  results: Record<string, SimResult>;
  /** fábrica → Entrada externa → como foi alimentada */
  feeds: Record<string, Record<string, Feed>>;
  outbounds: OutboundInfo[];
  /** fábrica → Saída externa → entradas ligadas nela */
  destinations: Record<string, Record<string, Destination[]>>;
  /** ordem em que as fábricas foram simuladas */
  order: string[];
  /** grupos de fábricas em ciclo (ids) */
  cycles: string[][];
}

export type SimCache = Map<string, { key: string; result: SimResult }>;

const EPS = 1e-6;
const itemName = (item: BeltItem) => (item === 'mixed' ? 'itens misturados' : item ? (ITEMS[item]?.name ?? item) : 'nada');

/** Nome da Saída externa: o dado pelo usuário, ou o item que chega nela */
export const outboundLabel = (d: OutboundData, item: BeltItem) => d.name || (item && item !== 'mixed' ? itemName(item) : 'Saída externa');

/** Junta avisos ao resultado (sem mexer no original, que pode estar no cache) */
export function withIssues(sim: SimResult, extra: Issue[]): SimResult {
  if (!extra.length) return sim;
  const order: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };
  const issues = [...sim.issues, ...extra].sort((a, b) => order[a.level] - order[b.level]);
  const byTarget: Record<string, Issue[]> = {};
  for (const i of issues) (byTarget[i.target.id] ??= []).push(i);
  return { ...sim, issues, byTarget };
}

/** Componentes fortemente conexos (Tarjan); saem do fim da cadeia pro começo */
function stronglyConnected(ids: string[], next: Map<string, Set<string>>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const id of ids) if (!idx.has(id)) visit(id);
  return out;
}

export function simulateProject(factories: ProjectFactory[], cache?: SimCache): ProjectSim {
  const byId = new Map(factories.map((f) => [f.id, f]));
  const nodesOf = new Map(factories.map((f) => [f.id, new Map(f.nodes.map((n) => [n.id, n]))]));
  const outboundNode = (fid: string, nid: string) => {
    const n = nodesOf.get(fid)?.get(nid);
    return n?.data.kind === 'outbound' ? (n.data as OutboundData) : undefined;
  };

  // dependências: fábrica da saída → fábrica da entrada
  const next = new Map<string, Set<string>>();
  const selfLinked = new Set<string>();
  /** entradas válidas (não quebradas) por saída "fábrica|node" */
  const linkedCount = new Map<string, number>();
  for (const f of factories)
    for (const n of f.nodes) {
      const d = n.data;
      if (d.kind !== 'inbound' || !d.link || !outboundNode(d.link.factory, d.link.node)) continue;
      if (d.link.factory === f.id) selfLinked.add(f.id);
      else (next.get(d.link.factory) ?? next.set(d.link.factory, new Set()).get(d.link.factory)!).add(f.id);
    }
  const comps = stronglyConnected(
    factories.map((f) => f.id),
    next,
  ).reverse();
  const compOf = new Map<string, number>();
  comps.forEach((c, i) => c.forEach((id) => compOf.set(id, i)));
  const cycles = comps.filter((c) => c.length > 1 || selfLinked.has(c[0]));
  const inCycle = (a: string, b: string) => compOf.get(a) === compOf.get(b);

  for (const f of factories)
    for (const n of f.nodes) {
      const d = n.data;
      if (d.kind !== 'inbound' || !d.link || !outboundNode(d.link.factory, d.link.node) || inCycle(d.link.factory, f.id)) continue;
      const k = `${d.link.factory}|${d.link.node}`;
      linkedCount.set(k, (linkedCount.get(k) ?? 0) + 1);
    }

  const raw: Record<string, SimResult> = {};
  const feeds: Record<string, Record<string, Feed>> = {};
  const extra: Record<string, Issue[]> = {};
  const warn = (fid: string, node: string, code: string, message: string, level: IssueLevel = 'warning') =>
    (extra[fid] ??= []).push({ id: `${node}:${code}`, level, target: { kind: 'node', id: node }, message });

  /** o que chega numa Saída externa de uma fábrica já simulada */
  const arriving = (fid: string, nid: string) => {
    const port = raw[fid]?.nodes[nid]?.inputs[0];
    return { item: port?.item ?? null, rate: port?.actual ?? 0 };
  };

  const order = comps.flat();
  for (const fid of order) {
    const f = byId.get(fid)!;
    const fFeeds: Record<string, Feed> = (feeds[fid] = {});
    const simNodes = f.nodes.map((n): SimNode => {
      const d = n.data;
      if (d.kind !== 'inbound') return n;
      const manual = inboundRate(d);
      const u = (v: number) => withUnit(fmt(v), d.item);
      let feed: Feed = { rate: manual, status: 'manual' };
      if (d.link) {
        const out = outboundNode(d.link.factory, d.link.node);
        const src = byId.get(d.link.factory);
        if (!out || !src) {
          feed = { rate: manual, status: 'missing' };
          warn(fid, n.id, 'link', `A Saída externa ligada não existe mais (fábrica ou node apagado): usando a vazão manual de ${u(manual)}`);
        } else if (inCycle(src.id, fid)) {
          const names = factories.filter((x) => inCycle(x.id, fid)).map((x) => x.name);
          const label = outboundLabel(out, null);
          feed = { rate: manual, status: 'cycle', source: { factory: src.id, factoryName: src.name, node: d.link.node, label } };
          warn(
            fid,
            n.id,
            'cycle',
            names.length > 1
              ? `Ciclo entre as fábricas ${names.join(', ')}: não dá pra saber o que chega, usando a vazão manual de ${u(manual)}`
              : `Ligada numa saída da própria fábrica: usando a vazão manual de ${u(manual)}`,
          );
        } else {
          const delivered = arriving(src.id, d.link.node);
          const label = outboundLabel(out, delivered.item);
          const sharedBy = linkedCount.get(`${src.id}|${d.link.node}`) ?? 1;
          const source = { factory: src.id, factoryName: src.name, node: d.link.node, label };
          const where = `a saída "${label}" (${src.name})`;
          if (!delivered.item || delivered.rate <= EPS) {
            feed = { rate: 0, status: 'empty', source, delivered, sharedBy };
            warn(fid, n.id, 'link', `Nada chegando: ${where} não está recebendo nenhum item`);
          } else if (delivered.item !== d.item) {
            feed = { rate: 0, status: 'mismatch', source, delivered, sharedBy };
            warn(fid, n.id, 'link', `Item diferente: ${where} manda ${itemName(delivered.item)}, esta entrada espera ${itemName(d.item)}`);
          } else {
            feed = { rate: delivered.rate / sharedBy, status: 'linked', source, delivered, sharedBy };
          }
        }
      }
      fFeeds[n.id] = feed;
      return { id: n.id, data: { ...(d as InboundData), rate: feed.rate } };
    });

    const feedKey = JSON.stringify(Object.entries(fFeeds).map(([k, v]) => [k, v.rate]));
    const key = f.key === undefined ? undefined : `${f.key}|${feedKey}`;
    const hit = key !== undefined ? cache?.get(fid) : undefined;
    const result = hit && hit.key === key ? hit.result : simulate(simNodes, f.edges);
    if (key !== undefined) cache?.set(fid, { key, result });
    raw[fid] = result;

    // entrada ligada pedindo mais do que a saída manda
    for (const [nid, feed] of Object.entries(fFeeds)) {
      if (feed.status !== 'linked') continue;
      const d = (nodesOf.get(fid)!.get(nid)!.data as InboundData);
      const demand = result.nodes[nid]?.demand ?? 0;
      if (demand > feed.rate + EPS) {
        const u = (v: number) => withUnit(fmt(v), d.item);
        const split = feed.sharedBy && feed.sharedBy > 1 ? ` (dividida entre ${feed.sharedBy} entradas)` : '';
        warn(fid, nid, 'short', `Pede ${u(demand)}, mas a saída "${feed.source!.label}" (${feed.source!.factoryName}) só manda ${u(feed.rate)}${split}`);
      }
    }
  }
  // fábricas que sumiram do cache
  if (cache) for (const id of [...cache.keys()]) if (!byId.has(id)) cache.delete(id);

  // pra onde vai cada saída
  const destinations: Record<string, Record<string, Destination[]>> = {};
  for (const f of factories)
    for (const [nid, feed] of Object.entries(feeds[f.id] ?? {})) {
      if (!feed.source) continue;
      const list = ((destinations[feed.source.factory] ??= {})[feed.source.node] ??= []);
      list.push({ factory: f.id, factoryName: f.name, node: nid, rate: feed.rate, status: feed.status });
    }

  const outbounds: OutboundInfo[] = [];
  for (const f of factories)
    for (const n of f.nodes) {
      if (n.data.kind !== 'outbound') continue;
      const a = arriving(f.id, n.id);
      outbounds.push({ factory: f.id, factoryName: f.name, node: n.id, label: outboundLabel(n.data, a.item), item: a.item, rate: a.rate });
      if (!destinations[f.id]?.[n.id]?.length)
        warn(
          f.id,
          n.id,
          'nolink',
          a.rate > EPS
            ? `Nenhuma Entrada externa ligada: ${withUnit(fmt(a.rate), a.item)} de ${itemName(a.item)} não vão pra lugar nenhum`
            : 'Nenhuma Entrada externa ligada nesta saída',
        );
    }

  const results: Record<string, SimResult> = {};
  for (const f of factories) results[f.id] = withIssues(raw[f.id], extra[f.id] ?? []);
  return { results, feeds, outbounds, destinations, order, cycles };
}

/* ---------- resumo do projeto ---------- */

export interface FactorySummary {
  id: string;
  name: string;
  consumption: number;
  generation: number;
  generators: number;
  machines: number;
  /** pontos/min do AWESOME Sink */
  points: number;
  /** o que entra pelas Entradas externas e de onde vem */
  imports: { node: string; item: ItemId; rate: number; from: string }[];
  /** o que sai pelas Saídas externas e pra onde vai */
  exports: { node: string; item: BeltItem; rate: number; to: string[] }[];
  production: SimResult['production'];
  errors: number;
  warnings: number;
}

export interface ProjectSummary {
  factories: FactorySummary[];
  total: {
    consumption: number;
    generation: number;
    generators: number;
    machines: number;
    points: number;
    production: SimResult['production'];
    /** o que entra de fora do projeto (Entradas externas sem link ou com o link quebrado) */
    fromOutside: { item: ItemId; rate: number }[];
    /** o que sai por Saídas externas sem nenhuma entrada ligada */
    unclaimed: { item: BeltItem; rate: number }[];
    errors: number;
    warnings: number;
  };
}

const merge = <K>(list: { item: K; rate: number }[]) => {
  const m = new Map<K, number>();
  for (const x of list) if (x.rate > EPS) m.set(x.item, (m.get(x.item) ?? 0) + x.rate);
  return [...m.entries()].map(([item, rate]) => ({ item, rate }));
};

/** Por fábrica e no total: energia, máquinas, o que importa/exporta, produção final e pontos do Sink */
export function summarizeProject(factories: { id: string; name: string }[], psim: ProjectSim): ProjectSummary {
  const nameOf = new Map(factories.map((f) => [f.id, f.name]));
  const fromOutside: { item: ItemId; rate: number }[] = [];
  const unclaimed: { item: BeltItem; rate: number }[] = [];
  const list = factories.map((f): FactorySummary => {
    const sim = psim.results[f.id];
    const feeds = psim.feeds[f.id] ?? {};
    const imports = sim.transfers.imports.map((t) => {
      const feed = feeds[t.node];
      const item = t.item as ItemId;
      const outside = !feed || feed.status === 'manual' || feed.status === 'missing';
      if (outside) fromOutside.push({ item, rate: t.rate });
      const from = outside ? 'fora do projeto' : `${feed.source!.factoryName}${feed.status === 'cycle' ? ' (ciclo: vazão manual)' : ''}`;
      return { node: t.node, item, rate: t.rate, from };
    });
    const exports = sim.transfers.exports.map((t) => {
      const dests = psim.destinations[f.id]?.[t.node] ?? [];
      if (!dests.length) unclaimed.push({ item: t.item, rate: t.rate });
      return { node: t.node, item: t.item, rate: t.rate, to: [...new Set(dests.map((d) => nameOf.get(d.factory) ?? d.factoryName))] };
    });
    return {
      id: f.id,
      name: f.name,
      consumption: sim.energy.consumption,
      generation: sim.energy.generation,
      generators: sim.energy.generators,
      machines: sim.machines,
      points: sim.sink.points,
      imports,
      exports,
      production: sim.production,
      errors: sim.issues.filter((i) => i.level === 'error').length,
      warnings: sim.issues.filter((i) => i.level === 'warning').length,
    };
  });

  const prod = new Map<ItemId, { stored: number; loose: number; sunk: number }>();
  for (const f of list)
    for (const p of f.production) {
      const t = prod.get(p.item) ?? { stored: 0, loose: 0, sunk: 0 };
      prod.set(p.item, { stored: t.stored + p.stored, loose: t.loose + p.loose, sunk: t.sunk + (p.sunk ?? 0) });
    }
  const production = (Object.keys(ITEMS) as ItemId[])
    .filter((i) => prod.has(i))
    .map((item) => {
      const p = prod.get(item)!;
      return { item, stored: p.stored, loose: p.loose, ...(p.sunk > 0 ? { sunk: p.sunk } : {}) };
    });
  const sumOf = (k: 'consumption' | 'generation' | 'generators' | 'machines' | 'points' | 'errors' | 'warnings') => list.reduce((a, f) => a + f[k], 0);
  return {
    factories: list,
    total: {
      consumption: sumOf('consumption'),
      generation: sumOf('generation'),
      generators: sumOf('generators'),
      machines: sumOf('machines'),
      points: sumOf('points'),
      production,
      fromOutside: merge(fromOutside),
      unclaimed: merge(unclaimed),
      errors: sumOf('errors'),
      warnings: sumOf('warnings'),
    },
  };
}
