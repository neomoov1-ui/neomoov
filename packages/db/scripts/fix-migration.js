// drizzle-kit place les types PostGIS paramétrés entre guillemets ("geography(point,4326)"), ce que PostgreSQL
// lit comme un nom de type inexistant. Ce script retire ces guillemets dans le dernier fichier de migration généré.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../drizzle/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const last = files.at(-1);
if (!last) process.exit(0);
const path = join(dir.pathname.replace(/^\/([A-Za-z]:)/, '$1'), last);
const before = readFileSync(path, 'utf8');
const after = before.replace(/"(geography\([a-z]+,\d+\))"/g, '$1');
if (after !== before) { writeFileSync(path, after); console.log(`Types PostGIS corrigés dans ${last}.`); }
