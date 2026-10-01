import { createContext, useContext } from 'react';
import type { SimResult } from './simulate';

export const EMPTY_SIM: SimResult = {
  nodes: {},
  edges: {},
  issues: [],
  byTarget: {},
  power: 0,
  energy: { consumption: 0, generation: 0, base: 0, boost: 0, boostRate: 0, generators: 0, byType: [], fuel: [], usage: null },
  machines: 0,
  sloops: 0,
  production: [],
  sink: { count: 0, points: 0, dna: 0 },
  transfers: { imports: [], exports: [] },
};

export const SimContext = createContext<SimResult>(EMPTY_SIM);
export const useSim = () => useContext(SimContext);
