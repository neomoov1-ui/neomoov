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
  /** Suggestions d'adresses ; `near` favorise les résultats autour de ce point (position du client). */
  autocomplete(input: string, sessionToken?: string, near?: GeoPoint): Promise<AutocompleteSuggestion[]>;
  /** Adresse et position d'un lieu choisi dans les suggestions (même jeton de session : facturation groupée). */
  placeDetails(placeId: string, sessionToken?: string): Promise<GeocodeResult>;
  route(request: RouteRequest): Promise<RouteResult>;
  /** Temps d'arrivée estimé (secondes) de chaque origine vers la destination. */
  etaMatrix(origins: GeoPoint[], destination: GeoPoint): Promise<number[]>;
}

export interface PaymentAuthorization {
  intentId: string;
  status: 'requires_action' | 'authorized' | 'captured' | 'canceled' | 'failed';
  /** Secret client quand une authentification (3-D Secure) est demandée par la banque. */
  clientSecret?: string;
  /** Code d'échec de la banque ou de Stripe (`card_declined`, `insufficient_funds`…). */
  failureCode?: string;
}

/** Carte enregistrée, telle que Stripe la décrit : jamais le numéro, seulement la marque et les 4 derniers chiffres. */
export interface CardDetails {
  ref: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

export interface SetupIntentResult {
  setupIntentId: string;
  status: 'succeeded' | 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'canceled';
  customerRef: string | null;
  card: CardDetails | null;
}

/** Événement de webhook vérifié : `data.object` est l'objet Stripe concerné (PaymentIntent, compte, transfert, litige…). */
export interface WebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Paiements (Stripe en production, simulé ailleurs ; section 5.6, prompt 07). Aucune donnée de carte ne transite par
 * l'API : seulement des identifiants Stripe. Toute opération financière porte une clé d'idempotence.
 */
export interface PaymentProvider {
  readonly name: string;
  createCustomer(input: { externalId: string; email?: string; phone?: string }): Promise<{ customerRef: string }>;
  createSetupIntent(customerRef: string): Promise<{ setupIntentId: string; clientSecret: string }>;
  /** Relit un SetupIntent confirmé par l'application : la carte vient de Stripe, jamais de l'application. */
  retrieveSetupIntent(setupIntentId: string): Promise<SetupIntentResult>;
  detachPaymentMethod(paymentMethodRef: string): Promise<void>;
  /** Autorisation à capture différée (`capture_method: manual`) sur une carte enregistrée. */
  authorize(input: { amountCents: number; currency: 'CAD'; customerRef: string; paymentMethodRef: string; idempotencyKey: string; metadata?: Record<string, string> }): Promise<PaymentAuthorization>;
  /** Capture (partielle possible) : jamais plus que l'autorisation. */
  capture(intentId: string, amountCents: number, idempotencyKey: string): Promise<PaymentAuthorization>;
  cancel(intentId: string, idempotencyKey?: string): Promise<void>;
  refund(input: { intentId: string; amountCents: number; idempotencyKey: string; reason?: string }): Promise<{ refundId: string; status: 'pending' | 'succeeded' | 'failed' }>;
  /** Paiement hors session sur une méthode enregistrée (pourboire, solde dû, prélèvement d'un chauffeur). */
  chargeOffSession(input: { amountCents: number; customerRef: string; paymentMethodRef: string; idempotencyKey: string; description: string; metadata?: Record<string, string> }): Promise<PaymentAuthorization>;
  /** Vérifie la signature d'un webhook et renvoie l'événement ; lance une erreur si la signature est invalide. */
  verifyWebhook(rawBody: string | Buffer, signature: string): Promise<WebhookEvent>;
  /** Stripe Connect Express (5.6, versements aux chauffeurs) : compte, lien d'inscription hébergé par Stripe, état. */
  createConnectAccount(input: { externalId: string; email?: string; phone?: string }): Promise<{ accountRef: string }>;
  createConnectOnboardingLink(input: { accountRef: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string; expiresAt: Date }>;
  connectAccountStatus(accountRef: string): Promise<{ onboarded: boolean; payoutsEnabled: boolean }>;
  /** Transfert vers un compte connecté (versement du vendredi, étape 9). */
  transfer(input: { accountRef: string; amountCents: number; idempotencyKey: string; description: string }): Promise<{ transferId: string }>;
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

/**
 * Document transmis au système d'enregistrement des ventes (SEV, section 5.13) : facture d'une course, facture de frais
 * d'annulation ou de non-présentation, note de crédit. Contrat de l'adaptateur réel : docs/sev-adapter.md.
 */
export interface SevDocument {
  /** Identifiant de la facture chez Neomoov : clé d'idempotence (une facture rejouée n'est enregistrée qu'une fois). */
  invoiceId: string;
  kind: 'ride' | 'cancellation' | 'no_show' | 'credit_note';
  /** Numéro global (NM-0001841) et numéro séquentiel du fournisseur (le chauffeur). */
  number: string;
  supplierSequence: number;
  issuedAt: Date;
  supplier: { name: string; publicNumber: string; gstNumber: string | null; qstNumber: string | null };
  platform: { name: string; gstNumber: string | null; qstNumber: string | null };
  paymentMethod: string;
  /** Lignes signées ; `party` dit qui facture (chauffeur ou Neomoov). Montants positifs sur une note de crédit. */
  lines: Array<{ code: string; label: string; amountCents: number; party: 'driver' | 'platform' }>;
  gstCents: number;
  qstCents: number;
  tipCents: number;
  totalCents: number;
  /** Note de crédit : facture d'origine et sa transaction au SEV. */
  original: { number: string; transactionId: string } | null;
}

export interface SevReceipt {
  transactionId: string;
  /** `acknowledged` : enregistrée et accusée ; `sent` : reçue, accusé attendu (fournisseur asynchrone). */
  status: 'acknowledged' | 'sent';
  /** Données de code QR imposées par le SEV, s'il y en a (à confirmer avec le fournisseur). */
  qrPayload?: string | null;
  /** Réponse brute utile au support, sans secret. */
  raw?: Record<string, unknown>;
}

/**
 * Facturation certifiée (SEV) : simulée en V1, fournisseur certifié à choisir (docs/sev-adapter.md). Chaque méthode
 * lance une erreur quand l'enregistrement échoue (réseau, refus) : l'appelant la consigne et réessaie plus tard.
 */
export interface SevProvider {
  readonly name: string;
  /** Facture d'une course terminée. */
  registerSale(document: SevDocument): Promise<SevReceipt>;
  /** Facture de frais d'annulation ou de non-présentation. */
  registerCancellation(document: SevDocument): Promise<SevReceipt>;
  /** Note de crédit (remboursement), rattachée à la transaction de la facture d'origine. */
  registerCredit(document: SevDocument): Promise<SevReceipt>;
  healthcheck(): Promise<{ ok: boolean; latencyMs: number | null; detail: string | null }>;
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
  /** Lecture d'un objet privé (visionneuse de documents de My Hub) ; null s'il n'existe pas. */
  getObject(key: string): Promise<{ body: Buffer; contentType: string } | null>;
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
