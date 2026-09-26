/**
 * Implémentations simulées : déterministes, en mémoire, sans réseau. Elles enregistrent leurs appels (`calls`) pour
 * les tests et journalisent en développement. Aucune ne contient de règle métier.
 */
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { haversineMeters } from '../../common/geo.js';
import type {
  AutocompleteSuggestion, CardDetails, EmailProvider, GeoPoint, GeocodeResult, LlmProvider, MapsProvider, PaymentAuthorization, PaymentProvider, SetupIntentResult, WebhookEvent,
  PushProvider, RouteRequest, RouteResult, SevDocument, SevProvider, SevReceipt, SmsDeliveryStatus, SmsProvider, StorageProvider, VoiceProvider, WhatsAppProvider,
} from '../types.js';

let counter = 0;
/** Préfixe propre au processus : deux processus (fichiers de tests en parallèle) ne produisent jamais le même identifiant. */
const RUN = randomBytes(3).toString('hex');
const nextId = (prefix: string) => `${prefix}_${RUN}${(++counter).toString(36).padStart(6, '0')}`;

export { haversineMeters };

const MONTREAL: GeoPoint = { lat: 45.5019, lng: -73.5674 };
const montrealHour = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', hourCycle: 'h23' });

/** Heure locale de Montréal (0 à 23) d'un instant, heure avancée ou normale selon la date. */
export function hourInMontreal(at: Date): number {
  return Number(montrealHour.formatToParts(at).find((p) => p.type === 'hour')?.value ?? 12);
}

export class MockMapsProvider implements MapsProvider {
  readonly name = 'mock';
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  /** Adresses connues du simulateur (adresse en minuscules → point). */
  readonly known = new Map<string, GeocodeResult>([
    ['aéroport montréal-trudeau', { lat: 45.4706, lng: -73.7408, formattedAddress: 'Aéroport international Montréal-Trudeau, Dorval, QC', placeId: 'mock-yul' }],
    ['204 rue du saint-sacrement, montréal', { lat: 45.5033, lng: -73.5586, formattedAddress: '204, rue du Saint-Sacrement, Montréal, QC H2Y 1W8', placeId: 'mock-nsk' }],
  ]);

  async geocode(address: string): Promise<GeocodeResult> {
    this.calls.push({ method: 'geocode', args: [address] });
    const found = this.known.get(address.trim().toLowerCase());
    if (found) return found;
    // Point déterministe autour de Montréal, dérivé de l'adresse, pour des tests reproductibles.
    const h = createHash('sha256').update(address).digest();
    return { lat: MONTREAL.lat + ((h[0]! - 128) / 128) * 0.08, lng: MONTREAL.lng + ((h[1]! - 128) / 128) * 0.12, formattedAddress: address.trim(), placeId: `mock-${h.subarray(2, 8).toString('hex')}` };
  }

  async reverseGeocode(point: GeoPoint): Promise<GeocodeResult> {
    this.calls.push({ method: 'reverseGeocode', args: [point] });
    return { ...point, formattedAddress: `Adresse simulée (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}), Montréal, QC` };
  }

  async autocomplete(input: string, sessionToken?: string, near?: GeoPoint): Promise<AutocompleteSuggestion[]> {
    this.calls.push({ method: 'autocomplete', args: [input, sessionToken, near] });
    const q = input.trim().toLowerCase();
    const known = [...this.known.values()].filter((k) => k.formattedAddress.toLowerCase().includes(q)).map((k) => ({ placeId: k.placeId!, description: k.formattedAddress }));
    if (known.length) return known;
    // Toujours au moins une suggestion : l'adresse saisie, géocodée de façon déterministe.
    const typed = await this.geocode(input);
    return [{ placeId: typed.placeId!, description: `${input.trim()}, Montréal, QC` }];
  }

  async placeDetails(placeId: string, sessionToken?: string): Promise<GeocodeResult> {
    this.calls.push({ method: 'placeDetails', args: [placeId, sessionToken] });
    const known = [...this.known.values()].find((k) => k.placeId === placeId);
    if (known) return known;
    if (!placeId.startsWith('mock-')) throw AppError.notFound('PLACE_NOT_FOUND', `Lieu introuvable : ${placeId}`);
    // Point déterministe dérivé de l'identifiant (comme geocode dérive de l'adresse).
    const h = createHash('sha256').update(placeId).digest();
    return { lat: MONTREAL.lat + ((h[0]! - 128) / 128) * 0.08, lng: MONTREAL.lng + ((h[1]! - 128) / 128) * 0.12, formattedAddress: `Lieu ${placeId}, Montréal, QC`, placeId };
  }

