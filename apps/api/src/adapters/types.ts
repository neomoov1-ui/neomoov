/**
 * Interfaces des dix fournisseurs externes (CLAUDE.md, section « Fournisseurs et adaptateurs »). Chaque interface a une
 * implémentation simulée (`mock/`) et une implémentation réelle (`real/`), choisies par variable d'environnement.
 * Les signatures s'étoffent étape par étape ; elles restent la seule façon d'atteindre un service externe.
 */
import type { AgentEffort, LlmUsage } from '@neomoov/domain';
import type { z } from 'zod';
import { AppError } from '../common/app-error.js';

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

/**
 * Événement de webhook vérifié, dans le vocabulaire interne des paiements (celui de Stripe : `payment_intent.succeeded`,
 * `refund.updated`, `payment_method.detached`…) : `data.object` est l'objet concerné (PaymentIntent, compte, transfert,
 * litige…). Un autre fournisseur (Square) traduit ses événements dans ce vocabulaire et garde l'original dans `raw`.
 */
export interface WebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  /** Événement d'origine quand il a été traduit (Square), gardé dans `webhook_events.payload` pour le support. */
  raw?: unknown;
}

/** Ce qu'un fournisseur de paiement sait faire (étape 26) : le service des paiements s'y adapte, jamais au nom du fournisseur. */
export interface PaymentCapabilities {
  /** Carte enregistrée par un SetupIntent confirmé dans l'application (feuille de paiement Stripe). */
  setupIntent: boolean;
  /** Carte enregistrée à partir d'un jeton de carte produit dans une page web (Web Payments SDK de Square). */
  cardToken: boolean;
  /** Versements aux chauffeurs par la plateforme (Stripe Connect) ; sinon, relevés réglés hors plateforme. */
  connect: boolean;
}

/**
 * Paiements (Stripe ou Square en production, simulé ailleurs ; section 5.6, prompt 07, étape 26). Aucune donnée de carte
 * ne transite par l'API : seulement des identifiants du fournisseur. Toute opération financière porte une clé d'idempotence.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly capabilities: PaymentCapabilities;
  createCustomer(input: { externalId: string; email?: string; phone?: string }): Promise<{ customerRef: string }>;
  /** Vrai si cette référence de client a été émise par ce fournisseur (un autre fournisseur en crée une nouvelle). */
  ownsCustomerRef(customerRef: string): boolean;
  createSetupIntent(customerRef: string): Promise<{ setupIntentId: string; clientSecret: string }>;
  /** Relit un SetupIntent confirmé par l'application : la carte vient de Stripe, jamais de l'application. */
  retrieveSetupIntent(setupIntentId: string): Promise<SetupIntentResult>;
  /** Carte enregistrée à partir d'un jeton de carte (Square : `source_id` du Web Payments SDK, jeton de vérification 3-D Secure). */
  saveCard(input: { customerRef: string; sourceId: string; verificationToken?: string; idempotencyKey: string; externalId: string }): Promise<CardDetails>;
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
  /** Texto reçu sur le numéro de Neomoov (réponse d'un tiers au relais de la messagerie). */
  parseInbound(params: Record<string, string>): { from: string; to: string; body: string; messageId: string } | null;
}

export interface EmailProvider {
  readonly name: string;
  /**
   * `from` (« Nom <adresse> ») : expéditeur de la marque d'une organisation (étape 22) ; sinon `EMAIL_FROM`. Boîte unifiée :
   * `replyTo` et `headers` (`In-Reply-To`, `References`) gardent la réponse dans le fil du courriel reçu.
   */
  send(input: { to: string; from?: string; replyTo?: string; subject: string; html: string; text?: string; headers?: Record<string, string>; attachments?: Array<{ filename: string; content: Buffer; contentType: string }>; idempotencyKey?: string }): Promise<{ messageId: string }>;
}

// --- Boîte de réception unifiée (phase 1 autonome, 2 octobre 2026) ----------------------------------------------------

