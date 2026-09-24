import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ jsc: { target: 'es2022', transform: { legacyDecorator: true, decoratorMetadata: true } } })],
  test: { include: ['test/**/*.test.ts'], environment: 'node', setupFiles: ['test/setup.ts'], testTimeout: 30_000 },
});
