/**
 * Écriture CSV des exports (registres, géolocalisation) : cellules citées au besoin (RFC 4180), fins de ligne CRLF.
 * Une cellule texte qui commence par un caractère de formule (= + - @) est préfixée d'une apostrophe : un tableur
 * n'exécute jamais une donnée saisie par un utilisateur (injection de formule).
 */

export type CsvValue = string | number | null | undefined;

export function csvCell(value: CsvValue, separator: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return safe.includes(separator) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvLine(cells: CsvValue[], separator: string): string {
  return cells.map((c) => csvCell(c, separator)).join(separator);
}

export function csvDocument(lines: string[]): string {
  return `${lines.join('\r\n')}\r\n`;
}
