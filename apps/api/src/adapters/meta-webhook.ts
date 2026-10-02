/**
 * Lecture des webhooks Meta (Messenger, Facebook, Instagram) de la boîte unifiée : fonction pure, partagée par le
 * connecteur réel et le simulateur (les tests l'exercent donc dans le format exact de Meta). Les messages envoyés par
 * la page elle-même (échos) et les commentaires de la page sont ignorés : jamais de boucle avec nos propres réponses.
 */
import type { SocialInboundComment, SocialInboundMessage } from './types.js';

interface MessagingEntry {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] };
}

interface ChangeEntry {
  field?: string;
  value?: Record<string, unknown>;
}

interface Entry {
  id?: string;
  time?: number;
  messaging?: MessagingEntry[];
  changes?: ChangeEntry[];
}

const PLACEHOLDER = '(pièce jointe sans texte)';

function at(ms: number | undefined, fallback: Date): Date {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms < 1e12 ? ms * 1000 : ms) : fallback;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Messages et commentaires d'un webhook Meta ; `ownIds` : identifiants de la page et du compte Instagram (échos ignorés). */
export function parseMetaWebhook(body: unknown, ownIds: readonly string[] = [], now = new Date()): { messages: SocialInboundMessage[]; comments: SocialInboundComment[] } {
  const messages: SocialInboundMessage[] = [];
  const comments: SocialInboundComment[] = [];
  const root = (body ?? {}) as { object?: string; entry?: Entry[] };
  const object = root.object === 'instagram' ? 'instagram' : root.object === 'page' ? 'page' : null;
  if (!object || !Array.isArray(root.entry)) return { messages, comments };
  const own = new Set(ownIds.map(String));
  for (const entry of root.entry) {
    const entryId = str(entry.id);
    if (entryId) own.add(entryId);
    for (const m of entry.messaging ?? []) {
      const senderId = str(m.sender?.id);
      const messageId = str(m.message?.mid);
      if (!senderId || !messageId || m.message?.is_echo || own.has(senderId)) continue;
      const text = str(m.message?.text) ?? (m.message?.attachments?.length ? PLACEHOLDER : null);
      if (!text) continue;
      messages.push({ network: object === 'instagram' ? 'instagram' : 'messenger', senderId, senderName: null, messageId, text: text.slice(0, 4_000), receivedAt: at(m.timestamp, now) });
    }
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      if (object === 'page' && change.field === 'feed') {
        if (value['item'] !== 'comment' || (value['verb'] ?? 'add') !== 'add') continue;
        const from = (value['from'] ?? {}) as { id?: string; name?: string };
        const authorId = str(from.id);
        const commentId = str(value['comment_id']);
        const text = str(value['message']);
        if (!authorId || !commentId || !text || own.has(authorId)) continue;
        comments.push({ network: 'facebook', commentId, postId: str(value['post_id']), authorId, authorName: str(from.name), text: text.slice(0, 4_000), receivedAt: at(value['created_time'] as number | undefined, now) });
      } else if (object === 'instagram' && change.field === 'comments') {
        const from = (value['from'] ?? {}) as { id?: string; username?: string };
        const authorId = str(from.id);
        const commentId = str(value['id']);
        const text = str(value['text']);
        if (!authorId || !commentId || !text || own.has(authorId)) continue;
        const media = (value['media'] ?? {}) as { id?: string };
        comments.push({ network: 'instagram', commentId, postId: str(media.id), authorId, authorName: str(from.username), text: text.slice(0, 4_000), receivedAt: now });
      }
    }
  }
  return { messages, comments };
}
