/**
 * Filtrage des secrets et des données personnelles avant qu'ils ne quittent nos serveurs ou les applications
 * (prompt 15, tâche 6) : journaux pino de l'API et du worker, événements envoyés au suivi des erreurs (Sentry) par
 * l'API, le worker, le web et les applications mobiles. Une seule liste de clés sert au journal et au suivi des
 * erreurs ; les textes libres (messages d'erreur, adresses de requêtes, fils d'Ariane) sont en plus nettoyés par
 * motifs : jetons, clés, paramètres d'URL sensibles, courriels, téléphones, codes postaux et adresses postales.
 * Fonctions pures, sans dépendance.
 */

export const REDACTED = '[masqué]';

/** Secrets : jamais journalisés ni envoyés (le journal de l'API masque ces clés, à tout niveau d'imbrication). */
export const SECRET_KEYS = [
  'password', 'passwordHash', 'token', 'secret', 'cardNumber', 'card_number', 'otp', 'accessToken', 'refreshToken', 'identityToken',
  'mfaToken', 'linkToken', 'totpSecret', 'backupCodes', 'apiKey', 'keyHash', 'authorization', 'cookie', 'setCookie',
] as const;

/** Données personnelles (Loi 25) : téléphones, courriels, adresses, positions, identité, adresse IP. */
export const PERSONAL_KEYS = [
  'phone', 'phoneNumber', 'guestPhone', 'email', 'recipientAddress', 'address', 'originAddress', 'destinationAddress',
  'pickupAddress', 'dropoffAddress', 'postalCode', 'firstName', 'lastName', 'guestName', 'lat', 'lng', 'latitude', 'longitude',
  'coordinates', 'ipAddress', 'ip_address',
] as const;

/** Toutes les clés masquées par le journal et le suivi des erreurs. */
export const REDACTED_KEYS: readonly string[] = [...SECRET_KEYS, ...PERSONAL_KEYS];

/**
 * Parties d'un événement Sentry laissées telles quelles : piles d'appels (chemins de fichiers et numéros de ligne que les
 * motifs pourraient abîmer), métadonnées du SDK et identifiants techniques. Elles ne portent aucune donnée d'utilisateur.
 */
export const ERROR_EVENT_STRUCTURAL_KEYS = ['stacktrace', 'debug_meta', 'sdk', 'modules', 'event_id', 'timestamp', 'start_timestamp', 'trace_id', 'span_id'] as const;

/** Clé comparée sans casse, tirets ni soulignés : `x-api-key`, `api_key` et `apiKey` se valent. */
const normalizeKey = (key: string) => key.toLowerCase().replace(/[-_]/g, '');
const SENSITIVE = new Set([...REDACTED_KEYS, 'x-api-key'].map(normalizeKey));

/** Vrai si la valeur de cette clé doit être masquée. */
export function isRedactedKey(key: string): boolean {
  return SENSITIVE.has(normalizeKey(key));
}

/** Types de voie : en français avant le nom (« 4500 rue Saint-Denis »), en anglais après (« 1200 Main Street »). */
const FRENCH_STREET_TYPES = 'rue|avenue|av\\.|boulevard|boul\\.|bd|chemin|ch\\.|place|route|rang|montée|côte|croissant|impasse|allée|promenade';
const ENGLISH_STREET_TYPES = 'Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Crescent|Place|Pl';