/** Courriel reçu sur contact@, tel que le relais entrant (Brevo) ou la lecture IMAP le livrent, avant tout nettoyage. */
export interface InboundEmail {
  /** `Message-ID` du courriel (chevrons admis) ; absent chez certains expéditeurs. */
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Expéditeur brut (« Nom <adresse> » ou adresse). */
  from: string;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  /** Pièces jointes listées (nom, type, taille) : jamais téléchargées ni transmises au modèle. */
  attachments: Array<{ name: string; contentType: string | null; size: number | null }>;
  /** En-têtes utiles à la détection des courriels automatiques (noms en minuscules ou non). */
  headers: Record<string, string>;
  receivedAt: Date;
}

/**
 * Boîte aux lettres (IMAP) : repli du relais entrant. `fetchUnseen` rend les courriels non lus (bornés) et les marque lus ;
 * un courriel déjà traité est reconnu ensuite par son `Message-ID` (idempotence de la conversation).
 */
export interface MailboxProvider {
  readonly name: string;
  fetchUnseen(limit?: number): Promise<InboundEmail[]>;
}

/** Message privé reçu d'une personne sur un réseau (Messenger, Instagram). */
export interface SocialInboundMessage {
  network: 'messenger' | 'instagram';
  /** Identifiant de la personne chez le réseau (PSID, IGSID) : sert à répondre. */
  senderId: string;
  senderName: string | null;
  messageId: string;
  text: string;
  receivedAt: Date;
}

/** Commentaire public reçu sous une publication (Facebook, Instagram). */
export interface SocialInboundComment {
  network: 'facebook' | 'instagram';
  commentId: string;
  postId: string | null;
  authorId: string;
  authorName: string | null;
  text: string;
  receivedAt: Date;
}

/**
 * Réseaux sociaux (Meta en production : Messenger, Facebook, Instagram ; simulé ailleurs). Les webhooks arrivent sur
 * `/v1/webhooks/meta` (même application et même secret que WhatsApp) ; `listInbound` et `listComments` servent de
 * rattrapage par interrogation. Les réseaux sans connecteur (YouTube, TikTok, X, Google, LinkedIn, Snapchat) passent par
 * le relais humain de My Hub, jamais par cette interface.
 */
