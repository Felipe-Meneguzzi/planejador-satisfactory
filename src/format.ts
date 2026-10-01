const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export const fmt = (n: number) => (Number.isFinite(n) ? nf.format(Math.abs(n) < 1e-9 ? 0 : n) : '∞');
