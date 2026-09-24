import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS a besoin des métadonnées de décorateurs : swc les émet pour les tests (tsc les émet pour la construction).
export default defineConfig({
  plugins: [swc.vite({ jsc: { target: 'es2022', transform: { legacyDecorator: true, decoratorMetadata: true } } })],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
