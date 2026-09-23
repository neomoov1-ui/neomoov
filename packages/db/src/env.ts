/** Charge le fichier .env de la racine du monorepo : les scripts pnpm s'exécutent depuis packages/db, où il n'y a pas de .env. */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let dir = dirname(fileURLToPath(import.meta.url));
for (let i = 0; i < 6; i += 1) {
  const candidate = join(dir, '.env');
  if (existsSync(candidate)) {
    config({ path: candidate });
    break;
  }
  dir = dirname(dir);
}
