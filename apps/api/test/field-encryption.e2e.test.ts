import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptField, deriveFieldKey, encryptField, FieldCipher, isEncryptedField } from '../src/common/field-cipher.js';
import { collectUserData } from '../src/modules/privacy/privacy-export.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, startTestApp } from './helpers.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const inOneYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

describe('chiffrement applicatif des champs sensibles', () => {
  it('aller-retour, clé dérivée propre, valeur en clair rendue telle quelle, autre clé refusée', () => {
    const key = deriveFieldKey('cle-de-test');
    const sealed = encryptField('123456789RT0001', key);
    expect(isEncryptedField(sealed)).toBe(true);
    expect(sealed).not.toContain('123456789');
    expect(encryptField('123456789RT0001', key)).not.toBe(sealed);
    expect(decryptField(sealed, key)).toBe('123456789RT0001');
    expect(decryptField('123456789RT0001', key)).toBe('123456789RT0001');
    expect(() => decryptField(sealed, deriveFieldKey('autre-cle'))).toThrow();
    expect(deriveFieldKey('cle-de-test').equals(deriveFieldKey('cle-de-test'))).toBe(true);
    const cipher = new FieldCipher({ ENCRYPTION_KEY: 'cle-de-test' } as never);
    expect(cipher.encrypt(null)).toBeNull();
    expect(cipher.encrypt('')).toBeNull();
    expect(cipher.encrypt(sealed)).toBe(sealed);
    expect(cipher.decrypt(cipher.encrypt('N-42'))).toBe('N-42');
    expect(() => new FieldCipher({ ENCRYPTION_KEY: undefined } as never)).toThrow();
  });

  describe('intégration', () => {
    let app: NestExpressApplication | null = null;
    const server = () => app!.getHttpServer();
    beforeAll(async () => {
      app = await startTestApp();
    });
    afterAll(async () => {
      if (app) await cleanupTestData(app);
      await app?.close();
    });

    it('numéros de taxes et de documents : chiffrés en base, en clair pour le chauffeur et l\'export Loi 25, masqués dans My Hub', async ({ skip }) => {
      if (!app) return skip('DATABASE_URL absente');
      const driver = await createDriver(app);
      const admin = await createStaffAndLogin(app, ['operator']);
      const profile = await request(server()).patch('/v1/driver/profile').set(bearer(driver.tokens)).send({ gstNumber: '123456789 RT0001', qstNumber: '1234567890 TQ0001', acceptsInterac: false }).expect(200);
      expect(profile.body).toMatchObject({ gstNumber: '123456789RT0001', qstNumber: '1234567890TQ0001' });
      const [row] = await db(app).select({ gst: schema.drivers.gstNumber, qst: schema.drivers.qstNumber }).from(schema.drivers).where(eq(schema.drivers.id, driver.driverId));
      expect(isEncryptedField(row!.gst!)).toBe(true);
      expect(isEncryptedField(row!.qst!)).toBe(true);
      expect(`${row!.gst}${row!.qst}`).not.toMatch(/123456789/);

      const upload = await request(server()).post('/v1/driver/documents').set(bearer(driver.tokens)).field('type', 'insurance').field('number', 'POL-778899').field('expiresOn', inOneYear()).attach('file', JPEG, 'assurance.jpg').expect(201);
      const [doc] = await db(app).select({ number: schema.driverDocuments.number }).from(schema.driverDocuments).where(eq(schema.driverDocuments.id, upload.body.id));
      expect(isEncryptedField(doc!.number!)).toBe(true);
      const own = await request(server()).get('/v1/driver/documents').set(bearer(driver.tokens)).expect(200);
      expect(JSON.stringify(own.body)).toContain('POL-778899');

      const detail = await request(server()).get(`/v1/admin/drivers/${driver.driverId}`).set(bearer(admin.tokens)).expect(200);
      const text = JSON.stringify(detail.body);
      expect(text).not.toContain('v1.');
      expect(text).not.toContain('123456789RT0001');
      expect(detail.body.driver.gstNumber).toMatch(/0001$/);
      const queue = await request(server()).get('/v1/admin/documents').query({ status: 'pending', pageSize: 100 }).set(bearer(admin.tokens)).expect(200);
      const listed = (queue.body.items as Array<{ id: string; number: string | null }>).find((d) => d.id === upload.body.id);
      expect(listed?.number).toMatch(/^•+899$/);
      expect(listed?.number).not.toContain('POL-77');

      const cipher = app.get(FieldCipher);
      const exported = await collectUserData(db(app), driver.userId, (value) => cipher.decrypt(value));
      expect(exported['driver']).toMatchObject({ gstNumber: '123456789RT0001', qstNumber: '1234567890TQ0001' });
      expect((exported['documents'] as Array<{ number: string }>).map((d) => d.number)).toContain('POL-778899');
    });
  });
});
