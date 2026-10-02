/**
 * Boîte contact@ lue par IMAP (boîte unifiée, repli du relais entrant Brevo) avec `imapflow` : connexion TLS, courriels
 * non lus du dossier (`MAILBOX_FOLDER`, INBOX par défaut), enveloppe, en-têtes utiles, partie texte décodée, pièces
 * jointes listées (jamais téléchargées), puis marquage « lu ». Une connexion par lecture : rien ne reste ouvert entre
 * deux passes (le poste et le serveur n'ont pas de connexion longue à surveiller).
 */
import { ImapFlow } from 'imapflow';
import { AppError } from '../../common/app-error.js';
import type { InboundEmail, MailboxProvider } from '../types.js';
import { decodeMimeText, listAttachments, parseRawHeaders, pickTextPart, type MimeNode } from './mime.js';

const HEADERS = ['auto-submitted', 'precedence', 'list-id', 'list-unsubscribe', 'x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'in-reply-to', 'references', 'content-type', 'reply-to'];

export interface ImapMailboxOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  folder: string;
}

export class ImapMailboxProvider implements MailboxProvider {
  readonly name = 'imap';
  readonly #password: string;

  constructor(private readonly options: ImapMailboxOptions) {
    this.#password = options.password;
  }

  toJSON() {
    return { name: this.name, configured: true, host: this.options.host, folder: this.options.folder };
  }

  async fetchUnseen(limit = 50): Promise<InboundEmail[]> {
    const client = new ImapFlow({ host: this.options.host, port: this.options.port, secure: true, auth: { user: this.options.user, pass: this.#password }, logger: false });
    const out: InboundEmail[] = [];
    try {
      await client.connect();
    } catch (error) {
      throw new AppError('MAILBOX_UNAVAILABLE', `Boîte IMAP injoignable : ${error instanceof Error ? error.message : String(error)}`, 502);
    }
    try {
      const lock = await client.getMailboxLock(this.options.folder);
      try {
        const found = await client.search({ seen: false }, { uid: true });
        const uids = (Array.isArray(found) ? found : []).slice(-limit);
        for (const uid of uids) {
          const message = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true, internalDate: true, headers: HEADERS }, { uid: true });
          if (!message) continue;
          const structure = message.bodyStructure as MimeNode | undefined;
          const textPart = structure ? pickTextPart(structure) : null;
          let text: string | null = null;
          let html: string | null = null;
          if (textPart) {
            const parts = await client.fetchOne(String(uid), { uid: true, bodyParts: [textPart.part] }, { uid: true });
            const raw = parts && parts.bodyParts ? (parts.bodyParts.get(textPart.part) ?? parts.bodyParts.get(textPart.part.toLowerCase())) : undefined;
            if (raw) {
              const decoded = decodeMimeText(raw, textPart.encoding, textPart.charset);
              if (textPart.type === 'text/html') html = decoded;
              else text = decoded;
            }
          }
          const envelope = message.envelope ?? {};
          const headers = parseRawHeaders(message.headers);
          const from = envelope.from?.[0];
          const fromText = from?.address ? (from.name ? `${from.name} <${from.address}>` : from.address) : (headers['from'] ?? '');
          out.push({
            messageId: envelope.messageId ?? null,
            inReplyTo: envelope.inReplyTo ?? headers['in-reply-to'] ?? null,
            references: (headers['references'] ?? '').split(/\s+/).filter(Boolean),
            from: fromText,
            to: (envelope.to ?? []).map((a) => a.address ?? '').filter(Boolean),
            subject: envelope.subject ?? null,
            text,
            html,
            attachments: structure ? listAttachments(structure) : [],
            headers,
            receivedAt: message.internalDate ? new Date(message.internalDate) : new Date(),
          });
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return out;
  }
}
