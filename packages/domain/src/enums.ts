/**
 * Énumérations partagées par l'API, le worker, le web et les applications mobiles.
 * Source : cahier des charges, section 4 (modèle de données) et 5.2 (cycle de vie d'une course).
 * Chaque énumération est un tableau constant (utilisable par Zod et par Drizzle) et son type.
 */

export const RIDE_STATES = [
  'quoted', 'requested', 'offering', 'assigned', 'en_route', 'arrived', 'in_progress', 'completed',
  'rated', 'disputed', 'no_driver', 'cancelled_by_client', 'cancelled_by_driver', 'no_show', 'interrupted',
  /** Devis jamais confirmé (la « expiration » de l'état `quoted` en 5.2). */
  'expired',
] as const;
export type RideState = (typeof RIDE_STATES)[number];

export const RIDE_TYPES = ['immediate', 'scheduled'] as const;
export type RideType = (typeof RIDE_TYPES)[number];

export const USER_ROLES = ['client', 'driver', 'partner', 'investor', 'operator', 'admin', 'agent', 'finance', 'readonly'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Rôles du personnel (My Hub) : connexion par courriel et mot de passe, second facteur obligatoire (prompt 03). */
export const STAFF_ROLES = ['admin', 'operator', 'finance', 'readonly'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const CONSENT_SOURCES = ['app', 'web', 'hub', 'voice', 'system'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const USER_STATUSES = ['active', 'blocked', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const VEHICLE_CATEGORIES = ['neo_premium', 'neo_prestige', 'neo_xl', 'neo_limo'] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

export const PAYMENT_METHODS = ['card_app', 'apple_pay', 'google_pay', 'cash', 'interac', 'terminal'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Moyens que le chauffeur choisit d'accepter (la carte dans l'application est toujours acceptée). */
export const DRIVER_ACCEPTED_METHODS = ['card_app', 'cash', 'interac', 'terminal'] as const;
export type DriverAcceptedMethod = (typeof DRIVER_ACCEPTED_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'authorized', 'captured', 'paid_direct', 'refunded', 'failed', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Nature d'un paiement (étape 7) : la course, le pourboire (paiement séparé), des frais, le règlement d'un solde dû. */
export const PAYMENT_KINDS = ['ride', 'tip', 'cancellation_fee', 'no_show_fee', 'balance'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/** Moyens prépayés par carte dans l'application (autorisation Stripe à capture différée). */
export const CARD_METHODS = ['card_app', 'apple_pay', 'google_pay'] as const;

export const COLLECTED_BY = ['platform', 'driver'] as const;
export type CollectedBy = (typeof COLLECTED_BY)[number];

export const DRIVER_STATUSES = ['pending', 'active', 'restricted', 'suspended', 'offboarded'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_QUALIFICATIONS = ['saaq_authorized', 'registered'] as const;
export type DriverQualification = (typeof DRIVER_QUALIFICATIONS)[number];

export const DOCUMENT_TYPES = ['licence', 'training', 'background_check', 'insurance', 'registration', 'mechanical_check', 'profile_photo', 'gst_qst'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const VEHICLE_STATUSES = ['pending', 'active', 'non_compliant', 'retired'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const ZONE_TYPES = ['service_area', 'airport', 'downtown', 'district'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export const SURCHARGE_CODES = ['night', 'airport', 'child_seat', 'luggage', 'stop', 'waiting'] as const;
export type SurchargeCode = (typeof SURCHARGE_CODES)[number];

export const OFFER_TYPES = ['fixed', 'client_proposal', 'driver_counter'] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_STATES = ['sent', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type OfferState = (typeof OFFER_STATES)[number];

export const PACK_CODES = ['discovery', 'essential', 'pro', 'elite', 'unlimited'] as const;
export type PackCode = (typeof PACK_CODES)[number];

/** Le type PackPurchaseStatus est exporté par packs/packs.ts. */
export const PACK_PURCHASE_STATUSES = ['active', 'exhausted', 'expired', 'cancelled'] as const;

export const PACK_BILLING_STATUSES = ['to_bill', 'billed', 'free'] as const;
export type PackBillingStatus = (typeof PACK_BILLING_STATUSES)[number];

export const STATEMENT_STATUSES = ['draft', 'issued', 'paid', 'charged', 'failed'] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export const PROMOTION_TYPES = ['percent', 'fixed', 'free_ride', 'nth_ride'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

/** `driver_pack` : crédit de pack d'un chauffeur (parrainage chauffeur), déduit de ses packs au relevé, jamais d'une course. */
export const CREDIT_ORIGINS = ['referral', 'promotion', 'goodwill', 'guarantee', 'refund', 'driver_pack'] as const;
export type CreditOrigin = (typeof CREDIT_ORIGINS)[number];

export const CONSENT_PURPOSES = ['geolocation', 'marketing', 'audio_recording', 'biometrics', 'data_transfer'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const SEV_STATUSES = ['pending', 'sent', 'acknowledged', 'error'] as const;
export type SevStatus = (typeof SEV_STATUSES)[number];

export const INCIDENT_TYPES = ['sos', 'complaint', 'accident', 'lost_item', 'no_show_dispute', 'model_guarantee', 'privacy', 'payment_failed', 'other'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ['open', 'investigating', 'decided', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const SANCTION_TYPES = ['warning', 'restriction', 'suspension'] as const;
export type SanctionType = (typeof SANCTION_TYPES)[number];

export const DATA_REQUEST_TYPES = ['access', 'rectification', 'deletion', 'portability', 'consent_withdrawal'] as const;
export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];

export const COMPLIANCE_ENTITY_TYPES = ['driver', 'vehicle'] as const;
export type ComplianceEntityType = (typeof COMPLIANCE_ENTITY_TYPES)[number];

export const AGENT_MODES = ['auto', 'approval', 'manual'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export const AGENT_CODES = ['customer_relations', 'driver_recruitment', 'accounting', 'analytics', 'voice_call_center'] as const;
export type AgentCode = (typeof AGENT_CODES)[number];

/** `skipped` : agent en mode manuel ou plafond de dépense atteint, aucun appel au modèle (l'humain prend le relais). */
export const AGENT_RUN_STATUSES = ['running', 'succeeded', 'failed', 'awaiting_approval', 'skipped'] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const APPROVAL_DECISIONS = ['pending', 'approved', 'rejected'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Conversations de l'assistance (agent relation client) : canal d'entrée et état. */
export const CONVERSATION_CHANNELS = ['whatsapp', 'voice', 'web', 'app'] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];
export const CONVERSATION_STATUSES = ['open', 'escalated', 'closed'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['push', 'sms', 'email', 'whatsapp', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const PARTNER_TYPES = ['hotel', 'restaurant', 'mall', 'bar', 'organizer'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const RATING_TAGS = ['punctual', 'smooth_driving', 'clean_car', 'discreet', 'bilingual', 'helpful', 'late', 'detour', 'unsafe', 'dirty', 'rude'] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

export const CANCELLATION_REASONS = ['changed_plans', 'too_long', 'wrong_address', 'driver_not_moving', 'other'] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
