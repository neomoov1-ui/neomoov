#!/usr/bin/env node
/**
 * Bilan du fichier .env, sans jamais afficher une valeur : pour chaque variable de .env.example, dit si .env la
 * renseigne. Signale aussi les variables présentes dans .env mais inconnues du code, et la forme des clés Square
 * (préfixes attendus, jamais la valeur). Usage : `pnpm env:check`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = resolve(root, '.env.example');
const envPath = resolve(root, '.env');

/**
 * Lit un fichier .env : sections (commentaires « # --- Titre --- ») et clés, dans l'ordre. Les lignes mal formées
 * (sans signe égal, ou nom de variable avec un espace ou un caractère interdit) sont signalées par leur numéro seulement.
 */
function parseEnv(text) {
  const entries = [];
  const issues = [];
  let section = 'Sans section';
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const title = /^#\s*---\s*(.+?)\s*---$/.exec(line);
    if (title) {
      section = title[1];
      return;
    }
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq < 1) {
      issues.push({ line: index + 1, reason: 'aucun signe égal : la ligne est ignorée (une clé s\'écrit NOM=valeur)' });
      return;
    }
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      issues.push({ line: index + 1, reason: 'nom de variable invalide (espace ou caractère interdit) : la ligne est ignorée' });
      return;
    }
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    // La valeur reste en mémoire pour les contrôles de forme ; elle n'est jamais affichée.
    entries.push({ section, key, filled: value.length > 0, value });
  });
  return { entries, issues };
}

if (!existsSync(examplePath)) {
  console.error(`Fichier ${examplePath} introuvable.`);
  process.exit(1);
}
const expected = parseEnv(readFileSync(examplePath, 'utf8')).entries;
console.log(`Fichier attendu : ${envPath}`);
if (!existsSync(envPath)) {
  console.log('Le fichier .env est ABSENT. Copiez .env.example en .env, puis remplissez-le.');
  process.exit(2);
}
const parsedActual = parseEnv(readFileSync(envPath, 'utf8'));
const actual = new Map(parsedActual.entries.map((e) => [e.key, e]));
if (parsedActual.issues.length) {
  console.log('\nLignes à corriger dans .env (numéro de ligne seulement, le contenu n\'est pas affiché) :');
  for (const issue of parsedActual.issues) console.log(`  ligne ${issue.line} : ${issue.reason}`);
}

let filled = 0;
let currentSection = '';
for (const entry of expected) {
  if (entry.section !== currentSection) {
    currentSection = entry.section;
    console.log(`\n${currentSection}`);
  }
  const present = actual.get(entry.key)?.filled ?? false;
  if (present) filled += 1;
  console.log(`  ${present ? 'OK ' : '-- '} ${entry.key}`);
}
const known = new Set(expected.map((e) => e.key));
const unknown = [...actual.keys()].filter((key) => !known.has(key));
if (unknown.length) {
  console.log('\nVariables présentes dans .env mais inconnues du code (ignorées) :');
  for (const key of unknown) console.log(`  ?  ${key}`);
}
/**
 * Forme des clés Square (étape 26) : préfixe attendu de chaque valeur, pour repérer une clé collée dans la mauvaise
 * variable (par exemple l'identifiant d'application du bac à sable à la place de son jeton d'accès). Seul le diagnostic
 * est affiché.
 */
