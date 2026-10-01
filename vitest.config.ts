import { defineConfig } from 'vitest/config';

// Testes unitários (sem browser): motor de simulação, cálculo da linha e layout gerado
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
