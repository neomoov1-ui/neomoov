/**
 * Comptes des tests de charge (étape 15, tâche 3) : chauffeurs prêts à passer en ligne et clients avec une carte
 * simulée, écrits par lots dans la base de l'environnement visé, et un jeton d'accès par compte (durée du réglage
 * `auth.access_token_ttl_seconds`, 15 minutes), comme après une connexion par code SMS.
 *
 * Marqueur : téléphones `+199956…` à 12 chiffres (distincts du jeu de bout en bout et des tests), courriels
 * `@load.neomoov.local`. Les chauffeurs refusent le terminal et les réservations planifiées (sauf demande) : sur une
 * base partagée, ils ne prennent aucune offre des tests de répartition.
 */
import { schema } from '@neomoov/db';
import type { UserRole } from '@neomoov/domain';
import type { INestApplicationContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { like, sql } from 'drizzle-orm';
import { randomToken, sha256Hex } from '../../common/crypto.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { TokensService } from '../../modules/auth/tokens.service.js';
import { UsersService } from '../../modules/users/users.service.js';
import { removeMarked } from '../seed-e2e/marked-accounts.js';
import { markedPhone, markedPhonePattern, mulberry32, type SeedMarker } from '../seed-e2e/plan.js';

export const LOAD_MARKER: SeedMarker = { key: 'load', phonePrefix: '+199956', emailDomain: 'load.neomoov.local', plateTag: 'LD', rideTag: 'L' };

/**
 * Zones de l'essai : `isolated` (défaut sur une base partagée) place chauffeurs et courses au nord-est de l'aire de
 * service, à plus de 20 km du centre-ville où se placent les tests, hors des trois premiers rayons de recherche (2, 5 et
 * 10 km) ; `city` les répartit sur le Grand Montréal (préproduction).
 */
export const LOAD_AREAS = {
  isolated: { center: { lat: 45.69, lng: -73.405 }, radiusMeters: 2500 },
  city: { center: { lat: 45.515, lng: -73.6 }, radiusMeters: 9000 },
} as const;
export type LoadArea = keyof typeof LOAD_AREAS;

export interface LoadFixturesOptions {
  drivers: number;
  clients: number;
  area: LoadArea;
  acceptsScheduled?: boolean;
  marker?: SeedMarker;
}

export interface LoadFixtures {
  createdAt: string;
  tokensExpireAt: string;
  area: LoadArea;
  areaCenter: { lat: number; lng: number };
  areaRadiusMeters: number;
  drivers: Array<{ token: string; driverId: string; vehicleId: string; lat: number; lng: number }>;
  clients: Array<{ token: string; clientId: string }>;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function positionIn(area: LoadArea, random: () => number): { lat: number; lng: number } {
  const { center, radiusMeters } = LOAD_AREAS[area];
  const r = radiusMeters * Math.sqrt(random());
  const angle = random() * 2 * Math.PI;
  return {
    lat: Number((center.lat + (r * Math.sin(angle)) / 111_320).toFixed(6)),
    lng: Number((center.lng + (r * Math.cos(angle)) / (111_320 * Math.cos((center.lat * Math.PI) / 180))).toFixed(6)),
  };
}

/** Retire les comptes de charge et tout ce que l'essai a produit (courses, factures, positions, relevés). */
export async function removeLoadFixtures(app: INestApplicationContext, marker: SeedMarker = LOAD_MARKER): Promise<Record<string, number>> {
  return removeMarked(app.get<Database>(DB).db, marker);
}

/** Crée les comptes (un essai précédent interrompu est retiré d'abord) et renvoie le contenu du fichier lu par k6. */
export async function createLoadFixtures(app: INestApplicationContext, options: LoadFixturesOptions): Promise<LoadFixtures> {
  const marker = options.marker ?? LOAD_MARKER;
  const { drivers: driverCount, clients: clientCount, area } = options;
  if (!(area in LOAD_AREAS)) throw new Error(`Zone inconnue : ${area} (isolated ou city)`);
  if (![driverCount, clientCount].every((n) => Number.isInteger(n) && n >= 1 && n <= 99_999)) throw new Error('Nombres de comptes invalides (1 à 99 999)');
  const db = app.get<Database>(DB).db;
  const leftovers = await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.phone, markedPhonePattern(marker))).limit(1);
  if (leftovers.length) await removeMarked(db, marker);

  const policy = await app.get(UsersService).currentPrivacyPolicyVersion();
  const required = (await app.get(SettingsService).get<unknown>('drivers.required_documents', ['licence', 'insurance', 'registration'])) as string[];
  const random = mulberry32(42);
  const now = new Date();
  const inOneYear = new Date(now.getTime() + 365 * 86_400_000).toISOString().slice(0, 10);
  const tag = marker.plateTag;

  const accounts = [
    ...Array.from({ length: driverCount }, (_, i) => ({ phone: markedPhone(marker, 0, i + 1), email: `chauffeur.${i + 1}@${marker.emailDomain}`, firstName: 'Charge', lastName: `Chauffeur ${i + 1}`, primaryRole: 'driver' as UserRole })),
    ...Array.from({ length: clientCount }, (_, i) => ({ phone: markedPhone(marker, 1, i + 1), email: `client.${i + 1}@${marker.emailDomain}`, firstName: 'Charge', lastName: `Client ${i + 1}`, primaryRole: 'client' as UserRole })),
  ];
  const userIds = new Map<string, string>();
  for (const part of chunks(accounts, 500)) {
    const rows = await db.insert(schema.users).values(part.map((a) => ({ ...a, termsAcceptedAt: now, privacyPolicyVersion: policy }))).returning({ id: schema.users.id, phone: schema.users.phone });
    for (const r of rows) userIds.set(r.phone, r.id);
    await db.insert(schema.userRoles).values(part.map((a) => ({ userId: userIds.get(a.phone)!, role: a.primaryRole }))).onConflictDoNothing();
  }

  const drivers: Array<{ userId: string; driverId: string; vehicleId: string; lat: number; lng: number }> = [];
  for (const part of chunks(accounts.slice(0, driverCount), 500)) {
    const offset = drivers.length;
    const rows = await db
      .insert(schema.drivers)
      .values(part.map((a, k) => ({
        // Numéro public propre à l'essai : le compteur des chauffeurs réels (CH-…) n'est pas consommé.
        userId: userIds.get(a.phone)!, publicNumber: `${tag}-${String(offset + k + 1).padStart(6, '0')}`.slice(0, 12), status: 'active' as const, qualification: 'saaq_authorized' as const,
        acceptsCash: true, acceptsInterac: true, acceptsTerminal: false, acceptsScheduled: options.acceptsScheduled === true, spokenLanguages: ['fr', 'en'], experienceYears: 5, trainingCertifiedAt: now, activatedAt: now,
      })))
      .returning({ id: schema.drivers.id, userId: schema.drivers.userId });
    const vehicles = await db
      .insert(schema.vehicles)
      .values(rows.map((r, k) => ({ driverId: r.id, category: 'neo_premium' as const, make: 'Tesla', model: 'Model 3', year: 2024, colour: 'blanche', plate: `${tag}${String(offset + k + 1).padStart(6, '0')}`.slice(0, 12), seats: 4, status: 'active' as const })))
      .returning({ id: schema.vehicles.id, driverId: schema.vehicles.driverId });
    const vehicleOf = new Map(vehicles.map((v) => [v.driverId, v.id]));
    await db.execute(sql`UPDATE drivers d SET current_vehicle_id = v.id FROM vehicles v WHERE v.driver_id = d.id AND d.id IN ${rows.map((r) => r.id)}`);
    for (const r of rows) drivers.push({ userId: r.userId, driverId: r.id, vehicleId: vehicleOf.get(r.id)!, ...positionIn(area, random) });
    await db.insert(schema.driverDocuments).values(rows.flatMap((r) => required.map((type) => ({ driverId: r.id, type: type as 'licence', fileKey: `load/${r.id}/${type}.pdf`, status: 'approved' as const, verifiedAt: now, expiresOn: inOneYear }))));
    await db.insert(schema.driverBalances).values(rows.map((r) => ({ driverId: r.id }))).onConflictDoNothing();
  }

  const clients: Array<{ userId: string; clientId: string }> = [];
  for (const part of chunks(accounts.slice(driverCount), 500)) {
    const rows = await db.insert(schema.clients).values(part.map((a) => ({ userId: userIds.get(a.phone)! }))).returning({ id: schema.clients.id, userId: schema.clients.userId });
    // Carte simulée enregistrée : l'autorisation et la capture passent par le fournisseur simulé de l'API visée.
    await db.insert(schema.clientPaymentMethods).values(rows.map((r) => ({ clientId: r.id, stripePaymentMethodId: `pm_mock_${marker.key.replace(/[^a-z0-9]/gi, '')}_${r.id.replace(/-/g, '').slice(0, 20)}`, brand: 'visa', last4: '4242', expMonth: 12, expYear: now.getUTCFullYear() + 3, isDefault: true })));
    clients.push(...rows.map((r) => ({ userId: r.userId, clientId: r.id })));
  }

  // Une session par compte (comme une connexion par code SMS) et son jeton d'accès.
  const tokens = app.get(TokensService);
  const sessionExpiresAt = new Date(now.getTime() + 86_400_000);
  const tokenOf = new Map<string, string>();
  const everyone = [...drivers.map((d) => ({ userId: d.userId, role: 'driver' as UserRole })), ...clients.map((c) => ({ userId: c.userId, role: 'client' as UserRole }))];
  for (const part of chunks(everyone, 500)) {
    const sessions = await db
      .insert(schema.sessions)
      .values(part.map((p) => ({ userId: p.userId, refreshTokenHash: sha256Hex(`rt_${randomToken(32)}`), family: randomUUID(), expiresAt: sessionExpiresAt, userAgent: 'k6-load', amr: ['otp'] })))
      .returning({ id: schema.sessions.id, userId: schema.sessions.userId });
    const roleOf = new Map(part.map((p) => [p.userId, p.role]));
    for (const s of sessions) {
      const role = roleOf.get(s.userId)!;
      tokenOf.set(s.userId, (await tokens.issueAccessToken({ userId: s.userId, sessionId: s.id, primaryRole: role, roles: [role], amr: ['otp'] })).token);
    }
  }
  const ttl = await tokens.accessTtlSeconds();
  return {
    createdAt: now.toISOString(),
    tokensExpireAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    area,
    areaCenter: { ...LOAD_AREAS[area].center },
    areaRadiusMeters: LOAD_AREAS[area].radiusMeters,
    drivers: drivers.map((d) => ({ token: tokenOf.get(d.userId)!, driverId: d.driverId, vehicleId: d.vehicleId, lat: d.lat, lng: d.lng })),
    clients: clients.map((c) => ({ token: tokenOf.get(c.userId)!, clientId: c.clientId })),
  };
}
