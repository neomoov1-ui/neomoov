import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, cleanupTestData, loginByOtp, startTestApp } from './helpers.js';

const HOME = { label: 'Maison', address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };

describe('configuration publique et profil client (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp({ FEATURE_NEGOTIATION: 'on' });
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('GET /config : drapeaux distants, préavis de 2 heures, catégories actives, sans authentification', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const res = await request(server()).get('/v1/config').expect(200);
    expect(res.body.features).toMatchObject({ negotiation: true, negotiationAboveMax: false, immediateRides: false, installments: false });
    expect(res.body.booking).toMatchObject({ minLeadSeconds: 7200, maxLeadDays: 30, freeCancellationSeconds: 120, cancellationFeeCents: 500 });
    expect(res.body.negotiation.floorPpm).toBe(700_000);
    expect(res.body.tips).toEqual({ suggestedCents: [0, 200, 300, 500], maxCents: 10_000 });
    expect(res.body.legal).toMatchObject({ privacyPolicyVersion: expect.any(String), termsUrl: expect.stringContaining('neomoov.net'), privacyUrl: expect.stringContaining('neomoov.net') });
    const codes = res.body.categories.map((c: { code: string }) => c.code);
    expect(codes.slice(0, 3)).toEqual(['neo_premium', 'neo_prestige', 'neo_xl']);
    expect(res.body.categories[0].allowedModels).toContain('Tesla Model 3');
  });

  it('préférences : valeurs par défaut, remplacement complet, validation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const initial = await request(server()).get('/v1/me/preferences').set(bearer(client)).expect(200);
    expect(initial.body).toMatchObject({ conversation: 'indifferent', music: 'indifferent', temperature: 'neutral', luggageHelp: false });
    const wanted = { conversation: 'silence', music: 'soft', temperature: 'cool', driverLanguage: 'en', luggageHelp: true, musicGenre: 'Jazz', luggageCount: 2, luggageSize: 'large', childSeat: true, accessibility: false };
    const saved = await request(server()).put('/v1/me/preferences').set(bearer(client)).send(wanted).expect(200);
    expect(saved.body).toEqual(wanted);
    expect((await request(server()).get('/v1/me/preferences').set(bearer(client)).expect(200)).body).toEqual(wanted);
    const invalid = await request(server()).put('/v1/me/preferences').set(bearer(client)).send({ ...wanted, luggageCount: 40 });
    expect(invalid.status).toBe(400);
    expect((await request(server()).get('/v1/me/preferences')).status).toBe(401);
  });

  it('lieux enregistrés : ajout, liste, suppression, propriétaire seulement', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const other = await loginByOtp(app);
    expect((await request(server()).get('/v1/me/places').set(bearer(client)).expect(200)).body).toEqual([]);
    const created = await request(server()).post('/v1/me/places').set(bearer(client)).send(HOME).expect(201);
    expect(created.body).toMatchObject(HOME);
    const listed = await request(server()).get('/v1/me/places').set(bearer(client)).expect(200);
    expect(listed.body).toEqual([expect.objectContaining({ id: created.body.id, label: 'Maison', coordinates: HOME.coordinates })]);
    expect((await request(server()).get('/v1/me/places').set(bearer(other)).expect(200)).body).toEqual([]);
    expect((await request(server()).delete(`/v1/me/places/${created.body.id}`).set(bearer(other))).status).toBe(404);
    await request(server()).delete(`/v1/me/places/${created.body.id}`).set(bearer(client)).expect(204);
    expect((await request(server()).get('/v1/me/places').set(bearer(client)).expect(200)).body).toEqual([]);
    expect((await request(server()).post('/v1/me/places').set(bearer(client)).send({ ...HOME, label: '' })).status).toBe(400);
  });
});
