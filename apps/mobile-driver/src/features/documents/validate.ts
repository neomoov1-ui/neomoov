/** Contrôles de saisie des documents, sans dépendance à React Native (testés par vitest). */

/** Date civile AAAA-MM-JJ valide (le 31 février est refusé). */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
