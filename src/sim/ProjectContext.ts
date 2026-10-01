import { createContext, useContext } from 'react';
import type { Destination, Feed, OutboundInfo } from './project';

/** O que os nodes de Entrada/Saída externa precisam saber do projeto (as outras fábricas) */
export interface ProjectInfo {
  /** fábrica aberta */
  factoryId: string;
  /** Entradas externas da fábrica aberta: como cada uma foi alimentada */
  feeds: Record<string, Feed>;
  /** Saídas externas da fábrica aberta: as entradas ligadas em cada uma */
  destinations: Record<string, Destination[]>;
  /** todas as Saídas externas do projeto */
  outbounds: OutboundInfo[];
  /** abre outra fábrica (aba) */
  openFactory: (id: string) => void;
}

export const ProjectContext = createContext<ProjectInfo>({ factoryId: '', feeds: {}, destinations: {}, outbounds: [], openFactory: () => {} });
export const useProject = () => useContext(ProjectContext);
