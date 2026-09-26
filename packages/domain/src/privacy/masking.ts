/**
 * Masquage des données sensibles affichées dans My Hub (prompt 12, contrainte : « aucune donnée sensible affichée en
 * clair »). Fonctions pures, appliquées par l'API avant l'envoi : le navigateur ne reçoit jamais la valeur complète.
 */

const BULLET = '•';

/** « +15145550123 » devient « +1 514 •••-0123 » : l'indicatif régional et les 4 derniers chiffres suffisent à reconnaître. */
export function maskPhone(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 7) return BULLET.repeat(digits.length);
  const last = digits.slice(-4);
  if (digits.length === 11 && digits.startsWith('1')) return `+1 ${digits.slice(1, 4)} ${BULLET.repeat(3)}-${last}`;
  return `+${BULLET.repeat(digits.length - 4)}${last}`;
}

/** « awa.diallo@exemple.ca » devient « a•••@exemple.ca ». */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 1) return BULLET.repeat(3);
  return `${email[0]}${BULLET.repeat(3)}${email.slice(at)}`;
}

/**
 * Numéros de TPS et TVQ : seuls les 4 derniers chiffres du numéro d'entreprise et le suffixe du programme restent
 * lisibles (« •••••6789 RT0001 »).
 */
export function maskTaxNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, '').toUpperCase();
  const match = /^(\d+)([A-Z]{2}\d{4})$/.exec(compact);
  if (!match) return `${BULLET.repeat(Math.max(0, compact.length - 4))}${compact.slice(-4)}`;
  const digits = match[1]!;
  const program = match[2]!;
  return `${BULLET.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)} ${program}`;
}

/** Numéro de document (permis, police d'assurance) : 3 derniers caractères seulement. */
export function maskDocumentNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 3 ? BULLET.repeat(value.length) : `${BULLET.repeat(value.length - 3)}${value.slice(-3)}`;
}