  /** Test du mode dégradé : quand vrai, `route` échoue comme une API indisponible. */
  failRoutes = false;

  async route(request: RouteRequest): Promise<RouteResult> {
    this.calls.push({ method: 'route', args: [request] });
    if (this.failRoutes) throw new Error('Routes API indisponible (simulation)');
    const points = [request.origin, ...(request.waypoints ?? []), request.destination];
    let meters = 0;
    for (let i = 1; i < points.length; i += 1) meters += haversineMeters(points[i - 1]!, points[i]!) * 1.3;
    // Trafic simulé : plus lent de 7 h à 9 h et de 16 h à 18 h, heure de Montréal (rien à voir avec les heures de pointe tarifaires, en base).
    const hour = request.departureTime ? hourInMontreal(new Date(request.departureTime)) : 12;
    const peak = (hour >= 7 && hour < 9) || (hour >= 16 && hour < 18);
    const speedKmh = peak ? 24 : 34;
    return { distanceMeters: Math.round(meters), durationSeconds: Math.round((meters / 1000 / speedKmh) * 3600) + 120, tollsCents: 0 };
  }

  async etaMatrix(origins: GeoPoint[], destination: GeoPoint): Promise<number[]> {
    this.calls.push({ method: 'etaMatrix', args: [origins, destination] });
    return origins.map((o) => Math.round(((haversineMeters(o, destination) * 1.3) / 1000 / 30) * 3600) + 60);
  }
}

