#!/usr/bin/env node
/**
 * Régénère `src/openapi.json`, la description OpenAPI de l'API dont ce client dérive.
 *
 *   node scripts/generate.mjs                              construit l'API et exporte le document sans la démarrer
 *   node scripts/generate.mjs --url http://localhost:4000  lit le document d'une API en marche
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/openapi.json');
const urlIndex = process.argv.indexOf('--url');
const baseUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : undefined;

if (baseUrl) {
  const response = await fetch(new URL('/v1/docs/openapi.json', baseUrl));
  if (!response.ok) throw new Error(`Réponse ${response.status} de ${baseUrl}`);
  const document = await response.json();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI lu depuis ${baseUrl} et écrit dans ${target}`);
} else {
  const result = spawnSync('pnpm', ['--filter', '@neomoov/api', 'run', 'openapi:export', target], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(result.status ?? 1);
}