export interface SocialProvider {
  readonly name: string;
  /** Vérification de l'abonnement au webhook (défi de Meta) : même jeton que WhatsApp. */
  verifyWebhook(query: Record<string, string | undefined>): string | null;
  /** Signature `X-Hub-Signature-256` du corps brut. */
  verifySignature(rawBody: string | Buffer, header: string | undefined): boolean;
  /** Messages et commentaires d'un webhook (`object` page ou instagram) ; les messages de la page elle-même sont ignorés. */
  parseWebhook(body: unknown): { messages: SocialInboundMessage[]; comments: SocialInboundComment[] };
  listInbound(since: Date): Promise<SocialInboundMessage[]>;
  listComments(since: Date): Promise<SocialInboundComment[]>;
  reply(input: { network: 'messenger' | 'instagram'; threadId: string; text: string }): Promise<{ messageId: string }>;
  replyComment(input: { network: 'facebook' | 'instagram'; commentId: string; text: string }): Promise<{ messageId: string }>;
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

/** Analyse antivirus d'un fichier téléversé (documents des chauffeurs). */
export interface ScanResult {
  clean: boolean;
  /** Nom de la signature détectée, sinon null. */
  signature: string | null;
}

export interface VirusScanner {
  readonly name: string;
  scan(input: { body: Buffer; filename?: string }): Promise<ScanResult>;
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
export const VIRUS_SCANNER = Symbol('VIRUS_SCANNER');
export const MAILBOX_PROVIDER = Symbol('MAILBOX_PROVIDER');
export const SOCIAL_PROVIDER = Symbol('SOCIAL_PROVIDER');

// --- CRM (étape 25, amendement v1.2 section 9) --------------------------------------------------------------------

/** Consentement attaché à toute donnée envoyée au CRM (Loi 25) : sans consentement donné, rien ne part. */
export interface CrmConsent {
  given: boolean;
  /** Date du consentement (formulaire) ou du contrat (compte d'affaires, organisation). */
  at: Date | null;
  source: 'form' | 'contract';
}

/** Refus commun aux adaptateurs, simulé comme réel : aucune donnée ne part sans consentement. */
export function requireCrmConsent(consent: CrmConsent): void {
  if (!consent.given) throw new AppError('CRM_CONSENT_REQUIRED', 'Aucune donnée n\'est envoyée au CRM sans consentement', 422);
}

/** Parcours commerciaux : ventes B2B (entreprises, marque blanche, flotte) et Formation chauffeurs. */
export type CrmPipeline = 'b2b' | 'training';
export type CrmLeadKind = 'driver' | 'business' | 'partner' | 'training';

/** Contact : identité, coordonnées, statuts et consentement. Jamais de trajet, d'adresse personnelle ni de paiement. */
export interface CrmContactInput {
  /** Identifiant Neomoov de la fiche (`lead:<id>`, `business_account:<id>`) : clé d'idempotence chez le fournisseur. */
  platformId: string;
  /** Identifiant déjà connu chez le fournisseur (`crm_records`), pour une mise à jour directe. */
  externalId?: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  language: 'fr' | 'en' | null;
  /** Ville seulement, jamais une adresse. */
  city?: string | null;
  /** Entité du Groupe NSK (`neomoov`). */
  entity: string;
  /** Origine de la fiche (site web, nom de la clé d'API, My Hub, plateforme). */
  source: string;
  consent: CrmConsent;
  leadKind?: CrmLeadKind | null;
  driverStatus?: 'candidate' | 'documents_pending' | 'validated' | 'active' | 'inactive' | null;
  trainingStatus?: 'preregistered' | 'paid' | 'in_progress' | 'certified' | null;
  affiliationProgram?: 'business' | 'fleet' | 'taxi' | 'white_label' | 'partner' | null;
}

export interface CrmCompanyInput {
  platformId: string;
  externalId?: string | null;
  name: string;
  legalName?: string | null;
  accountType: 'business_account' | 'organization';
  organizationType?: string | null;
  planCode?: string | null;
  entity: string;
  source: string;
  consent: CrmConsent;
}

export interface CrmDealInput {
  platformId: string;
  externalId?: string | null;
  name: string;
  pipeline: CrmPipeline;
  /** Étape du parcours (codes du modèle HubSpot : `new`, `trial`, `active`, `candidate`, `preregistered`…). */
  stage: string;
  /** Montant de la transaction (prix d'une formule), jamais un paiement. */
  amountCents?: number | null;
  contactExternalId?: string | null;
  companyExternalId?: string | null;
  entity: string;
  source: string;
  consent: CrmConsent;
}

export interface CrmNoteInput {
  body: string;
  occurredAt?: Date;
  contactExternalId?: string | null;
  companyExternalId?: string | null;
  dealExternalId?: string | null;
  consent: CrmConsent;
}

export interface CrmUpsertResult {
  id: string;
  created: boolean;
}

/**
 * CRM (HubSpot en production, simulé ailleurs). Chaque méthode porte l'indicateur de consentement et refuse sans lui ;
 * une fiche est identifiée par son identifiant Neomoov (rejouable). Une panne du fournisseur lance une erreur 502
 * `CRM_PROVIDER_ERROR` : la file `crm` relance plus tard.
 */
export interface CrmProvider {
  readonly name: string;
  upsertContact(input: CrmContactInput): Promise<CrmUpsertResult>;
  upsertCompany(input: CrmCompanyInput): Promise<CrmUpsertResult>;
  upsertDeal(input: CrmDealInput): Promise<CrmUpsertResult>;
  addNote(input: CrmNoteInput): Promise<{ id: string }>;
}

export const CRM_PROVIDER = Symbol('CRM_PROVIDER');