/**
 * Paiements simulés (prompt 07) : mêmes règles que Stripe pour ce que l'API en attend. Chaque écriture est idempotente
 * par sa clé (un rejeu renvoie le même résultat, sans second mouvement). Une méthode dont l'identifiant finit par
 * `_declined` est refusée ; `captureFailures` fait échouer les N prochaines captures (tests des nouvelles tentatives) ;
 * `nextCard` choisit la carte que « confirme » le prochain SetupIntent.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly intents = new Map<string, PaymentAuthorization & { amountCents: number; capturedCents?: number; refundedCents: number }>();
  readonly setupIntents = new Map<string, { customerRef: string; card: CardDetails }>();
  readonly transfers = new Map<string, { accountRef: string; amountCents: number }>();
  private readonly idempotency = new Map<string, unknown>();
  captureFailures = 0;
  nextCard: { brand: string; last4: string; declined?: boolean } = { brand: 'visa', last4: '4242' };

  private once<T>(key: string, run: () => T): T {
    if (this.idempotency.has(key)) return this.idempotency.get(key) as T;
    const result = run();
    this.idempotency.set(key, result);
    return result;
  }

  async createCustomer(input: { externalId: string }) {
    this.calls.push({ method: 'createCustomer', args: [input] });
    return { customerRef: `cus_mock_${input.externalId.replace(/-/g, '').slice(0, 20)}` };
  }
  async createSetupIntent(customerRef: string) {
    this.calls.push({ method: 'createSetupIntent', args: [customerRef] });
    const id = nextId('seti_mock');
    const ref = `${nextId('pm_mock')}${this.nextCard.declined ? '_declined' : ''}`;
    this.setupIntents.set(id, { customerRef, card: { ref, brand: this.nextCard.brand, last4: this.nextCard.last4, expMonth: 12, expYear: new Date().getFullYear() + 3 } });
    return { setupIntentId: id, clientSecret: `${id}_secret_mock` };
  }
  /** Le SetupIntent simulé est réputé confirmé par l'application : la carte choisie à sa création est renvoyée. */
  async retrieveSetupIntent(setupIntentId: string): Promise<SetupIntentResult> {
    this.calls.push({ method: 'retrieveSetupIntent', args: [setupIntentId] });
    const intent = this.setupIntents.get(setupIntentId);
    if (!intent) return { setupIntentId, status: 'requires_payment_method', customerRef: null, card: null };
    return { setupIntentId, status: 'succeeded', customerRef: intent.customerRef, card: intent.card };
  }
  async detachPaymentMethod(paymentMethodRef: string) {
    this.calls.push({ method: 'detachPaymentMethod', args: [paymentMethodRef] });
  }
  async authorize(input: Parameters<PaymentProvider['authorize']>[0]) {
    this.calls.push({ method: 'authorize', args: [input] });
    return this.once(`authorize:${input.idempotencyKey}`, () => {
      const intentId = nextId('pi_mock');
      const declined = input.paymentMethodRef.endsWith('_declined');
      const intent = { intentId, status: declined ? ('failed' as const) : ('authorized' as const), amountCents: input.amountCents, refundedCents: 0, ...(declined ? { failureCode: 'card_declined' } : {}) };
      this.intents.set(intentId, intent);
      return { intentId, status: intent.status, ...(declined ? { failureCode: 'card_declined' } : {}) };
    });
  }
  async capture(intentId: string, amountCents: number, idempotencyKey: string) {
    this.calls.push({ method: 'capture', args: [intentId, amountCents, idempotencyKey] });
    const key = `capture:${idempotencyKey}`;
    if (this.idempotency.has(key)) return this.idempotency.get(key) as PaymentAuthorization;
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error(`Intent inconnu : ${intentId}`);
    if (amountCents > intent.amountCents) throw new Error('Capture supérieure à l\'autorisation');
    if (this.captureFailures > 0) {
      // Un échec n'est pas mémorisé sous la clé : la nouvelle tentative (autre clé) peut réussir.
      this.captureFailures -= 1;
      return { intentId, status: 'failed' as const, failureCode: 'insufficient_funds' };
    }
    if (intent.status !== 'authorized') return { intentId, status: 'failed' as const, failureCode: `intent_${intent.status}` };
    intent.status = 'captured';
    intent.capturedCents = amountCents;
    const result = { intentId, status: 'captured' as const };
    this.idempotency.set(key, result);
    return result;
  }
  async cancel(intentId: string) {
    this.calls.push({ method: 'cancel', args: [intentId] });
    const intent = this.intents.get(intentId);
    if (intent && intent.status === 'authorized') intent.status = 'canceled';
  }
  async refund(input: { intentId: string; amountCents: number; idempotencyKey: string }) {
    this.calls.push({ method: 'refund', args: [input] });
    return this.once(`refund:${input.idempotencyKey}`, () => {
      const intent = this.intents.get(input.intentId);
      if (intent) {
        if (intent.refundedCents + input.amountCents > (intent.capturedCents ?? 0)) throw new Error('Remboursement supérieur au montant capturé');
        intent.refundedCents += input.amountCents;
      }
      return { refundId: nextId('re_mock'), status: 'succeeded' as const };
    });
  }
  async chargeOffSession(input: Parameters<PaymentProvider['chargeOffSession']>[0]) {
    this.calls.push({ method: 'chargeOffSession', args: [input] });
    return this.once(`charge:${input.idempotencyKey}`, () => {
      const intentId = nextId('pi_mock');
      if (input.paymentMethodRef.endsWith('_declined')) return { intentId, status: 'failed' as const, failureCode: 'card_declined' };
      this.intents.set(intentId, { intentId, status: 'captured', amountCents: input.amountCents, capturedCents: input.amountCents, refundedCents: 0 });
      return { intentId, status: 'captured' as const };
    });
  }
  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<WebhookEvent> {
    this.calls.push({ method: 'verifyWebhook', args: [signature] });
    if (signature !== 'mock-signature') throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    return JSON.parse(rawBody.toString()) as WebhookEvent;
  }
  /** Comptes Connect simulés : l'inscription est considérée terminée dès que le lien a été demandé (aucun formulaire Stripe). */
  readonly connectAccounts = new Map<string, { onboarded: boolean }>();
  async createConnectAccount(input: { externalId: string }) {
    this.calls.push({ method: 'createConnectAccount', args: [input] });
    const accountRef = `acct_mock_${input.externalId.replace(/-/g, '').slice(0, 16)}`;
    if (!this.connectAccounts.has(accountRef)) this.connectAccounts.set(accountRef, { onboarded: false });
    return { accountRef };
  }
  async createConnectOnboardingLink(input: { accountRef: string; returnUrl: string; refreshUrl: string }) {
    this.calls.push({ method: 'createConnectOnboardingLink', args: [input] });
    this.connectAccounts.set(input.accountRef, { onboarded: true });
    const url = new URL(input.returnUrl);
    url.searchParams.set('account', input.accountRef);
    url.searchParams.set('simulated', '1');
    return { url: url.toString(), expiresAt: new Date(Date.now() + 300_000) };
  }
  async connectAccountStatus(accountRef: string) {
    this.calls.push({ method: 'connectAccountStatus', args: [accountRef] });
    // Après un redémarrage de l'API, un compte simulé déjà créé est considéré comme inscrit.
    const onboarded = this.connectAccounts.get(accountRef)?.onboarded ?? accountRef.startsWith('acct_mock_');
    return { onboarded, payoutsEnabled: onboarded };
  }
  async transfer(input: { accountRef: string; amountCents: number; idempotencyKey: string; description: string }) {
    this.calls.push({ method: 'transfer', args: [input] });
    return this.once(`transfer:${input.idempotencyKey}`, () => {
      const transferId = nextId('tr_mock');
      this.transfers.set(transferId, { accountRef: input.accountRef, amountCents: input.amountCents });
      return { transferId };
    });
  }
}

