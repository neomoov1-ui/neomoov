import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { inArray, sql } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PresenceService } from '../src/modules/rides/presence.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();

function waitFor<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Événement ${event} non reçu en ${timeoutMs} ms`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitAck<T = { ok: boolean }>(socket: Socket, event: string, body: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Aucun acquittement pour ${event} en ${timeoutMs} ms`)), timeoutMs);
    socket.emit(event, body, (ack: T) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

describe('temps réel Socket.IO (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let base = '';
  const sockets: Socket[] = [];
  const server = () => app!.getHttpServer();

  const connect = (namespace: string, token?: string): Promise<{ socket: Socket; error: { code: string } | null }> =>
    new Promise((resolve) => {
      const socket = io(`${base}${namespace}`, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push(socket);
      let error: { code: string } | null = null;
      socket.on('error', (e: { code: string }) => {
        error = e;
      });
      socket.on('connect', () => resolve({ socket, error }));
      // Refus dans l'intergiciel d'espace : le message de l'erreur porte le code.
      socket.on('connect_error', (e: Error) => resolve({ socket, error: { code: e.message } }));
    });

  beforeAll(async () => {
    app = await startTestApp();
    if (app) {
      await app.listen(0);
      const { port } = app.getHttpServer().address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
    }
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('refuse un socket sans jeton, ou un non-chauffeur sur /driver', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const anonymous = await connect('/client');
    expect(anonymous.error?.code).toBe('UNAUTHENTICATED');
    const client = await loginByOtp(app);
    const notDriver = await connect('/driver', client.accessToken);
    expect(notDriver.error?.code).toBe('DRIVER_PROFILE_REQUIRED');
    const notStaff = await connect('/admin', client.accessToken);
    expect(notStaff.error?.code).toBe('FORBIDDEN_ROLE');
  });

  it('client, chauffeur et My Hub reçoivent la course, les positions (moins de 2 secondes), les messages et les alertes', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const stranger = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201)).body.quotes[0];
    const ride = (await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `rt-${Date.now()}`).send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body;

    const { socket: clientSocket } = await connect('/client', client.accessToken);
    const { socket: strangerSocket } = await connect('/client', stranger.accessToken);
    const { socket: driverSocket } = await connect('/driver', driver.tokens.accessToken);
    const { socket: adminSocket } = await connect('/admin', admin.tokens.accessToken);
    expect(clientSocket.connected && driverSocket.connected && adminSocket.connected).toBe(true);

    const subscribed = await emitAck<{ ok: boolean; ride?: { state: string } }>(clientSocket, 'ride.subscribe', { rideId: ride.id });
    expect(subscribed.ok).toBe(true);
    expect(subscribed.ride?.state).toBe('requested');
    const refused = await emitAck<{ ok: boolean; code?: string }>(strangerSocket, 'ride.subscribe', { rideId: ride.id });
    expect(refused).toMatchObject({ ok: false, code: 'NOT_RIDE_PARTICIPANT' });

    const presenceSeen = waitFor<{ driverId: string; status: string }>(adminSocket, 'driver.presence');
    const online = await emitAck<{ ok: boolean; status?: { status: string } }>(driverSocket, 'status.update', { status: 'online', coordinates: PLATEAU.coordinates });
    expect(online.ok).toBe(true);
    expect((await presenceSeen).status).toBe('online');

    // L'attribution forcée passe par « offres envoyées » puis « attribuée » : chaque abonné reçoit les deux mises à jour.
    const states: Record<string, string[]> = { client: [], driver: [], admin: [] };
    const waitForAssigned = (socket: Socket, who: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${who} : état « assigned » non reçu`)), 5000);
        socket.on('ride.updated', (view: { state: string }) => {
          states[who]!.push(view.state);
          if (view.state === 'assigned') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    const updates = Promise.all([waitForAssigned(clientSocket, 'client'), waitForAssigned(driverSocket, 'driver'), waitForAssigned(adminSocket, 'admin')]);
    await request(server()).post(`/v1/admin/rides/${ride.id}/assign`).set(bearer(admin.tokens)).send({ driverId: driver.driverId }).expect(200);
    await updates;
    expect(states['client']).toEqual(['offering', 'assigned']);
    expect(states['driver']).toContain('assigned');
    expect(states['admin']).toEqual(['offering', 'assigned']);
    // Le chauffeur suit aussi sa course par la salle de la course.
    expect((await emitAck<{ ok: boolean }>(driverSocket, 'ride.subscribe', { rideId: ride.id })).ok).toBe(true);

    // Position : le client de la course la reçoit en moins de 2 secondes ; un autre client jamais.
    const strangerGotLocation = new Promise<boolean>((resolve) => {
      strangerSocket.once('driver.location', () => resolve(true));
      setTimeout(() => resolve(false), 1500);
    });
    const location = waitFor<{ rideId: string; coordinates: { lat: number; lng: number } }>(clientSocket, 'driver.location');
    const sentAt = performance.now();
    const ack = await emitAck<{ ok: boolean; rideId: string | null; accepted: boolean }>(driverSocket, 'location.update', { coordinates: { lat: 45.53, lng: -73.59 }, speedMps: 8, headingDegrees: 120 });
    expect(ack).toMatchObject({ ok: true, rideId: ride.id, accepted: true });
    const received = await location;
    const latencyMs = performance.now() - sentAt;
    console.log(`Latence de diffusion d'une position chauffeur → client : ${Math.round(latencyMs)} ms`);
    expect(latencyMs).toBeLessThan(2000);
    expect(received.rideId).toBe(ride.id);
    expect(received.coordinates).toEqual({ lat: 45.53, lng: -73.59 });
    expect(await strangerGotLocation).toBe(false);

    const clientMessage = waitFor<{ body: string; senderKind: string }>(clientSocket, 'message.received');
    const driverMessage = waitFor<{ body: string }>(driverSocket, 'message.received');
    await request(server()).post(`/v1/rides/${ride.id}/messages`).set(bearer(driver.tokens)).send({ body: 'J\'arrive dans 5 minutes' }).expect(201);
    expect(await clientMessage).toMatchObject({ body: 'J\'arrive dans 5 minutes', senderKind: 'driver' });
    expect((await driverMessage).body).toBe('J\'arrive dans 5 minutes');

    const alert = waitFor<{ type: string; rideId: string }>(adminSocket, 'alert.new');
    await request(server()).post(`/v1/rides/${ride.id}/sos`).set(bearer(client)).send({}).expect(201);
    expect(await alert).toMatchObject({ type: 'sos', rideId: ride.id });

    const badLocation = await emitAck<{ ok: boolean; code?: string }>(driverSocket, 'location.update', { coordinates: { lat: 95, lng: 0 } });
    expect(badLocation).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('charge légère : plusieurs chauffeurs envoient des positions en continu sans perte', { timeout: 180_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const load = process.env['LOAD_TEST'] === '1';
    const driverCount = load ? 200 : 8;
    const intervalMs = load ? 5000 : 250;
    const durationMs = load ? 120_000 : 5000;
    const drivers: TestDriver[] = [];
    for (let i = 0; i < driverCount; i += 1) drivers.push(await createDriver(app));
    const connections = await Promise.all(drivers.map((d) => connect('/driver', d.tokens.accessToken)));
    for (const [i, c] of connections.entries()) {
      const ack = await emitAck<{ ok: boolean }>(c.socket, 'status.update', { status: 'online', coordinates: { lat: 45.5 + i * 0.0005, lng: -73.6 } });
      expect(ack.ok).toBe(true);
    }
    const presence = app.get(PresenceService);
    const before = { ...presence.stats };
    let sent = 0;
    let accepted = 0;
    let failed = 0;
    const started = performance.now();
    const loops = connections.map(async (c, i) => {
      let step = 0;
      while (performance.now() - started < durationMs) {
        step += 1;
        sent += 1;
        // Déplacement d'environ 110 m à chaque envoi : jamais filtré comme immobile.
        const ack = await emitAck<{ ok: boolean; accepted: boolean }>(c.socket, 'location.update', { coordinates: { lat: 45.5 + i * 0.0005 + step * 0.001, lng: -73.6 }, speedMps: 12 });
        if (!ack.ok) failed += 1;
        else if (ack.accepted) accepted += 1;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    });
    await Promise.all(loops);
    await presence.flush();
    const written = presence.stats.written - before.written;
    const rows = await db(app).execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM driver_locations WHERE driver_id IN ${drivers.map((d) => d.driverId)}`);
    console.log(`Charge : ${driverCount} chauffeurs, ${sent} positions envoyées, ${accepted} acceptées, ${failed} refusées, ${written} écrites, ${rows[0]!.n} en base`);
    expect(failed).toBe(0);
    expect(accepted).toBe(sent);
    expect(presence.stats.dropped - before.dropped).toBe(0);
    expect(rows[0]!.n).toBe(accepted);
    await Promise.all(connections.map((c) => emitAck(c.socket, 'status.update', { status: 'offline' })));
    const remaining = await db(app).select({ driverId: schema.driverPresence.driverId }).from(schema.driverPresence).where(inArray(schema.driverPresence.driverId, drivers.map((d) => d.driverId)));
    expect(remaining).toHaveLength(0);
  });
});
