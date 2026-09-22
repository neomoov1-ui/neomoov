/**
 * pnpm db:rollback : annule la dernière migration appliquée.
 * Drizzle n'écrit pas de migration inverse : chaque migration `drizzle/NNNN_nom.sql` a son inverse écrite à la main
 * dans `drizzle/down/NNNN_nom.sql`. Le journal de Drizzle (`drizzle.__drizzle_migrations`) est mis à jour en conséquence.
 */

import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDatabase, databaseUrlFromEnv } from './index.js';

const dir = fileURLToPath(new URL('../drizzle', import.meta.url));
const { db, close } = createDatabase({ url: databaseUrlFromEnv(), max: 1 });
try {
  const rows = await db.execute<{ id: number; hash: string; created_at: string }>(sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`);
  const last = rows[0];
  if (!last) { console.log('Aucune migration appliquée.'); process.exit(0); }
  const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string; when: number }[] };
  const entry = journal.entries.find((e) => String(e.when) === String(last.created_at));
  if (!entry) throw new Error(`Migration ${last.created_at} absente du journal local.`);
  const downFile = readdirSync(join(dir, 'down')).find((f) => f.startsWith(entry.tag));
  if (!downFile) throw new Error(`Pas de migration inverse pour ${entry.tag} dans drizzle/down/.`);
  const downSql = readFileSync(join(dir, 'down', downFile), 'utf8');
  await db.transaction(async (tx) => {
    for (const statement of downSql.split('--> statement-breakpoint')) {
      if (statement.trim()) await tx.execute(sql.raw(statement));
    }
    await tx.execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = ${last.id}`);
  });
  console.log(`Migration ${entry.tag} annulée.`);
} finally {
  await close();
}
