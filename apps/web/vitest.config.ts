import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Alias `@/` de Next.js : les tests de rendu (react-dom/server, sans navigateur) importent les composants tels quels.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
