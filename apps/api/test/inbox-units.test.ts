import { describe, expect, it } from 'vitest';
import { parseMetaWebhook } from '../src/adapters/meta-webhook.js';
import { MockMailboxProvider, MockSocialProvider } from '../src/adapters/mock/index.js';
import { decodeMimeText, decodeTransferEncoding, listAttachments, parseRawHeaders, pickTextPart } from '../src/adapters/real/mime.js';
import { realMailbox, realSocial } from '../src/adapters/real/index.js';
import { loadEnv } from '../src/config/env.js';
import { brevoToEmail } from '../src/modules/inbox/inbox.controller.js';

/** Boîte unifiée, sans base : lecture des webhooks Meta, parties MIME d'IMAP, relais Brevo, adaptateurs réels sans clé. */
describe('boîte unifiée : webhooks Meta (Messenger, Facebook, Instagram)', () => {
  it('lit les messages privés et les commentaires, ignore les échos, les messages de la page et les objets inconnus', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'page-1', time: 1_759_400_000_000,
          messaging: [
            { sender: { id: 'psid-1' }, recipient: { id: 'page-1' }, timestamp: 1_759_400_000_000, message: { mid: 'm1', text: 'Bonjour' } },
            { sender: { id: 'page-1' }, recipient: { id: 'psid-1' }, timestamp: 1_759_400_000_500, message: { mid: 'm2', text: 'Écho', is_echo: true } },
            { sender: { id: 'psid-2' }, recipient: { id: 'page-1' }, timestamp: 1_759_400_001_000, message: { mid: 'm3', attachments: [{ type: 'image' }] } },
            { sender: { id: 'psid-3' }, recipient: { id: 'page-1' }, timestamp: 1_759_400_001_000, message: { mid: 'm4' } },
          ],
          changes: [
            { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', post_id: 'p1', message: 'Super service', from: { id: 'u1', name: 'Marie' }, created_time: 1_759_400_002 } },
            { field: 'feed', value: { item: 'comment', verb: 'remove', comment_id: 'c2', message: 'x', from: { id: 'u2' } } },
            { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c3', message: 'Notre réponse', from: { id: 'page-1', name: 'Neomoov' } } },
            { field: 'feed', value: { item: 'post', verb: 'add', post_id: 'p2' } },
          ],
        },
      ],
    };
    const parsed = parseMetaWebhook(body, [], new Date('2026-10-02T12:00:00Z'));
    expect(parsed.messages).toEqual([
      { network: 'messenger', senderId: 'psid-1', senderName: null, messageId: 'm1', text: 'Bonjour', receivedAt: new Date(1_759_400_000_000) },
      { network: 'messenger', senderId: 'psid-2', senderName: null, messageId: 'm3', text: '(pièce jointe sans texte)', receivedAt: new Date(1_759_400_001_000) },
    ]);
    expect(parsed.comments).toEqual([{ network: 'facebook', commentId: 'c1', postId: 'p1', authorId: 'u1', authorName: 'Marie', text: 'Super service', receivedAt: new Date(1_759_400_002_000) }]);
    const instagram = parseMetaWebhook({
      object: 'instagram',
      entry: [{ id: 'ig-1', messaging: [{ sender: { id: 'igs-1' }, message: { mid: 'im1', text: 'Hello' } }], changes: [{ field: 'comments', value: { id: 'ic1', text: 'Nice car', from: { id: 'igu-1', username: 'jean.r' }, media: { id: 'media-1' } } }, { field: 'comments', value: { id: 'ic2', text: 'Reply', from: { id: 'ig-1', username: 'neomoov' } } }] }],
    }, ['ig-1'], new Date('2026-10-02T12:00:00Z'));
    expect(instagram.messages).toEqual([expect.objectContaining({ network: 'instagram', senderId: 'igs-1', messageId: 'im1', text: 'Hello' })]);
    expect(instagram.comments).toEqual([{ network: 'instagram', commentId: 'ic1', postId: 'media-1', authorId: 'igu-1', authorName: 'jean.r', text: 'Nice car', receivedAt: new Date('2026-10-02T12:00:00Z') }]);
    expect(parseMetaWebhook({ object: 'whatsapp_business_account', entry: [] })).toEqual({ messages: [], comments: [] });
    expect(parseMetaWebhook(null)).toEqual({ messages: [], comments: [] });
  });

  it('simulateur : signature de test, lecteur de Meta, réponses gardées, rattrapage depuis une date', async () => {
    const social = new MockSocialProvider();
    expect(social.verifySignature('{}', 'mock-signature')).toBe(true);
    expect(social.verifySignature('{}', 'faux')).toBe(false);
    expect(social.verifyWebhook({ 'hub.verify_token': 'mock-verify', 'hub.challenge': '42' })).toBe('42');
    expect(new MockSocialProvider({ acceptTestSignatures: false }).verifySignature('{}', 'mock-signature')).toBe(false);
    expect(social.parseWebhook({ object: 'page', entry: [{ id: 'mock-page', messaging: [{ sender: { id: 'mock-page' }, message: { mid: 'x', text: 'écho de la page' } }] }] }).messages).toEqual([]);
    const reply = await social.reply({ network: 'messenger', threadId: 'psid', text: 'Bonjour' });
    expect(reply.messageId).toMatch(/^social_mock/);
    await social.replyComment({ network: 'instagram', commentId: 'c', text: 'Merci' });
    expect(social.commentReplies).toHaveLength(1);
    social.inbound.push({ network: 'messenger', senderId: 'a', senderName: null, messageId: 'old', text: 'x', receivedAt: new Date('2026-01-01T00:00:00Z') });
    social.inbound.push({ network: 'messenger', senderId: 'b', senderName: null, messageId: 'new', text: 'y', receivedAt: new Date('2026-10-02T00:00:00Z') });
    expect((await social.listInbound(new Date('2026-06-01T00:00:00Z'))).map((m) => m.messageId)).toEqual(['new']);
    expect(await social.listComments(new Date())).toEqual([]);
  });
});

