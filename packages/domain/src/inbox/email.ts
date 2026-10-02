/**
 * Courriels entrants de la boîte unifiée (phase 1 autonome, 2 octobre 2026) : fonctions pures appliquées à tout courriel
 * reçu sur contact@ (relais Brevo ou lecture IMAP) avant qu'il ne devienne un message de conversation : expéditeur,
 * texte réduit (citations et signatures coupées, 4 000 caractères au plus), courriels automatiques reconnus (notification,
 * rebond, liste de diffusion, réponse d'absence) et classés sans réponse, identifiant de fil.
 */
export interface EmailAddress {
  name: string | null;
  email: string;
}

/** `Prénom Nom <adresse>`, `"Nom" <adresse>` ou `adresse` ; l'adresse est mise en minuscules ; null si aucune adresse. */
export function parseEmailAddress(raw: string | null | undefined): EmailAddress | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const bracket = /<([^<>\s]+@[^<>\s]+)>/.exec(text);
  const email = (bracket?.[1] ?? (/^[^\s<>]+@[^\s<>]+$/.test(text) ? text : null))?.toLowerCase().replace(/^mailto:/, '') ?? null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const name = bracket ? text.slice(0, bracket.index).replace(/["']/g, '').trim() : '';
  return { name: name || null, email };
}

/** Bornes du texte transmis au modèle : jamais plus de 4 000 caractères (règle de la boîte unifiée). */
export const EMAIL_TEXT_MAX = 4_000;

const QUOTE_HEADERS = [
  /^\s*(on|le)\s.+(wrote|a écrit)\s*:?\s*$/i,
  /^\s*-{2,}\s*(original message|message d'origine|message original|forwarded message|message transféré)\s*-{2,}\s*$/i,
  /^\s*(from|de|von)\s*:\s.+$/i,
  /^\s*_{5,}\s*$/,
];
const SIGNATURE_MARKERS = [
  /^--\s*$/,
  /^(envoyé|envoyée|envoyés) (de|depuis) mon (iphone|ipad|android|téléphone|cellulaire|appareil)/i,
  /^sent from my (iphone|ipad|android|phone|galaxy|mobile)/i,
  /^(cordialement|bien cordialement|bien à vous|salutations|merci d'avance|au plaisir|best regards|kind regards|regards|sincerely|thanks,|thank you,|cheers)\s*[,.!]?\s*$/i,
  /^get outlook for (ios|android)/i,
];

/**
 * Texte utile d'un courriel : HTML réduit au texte si aucun texte brut, citations (lignes `>` et en-tête « Le … a
 * écrit : »), signatures (`-- `, « Envoyé de mon iPhone », formules de politesse finales) et espaces superflus coupés,
 * puis borné à `max` caractères.
 */
export function cleanEmailText(text: string | null | undefined, html: string | null | undefined = null, max = EMAIL_TEXT_MAX): string {
  const source = (text ?? '').trim() || htmlToText(html ?? '');
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, '');
    if (/^\s*>/.test(line)) continue;
    if (QUOTE_HEADERS.some((re) => re.test(line))) break;
    if (SIGNATURE_MARKERS.some((re) => re.test(line.trim()))) break;
    kept.push(line);
  }
  const compact = kept.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const body = compact || source.replace(/\s+/g, ' ').trim();
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù',
  icirc: 'î', iuml: 'ï', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', laquo: '«', raquo: '»', ndash: '–', mdash: '—', euro: '€',
};

/** Entités HTML décodées : numériques (`&#39;`, `&#x27;`) et les plus courantes en français ; les autres restent telles quelles. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** HTML réduit à du texte lisible : scripts, styles et citations retirés, blocs séparés par des sauts de ligne, entités usuelles. */
export function htmlToText(html: string): string {
  if (!html) return '';
  const text = html
    .replace(/<(script|style|blockquote)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6])>/gi, '\n\n')
    .replace(/<\/(div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface AutomatedEmailCheck {
  automated: boolean;
  /** `bounce`, `auto_reply`, `list`, `notification`, ou null. */
  reason: 'bounce' | 'auto_reply' | 'list' | 'notification' | null;
}

const NOREPLY = /^(no-?reply|do-?not-?reply|ne-?pas-?repondre|nepasrepondre|mailer-daemon|postmaster|bounce[s]?(-|\+|@)|notification[s]?@|newsletter@|alerts?@|info-?noreply)/i;
const BOUNCE_SUBJECT = /(delivery status notification|undeliverable|mail delivery failed|delivery failure|non remis|échec de (la )?livraison|undelivered mail|returned mail)/i;
const AUTO_REPLY_SUBJECT = /(automatic reply|auto(matic)?-?reply|réponse automatique|out of office|absence du bureau|absent du bureau|hors du bureau|away from (the )?office)/i;

/**
 * Courriel automatique : en-têtes `Auto-Submitted`, `Precedence`, listes de diffusion, réponses d'absence, rebonds,
 * expéditeurs sans réponse. Les en-têtes sont comparés sans tenir compte de la casse de leur nom.
 */
export function isAutomatedEmail(input: { from: string | null | undefined; subject: string | null | undefined; headers?: Record<string, string | string[] | undefined> | null }): AutomatedEmailCheck {
  const headers = new Map<string, string>();
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (value === undefined) continue;
    headers.set(key.toLowerCase(), Array.isArray(value) ? value.join(' ') : value);
  }
  const header = (name: string) => (headers.get(name) ?? '').toLowerCase();
  const subject = input.subject ?? '';
  const from = parseEmailAddress(input.from)?.email ?? (input.from ?? '').toLowerCase();
  if (/^mailer-daemon|^postmaster@/.test(from) || BOUNCE_SUBJECT.test(subject) || header('content-type').includes('multipart/report')) return { automated: true, reason: 'bounce' };
  if (/^auto-/.test(header('auto-submitted')) || header('x-autoreply') === 'yes' || header('x-autorespond') || /^(all|oof|autoreply)$/.test(header('x-auto-response-suppress')) || AUTO_REPLY_SUBJECT.test(subject)) {
    return { automated: true, reason: 'auto_reply' };
  }
  if (headers.has('list-id') || headers.has('list-unsubscribe') || /^(list|bulk|junk)$/.test(header('precedence'))) return { automated: true, reason: 'list' };
  if (NOREPLY.test(from) || /^(auto_reply|auto-reply)$/.test(header('precedence'))) return { automated: true, reason: 'notification' };
  return { automated: false, reason: null };
}

/** Identifiant de message normalisé (chevrons retirés, minuscules) ; null sans identifiant exploitable. */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  const id = (raw ?? '').trim().replace(/^<|>$/g, '').trim();
  return id ? id.toLowerCase() : null;
}

