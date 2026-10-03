/**
 * Bornes des réglages de sécurité modifiables à chaud dans My Hub (revue du 2 octobre 2026, sécurité 22) : une valeur
 * hors bornes (aucune tentative de code, jeton d'accès d'un jour, limite par adresse presque nulle qui bloquerait tout
 * le monde) est refusée à l'enregistrement (400 `SETTING_OUT_OF_RANGE`). Ce sont des garde-fous techniques, larges :
 * les valeurs en place restent celles décidées.
 */

/** Durée maximale d'un jeton d'accès : le drapeau de révocation d'une session vit au moins aussi longtemps. */
export const ACCESS_TOKEN_TTL_MAX_SECONDS = 3_600;
export const ACCESS_TOKEN_TTL_MIN_SECONDS = 60;

const BOUNDS: Readonly<Record<string, readonly [number, number]>> = {
  'auth.access_token_ttl_seconds': [ACCESS_TOKEN_TTL_MIN_SECONDS, ACCESS_TOKEN_TTL_MAX_SECONDS],
  'auth.refresh_token_ttl_days': [1, 90],
  'auth.mfa_token_ttl_seconds': [60, 900],
  'auth.link_token_ttl_seconds': [60, 3_600],
  'auth.otp_ttl_seconds': [60, 900],
  'auth.otp_max_attempts': [1, 10],
  'auth.otp_resend_seconds': [0, 600],
  'auth.otp_per_phone_per_hour': [1, 20],
  'auth.otp_per_ip_per_hour': [1, 1_000],
  'auth.staff_lockout_threshold': [1, 50],
  'auth.staff_lockout_minutes': [1, 1_440],
  'auth.staff_login_per_email_per_10min': [1, 100],
  'auth.staff_login_per_ip_per_10min': [1, 1_000],
  'ratelimit.per_ip_per_minute': [30, 100_000],
  'ratelimit.per_user_per_minute': [30, 100_000],
  'ratelimit.webhooks_per_ip_per_minute': [60, 100_000],
  'security.turnstile_window_seconds': [60, 86_400],
};

/** Bornes entières d'un réglage de sécurité, ou null pour un réglage sans bornes. */
export function securitySettingBounds(key: string): readonly [number, number] | null {
  const bounds = BOUNDS[key];
  if (bounds) return bounds;
  // Seuils du défi anti-robots (`security.turnstile_<portée>_after`, 0 = jamais).
  if (/^security\.turnstile_[a-z_]+_after$/.test(key)) return [0, 10_000];
  return null;
}

/** Valeur ramenée dans les bornes d'un réglage déjà en base (posé avant les bornes). */
export function clampSecuritySetting(key: string, value: number): number {
  const bounds = securitySettingBounds(key);
  if (!bounds) return value;
  if (!Number.isFinite(value)) return bounds[0];
  return Math.min(bounds[1], Math.max(bounds[0], Math.round(value)));
}
