import { createContext, useContext } from 'react';

/** Preferências globais que os componentes de esteira precisam ler */
export interface PlannerSettings {
  /** esteiras sem escolha própria seguem o grid (ângulos retos) */
  gridBelts: boolean;
  /** mostrar o rótulo (Mk, fluxo) em cima de cada esteira */
  beltLabels: boolean;
}

export const SettingsContext = createContext<PlannerSettings>({ gridBelts: true, beltLabels: true });
export const useSettings = () => useContext(SettingsContext);

/**
 * Container dos rótulos das esteiras (o mesmo que o EdgeLabelRenderer do React Flow usa).
 * O EdgeLabelRenderer procura esse container com querySelector a cada mudança do canvas,
 * em cada esteira; com milhares de esteiras isso travava. Aqui ele é achado uma vez só.
 */
export const LabelRootContext = createContext<Element | null>(null);
export const useLabelRoot = () => useContext(LabelRootContext);
