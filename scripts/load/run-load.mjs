#!/usr/bin/env node
/**
 * `pnpm test:load` (étape 15, tâche 3) : prépare les comptes de charge dans la base de l'environnement visé, lance k6,
 * puis retire les comptes et tout ce que l'essai a produit (courses, factures, positions), même en cas d'échec.
 *
 *   LOAD_PROFILE=smoke (défaut) | full        profil (voir tests/load/lib/config.js)
 *   LOAD_BASE_URL=http://127.0.0.1:4000       API visée (démarrée à part, fournisseurs simulés)
 *   LOAD_CONFIRM_ISOLATED=1                   obligatoire pour le profil complet : l'environnement est isolé (préproduction)
 *   K6_BIN=<chemin de k6>                     sinon `k6` dans le PATH
 *   LOAD_AREA=isolated | city                 zone des chauffeurs et des courses (défaut : isolated en fumée, city en complet)
 *   LOAD_KEEP_FIXTURES=1                      garde les comptes après l'essai (diagnostic)
 * Les autres variables LOAD_* sont passées telles quelles à k6.
 *
 * Refus : cible de production (domaine neomoov.* hors staging, preprod ou test), NODE_ENV ou LOAD_ENV à production.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = process.env;
const profile = env.LOAD_PROFILE || 'smoke';
const baseUrl = (env.LOAD_BASE_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');

function fail(message, code = 2) {
  console.error(`[test:load] ${message}`);
  process.exit(code);
}

/** Jamais contre la production (section 9.1, prompt 15) : domaine de production refusé, environnement de production refusé. */
function productionTarget(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'adresse invalide';
  }
  if (/(^|\.)neomoov\.(net|com|ca|app)$/.test(host) && !/^(staging|preprod|preproduction|test|load)[.-]/.test(host)) return `domaine de production (${host})`;
  if (env.NODE_ENV === 'production' || env.LOAD_ENV === 'production') return 'NODE_ENV ou LOAD_ENV vaut production';
  return null;
}

if (!['smoke', 'full'].includes(profile)) fail(`Profil inconnu : ${profile} (smoke ou full)`);
const refused = productionTarget(baseUrl);
if (refused) fail(`Refusé : ${refused}. Les tests de charge ne visent jamais la production.`);
if (profile === 'full' && env.LOAD_CONFIRM_ISOLATED !== '1') {
  fail('Profil complet : confirmez un environnement isolé (préproduction, base dédiée) avec LOAD_CONFIRM_ISOLATED=1. Jamais la base de développement partagée.');
}

const k6 = env.K6_BIN || 'k6';
const k6Version = spawnSync(k6, ['version'], { encoding: 'utf8', shell: false });
if (k6Version.status !== 0) fail(`k6 introuvable (${k6}) : installez k6 ou indiquez son chemin dans K6_BIN (archive officielle grafana/k6).`);

const fixturesScript = join(root, 'apps', 'api', 'dist', 'scripts', 'load-fixtures.js');
if (!existsSync(fixturesScript)) {
  console.log('[test:load] Construction de l\'API (scripts de préparation)…');
  const build = spawnSync('pnpm', ['--filter', '@neomoov/api', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) fail('Construction de l\'API impossible', 1);
}

const scale = profile === 'full' ? Number(env.LOAD_SCALE || 1) : 1;
const counts = profile === 'full'
  ? { drivers: Number(env.LOAD_DRIVERS || Math.max(1, Math.round(2000 * scale))), clients: Number(env.LOAD_CLIENTS || Math.max(1, Math.round(500 * scale))) }
  : { drivers: Number(env.LOAD_DRIVERS || 12), clients: Number(env.LOAD_CLIENTS || 6) };
const area = env.LOAD_AREA || (profile === 'full' ? 'city' : 'isolated');
const workDir = join(tmpdir(), 'neomoov-load');
mkdirSync(workDir, { recursive: true });
const fixtures = join(workDir, `fixtures-${profile}-${Date.now()}.json`);
const node = (args) => spawnSync(process.execPath, ['--enable-source-maps', fixturesScript, ...args], { cwd: join(root, 'apps', 'api'), stdio: 'inherit', env });

console.log(`[test:load] Profil ${profile} contre ${baseUrl} : ${counts.drivers} chauffeurs, ${counts.clients} clients, zone ${area}.`);
const prepared = node([`--drivers=${counts.drivers}`, `--clients=${counts.clients}`, `--area=${area}`, `--out=${fixtures}`]);
if (prepared.status !== 0) fail('Préparation des comptes de charge impossible', 1);

let status = 1;
try {
  const summaryDir = env.LOAD_SUMMARY_DIR || join(root, 'tests', 'load', 'results');
  mkdirSync(summaryDir, { recursive: true });
  const k6Env = { ...env, LOAD_PROFILE: profile, LOAD_BASE_URL: baseUrl, LOAD_FIXTURES: fixtures, LOAD_SUMMARY_DIR: summaryDir.replace(/\\/g, '/'), K6_NO_USAGE_REPORT: 'true' };
  const run = spawnSync(k6, ['run', '--quiet', '--include-system-env-vars', join(root, 'tests', 'load', 'neomoov.js')], { cwd: root, stdio: 'inherit', env: k6Env, shell: false });
  status = run.status ?? 1;
  console.log(`[test:load] k6 terminé (code ${status}${status === 99 ? ' : au moins un seuil de la section 2.2 n\'est pas atteint' : ''}). Résumé : ${join(summaryDir, `${profile}-summary.md`)}`);
} finally {
  // Le fichier des jetons ne survit pas à l'essai.
  rmSync(fixtures, { force: true });
  if (env.LOAD_KEEP_FIXTURES === '1') console.log(`[test:load] Comptes de charge gardés (LOAD_KEEP_FIXTURES=1) ; retrait : node ${fixturesScript} --reset`);
  else {
    const reset = node(['--reset']);
    if (reset.status !== 0) console.error('[test:load] Retrait des comptes de charge en échec : relancez `node apps/api/dist/scripts/load-fixtures.js --reset`.');
  }
}
process.exit(status);
