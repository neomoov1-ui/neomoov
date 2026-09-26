import 'reflect-metadata';
import { createServer, type Server } from 'node:net';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClamAvScanner, parseClamdReply } from '../src/adapters/real/clamav.js';
import { bearer, cleanupTestData, createDriver, db, startTestApp } from './helpers.js';

// Fichier de test EICAR : chaîne inoffensive que tous les antivirus reconnaissent comme un « virus ».
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const inOneYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

/** Faux démon clamd : lit le flux INSTREAM (blocs préfixés de leur longueur) et répond comme ClamAV. */
function fakeClamd(): Promise<{ server: Server; port: number; received: number[] }> {
  const received: number[] = [];
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      const command = 'zINSTREAM\0';
      if (buffer.length < command.length) return;
      let offset = command.length;
      const parts: Buffer[] = [];
      for (;;) {
        if (buffer.length < offset + 4) return;
        const size = buffer.readUInt32BE(offset);
        if (size === 0) break;
        if (buffer.length < offset + 4 + size) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
      const file = Buffer.concat(parts);
      received.push(file.length);
      socket.end(file.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, received })));
}

describe('analyse antivirus des documents', () => {
  it('protocole ClamAV (INSTREAM) : fichier sain, fichier infecté, gros fichier en plusieurs blocs, démon absent', async () => {
    const { server, port, received } = await fakeClamd();
    try {
      const scanner = new ClamAvScanner('127.0.0.1', port, 2_000);
      expect(await scanner.scan({ body: JPEG })).toEqual({ clean: true, signature: null });
      expect(await scanner.scan({ body: Buffer.from(EICAR) })).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
      expect(await scanner.scan({ body: Buffer.alloc(200_000, 1) })).toEqual({ clean: true, signature: null });
      expect(received).toEqual([JPEG.length, EICAR.length, 200_000]);
    } finally {
      server.close();
    }
    await expect(new ClamAvScanner('127.0.0.1', 1, 500).scan({ body: JPEG })).rejects.toMatchObject({ code: 'VIRUS_SCAN_FAILED' });
    expect(() => parseClamdReply('stream: ERROR size limit exceeded')).toThrow(/Réponse inattendue/);
  });

  describe('téléversement (intégration)', () => {
    let app: NestExpressApplication | null = null;
    beforeAll(async () => {
      app = await startTestApp();
    });
    afterAll(async () => {
      if (app) await cleanupTestData(app);
      await app?.close();
    });

    it('un document infecté est refusé (422) et n\'est jamais stocké ; un document sain passe', async ({ skip }) => {
      if (!app) return skip('DATABASE_URL absente');
      const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
      const before = await db(app).select().from(schema.driverDocuments).where(eq(schema.driverDocuments.driverId, driver.driverId));
      const infected = Buffer.concat([JPEG.subarray(0, 4), Buffer.from(EICAR), Buffer.alloc(64, 1)]);
      const refused = await request(app.getHttpServer()).post('/v1/driver/documents').set(bearer(driver.tokens)).field('type', 'insurance').field('expiresOn', inOneYear()).attach('file', infected, 'assurance.jpg');
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: 'DOCUMENT_INFECTED', details: { signature: 'Eicar-Test-Signature' } });
      expect(await db(app).select().from(schema.driverDocuments).where(eq(schema.driverDocuments.driverId, driver.driverId))).toHaveLength(before.length);
      await request(app.getHttpServer()).post('/v1/driver/documents').set(bearer(driver.tokens)).field('type', 'insurance').field('expiresOn', inOneYear()).attach('file', JPEG, 'assurance.jpg').expect(201);
    });
  });
});