/** Motifs appliqués aux textes libres, dans cet ordre (les jetons avant les courriels et les téléphones). */
const TEXT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // En-tête d'autorisation recopié dans un message (« bearer of » n'est pas un jeton : 8 caractères au moins).
  [/\b(Bearer)\s+[\w.~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // Jetons JWT : trois segments base64url, le premier commence par « eyJ ».
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, '[jeton]'],
  // Clés de fournisseurs et de service : Stripe (secrètes et restreintes), secret de webhook, clés de service Neomoov.
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\bwhsec_[A-Za-z0-9]{8,}|\bnmk_[A-Za-z0-9_]{8,}/g, '[clé]'],
  // Paramètres sensibles d'une adresse web (clé Google dans une URL, jeton, signature, code à usage unique).
  [/([?&;](?:key|api_key|apikey|token|access_token|refresh_token|secret|signature|sig|password|code|otp)=)[^&#\s"']+/gi, `$1${REDACTED}`],
  // Valeurs d'une requête SQL en échec (« Failed query: … params: … » de drizzle) : noms, téléphones, adresses possibles.
  [/(\bparams: ?)[^\n]*/g, `$1${REDACTED}`],
  // Courriels (domaine terminé par des lettres : « paquet@11.0.0 » dans un chemin n'est pas un courriel).
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[courriel]'],
  // Téléphones : format international, puis nord-américain à 10 chiffres (jamais au milieu d'un identifiant).
  [/(?<![\w+-])\+\d[\d ().-]{6,18}\d(?![\w-])/g, '[téléphone]'],
  [/(?<![\w-])(?:1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?![\w-])/g, '[téléphone]'],
  // Codes postaux canadiens.
  [/\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi, '[code postal]'],
  // Adresses postales : numéro civique suivi d'un type de voie et du nom (français), ou du nom et du type (anglais).
  [new RegExp(`\\b\\d{1,6}(?:-\\d{1,6})?,?\\s+(?:${FRENCH_STREET_TYPES})\\s+[^,;\\n"]{1,60}`, 'giu'), '[adresse]'],
  [new RegExp(`\\b\\d{1,6}\\s+(?:[A-Z][\\w'’-]*\\s+){1,3}(?:${ENGLISH_STREET_TYPES})\\b\\.?`, 'gu'), '[adresse]'],
];

/** Nettoie un texte libre : secrets et données personnelles remplacés par un libellé neutre. */
export function scrubText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of TEXT_RULES) result = result.replace(pattern, replacement);
  return result;
}

export interface ScrubOptions {
  /** Clés dont la valeur est gardée telle quelle, sans parcours (parties techniques d'un événement). */
  skipKeys?: readonly string[];
  /** Profondeur maximale parcourue ; au-delà, la valeur est remplacée (défaut : 12). */
  maxDepth?: number;
}

/**
 * Copie nettoyée d'une valeur JSON : les clés sensibles sont masquées quel que soit leur type, les textes passent par
 * `scrubText`, les tableaux et objets sont parcourus. Les références circulaires et les niveaux trop profonds sont
 * remplacés. La forme de la valeur est conservée (le type rendu est celui reçu, à ces remplacements près).
 */
export function scrubValue<T>(value: T, options: ScrubOptions = {}): T {
  const skip = new Set(options.skipKeys ?? []);
  const maxDepth = options.maxDepth ?? 12;
  const seen = new WeakSet<object>();
  const walk = (current: unknown, depth: number): unknown => {
    if (typeof current === 'string') return scrubText(current);
    if (current === null || typeof current !== 'object') return current;
    if (depth >= maxDepth) return '[tronqué]';
    if (seen.has(current)) return '[circulaire]';
    seen.add(current);
    if (Array.isArray(current)) return current.map((item) => walk(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      if (skip.has(key)) out[key] = item;
      else if (isRedactedKey(key)) out[key] = item === null || item === undefined ? item : REDACTED;
      else out[key] = walk(item, depth + 1);
    }
    return out;
  };
  return walk(value, 0) as T;
}

/**
 * Événement d'erreur prêt à partir (Sentry, crochet `beforeSend` et `beforeBreadcrumb`) : tout est nettoyé sauf les
 * parties techniques (`ERROR_EVENT_STRUCTURAL_KEYS`) ; l'utilisateur n'est gardé que par son identifiant.
 */
export function scrubErrorEvent<T extends object>(event: T): T {
  const scrubbed = scrubValue(event, { skipKeys: ERROR_EVENT_STRUCTURAL_KEYS }) as T & { user?: Record<string, unknown> | null };
  if (scrubbed.user && typeof scrubbed.user === 'object') {
    const id = scrubbed.user['id'];
    scrubbed.user = typeof id === 'string' || typeof id === 'number' ? { id } : {};
  }
  return scrubbed;
}
