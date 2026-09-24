/**
 * Exporte la description OpenAPI de l'API dans un fichier JSON, sans démarrer de serveur ni interroger la base.
 * Usage : node dist/scripts/export-openapi.js [chemin de sortie]
 * Par défaut : packages/api-client/src/openapi.json (relatif au dossier apps/api).
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pino } from 'pino';
import { createApp, getOpenApiDocument } from '../bootstrap.js';
import { loadDotenvFromRoot, loadEnv } from '../config/env.js';

loadDotenvFromRoot();
const env = loadEnv(
  {
    ...process.env,
    NODE_ENV: 'test',
    // Aucune requête n'est exécutée : une adresse de repli suffit quand le .env est absent (intégration continue).
    DATABASE_URL: process.env['DATABASE_URL'] || 'postgresql://neomoov:neomoov@localhost:5432/neomoov',
    REDIS_URL: '',
  },
  { dotenv: false },
);
const output = resolve(process.argv[2] ?? '../../packages/api-client/src/openapi.json');

const app = await createApp(env, pino({ level: 'silent' }));
try {
  const document = getOpenApiDocument(app);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI : ${Object.keys(document.paths).length} chemin(s) écrit(s) dans ${output}`);
} finally {
  await app.close();
}
