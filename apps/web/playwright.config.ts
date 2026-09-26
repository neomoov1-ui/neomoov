import { defineConfig } from '@playwright/test';

/**
 * Tests de bout en bout du web (Edge), lancés par `node e2e/run.cjs` qui démarre l'API et le web de test. Un seul
 * travailleur : la base de développement est partagée. Le projet `setup` fait la première connexion à deux facteurs
 * par l'interface et garde la session pour les modules de My Hub.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '../../logs/playwright',
  use: { baseURL: 'http://localhost:3100', channel: 'msedge', locale: 'fr-CA', timezoneId: 'America/Toronto', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'hub', testMatch: /hub\.spec\.ts/, dependencies: ['setup'], use: { storageState: 'e2e/.auth/admin.json' } },
    { name: 'public', testMatch: /(public|roles)\.spec\.ts/ },
  ],
});
