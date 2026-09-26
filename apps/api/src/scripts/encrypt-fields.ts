/**
 * Rattrapage du chiffrement applicatif (étape 14) : chiffre les numéros de taxes des chauffeurs, les numéros de leurs
 * documents et le numéro extrait par l'agent recrutement encore en clair. Idempotent (une valeur déjà chiffrée n'est pas
 * touchée), par lots, sans rien afficher des valeurs :
 *
 *   pnpm --filter @neomoov/api fields:encrypt              # à lancer une fois après la migration 0014
 *   pnpm --filter @neomoov/api fields:encrypt -- --decrypt # remet en clair, seulement avant le retour arrière de 0014
 */
import { createDatabase, schema } from '@neomoov/db';
import { eq, isNotNull, or } from 'drizzle-orm';
import { decryptField, deriveFieldKey, encryptField, isEncryptedField } from '../common/field-cipher.js';
import { loadEnv } from '../config/env.js';

const decrypting = process.argv.includes('--decrypt');
const env = loadEnv();
if (!env.ENCRYPTION_KEY) {
  console.error('ENCRYPTION_KEY absente.');
  process.exit(2);
}
const key = deriveFieldKey(env.ENCRYPTION_KEY);
const { db, close } = createDatabase({ url: env.DATABASE_URL, max: 2, prepare: false });

/** Valeur à écrire, ou undefined si elle est déjà dans l'état voulu. */
function transform(value: string | null): string | null | undefined {
  if (value === null || value === '') return undefined;
  if (decrypting) return isEncryptedField(value) ? decryptField(value, key) : undefined;
  return isEncryptedField(value) ? undefined : encryptField(value, key);
}

let drivers = 0;
let documents = 0;
try {
  const driverRows = await db
    .select({ id: schema.drivers.id, gst: schema.drivers.gstNumber, qst: schema.drivers.qstNumber })
    .from(schema.drivers)
    .where(or(isNotNull(schema.drivers.gstNumber), isNotNull(schema.drivers.qstNumber)));
  for (const row of driverRows) {
    const gst = transform(row.gst);
    const qst = transform(row.qst);
    if (gst === undefined && qst === undefined) continue;
    await db.update(schema.drivers).set({ ...(gst !== undefined ? { gstNumber: gst } : {}), ...(qst !== undefined ? { qstNumber: qst } : {}) }).where(eq(schema.drivers.id, row.id));
    drivers += 1;
  }
  const documentRows = await db
    .select({ id: schema.driverDocuments.id, number: schema.driverDocuments.number, extracted: schema.driverDocuments.extractedFields })
    .from(schema.driverDocuments)
    .where(or(isNotNull(schema.driverDocuments.number), isNotNull(schema.driverDocuments.extractedFields)));
  for (const row of documentRows) {
    const number = transform(row.number);
    const extracted = row.extracted && typeof row.extracted === 'object' ? (row.extracted as Record<string, unknown>) : null;
    const extractedNumber = typeof extracted?.['number'] === 'string' ? transform(extracted['number']) : undefined;
    if (number === undefined && extractedNumber === undefined) continue;
    await db
      .update(schema.driverDocuments)
      .set({ ...(number !== undefined ? { number } : {}), ...(extractedNumber !== undefined ? { extractedFields: { ...extracted, number: extractedNumber } } : {}) })
      .where(eq(schema.driverDocuments.id, row.id));
    documents += 1;
  }
  console.log(`${decrypting ? 'Remis en clair' : 'Chiffrés'} : ${drivers} chauffeur(s), ${documents} document(s).`);
} finally {
  await close();
}