/** Empreinte stable d'une chaîne (FNV-1a sur deux graines, 16 caractères hexadécimaux) : le domaine n'a pas de dépendance Node. */
export function stableHash(text: string): string {
  const lane = (seed: number): string => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  return `${lane(2_166_136_261)}${lane(0x9747b28c)}`;
}

/**
 * Identifiant externe du message de conversation (unique, 120 caractères au plus) : `email:<Message-ID>` ; un identifiant
 * trop long est remplacé par son empreinte, un identifiant absent par l'empreinte de l'expéditeur, de l'objet et de la date.
 */
export function emailExternalId(messageId: string | null | undefined, fallback: { from: string; subject: string | null; receivedAt: string }): string {
  const id = normalizeMessageId(messageId);
  if (id && id.length <= 110) return `email:${id}`;
  const seed = id ?? `${fallback.from.toLowerCase()}|${fallback.subject ?? ''}|${fallback.receivedAt}`;
  return `email:h-${stableHash(seed)}`;
}

/** Identifiants d'un fil (`In-Reply-To`, `References`), normalisés et sans doublon. */
export function threadReferences(inReplyTo: string | null | undefined, references: string | string[] | null | undefined): string[] {
  const list = Array.isArray(references) ? references : (references ?? '').split(/[\s,]+/);
  const out = new Set<string>();
  for (const raw of [...list, inReplyTo ?? '']) {
    const id = normalizeMessageId(raw);
    if (id) out.add(id);
  }
  return [...out];
}

/** Objet d'une réponse : « Re: » ajouté une seule fois ; objet vide : libellé de l'assistance. */
export function replySubject(subject: string | null | undefined, language: 'fr' | 'en' = 'fr'): string {
  const base = (subject ?? '').trim();
  if (!base) return language === 'en' ? 'Re: Your message to Neomoov' : 'Re: Votre message à Neomoov';
  return /^(re|réf|ref|aw|sv)\s*:/i.test(base) ? base : `Re: ${base}`;
}
