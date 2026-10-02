import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Le migrateur Drizzle n'applique que les migrations dont `when` dépasse le `created_at` de la dernière ligne appliquée,
 * et `rollback` cible la ligne au `created_at` le plus grand : un journal non monotone saute des migrations ou annule la
 * mauvaise (revue du 2 octobre 2026, constat n° 1 : 0029 et 0030 datées avant 0028).
 */
describe('journal des migrations', () => {
  const journal = JSON.parse(readFileSync(join(__dirname, '..', 'drizzle', 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; when: number; tag: string }[] };

  it('a des horodatages strictement croissants, dans l\'ordre des index', () => {
    const entries = journal.entries;
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.idx, `index de ${entries[i]!.tag}`).toBe(entries[i - 1]!.idx + 1);
      expect(entries[i]!.when, `${entries[i]!.tag} doit être postérieure à ${entries[i - 1]!.tag}`).toBeGreaterThan(entries[i - 1]!.when);
    }
  });

  it('a un fichier SQL par entrée', () => {
    for (const entry of journal.entries) expect(() => readFileSync(join(__dirname, '..', 'drizzle', `${entry.tag}.sql`))).not.toThrow();
  });
});
