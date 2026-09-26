/**
 * Interfaces des dix fournisseurs externes (CLAUDE.md, section « Fournisseurs et adaptateurs »). Chaque interface a une
 * implémentation simulée (`mock/`) et une implémentation réelle (`real/`), choisies par variable d'environnement.
 * Les signatures s'étoffent étape par étape ; elles restent la seule façon d'atteindre un service externe.
 */
import type { AgentEffort, LlmUsage } from '@neomoov/domain';
import type { z } from 'zod';

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

/** État de livraison d'un texto rapporté par le webhook du fournisseur. */
export interface SmsDeliveryStatus {
  messageId: string;
  status: 'pending' | 'delivered' | 'failed';
  errorCode: string | null;
}

export interface SmsProvider {
  readonly name: string;
  send(input: { to: string; body: string; idempotencyKey?: string }): Promise<{ messageId: string }>;
  /** Signature du webhook de statut (Twilio : `X-Twilio-Signature` sur l'adresse et les paramètres). */
  verifyStatusWebhook(input: { url: string; params: Record<string, string>; signature: string }): boolean;
  parseStatus(params: Record<string, string>): SmsDeliveryStatus | null;
}

export interface EmailProvider {
  readonly name: string;
  send(input: { to: string; subject: string; html: string; text?: string; attachments?: Array<{ filename: string; content: Buffer; contentType: string }>; idempotencyKey?: string }): Promise<{ messageId: string }>;
}

export interface PushTicket {
  token: string;
  status: 'ok' | 'error';
  /** Identifiant du ticket, pour consulter le reçu de livraison plus tard. */
  ticketId?: string;
  /** Motif d'un refus (`DeviceNotRegistered` : appareil à retirer). */
  detail?: string;
}

export interface PushReceipt {
  ticketId: string;
  status: 'ok' | 'error';
  detail?: string;
}

export interface PushProvider {
  readonly name: string;
  send(input: { tokens: string[]; title: string; body: string; data?: Record<string, string>; sound?: boolean }): Promise<{ tickets: PushTicket[] }>;
  receipts(ticketIds: string[]): Promise<PushReceipt[]>;
}

export interface WhatsAppInbound {
  from: string;
  text: string;
  messageId: string;
  timestamp: Date;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(input: { to: string; text: string }): Promise<{ messageId: string }>;
  /** Gabarit approuvé par Meta (obligatoire hors de la fenêtre de 24 heures d'une conversation). */
  sendTemplate(input: { to: string; template: string; language: string; parameters: string[] }): Promise<{ messageId: string }>;
  verifyWebhook(query: Record<string, string | undefined>): string | null;
  /** Signature `X-Hub-Signature-256` du corps brut. */
  verifySignature(rawBody: string | Buffer, header: string | undefined): boolean;
  parseInbound(body: unknown): WhatsAppInbound[];
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

/** Pièce jointe d'un message au modèle : image ou PDF (vision sur un document de chauffeur), en base64. */
export interface LlmAttachment {
  kind: 'image' | 'pdf';
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  dataBase64: string;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: LlmAttachment[];
}

/** Paramètres communs d'une requête d'agent : modèle et effort de l'agent (en base), prompt système mis en cache. */
export interface LlmCallOptions {
  model: string;
  effort: AgentEffort;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
}

/** Décision structurée (classification, montant, proposition) : la sortie est validée par le schéma Zod. */
export interface LlmStructuredRequest<T> extends LlmCallOptions {
  schemaName: string;
  schema: z.ZodType<T>;
}

export interface LlmResultMeta {
  /** Modèle qui a servi la requête (celui de l'agent, ou le modèle de repli du serveur). */
  model: string;
  usage: LlmUsage;
  stopReason: string | null;
}

export interface LlmStructuredResult<T> extends LlmResultMeta {
  output: T;
}

/** Outil d'un agent qui agit : l'entrée est validée par le schéma avant `run` ; le résultat est renvoyé au modèle en JSON. */
export interface LlmTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface LlmToolsRequest extends LlmCallOptions {
  tools: LlmTool[];
  /** Requêtes au modèle au plus (boucle d'outils). */
  maxIterations: number;
}

export interface LlmToolsResult extends LlmResultMeta {
  /** Texte final de l'agent (vide si la boucle s'arrête sur le nombre maximal de requêtes). */
  text: string;
  iterations: number;
}

export type LlmErrorCode = 'refused' | 'invalid_output' | 'truncated' | 'rate_limited' | 'unavailable' | 'authentication' | 'bad_request';

/** Erreur d'un appel au modèle, typée : `retryable` indique qu'une nouvelle tentative de la tâche a un sens. */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmProvider {
  readonly name: string;
  /** Réponse structurée : `jsonSchema` impose un objet JSON conforme ; sans schéma, texte libre (appel simple, hors agents). */
  complete(input: { system: string; messages: LlmMessage[]; jsonSchema?: Record<string, unknown>; effort?: 'low' | 'medium' | 'high'; maxTokens?: number }): Promise<{ text: string; json?: unknown; inputTokens: number; outputTokens: number }>;
  /** Sortie structurée validée par un schéma Zod (décisions des agents). */
  structured<T>(request: LlmStructuredRequest<T>): Promise<LlmStructuredResult<T>>;
  /** Boucle d'outils : le modèle appelle les outils déclarés jusqu'à sa réponse finale. */
  runTools(request: LlmToolsRequest): Promise<LlmToolsResult>;
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
