import { useMemo, useState, type DragEvent } from 'react';
import { BELTS, BELT_TIERS, PIPES, PIPE_TIERS } from '../game/data';
import { GROUPS, search, type PaletteEntry } from '../game/catalog';
import type { BeltTier, FactoryData, PipeTier } from '../game/types';

export const DND_TYPE = 'application/x-satisplanner';

export function Palette({
  onAdd,
  version,
  onOpenPlanner,
  defaults,
  onDefaults,
}: {
  onAdd: (data: FactoryData) => void;
  version: string;
  onOpenPlanner: () => void;
  /** Mk usado nas conexões novas */
  defaults: { belt: BeltTier; pipe: PipeTier };
  onDefaults: (d: { belt?: BeltTier; pipe?: PipeTier }) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => (query.trim() ? search(query) : null), [query]);

  const item = (en: PaletteEntry) => (
    <div
      key={en.key}
      className="palette-item"
      draggable
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(DND_TYPE, JSON.stringify(en.data));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onAdd(en.data)}
      title="Arraste para o canvas ou clique para adicionar"
    >
      <span className="palette-icon" style={{ background: en.color }}>
        {en.icon}
      </span>
      <span className="palette-text">
        <b>{en.label}</b>
        <small>{en.sub}</small>
      </span>
    </div>
  );

  return (
    <aside className="palette">
      <button className="planner-btn" onClick={onOpenPlanner} title="Escolha um produto e a quantidade: monta a linha inteira com 100% de eficiência">
        🏭 Gerar linha
      </button>
      <div className="palette-defaults" title="Mk usado quando você cria uma conexão nova">
        <label>
          Esteira
          <select value={defaults.belt} onChange={(e) => onDefaults({ belt: Number(e.target.value) as BeltTier })}>
            {BELT_TIERS.map((t) => (
              <option key={t} value={t}>
                {BELTS[t].name} ({BELTS[t].rate})
              </option>
            ))}
          </select>
        </label>
        <label>
          Cano
          <select value={defaults.pipe} onChange={(e) => onDefaults({ pipe: Number(e.target.value) as PipeTier })}>
            {PIPE_TIERS.map((t) => (
              <option key={t} value={t}>
                {PIPES[t].name} ({PIPES[t].rate})
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        className="palette-search"
        placeholder="Buscar receita, item ou minério…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      {results ? (
        <section>
          <h3>{results.length} resultado(s)</h3>
          {results.map(item)}
        </section>
      ) : (
        GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            {g.entries.map(item)}
          </section>
        ))
      )}
      <section className="help">
        <h3>Como usar</h3>
        <ul>
          <li>Arraste da paleta pro canvas (ou clique)</li>
          <li>Ligue a <b>saída</b> (direita) numa <b>entrada</b> (esquerda) pra criar uma esteira</li>
          <li>Troque o Mk da esteira no rótulo dela</li>
          <li><kbd>Del</kbd> apaga o selecionado</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz, <kbd>Ctrl</kbd>+<kbd>Y</kbd> refaz</li>
          <li><kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> copia, recorta e cola (no mouse); <kbd>Ctrl</kbd>+<kbd>D</kbd> duplica</li>
          <li><kbd>R</kbd> gira o selecionado (<kbd>Shift</kbd>+<kbd>R</kbd> ao contrário)</li>
          <li><kbd>Alt</kbd> + arrastar alinha ao grid</li>
          <li><kbd>Shift</kbd> + arrastar seleciona vários</li>
          <li>Abas em cima do canvas: uma fábrica por aba (duplo clique renomeia, arraste pra reordenar)</li>
          <li>Copie numa aba e cole em outra</li>
          <li><b>Saída externa</b> numa fábrica + <b>Entrada externa</b> ligada nela em outra levam itens entre fábricas</li>
        </ul>
        <p className="version">Dados: Satisfactory {version} · satisfactory.wiki.gg</p>
      </section>
    </aside>
  );
}
