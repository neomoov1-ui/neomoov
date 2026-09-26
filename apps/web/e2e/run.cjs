// Orchestration des tests Playwright du web (prompt 12, tâche 6) contre une API locale en développement :
//  1. démarre l'API compilée (port 4000, NODE_ENV=development, journal dans logs/e2e-api.log pour lire les codes SMS
//     simulés, CORS ouvert au web de test) ;
//  2. crée les comptes du personnel de test (script create-staff) et une clé publique `public:write` ;
//  3. démarre le web compilé (`next start`, port 3100) avec cette clé côté serveur ;
//  4. lance Playwright (Edge), puis révoque la clé, retire les chauffeurs de test et arrête les serveurs.
// Prérequis : `pnpm --filter @neomoov/api build` et `pnpm --filter @neomoov/web build`. `.env` est chargé dans le
// processus (base de données), jamais affiché. Usage : node e2e/run.cjs [arguments de playwright test]
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WEB_DIR = path.join(__dirname, '..');
const ROOT = path.join(WEB_DIR, '..', '..');
const API_DIR = path.join(ROOT, 'apps', 'api');
const API = 'http://localhost:4000';
const WEB = 'http://localhost:3100';
const LOGS = path.join(ROOT, 'logs');
const API_LOG = path.join(LOGS, 'e2e-api.log');
const STATE = path.join(__dirname, '.state.json');

process.loadEnvFile(path.join(ROOT, '.env'));
const { totp } = require('./totp.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];

async function waitFor(url, label, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // pas encore prêt
    }
    await sleep(1000);
  }
  throw new Error(`${label} ne répond pas (${url})`);
}

async function call(method, pathname, token, body) {
  const res = await fetch(`${API}/v1${pathname}`, {
    method,
    headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} : ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : undefined;
}

function createStaff(email, phone, roles, password) {
  const res = spawnSync(process.execPath, ['--enable-source-maps', 'dist/scripts/create-staff.js', '--email', email, '--phone', phone, '--first', 'E2E', '--last', roles, '--roles', roles], {
    cwd: API_DIR,
    env: { ...process.env, STAFF_PASSWORD: password, NODE_ENV: 'development', LOG_LEVEL: 'warn' },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`create-staff ${roles} : ${res.stderr || res.stdout}`);
}

const suffix = () => String(crypto.randomInt(1000, 9999));
const password = () => `E2e-${crypto.randomBytes(9).toString('base64url')}-7`;

async function main() {
  fs.mkdirSync(LOGS, { recursive: true });
  const apiOut = fs.openSync(API_LOG, 'w');
  const env = { ...process.env, PORT: '4000', NODE_ENV: 'development', CORS_ORIGINS: WEB, WEB_BASE_URL: WEB, LOG_LEVEL: 'info' };
  children.push(spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], { cwd: API_DIR, env, stdio: ['ignore', apiOut, apiOut] }));
  await waitFor(`${API}/v1/health`, 'API');

  const stamp = Date.now().toString(36);
  const accounts = {
    setup: { email: `e2e-setup-${stamp}@neomoov.test`, password: password(), phone: `+1438555${suffix()}` },
    admin: { email: `e2e-admin-${stamp}@neomoov.test`, password: password(), phone: `+1438556${suffix()}` },
    readonly: { email: `e2e-lecture-${stamp}@neomoov.test`, password: password(), phone: `+1438557${suffix()}` },
  };
  createStaff(accounts.setup.email, accounts.setup.phone, 'admin', accounts.setup.password);
  createStaff(accounts.admin.email, accounts.admin.phone, 'admin', accounts.admin.password);
  createStaff(accounts.readonly.email, accounts.readonly.phone, 'readonly', accounts.readonly.password);

  // Clé publique créée par le compte de préparation (connexion complète par l'API, second facteur inscrit).
  const login = await call('POST', '/auth/staff/login', null, { email: accounts.setup.email, password: accounts.setup.password });
  const enrollment = await call('POST', '/auth/staff/mfa/enroll', null, { mfaToken: login.mfaToken });
  const session = await call('POST', '/auth/staff/mfa/confirm', null, { mfaToken: login.mfaToken, code: totp(enrollment.secret) });
  const key = await call('POST', '/admin/api-keys', session.accessToken, { name: `E2E web ${stamp}`, scopes: ['public:write'] });

  // Exemple d'appel de l'API publique (vérification du prompt 12) : devis avec la clé, puis refus sans clé.
  const sample = { origin: { address: 'Aéroport international Montréal-Trudeau, Dorval, QC', coordinates: { lat: 45.4706, lng: -73.7408 } }, destination: { address: '204, rue du Saint-Sacrement, Montréal, QC H2Y 1W8', coordinates: { lat: 45.5033, lng: -73.5586 } }, requestedAt: new Date(Date.now() + 3 * 3_600_000).toISOString(), category: 'neo_premium' };
  const withKey = await fetch(`${API}/v1/public/quotes`, { method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' }, body: JSON.stringify(sample) });
  const withoutKey = await fetch(`${API}/v1/public/quotes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sample) });
  fs.writeFileSync(path.join(LOGS, 'e2e-public-api.json'), JSON.stringify({ request: sample, withKey: { status: withKey.status, body: await withKey.json() }, withoutKey: { status: withoutKey.status, body: await withoutKey.json() } }, null, 2));

  fs.writeFileSync(STATE, JSON.stringify({ api: API, web: WEB, apiLog: API_LOG, accounts, setupToken: session.accessToken, apiKeyId: key.id }, null, 2));

  const webOut = fs.openSync(path.join(LOGS, 'e2e-web.log'), 'w');
  const next = path.join(WEB_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
  children.push(spawn(process.execPath, [next, 'start', '--port', '3100'], {
    cwd: WEB_DIR,
    env: { ...process.env, NODE_ENV: 'production', NEOMOOV_PUBLIC_API_KEY: key.key, API_INTERNAL_URL: API, NEXT_PUBLIC_API_BASE_URL: API },
    stdio: ['ignore', webOut, webOut],
  }));
  await waitFor(`${WEB}/hub/connexion`, 'Web');

  const playwright = path.join(WEB_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
  const result = spawnSync(process.execPath, [playwright, 'test', ...process.argv.slice(2)], { cwd: WEB_DIR, stdio: 'inherit', env: { ...process.env, E2E_STATE: STATE } });

  await call('DELETE', `/admin/api-keys/${key.id}`, session.accessToken).catch(() => undefined);
  return result.status ?? 1;
}

async function cleanup() {
  // Chauffeurs créés par les tests : retirés du service (comme le parcours chauffeur de l'étape 11).
  try {
    const postgres = require(path.join(ROOT, 'packages', 'db', 'node_modules', 'postgres'));
    const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
    const drivers = await sql`SELECT d.id FROM drivers d JOIN users u ON u.id = d.user_id WHERE u.first_name = 'E2E' AND d.status <> 'offboarded'`;
    for (const { id } of drivers) {
      await sql`UPDATE vehicles SET status = 'retired' WHERE driver_id = ${id}`;
      await sql`UPDATE drivers SET status = 'offboarded', offboarded_at = now(), is_online = false WHERE id = ${id}`;
      await sql`DELETE FROM driver_presence WHERE driver_id = ${id}`;
    }
    await sql.end();
  } catch (error) {
    console.error('Nettoyage incomplet :', error.message);
  }
  for (const child of children) child.kill();
  fs.rmSync(STATE, { force: true });
}

main()
  .then(async (code) => {
    await cleanup();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup();
    process.exit(1);
  });
