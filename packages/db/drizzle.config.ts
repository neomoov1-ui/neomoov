import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Les migrations sont générées hors ligne à partir du schéma ; l'URL n'est nécessaire que pour db:migrate.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/neomoov' },
  strict: true,
  verbose: true,
});

