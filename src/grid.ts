/** Tamanho do grid universal do canvas, em px (o mesmo espaçamento dos pontos do fundo) */
export const GRID = 20;

/** Arredonda pra cima até o próximo múltiplo do grid */
export const snapUp = (v: number) => Math.ceil(v / GRID - 1e-6) * GRID;
