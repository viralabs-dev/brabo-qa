import { defineConfig } from 'vitest/config';

// Lógica pura e leitura de arquivos dos repositórios irmãos (brabo-api, brabo-engine) em checkout ao lado.
export default defineConfig({
  test: {
    include: ['**/*.spec.ts'],
  },
});
