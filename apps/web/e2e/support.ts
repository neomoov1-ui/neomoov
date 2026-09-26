/**
 * Aides des tests Playwright : état écrit par `run.cjs` (comptes, journal de l'API), code SMS simulé lu dans le journal,
 * appels directs à l'API pour préparer les données (chauffeur, course avec SOS), accès à la base pour ce qui n'a pas
 * encore d'API (approbation d'un agent avant l'étape 13), et captures dans `docs/screens/hub/`.
 */
import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
export const SCREENS = path.join(ROOT, 'docs', 'screens', 'hub');
export const AUTH_FILE = path.join(HERE, '.auth', 'admin.json');
export const MFA_FILE = path.join(HERE, '.auth', 'admin-mfa.json');
export const { totp } = require('./totp.cjs') as { totp: (secret: string, atMs?: number) => string };

interface Account {
  email: string;
  password: string;
  phone: string;
}
export interface E2eState {
  api: string;
  web: string;
  apiLog: string;
  accounts: { setup: Account; admin: Account; readonly: Account };
  setupToken: string;
  apiKeyId: string;
}

export function state(): E2eState {
  const file = process.env['E2E_STATE'] ?? path.join(HERE, '.state.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as E2eState;
}

export async function call<T = unknown>(method: string, pathname: string, token?: string | null, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${state().api}/v1${pathname}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} : ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Dernier code SMS simulé envoyé à ce numéro depuis `sinceMs` (journal de l'API en développement ; numéro masqué sauf la fin). */
export async function smsCode(phone: string, sinceMs = 0): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const lines = fs.readFileSync(state().apiLog, 'utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('devOtpCode')) continue;
      const entry = JSON.parse(line) as { phone?: string; devOtpCode: string; time?: number };
      if (String(entry.phone ?? '').endsWith(phone.slice(-3)) && (entry.time ?? Date.now()) >= sinceMs) return entry.devOtpCode;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`code SMS introuvable pour ${phone}`);
}

export const randomPhone = (prefix = '+1438558') => `${prefix}${String(Math.floor(1000 + Math.random() * 9000))}`;
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface Tokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string };
}

/** Compte client par code SMS, conditions acceptées. */
export async function signUp(phone: string): Promise<Tokens> {
  const since = Date.now() - 1000;
  await call('POST', '/auth/otp/request', null, { phone });
  const config = await call<{ legal: { privacyPolicyVersion: string } }>('GET', '/config');
  return call('POST', '/auth/otp/verify', null, { phone, code: await smsCode(phone, since), acceptTerms: true, privacyPolicyVersion: config.legal.privacyPolicyVersion });
}

type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>) & { end: () => Promise<void>; json: (value: unknown) => unknown };
let sqlClient: Sql | null = null;

/** Accès direct à la base de développement (`.env` chargé dans le processus, jamais affiché). */
export function sql(): Sql {
  if (!sqlClient) {
    process.loadEnvFile(path.join(ROOT, '.env'));
    const postgres = require(path.join(ROOT, 'packages', 'db', 'node_modules', 'postgres')) as (url: string, options: object) => Sql;
    sqlClient = postgres(process.env['DATABASE_URL']!, { max: 1, prepare: false, onnotice: () => undefined });
  }
  return sqlClient;
}

/** Ferme la connexion à la base (fin d'un fichier de tests) ; une prochaine requête en rouvre une. */
export async function closeSql(): Promise<void> {
  await sqlClient?.end();
  sqlClient = null;
}

export interface DriverFixture {
  driverId: string;
  vehicleId: string;
  lastName: string;
  phone: string;
}

/**
 * Chauffeur de test : candidature, véhicule (Tesla Model X, Neo Prestige) et permis envoyé par l'API. `active` : validé
 * en base (statut, véhicule, formation) comme l'aurait fait l'équipe, pour pouvoir lui attribuer une course.
 */
export async function createDriver(active: boolean): Promise<DriverFixture> {
  const phone = randomPhone('+1438559');
  const tokens = await signUp(phone);
  const lastName = `Essai${Date.now().toString(36)}`;
  await call('POST', '/driver/apply', tokens.accessToken, { firstName: 'E2E', lastName, qualification: 'registered' });
  const renewed = await call<Tokens>('POST', '/auth/refresh', null, { refreshToken: tokens.refreshToken });
  const token = renewed.accessToken;
  const profile = await call<{ id: string }>('GET', '/driver/profile', token);
  const vehicle = await call<{ id: string }>('POST', '/driver/vehicles', token, { make: 'Tesla', model: 'Model X', year: 2024, colour: 'Noire', plate: `E2E ${Date.now().toString().slice(-4)}`, seats: 5 });
  const form = new FormData();
  form.append('type', 'licence');
  form.append('expiresOn', inDays(365));
  form.append('file', new Blob([fs.readFileSync(path.join(ROOT, 'apps', 'mobile-driver', 'assets', 'images', 'icon.png'))], { type: 'image/png' }), 'permis.png');
  await call('POST', '/driver/documents', token, form);
  if (active) {
    const db = sql();
    await db`UPDATE vehicles SET status = 'active' WHERE id = ${vehicle.id}`;
    await db`UPDATE drivers SET status = 'active', activated_at = now(), training_certified_at = now(), current_vehicle_id = ${vehicle.id} WHERE id = ${profile.id}`;
  }
  return { driverId: profile.id, vehicleId: vehicle.id, lastName, phone };
}

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };

/** Course planifiée d'un client de test, puis SOS déclenché par ce client : un incident critique ouvert. */
export async function createSosIncident(description: string): Promise<{ rideId: string; incidentId: string }> {
  const client = await signUp(randomPhone('+1438560'));
  const requestedAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const quotes = await call<{ quotes: Array<{ id: string; maxConsentedCents: number }> }>('POST', '/quotes', client.accessToken, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt });
  const quote = quotes.quotes[0]!;
  const ride = await call<{ id: string }>('POST', '/rides', client.accessToken, {
    quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents,
  }, { 'idempotency-key': crypto.randomUUID() });
  const sos = await call<{ incidentId: string }>('POST', `/rides/${ride.id}/sos`, client.accessToken, { description });
  return { rideId: ride.id, incidentId: sos.incidentId };
}

/** Action proposée par l'agent de relation client, en attente d'approbation (les agents sont branchés à l'étape 13). */
export async function createPendingApproval(justification: string): Promise<string> {
  const db = sql();
  const [run] = await db`INSERT INTO agent_runs (agent_code, trigger, status) VALUES ('customer_relations', 'e2e', 'awaiting_approval') RETURNING id`;
  const [approval] = await db`INSERT INTO approvals (agent_run_id, proposed_action, data, justification) VALUES (${run!['id']}, 'issueCredit', ${db.json({ amountCents: 1500, reason: 'retard' })}, ${justification}) RETURNING id`;
  return String(approval!['id']);
}

/** Attend quelques tuiles de carte chargées (réseau public) ; sans elles, la capture reste valable. */
export async function waitForTiles(page: Page, minimum = 6): Promise<void> {
  await page.waitForFunction((n) => document.querySelectorAll('.leaflet-tile-loaded').length >= n, minimum, { timeout: 20_000 }).catch(() => undefined);
}

export async function shot(page: Page, name: string, mask: Locator[] = []): Promise<void> {
  fs.mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage: true, mask });
}