/** Textos simulés : un numéro qui finit par `0000` est refusé (tests du repli et des erreurs). */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly sent: Array<{ to: string; body: string; messageId: string }> = [];
  async send(input: { to: string; body: string }) {
    if (input.to.endsWith('0000')) throw new Error('Numéro refusé (simulé)');
    const messageId = nextId('sms_mock');
    this.sent.push({ to: input.to, body: input.body, messageId });
    return { messageId };
  }
  verifyStatusWebhook(input: { signature: string }) {
    return input.signature === 'mock-signature';
  }
  parseInbound(params: Record<string, string>) {
    const { From: from, To: to, Body: body, MessageSid: messageId } = params;
    return from && to && body !== undefined && messageId ? { from, to, body, messageId } : null;
  }
  parseStatus(params: Record<string, string>): SmsDeliveryStatus | null {
    const messageId = params['MessageSid'];
    const status = params['MessageStatus'];
    if (!messageId || !status) return null;
    return { messageId, status: status === 'delivered' ? 'delivered' : status === 'failed' || status === 'undelivered' ? 'failed' : 'pending', errorCode: params['ErrorCode'] ?? null };
  }
}

export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  readonly sent: Array<{ to: string; subject: string; html: string; attachments: string[]; messageId: string }> = [];
  async send(input: { to: string; subject: string; html: string; attachments?: Array<{ filename: string }> }) {
    const messageId = nextId('email_mock');
    this.sent.push({ to: input.to, subject: input.subject, html: input.html, attachments: (input.attachments ?? []).map((a) => a.filename), messageId });
    return { messageId };
  }
}

/** Push simulé : un jeton qui contient `dead` est refusé (`DeviceNotRegistered`), comme un appareil désinstallé. */
export class MockPushProvider implements PushProvider {
  readonly name = 'mock';
  readonly sent: Array<{ tokens: string[]; title: string; body: string; data?: Record<string, string> }> = [];
  async send(input: { tokens: string[]; title: string; body: string; data?: Record<string, string> }) {
    this.sent.push(input);
    return {
      tickets: input.tokens.map((token) => (token.includes('dead') ? { token, status: 'error' as const, detail: 'DeviceNotRegistered' } : { token, status: 'ok' as const, ticketId: nextId('ticket_mock') })),
    };
  }
  async receipts(ticketIds: string[]) {
    return ticketIds.map((ticketId) => ({ ticketId, status: 'ok' as const }));
  }
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'mock';
  readonly sent: Array<{ to: string; text: string }> = [];
  async sendText(input: { to: string; text: string }) {
    this.sent.push(input);
    return { messageId: nextId('wa_mock') };
  }
  async sendTemplate(input: { to: string; template: string; language: string; parameters: string[] }) {
    this.sent.push({ to: input.to, text: `[${input.template}] ${input.parameters.join(' | ')}` });
    return { messageId: nextId('wa_mock') };
  }
  verifyWebhook(query: Record<string, string | undefined>) {
    return query['hub.verify_token'] === 'mock-verify' ? (query['hub.challenge'] ?? null) : null;
  }
  verifySignature(_rawBody: string | Buffer, header: string | undefined) {
    return header === 'mock-signature';
  }
  parseInbound(body: unknown) {
    const b = body as { messages?: Array<{ from: string; text: string; id: string }> };
    return (b.messages ?? []).map((m) => ({ from: m.from, text: m.text, messageId: m.id, timestamp: new Date() }));
  }
}

