/**
 * Discussion du site (Tidio) vers la boîte unifiée : le webhook de Tidio (ou le scénario « Envoyer un webhook » d'un
 * flux Tidio) transmet les messages des visiteurs. Les formes de charge utile varient selon l'origine : la lecture est
 * tolérante (message seul, objet `data`, liste `messages`), ignore les messages de l'équipe ou du robot de Tidio, et ne
 * garde que le texte, le visiteur (identifiant, nom, courriel, téléphone) et un identifiant externe stable pour le
 * dédoublonnage. Fonction pure : le corps reçu et l'heure courante sont des entrées.
 */

export interface TidioInboundMessage {
  /** `tidio:<identifiant du message>` (ou conversation et horodatage), borné à 120 caractères. */
  externalId: string;
  conversationRef: string | null;
  visitorRef: string | null;
  email: string | null;
  name: string | null;
  /** Numéro au format international (+1 pour un numéro nord-américain à 10 chiffres), sinon null. */
  phone: string | null;
  text: string;
  receivedAt: Date;
}

export interface TidioParseResult {
  messages: TidioInboundMessage[];
  /** Éléments lus mais écartés : message de l'équipe ou du robot, sans texte, sans identifiant. */
  ignored: number;
}

/** Auteurs d'un message qui ne viennent pas du visiteur (réponses de l'équipe, du robot Lyro, messages du système). */
const STAFF_AUTHORS = ['operator', 'bot', 'agent', 'system', 'admin', 'lyro'];
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null;
}

/** Première chaîne non vide (nombres acceptés : identifiants numériques). */
function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (text) return text;
  }
  return null;
}

/** Date ISO ou horodatage (secondes ou millisecondes) ; `null` si absente ou illisible. */
function readDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value < 1e12 ? value * 1000 : value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Numéro saisi par le visiteur : chiffres gardés ; 10 chiffres → +1 ; 11 chiffres commençant par 1 → + ; sinon tel quel s'il commence par +. */
export function normalizeVisitorPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function readMessage(record: Rec | null, now: Date): TidioInboundMessage | null {
  if (!record) return null;
  const message = asRecord(record['message']);
  const visitor = asRecord(record['visitor']) ?? asRecord(record['contact']) ?? asRecord(record['customer']);
  const author = firstText(message?.['author'], message?.['sender'], record['author'], record['sender_type'])?.toLowerCase() ?? null;
  if (author && STAFF_AUTHORS.includes(author)) return null;
  const text = firstText(message?.['content'], message?.['text'], typeof record['message'] === 'string' ? record['message'] : null, record['content'], record['text']);
  if (!text) return null;
  const messageId = firstText(message?.['id'], record['message_id'], record['id']);
  const conversationRef = firstText(record['conversation_id'], record['conversationId'], record['chat_id'], record['thread_id']);
  const stamped = readDate(message?.['created_at'] ?? record['created_at'] ?? record['timestamp']);
  const ref = messageId ?? (conversationRef && stamped ? `${conversationRef}:${stamped.getTime()}` : null);
  if (!ref) return null;
  const email = firstText(visitor?.['email'], record['email'])?.toLowerCase() ?? null;
  const fullName = [firstText(visitor?.['first_name']), firstText(visitor?.['last_name'])].filter(Boolean).join(' ');
  return {
    externalId: `tidio:${ref}`.slice(0, 120),
    conversationRef,
    visitorRef: firstText(visitor?.['id'], visitor?.['distinct_id'], record['visitor_id'], record['contact_id']),
    email: email && EMAIL.test(email) ? email : null,
    name: firstText(visitor?.['name'], fullName)?.slice(0, 120) ?? null,
    phone: normalizeVisitorPhone(firstText(visitor?.['phone'], record['phone'])),
    text: text.slice(0, 4_000),
    receivedAt: stamped ?? now,
  };
}

/** Messages des visiteurs d'un webhook Tidio ; `now` date les messages qui n'ont pas d'horodatage. */
export function parseTidioWebhook(body: unknown, now: Date): TidioParseResult {
  const root = asRecord(body);
  if (!root) return { messages: [], ignored: 0 };
  const list: unknown[] = Array.isArray(root['messages']) ? root['messages'] : [asRecord(root['data']) ?? root];
  const messages: TidioInboundMessage[] = [];
  let ignored = 0;
  for (const raw of list) {
    const read = readMessage(asRecord(raw), now);
    if (read) messages.push(read);
    else ignored += 1;
  }
  return { messages, ignored };
}
