/**
 * Export des données personnelles (5.15, droit d'accès et portabilité) : collecte de tout ce que la plateforme détient
 * sur un utilisateur, en JSON (lisible par une machine) et en PDF (document). Les secrets et identifiants techniques
 * de tiers ne sont jamais exportés.
 */
import { schema, type Database } from '@neomoov/db';
import type { Language } from '@neomoov/domain';
import { desc, eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { PDF_TEXTS } from '../../common/i18n.js';

export type ExportData = Record<string, unknown>;

function clean<T extends Record<string, unknown>>(row: T, omit: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (omit.includes(k)) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

export async function collectUserData(db: Database, userId: string): Promise<ExportData> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new Error(`Utilisateur ${userId} introuvable`);
  const data: ExportData = {
    generatedAt: new Date().toISOString(),
    profile: { ...clean(user, ['appleId', 'googleId']), linkedProviders: { apple: Boolean(user.appleId), google: Boolean(user.googleId) } },
    roles: (await db.select({ role: schema.userRoles.role, scope: schema.userRoles.scope, grantedAt: schema.userRoles.grantedAt }).from(schema.userRoles).where(eq(schema.userRoles.userId, userId))).map((r) => clean(r)),
    devices: (await db.select().from(schema.devices).where(eq(schema.devices.userId, userId))).map((d) => clean({ ...d, pushToken: d.pushToken ? `…${d.pushToken.slice(-6)}` : null })),
    sessions: (await db.select({ createdAt: schema.sessions.createdAt, expiresAt: schema.sessions.expiresAt, revokedAt: schema.sessions.revokedAt, ipAddress: schema.sessions.ipAddress, userAgent: schema.sessions.userAgent, amr: schema.sessions.amr }).from(schema.sessions).where(eq(schema.sessions.userId, userId)).orderBy(desc(schema.sessions.createdAt)).limit(200)).map((s) => clean(s)),
    consents: (await db.select().from(schema.consents).where(eq(schema.consents.userId, userId)).orderBy(desc(schema.consents.grantedAt))).map((c) => clean(c)),
    dataRequests: (await db.select().from(schema.dataRequests).where(eq(schema.dataRequests.userId, userId)).orderBy(desc(schema.dataRequests.receivedAt))).map((r) => clean(r, ['fileKey', 'handledByUserId'])),
  };

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
  if (client) {
    data['client'] = clean(client);
    data['savedPlaces'] = (await db.select().from(schema.savedPlaces).where(eq(schema.savedPlaces.clientId, client.id))).map((p) => clean(p));
    data['ridesAsClient'] = (await db.select().from(schema.rides).where(eq(schema.rides.clientId, client.id)).orderBy(desc(schema.rides.createdAt)).limit(1000)).map((r) => clean(r));
  }

  const [driver] = await db.select().from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
  if (driver) {
    data['driver'] = clean(driver, ['stripeConnectAccountId', 'stripeDebitPaymentMethodId']);
    data['vehicles'] = (await db.select().from(schema.vehicles).where(eq(schema.vehicles.driverId, driver.id))).map((v) => clean(v));
    data['documents'] = (await db.select().from(schema.driverDocuments).where(eq(schema.driverDocuments.driverId, driver.id))).map((d) => clean(d, ['fileKey']));
    data['ridesAsDriver'] = (await db.select().from(schema.rides).where(eq(schema.rides.driverId, driver.id)).orderBy(desc(schema.rides.createdAt)).limit(1000)).map((r) => clean(r));
  }

  data['auditTrail'] = (await db.select({ action: schema.auditLog.action, entity: schema.auditLog.entity, entityId: schema.auditLog.entityId, occurredAt: schema.auditLog.occurredAt, ipAddress: schema.auditLog.ipAddress }).from(schema.auditLog).where(eq(schema.auditLog.actorUserId, userId)).orderBy(desc(schema.auditLog.occurredAt)).limit(500)).map((a) => clean(a));
  return data;
}

export function toJsonBuffer(data: ExportData): Buffer {
  return Buffer.from(JSON.stringify(data, null, 2), 'utf8');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Document PDF simple et lisible, dans la langue de l'utilisateur : un titre, une section par bloc de données, une ligne par champ. */
export function toPdfBuffer(data: ExportData, language: Language): Promise<Buffer> {
  const texts = PDF_TEXTS[language] ?? PDF_TEXTS.fr;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: texts.title, Author: 'Neomoov, Groupe NSK Inc.' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(texts.title);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555555').text(`${texts.generated} ${String(data['generatedAt'] ?? '')} · ${texts.footer}`);
    doc.fillColor('#000000');

    for (const [key, value] of Object.entries(data)) {
      if (key === 'generatedAt') continue;
      doc.moveDown(0.8);
      doc.fontSize(13).text(texts.sections[key] ?? key);
      doc.moveDown(0.2);
      doc.fontSize(9);
      const rows = Array.isArray(value) ? value : [value];
      if (!rows.length) {
        doc.text(texts.empty);
        continue;
      }
      rows.forEach((row, index) => {
        if (Array.isArray(value)) doc.font('Helvetica-Bold').text(`${index + 1}.`).font('Helvetica');
        if (row && typeof row === 'object') {
          for (const [field, fieldValue] of Object.entries(row as Record<string, unknown>)) doc.text(`${field} : ${formatValue(fieldValue)}`);
        } else {
          doc.text(formatValue(row));
        }
        if (Array.isArray(value)) doc.moveDown(0.2);
      });
    }
    doc.end();
  });
}
