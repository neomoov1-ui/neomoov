/**
 * Implémentations simulées : déterministes, en mémoire, sans réseau. Elles enregistrent leurs appels (`calls`) pour
 * les tests et journalisent en développement. Aucune ne contient de règle métier.
 */
import { createHash } from 'node:crypto';
import type {
  AutocompleteSuggestion, EmailProvider, GeoPoint, GeocodeResult, LlmProvider, MapsProvider, PaymentAuthorization, PaymentProvider,
  PushProvider, RouteRequest, RouteResult, SevInvoiceInput, SevProvider, SmsProvider, StorageProvider, VoiceProvider, WhatsAppProvider,
} from '../types.js';

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(++counter).toString(36).padStart(6, '0')}`;

/** Distance à vol d'oiseau (mètres) : sert de base au simulateur de cartes, majorée pour approcher une distance routière. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const r = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

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

  async autocomplete(input: string): Promise<AutocompleteSuggestion[]> {
    this.calls.push({ method: 'autocomplete', args: [input] });
    const q = input.trim().toLowerCase();
    return [...this.known.values()].filter((k) => k.formattedAddress.toLowerCase().includes(q)).map((k) => ({ placeId: k.placeId!, description: k.formattedAddress }));
  }

  async route(request: RouteRequest): Promise<RouteResult> {
    this.calls.push({ method: 'route', args: [request] });
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

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly intents = new Map<string, PaymentAuthorization & { amountCents: number; capturedCents?: number }>();
  private readonly idempotency = new Map<string, string>();

  async createCustomer(input: { externalId: string }) {
    this.calls.push({ method: 'createCustomer', args: [input] });
    return { customerRef: `cus_mock_${input.externalId}` };
  }
  async createSetupIntent(customerRef: string) {
    this.calls.push({ method: 'createSetupIntent', args: [customerRef] });
    const id = nextId('seti_mock');
    return { setupIntentId: id, clientSecret: `${id}_secret` };
  }
  async authorize(input: Parameters<PaymentProvider["authorize"]>[0]) {
    this.calls.push({ method: 'authorize', args: [input] });
    const existing = this.idempotency.get(input.idempotencyKey);
    if (existing) return this.intents.get(existing)!;
    const intentId = nextId('pi_mock');
    const status: PaymentAuthorization['status'] = input.paymentMethodRef.endsWith('_declined') ? 'failed' : 'authorized';
    const intent = { intentId, status, amountCents: input.amountCents };
    this.intents.set(intentId, intent);
    this.idempotency.set(input.idempotencyKey, intentId);
    return intent;
  }
  async capture(intentId: string, amountCents: number, idempotencyKey: string) {
    this.calls.push({ method: 'capture', args: [intentId, amountCents, idempotencyKey] });
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error(`Intent inconnu : ${intentId}`);
    if (amountCents > intent.amountCents) throw new Error('Capture supérieure à l\'autorisation');
    intent.status = 'captured';
    intent.capturedCents = amountCents;
    return intent;
  }
  async cancel(intentId: string) {
    this.calls.push({ method: 'cancel', args: [intentId] });
    const intent = this.intents.get(intentId);
    if (intent) intent.status = 'canceled';
  }
  async refund(input: { intentId: string; amountCents: number; idempotencyKey: string }) {
    this.calls.push({ method: 'refund', args: [input] });
    return { refundId: nextId('re_mock') };
  }
  async chargeOffSession(input: { amountCents: number; idempotencyKey: string }) {
    this.calls.push({ method: 'chargeOffSession', args: [input] });
    const intentId = nextId('pi_mock');
    const intent = { intentId, status: 'captured' as const, amountCents: input.amountCents, capturedCents: input.amountCents };
    this.intents.set(intentId, intent);
    return intent;
  }
  async verifyWebhook(rawBody: string | Buffer, signature: string) {
    this.calls.push({ method: 'verifyWebhook', args: [signature] });
    if (signature !== 'mock-signature') throw new Error('Signature de webhook invalide');
    const parsed = JSON.parse(rawBody.toString()) as { id: string; type: string; data: unknown };
    return parsed;
  }
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly sent: Array<{ to: string; body: string }> = [];
  async send(input: { to: string; body: string }) {
    this.sent.push(input);
    return { messageId: nextId('sms_mock') };
  }
}

export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  readonly sent: Array<{ to: string; subject: string; html: string }> = [];
  async send(input: { to: string; subject: string; html: string }) {
    this.sent.push({ to: input.to, subject: input.subject, html: input.html });
    return { messageId: nextId('email_mock') };
  }
}

export class MockPushProvider implements PushProvider {
  readonly name = 'mock';
  readonly sent: Array<{ tokens: string[]; title: string; body: string }> = [];
  async send(input: { tokens: string[]; title: string; body: string }) {
    this.sent.push(input);
    return { tickets: input.tokens.map((token) => ({ token, status: 'ok' as const })) };
  }
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'mock';
  readonly sent: Array<{ to: string; text: string }> = [];
  async sendText(input: { to: string; text: string }) {
    this.sent.push(input);
    return { messageId: nextId('wa_mock') };
  }
  verifyWebhook(query: Record<string, string | undefined>) {
    return query['hub.verify_token'] === 'mock-verify' ? (query['hub.challenge'] ?? null) : null;
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
  async verifyWebhook(rawBody: string | Buffer, signature: string) {
    if (signature !== 'mock-signature') throw new Error('Signature de webhook invalide');
    return JSON.parse(rawBody.toString()) as { type: string; payload: unknown };
  }
}

export class MockSevProvider implements SevProvider {
  readonly name = 'mock';
  readonly transmitted: SevInvoiceInput[] = [];
  async transmitInvoice(invoice: SevInvoiceInput) {
    this.transmitted.push(invoice);
    const transactionId = nextId('sev_mock');
    return { transactionId, qrPayload: `MOCK-SEV|${invoice.invoiceNumber}|${invoice.totalCents}|${transactionId}` };
  }
  async transmitCancellation() {
    return { transactionId: nextId('sev_mock') };
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
  async getSignedUrl(key: string, expiresInSeconds: number) {
    return `mock://storage/${encodeURIComponent(key)}?expires=${expiresInSeconds}`;
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
}
