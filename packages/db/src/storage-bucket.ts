/** pnpm db:storage : crée le bucket privé `documents` de Supabase Storage (D49) s'il n'existe pas. Les clés S3 se créent dans le tableau de bord. */
import './env.js';
import { sql } from 'drizzle-orm';
import { createDatabase, databaseUrlFromEnv } from './index.js';

const { db, close } = createDatabase({ url: databaseUrlFromEnv(), max: 1 });
try {
  await db.execute(sql`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('documents', 'documents', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/json'])
    ON CONFLICT (id) DO NOTHING`);
  const rows = await db.execute<{ id: string; public: boolean }>(sql`SELECT id, public FROM storage.buckets WHERE id = 'documents'`);
  console.log('Bucket :', rows[0] ? `${rows[0].id} (${rows[0].public ? 'public' : 'privé'})` : 'absent');
} finally {
  await close();
}
