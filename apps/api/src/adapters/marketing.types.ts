/**
 * Adaptateurs du marketing automatisé (phase 1 « entreprise autonome », 2 octobre 2026). Un connecteur par espace de
 * diffusion (`SocialPublisher`), un lecteur et éditeur du site (`SiteConnector`, API WordPress), une voix de synthèse
 * (`TtsProvider`) et la Search Console (`SearchConsoleProvider`). Chaque interface a une implémentation simulée
 * (`mock/marketing.mock.ts`) et une implémentation réelle (`real/`), choisies par `MARKETING_PROVIDER` ; en mode réel,
 * un espace sans clés reçoit un connecteur « non configuré » qui refuse clairement (jamais une simulation silencieuse).
 */
import type { ContentFormat, ContentLanguage, ContentSpace, CtaTarget, SearchStat, SitePage } from '@neomoov/domain';

/** Média joint à une publication : fichier lu dans le stockage, et adresse signée pour les réseaux qui le téléchargent eux-mêmes. */
export interface SocialMedia {
  key: string;
  contentType: string;
  body: Buffer;
  url: string | null;
}

export interface SocialPublishInput {
  itemId: string;
  space: ContentSpace;
  format: ContentFormat;
  language: ContentLanguage;
  title: string | null;
  body: string;
  caption: string | null;
  hashtags: string[];
  /** Texte composé pour le réseau (`composeText` du domaine). */
  text: string;
  ctaUrl: string | null;
  /** Cible de l'appel à l'action (bouton RÉSERVER ou EN SAVOIR PLUS de la Fiche Google) ; absente : bouton EN SAVOIR PLUS si une adresse est donnée. */
  cta?: CtaTarget | null;
  media: SocialMedia | null;
  /** Brouillon chez le réseau (WordPress, Brevo) plutôt qu'une publication en ligne. */
  draft: boolean;
}

export interface SocialPublishResult {
  externalId: string;
  url: string | null;
  draft: boolean;
  /** Mention pour le personnel (vidéo gardée privée tant que l'application n'est pas auditée par YouTube ou TikTok). */
  notice?: string | null;
}

/**
 * Erreurs de relais manuel (3 octobre 2026) : l'espace est en mode `manual` (`SOCIAL_MANUAL_RELAY` : Snapchat, chaîne
 * WhatsApp, compte réglé ainsi) ou son approbation est en attente chez le réseau (`SOCIAL_APPROVAL_PENDING` : LinkedIn
 * sans la Community Management API). La diffusion ne relance pas : la publication passe en relais manuel.
 */
export const MANUAL_RELAY_ERRORS: readonly string[] = ['SOCIAL_MANUAL_RELAY', 'SOCIAL_APPROVAL_PENDING'];

export interface SocialMetrics {
  reach: number;
  interactions: number;
  clicks: number;
  collectedAt: Date;
  raw?: Record<string, unknown>;
}

export interface SocialComment {
  externalId: string;
  author: string | null;
  text: string;
  postedAt: Date;
  /** Note sur 5 d'un avis (Fiche Google) : 3 ou moins, jamais de réponse automatique. */
  rating?: number | null;
}

/** État de l'autorisation d'un réseau à jeton OAuth : renouvellement automatique, ou échéance à surveiller par le personnel. */
export interface CredentialStatus {
  /** Jeton de rafraîchissement présent : le jeton d'accès se renouvelle seul. */
  renewable: boolean;
  /** Date avant laquelle le fondateur doit refaire l'autorisation (jeton d'accès sans rafraîchissement, ou jeton de rafraîchissement à durée limitée) ; null : inconnue ou sans limite. */
  renewBy: Date | null;
  /** Échec de l'échange ou de la conservation du jeton (message sans secret) ; null : aucun. */
  problem: string | null;
}

export interface PublishedRef {
  itemId: string;
  externalId: string;
  externalUrl: string | null;
}

/** Connecteur d'un espace : publier, mesurer, lire les commentaires, répondre. Une panne lance une erreur (la file relance). */
export interface SocialPublisher {
  readonly space: ContentSpace;
  readonly name: string;
  /** Clés présentes et connecteur livré ; faux : la publication échoue avec un message clair, le calendrier ignore l'espace. */
  readonly configured: boolean;
  publish(input: SocialPublishInput): Promise<SocialPublishResult>;
  metrics(ref: PublishedRef): Promise<SocialMetrics>;
  comments(ref: PublishedRef, since: Date): Promise<SocialComment[]>;
  replyComment(ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }>;
  /** Réseaux à jeton OAuth : état de l'autorisation, lu une fois par jour pour alerter le personnel avant l'échéance. */
  credentials?(): Promise<CredentialStatus>;
}

export type SocialPublishers = ReadonlyMap<ContentSpace, SocialPublisher>;

export interface SiteMediaItem {
  id: string;
  url: string;
  alt: string | null;
  mimeType: string;
}

/** Site WordPress de neomoov.net : pages et balises (lecture), corrections de balises, brouillons, médiathèque (photos réelles). */
export interface SiteConnector {
  readonly name: string;
  readonly configured: boolean;
  pages(): Promise<SitePage[]>;
  updateSeo(ref: string, patch: { title?: string | null; description?: string | null }): Promise<void>;
  /** Brouillon jamais publié par la plateforme : la mise en ligne reste humaine (ou passe par le calendrier de contenu). */
  createDraft(input: { kind: 'page' | 'post'; title: string; content: string; excerpt?: string | null; category?: string | null }): Promise<{ externalId: string; url: string | null }>;
  mediaLibrary(limit: number): Promise<SiteMediaItem[]>;
}

export interface TtsProvider {
  readonly name: string;
  readonly configured: boolean;
  /** Voix de synthèse : audio WAV (ou MP3 selon le moteur) et durée si connue. */
  synthesize(input: { text: string; language: ContentLanguage }): Promise<{ audio: Buffer; contentType: string; durationSeconds: number | null }>;
}

export interface SearchConsoleProvider {
  readonly name: string;
  readonly configured: boolean;
  /** Lignes clics, impressions, position par requête (et par page si demandé) sur une période de dates locales. */
  query(input: { from: string; to: string; byPage: boolean; rowLimit?: number }): Promise<SearchStat[]>;
}

export const SOCIAL_PUBLISHERS = Symbol('SOCIAL_PUBLISHERS');
export const SITE_CONNECTOR = Symbol('SITE_CONNECTOR');
export const TTS_PROVIDER = Symbol('TTS_PROVIDER');
export const SEARCH_CONSOLE_PROVIDER = Symbol('SEARCH_CONSOLE_PROVIDER');