describe('boîte unifiée : parties MIME lues par IMAP', () => {
  it('décode quoted-printable, base64 et les jeux de caractères usuels', () => {
    expect(decodeTransferEncoding(Buffer.from('Bonjour=20=C3=A9t=C3=A9=\r\n suite'), 'quoted-printable').toString('utf8')).toBe('Bonjour été suite');
    expect(decodeTransferEncoding(Buffer.from(Buffer.from('été').toString('base64')), 'BASE64').toString('utf8')).toBe('été');
    expect(decodeTransferEncoding(Buffer.from('tel quel'), '7bit').toString()).toBe('tel quel');
    expect(decodeMimeText(Buffer.from([0xe9, 0x74, 0xe9]), undefined, 'iso-8859-1')).toBe('été');
    expect(decodeMimeText(Buffer.from([0x80]), '8bit', 'windows-1252')).toBe('€');
    expect(decodeMimeText(Buffer.from('ok'), undefined, 'x-inconnu')).toBe('ok');
  });

  it('choisit la partie texte (texte brut avant HTML, jamais une pièce jointe) et liste les pièces jointes', () => {
    const structure = {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'multipart/alternative', part: '1', childNodes: [{ type: 'text/html', part: '1.1', encoding: 'quoted-printable', parameters: { charset: 'utf-8' } }, { type: 'text/plain', part: '1.2', encoding: '7bit', parameters: { charset: 'iso-8859-1' } }] },
        { type: 'application/pdf', part: '2', disposition: 'attachment', dispositionParameters: { filename: 'billet.pdf' }, size: 1234 },
        { type: 'text/plain', part: '3', disposition: 'attachment', dispositionParameters: { filename: 'notes.txt' } },
        { type: 'image/png', part: '4', parameters: { name: 'photo.png' }, disposition: 'inline' },
      ],
    };
    expect(pickTextPart(structure)).toEqual({ part: '1.2', type: 'text/plain', encoding: '7bit', charset: 'iso-8859-1' });
    expect(listAttachments(structure)).toEqual([{ name: 'billet.pdf', contentType: 'application/pdf', size: 1234 }, { name: 'notes.txt', contentType: 'text/plain', size: null }, { name: 'photo.png', contentType: 'image/png', size: null }]);
    expect(pickTextPart({ type: 'text/html', encoding: 'base64' })).toEqual({ part: 'TEXT', type: 'text/html', encoding: 'base64', charset: undefined });
    expect(pickTextPart({ type: 'application/pdf', disposition: 'attachment' })).toBeNull();
    expect(listAttachments({ type: 'application/octet-stream', part: '1', disposition: 'attachment' })).toEqual([{ name: 'piece-jointe.octet-stream', contentType: 'application/octet-stream', size: null }]);
    expect(parseRawHeaders(Buffer.from('Auto-Submitted: auto-replied\r\nReferences: <a@x>\r\n <b@x>\r\nX-Multi: 1\r\nX-Multi: 2\r\nsansdeuxpoints\r\n'))).toEqual({ 'auto-submitted': 'auto-replied', references: '<a@x> <b@x>', 'x-multi': '1 2' });
    expect(parseRawHeaders(undefined)).toEqual({});
  });

  it('boîte simulée : les courriels déposés sont rendus une seule fois', async () => {
    const mailbox = new MockMailboxProvider();
    const email = { messageId: '<a@x>', inReplyTo: null, references: [], from: 'a@x.co', to: [], subject: 's', text: 't', html: null, attachments: [], headers: {}, receivedAt: new Date() };
    mailbox.unseen.push(email, { ...email, messageId: '<b@x>' });
    expect((await mailbox.fetchUnseen(1)).map((e) => e.messageId)).toEqual(['<a@x>']);
    expect((await mailbox.fetchUnseen()).map((e) => e.messageId)).toEqual(['<b@x>']);
    expect(await mailbox.fetchUnseen()).toEqual([]);
  });
});