export class MockVoiceProvider implements VoiceProvider {
  readonly name = 'mock';
  readonly calls: Array<{ to: string; assistantId: string }> = [];
  async startOutboundCall(input: { to: string; assistantId: string }) {
    this.calls.push(input);
    return { callId: nextId('call_mock') };
  }
  /** Même forme que Vapi : secret dans l'en-tête, message JSON sous `message`. */
  async verifyWebhook(rawBody: string | Buffer, signature: string) {
    if (signature !== 'mock-signature') throw new Error('Signature de webhook invalide');
    const body = JSON.parse(rawBody.toString()) as { message?: { type?: string } };
    return { type: body.message?.type ?? 'unknown', payload: body.message ?? body };
  }
}

/**
 * SEV simulé (5.13) : garde chaque document reçu (`calls`) et renvoie un identifiant de transaction fictif, le même pour
 * une facture rejouée (idempotence par facture). Le service de transmission journalise chaque envoi. `failures` fait
 * échouer les N prochains envois (tests des reprises, comme `captureFailures` des paiements) ; `healthy` faux simule
 * une panne au `healthcheck`.
 */
export class MockSevProvider implements SevProvider {
  readonly name = 'mock';
  readonly calls: Array<{ method: 'registerSale' | 'registerCancellation' | 'registerCredit'; document: SevDocument }> = [];
  private readonly transactions = new Map<string, string>();
  failures = 0;
  healthy = true;

  registerSale(document: SevDocument) {
    return this.register('registerSale', document);
  }
  registerCancellation(document: SevDocument) {
    return this.register('registerCancellation', document);
  }
  registerCredit(document: SevDocument) {
    return this.register('registerCredit', document);
  }
  async healthcheck() {
    return this.healthy ? { ok: true, latencyMs: 0, detail: 'SEV simulé' } : { ok: false, latencyMs: null, detail: 'Panne simulée du SEV' };
  }

  private async register(method: 'registerSale' | 'registerCancellation' | 'registerCredit', document: SevDocument): Promise<SevReceipt> {
    this.calls.push({ method, document });
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('SEV indisponible (simulation)');
    }
    if (method === 'registerCredit' && !document.original) throw new Error('Note de crédit sans transaction d\'origine (simulation)');
    let transactionId = this.transactions.get(document.invoiceId);
    if (!transactionId) {
      transactionId = nextId('sev_mock');
      this.transactions.set(document.invoiceId, transactionId);
    }
    return { transactionId, status: 'acknowledged', raw: { simulated: true, operation: method } };
  }
}

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly calls: Array<{ system: string; lastMessage?: string }> = [];
  /** Réponses préparées par les tests : la première fonction qui accepte l'entrée produit la sortie. */
  readonly scripted: Array<(input: { system: string; messages: Array<{ role: string; content: string }> }) => { text: string; json?: unknown } | undefined> = [];
  async complete(input: { system: string; messages: Array<{ role: string; content: string }>; jsonSchema?: Record<string, unknown> }) {
    const last = input.messages.at(-1)?.content;
    this.calls.push(last === undefined ? { system: input.system } : { system: input.system, lastMessage: last });
    for (const s of this.scripted) {
      const out = s(input);
      if (out) return { ...out, inputTokens: 10, outputTokens: 10 };
    }
    const text = input.jsonSchema ? '{}' : 'Réponse simulée.';
    return { text, json: input.jsonSchema ? {} : undefined, inputTokens: 10, outputTokens: 5 };
  }
}

export class MockStorageProvider implements StorageProvider {
  readonly name = 'mock';
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async putObject(input: { key: string; body: Buffer; contentType: string }) {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType });
    return { key: input.key };
  }
  async getObject(key: string) {
    return this.objects.get(key) ?? null;
  }
  async getSignedUrl(key: string, expiresInSeconds: number) {
    return `mock://storage/${encodeURIComponent(key)}?expires=${expiresInSeconds}`;
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
}
