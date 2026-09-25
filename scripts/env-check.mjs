#!/usr/bin/env node
/**
 * Bilan du fichier .env, sans jamais afficher une valeur : pour chaque variable de .env.example, dit si .env la
 * renseigne. Signale aussi les variables présentes dans .env mais inconnues du code. Usage : `pnpm env:check`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = resolve(root, '.env.example');
const envPath = resolve(root, '.env');

/** Lit un fichier .env : sections (commentaires « # --- Titre --- ») et clés, dans l'ordre. */
function parseEnv(text) {
  const entries = [];
  let section = 'Sans section';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const title = /^#\s*---\s*(.+?)\s*---$/.exec(line);
    if (title) {
      section = title[1];
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    entries.push({ section, key, filled: value.length > 0 });
  }
  return entries;
}

if (!existsSync(examplePath)) {
  console.error(`Fichier ${examplePath} introuvable.`);
  process.exit(1);
}
const expected = parseEnv(readFileSync(examplePath, 'utf8'));
console.log(`Fichier attendu : ${envPath}`);
if (!existsSync(envPath)) {
  console.log('Le fichier .env est ABSENT. Copiez .env.example en .env, puis remplissez-le.');
  process.exit(2);
}
const actual = new Map(parseEnv(readFileSync(envPath, 'utf8')).map((e) => [e.key, e]));

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
console.log(`\n${filled} variable(s) renseignée(s) sur ${expected.length}. Aucune valeur n'est affichée.`);