describe('boîte unifiée : relais entrant Brevo et adaptateurs réels', () => {
  it('traduit un courriel du relais Brevo (en-têtes en minuscules, pièces jointes listées, date tolérante)', () => {
    const email = brevoToEmail({
      MessageId: '<m1@example.com>', From: { Name: 'Marie', Address: 'marie@example.com' }, To: [{ Address: 'contact@neomoov.net' }], Subject: 'Prix', RawTextBody: 'Bonjour', RawHtmlBody: '<p>Bonjour</p>',
      SentAtDate: 'pas une date', Attachments: [{ Name: 'a.pdf', ContentType: 'application/pdf', ContentLength: 10 }], Headers: { 'Auto-Submitted': 'no', References: ['<x@y>', '<z@y>'] },
    });
    expect(email).toMatchObject({ messageId: '<m1@example.com>', from: 'Marie <marie@example.com>', to: ['contact@neomoov.net'], subject: 'Prix', text: 'Bonjour', html: '<p>Bonjour</p>', references: ['<x@y>', '<z@y>'], headers: { 'auto-submitted': 'no' } });
    expect(email.attachments).toEqual([{ name: 'a.pdf', contentType: 'application/pdf', size: 10 }]);
    expect(email.receivedAt).toBeInstanceOf(Date);
    expect(brevoToEmail({}).from).toBe('');
    expect(brevoToEmail({ From: { Address: 'x@y.z' }, SentAtDate: '2026-10-02T10:00:00Z' }).receivedAt.toISOString()).toBe('2026-10-02T10:00:00.000Z');
  });

  it('les adaptateurs réels exigent leurs clés au démarrage', () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x' }, { dotenv: false });
    expect(() => realMailbox(env)).toThrow(/MAILBOX_HOST/);
    expect(() => realSocial(env)).toThrow(/META_PAGE_TOKEN/);
    const configured = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x', META_PAGE_TOKEN: 'jeton-de-test', META_PAGE_ID: '123', WHATSAPP_VERIFY_TOKEN: 'verif', WHATSAPP_APP_SECRET: 'secret-de-test' }, { dotenv: false });
    const social = realSocial(configured);
    expect(social.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verif', 'hub.challenge': '7' })).toBe('7');
    expect(social.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'autre', 'hub.challenge': '7' })).toBeNull();
    expect(social.verifySignature('{}', 'sha256=faux')).toBe(false);
    expect(social.parseWebhook({ object: 'page', entry: [{ id: '123', messaging: [{ sender: { id: '123' }, message: { mid: 'x', text: 'écho' } }, { sender: { id: 'u' }, message: { mid: 'y', text: 'ok' } }] }] }).messages).toHaveLength(1);
    const mailbox = realMailbox(loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x', MAILBOX_HOST: 'imap.example.com', MAILBOX_USER: 'contact@example.com', MAILBOX_PASSWORD: 'mot-de-passe-de-test' }, { dotenv: false }));
    expect(mailbox.name).toBe('imap');
    expect(JSON.stringify(mailbox)).not.toContain('mot-de-passe-de-test');
  });
});
