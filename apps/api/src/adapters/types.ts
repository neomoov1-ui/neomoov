/**
 * Interfaces des dix fournisseurs externes (CLAUDE.md, section « Fournisseurs et adaptateurs »). Chaque interface a une
 * implémentation simulée (`mock/`) et une implémentation réelle (`real/`), choisies par variable d'environnement.
 * Les signatures s'étoffent étape par étape ; elles restent la seule façon d'atteindre un service externe.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeocodeResult extends GeoPoint {
  formattedAddress: string;
  placeId?: string;
}

export interface AutocompleteSuggestion {
  placeId: string;
  description: string;
}

export interface RouteRequest {
  origin: GeoPoint;
  destination: GeoPoint;
  waypoints?: GeoPoint[];
  /** Heure de prise en charge : la durée tient compte du trafic prévu à cette heure (D33). */
  departureTime?: Date;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Péages sur l'itinéraire, en cents, si le fournisseur les renvoie (D33). */
  tollsCents: number;
  polyline?: string;
}

export interface MapsProvider {
  readonly name: string;
  geocode(address: string): Promise<GeocodeResult>;
  reverseGeocode(point: GeoPoint): Promise<GeocodeResult>;
  autocomplete(input: string, sessionToken?: string): Promise<AutocompleteSuggestion[]>;
  route(request: RouteRequest): Promise<RouteResult>;
  /** Temps d'arrivée estimé (secondes) de chaque origine vers la destination. */
  etaMatrix(origins: GeoPoint[], destination: GeoPoint): Promise<number[]>;
}

export interface PaymentAuthorization {
  intentId: string;
  status: 'requires_action' | 'authorized' | 'captured' | 'canceled' | 'failed';
  clientSecret?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createCustomer(input: { externalId: string; email?: string; phone?: string }): Promise<{ customerRef: string }>;
  createSetupIntent(customerRef: string): Promise<{ setupIntentId: string; clientSecret: string }>;
  authorize(input: { amountCents: number; currency: 'CAD'; customerRef: string; paymentMethodRef: string; idempotencyKey: string; metadata?: Record<string, string> }): Promise<PaymentAuthorization>;
  capture(intentId: string, amountCents: number, idempotencyKey: string): Promise<PaymentAuthorization>;
  cancel(intentId: string): Promise<void>;
  refund(input: { intentId: string; amountCents: number; idempotencyKey: string; reason?: string }): Promise<{ refundId: string }>;
  chargeOffSession(input: { amountCents: number; customerRef: string; paymentMethodRef: string; idempotencyKey: string; description: string }): Promise<PaymentAuthorization>;
  /** Vérifie la signature d'un webhook et renvoie l'événement typé ; lance une erreur si la signature est invalide. */
  verifyWebhook(rawBody: string | Buffer, signature: string): Promise<{ id: string; type: string; data: unknown }>;
}

export interface SmsProvider {
  readonly name: string;
  send(input: { to: string; body: string; idempotencyKey?: string }): Promise<{ messageId: string }>;
}

export interface EmailProvider {
  readonly name: string;
  send(input: { to: string; subject: string; html: string; text?: string; attachments?: Array<{ filename: string; content: Buffer; contentType: string }> }): Promise<{ messageId: string }>;
}

export interface PushProvider {
  readonly name: string;
  send(input: { tokens: string[]; title: string; body: string; data?: Record<string, string>; sound?: boolean }): Promise<{ tickets: Array<{ token: string; status: 'ok' | 'error'; detail?: string }> }>;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(input: { to: string; text: string }): Promise<{ messageId: string }>;
  verifyWebhook(query: Record<string, string | undefined>): string | null;
  parseInbound(body: unknown): Array<{ from: string; text: string; messageId: string; timestamp: Date }>;
}

export interface VoiceProvider {
  readonly name: string;
  startOutboundCall(input: { to: string; assistantId: string; metadata?: Record<string, string> }): Promise<{ callId: string }>;
  verifyWebhook(rawBody: string | Buffer, signature: string): Promise<{ type: string; payload: unknown }>;
}

export interface SevInvoiceInput {
  invoiceNumber: string;
  supplier: { name: string; gstNumber?: string; qstNumber?: string };
  totalCents: number;
  gstCents: number;
  qstCents: number;
  issuedAt: Date;
  lines: Array<{ label: string; amountCents: number }>;
}

export interface SevProvider {
  readonly name: string;
  transmitInvoice(invoice: SevInvoiceInput): Promise<{ transactionId: string; qrPayload: string }>;
  transmitCancellation(input: { originalTransactionId: string; reason: string }): Promise<{ transactionId: string }>;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmProvider {
  readonly name: string;
  /** Réponse structurée : `jsonSchema` impose un objet JSON conforme ; sans schéma, texte libre. */
  complete(input: { system: string; messages: LlmMessage[]; jsonSchema?: Record<string, unknown>; effort?: 'low' | 'medium' | 'high'; maxTokens?: number }): Promise<{ text: string; json?: unknown; inputTokens: number; outputTokens: number }>;
}

export interface StorageProvider {
  readonly name: string;
  putObject(input: { key: string; body: Buffer; contentType: string }): Promise<{ key: string }>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const MAPS_PROVIDER = Symbol('MAPS_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');
export const SEV_PROVIDER = Symbol('SEV_PROVIDER');
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