const SQUARE_SHAPES = [
  { key: 'SQUARE_ACCESS_TOKEN', test: (v) => /^EAAA[A-Za-z0-9_-]{20,}$/.test(v), expected: 'jeton d\'accès de production (commence par EAAA)' },
  { key: 'SQUARE_SANDBOX_ACCESS_TOKEN', test: (v) => /^EAAA[A-Za-z0-9_-]{20,}$/.test(v), expected: 'jeton d\'accès du bac à sable (commence par EAAA)' },
  { key: 'SQUARE_APPLICATION_ID', test: (v) => /^sq0idp-[A-Za-z0-9_-]+$/.test(v), expected: 'identifiant d\'application de production (sq0idp-…)' },
  { key: 'SQUARE_SANDBOX_APPLICATION_ID', test: (v) => /^sandbox-sq0idb-[A-Za-z0-9_-]+$/.test(v), expected: 'identifiant d\'application du bac à sable (sandbox-sq0idb-…)' },
  { key: 'SQUARE_LOCATION_ID', test: (v) => /^[A-Z0-9]{6,40}$/.test(v), expected: 'identifiant d\'emplacement (majuscules et chiffres, souvent L…)' },
  { key: 'SQUARE_SANDBOX_LOCATION_ID', test: (v) => /^[A-Z0-9]{6,40}$/.test(v), expected: 'identifiant d\'emplacement du bac à sable (majuscules et chiffres)' },
  { key: 'SQUARE_WEBHOOK_URL', test: (v) => /^https:\/\/[^\s]+\/v1\/webhooks\/square$/.test(v), expected: 'adresse publique en https se terminant par /v1/webhooks/square' },
  { key: 'SQUARE_ENVIRONMENT', test: (v) => v === 'sandbox' || v === 'production', expected: 'sandbox ou production' },
  // Twilio (2 octobre 2026) : même contrôle de forme, sans afficher la valeur.
  { key: 'TWILIO_ACCOUNT_SID', test: (v) => /^AC[0-9a-f]{32}$/.test(v), expected: 'Account SID (AC suivi de 32 caractères hexadécimaux)' },
  { key: 'TWILIO_AUTH_TOKEN', test: (v) => /^[0-9a-f]{32}$/.test(v), expected: 'Auth Token (32 caractères hexadécimaux)' },
  { key: 'TWILIO_FROM_NUMBER', test: (v) => /^\+1\d{10}$/.test(v), expected: 'numéro au format international sans espace, par exemple +15145550100' },
  // Cloudflare Turnstile (revue Q1 du 3 octobre 2026) : clés de la forme 0x… (1x, 2x ou 3x pour les clés de test de Cloudflare).
  { key: 'TURNSTILE_SECRET_KEY', test: (v) => /^[0-3]x[A-Za-z0-9_-]{20,}$/.test(v), expected: 'clé secrète Turnstile (0x suivi d\'au moins 20 caractères)' },
  { key: 'NEXT_PUBLIC_TURNSTILE_SITE_KEY', test: (v) => /^[0-3]x[A-Za-z0-9_-]{20,}$/.test(v), expected: 'clé de site Turnstile (0x suivi d\'au moins 20 caractères)' },
];
/** Ce que la valeur semble être quand elle n'a pas la forme attendue (sans la montrer). */
function squareLooksLike(value) {
  if (/^sandbox-sq0idb-/.test(value)) return 'elle ressemble à un identifiant d\'application du bac à sable';
  if (/^sq0idp-/.test(value)) return 'elle ressemble à un identifiant d\'application de production';
  if (/^EAAA/.test(value)) return 'elle ressemble à un jeton d\'accès';
  if (/^sq0csp-|^sandbox-sq0csb-/.test(value)) return 'elle ressemble à un secret OAuth d\'application, pas à un jeton d\'accès';
  if (/^SK[0-9a-f]{32}$/.test(value)) return 'elle ressemble à une clé d\'API Twilio (SK…), pas à l\'Account SID (AC…)';
  if (/^\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}$/.test(value)) return 'numéro avec espaces ou ponctuation : écrire +1 puis les 10 chiffres collés';
  return 'forme inconnue';
}
const squareProblems = SQUARE_SHAPES.filter(({ key, test }) => actual.get(key)?.filled && !test(actual.get(key).value));
if (squareProblems.length) {
  console.log('\nForme des clés à vérifier (valeurs non affichées) :');
  for (const { key, expected: shape } of squareProblems) console.log(`  !! ${key} : attendu ${shape} ; ${squareLooksLike(actual.get(key).value)}`);
}

console.log(`\n${filled} variable(s) renseignée(s) sur ${expected.length}. Aucune valeur n'est affichée.`);
