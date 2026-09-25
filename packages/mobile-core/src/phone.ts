/** Numéros nord-américains : saisie libre (espaces, tirets, parenthèses), envoi au format E.164 attendu par l'API. */
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1') && /^1[2-9]/.test(digits)) return `+${digits}`;
  return null;
}

/** « +15145550123 » devient « 514 555-0123 ». */
export function displayPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return e164;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
