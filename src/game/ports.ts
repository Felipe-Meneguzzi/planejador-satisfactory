import { generatorPorts, getRecipe, isFluid } from './data';
import type { FactoryData, Medium } from './types';

/**
 * Meio de uma porta: 'solid' (esteira) ou 'fluid' (cano). O Armazém e a Saída externa aceitam os dois ('any'); o AWESOME Sink, só esteira.
 * Nas máquinas e geradores depende do item (receita/combustível) naquela porta.
 */
export function portMedium(data: FactoryData, handle?: string | null): Medium | 'any' {
  switch (data.kind) {
    case 'miner':
      return 'solid';
    case 'extractor':
    case 'well':
      return 'fluid';
    case 'splitter':
    case 'merger':
      return data.fluid ? 'fluid' : 'solid';
    case 'sink':
      // o AWESOME Sink só tem entrada de esteira
      return data.mode === 'awesome' ? 'solid' : 'any';
    case 'inbound':
      return isFluid(data.item) ? 'fluid' : 'solid';
    case 'outbound':
      // como o Armazém: aceita esteira e cano
      return 'any';
    case 'machine': {
      const r = getRecipe(data);
      const idx = Number(handle?.split('-')[1]);
      const p = handle?.startsWith('in') ? r.inputs[idx] : r.outputs[idx];
      return p && isFluid(p.item) ? 'fluid' : 'solid';
    }
    case 'generator': {
      const g = generatorPorts(data);
      const idx = Number(handle?.split('-')[1]);
      const p = handle?.startsWith('in') ? g.inputs[idx] : g.outputs[idx];
      return p && isFluid(p.item) ? 'fluid' : 'solid';
    }
    case 'frame':
    case 'note':
      // moldura e anotação não têm conectores: nunca chegam numa conexão
      return 'any';
  }
}

/** Duas portas podem se ligar se forem do mesmo meio (ou se uma aceitar qualquer um) */
export const mediumsMatch = (a: Medium | 'any', b: Medium | 'any') => a === 'any' || b === 'any' || a === b;
