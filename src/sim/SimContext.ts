import { createContext, useContext } from 'react';
import type { SimResult } from './simulate';

export const EMPTY_SIM: SimResult = { nodes: {}, edges: {}, issues: [], byTarget: {}, power: 0, machines: 0, sloops: 0, production: [] };

export const SimContext = createContext<SimResult>(EMPTY_SIM);
export const useSim = () => useContext(SimContext);
