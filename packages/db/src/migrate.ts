/** pnpm db:migrate : applique les migrations de ./drizzle dans l'ordre, une seule fois chacune. */

import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase, databaseUrlFromEnv } from './index.js';

const { db, close } = createDatabase({ url: databaseUrlFromEnv(), max: 1 });
try {
  await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  console.log('Migrations appliquées.');
} finally {
  await close();
}
