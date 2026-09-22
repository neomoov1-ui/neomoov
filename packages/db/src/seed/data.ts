/**
 * Données de départ (cahier des charges 5.1, 5.7, 5.9 et prompt 02). Montants en cents, taux en ppm, durées en secondes.
 * Les polygones des zones sont approximatifs mais réalistes (longitude, latitude, WGS 84).
 */

import type { GeoPolygon } from '../schema/_helpers.js';

export const CITY = { code: 'montreal', name: 'Montréal', timeZone: 'America/Toronto' } as const;

const ring = (points: [number, number][]): GeoPolygon => ({ type: 'Polygon', coordinates: [[...points, points[0]!]] });

export const ZONES: { code: string; name: string; type: 'service_area' | 'airport' | 'downtown' | 'district'; geometry: GeoPolygon }[] = [
  { code: 'grand-montreal', name: 'Aire de service du Grand Montréal', type: 'service_area', geometry: ring([[-74.05, 45.40], [-73.30, 45.40], [-73.30, 45.72], [-74.05, 45.72]]) },
  { code: 'yul', name: 'Aéroport Montréal-Trudeau', type: 'airport', geometry: ring([[-73.762, 45.458], [-73.725, 45.458], [-73.725, 45.478], [-73.762, 45.478]]) },
  { code: 'centre-ville', name: 'Centre-ville', type: 'downtown', geometry: ring([[-73.585, 45.492], [-73.552, 45.492], [-73.552, 45.512], [-73.585, 45.512]]) },
  { code: 'vieux-montreal', name: 'Vieux-Montréal', type: 'district', geometry: ring([[-73.565, 45.498], [-73.548, 45.498], [-73.548, 45.512], [-73.565, 45.512]]) },
  { code: 'plateau', name: 'Plateau-Mont-Royal', type: 'district', geometry: ring([[-73.600, 45.512], [-73.565, 45.512], [-73.565, 45.535], [-73.600, 45.535]]) },
];

export const VEHICLE_CATEGORIES = [
  { code: 'neo_premium', name: 'Neo Premium', rank: 1, seats: 4, minYear: 2019, allowedModels: ['Tesla Model 3', 'Tesla Model Y', 'Hyundai Ioniq 5', 'Hyundai Ioniq 6', 'Kia EV6', 'Polestar 2'], description: 'Berline ou VUS électrique récent, quatre places.', active: true },
  { code: 'neo_prestige', name: 'Neo Prestige', rank: 2, seats: 4, minYear: 2021, allowedModels: ['Tesla Model S', 'Tesla Model X', 'Mercedes EQE', 'Mercedes EQS', 'BMW i5', 'Audi e-tron GT', 'Lucid Air'], description: 'Haut de gamme, intérieur cuir, silence à bord.', active: true },
  { code: 'neo_xl', name: 'Neo XL', rank: 3, seats: 6, minYear: 2019, allowedModels: ['Kia EV9', 'Volvo EX90', 'Tesla Model X (7 places)'], description: 'Jusqu\'à six passagers et leurs bagages.', active: true },
  { code: 'neo_limo', name: 'Neo Limo', rank: 4, seats: 4, minYear: 2022, allowedModels: [], description: 'Limousine, offerte en V2.', active: false },
] as const;

export const PRICING_RULES = [
  { category: 'neo_premium', baseCents: 375, perKmCents: 170, perMinuteCents: 40, minimumCents: 950 },
  { category: 'neo_prestige', baseCents: 475, perKmCents: 210, perMinuteCents: 50, minimumCents: 1200 },
  { category: 'neo_xl', baseCents: 500, perKmCents: 230, perMinuteCents: 55, minimumCents: 1300 },
] as const;

export const SURCHARGES = [
  { code: 'night', amountCents: 200, perUnit: false, conditions: { from: '23:00', to: '05:00' } },
  { code: 'airport', amountCents: 300, perUnit: false, conditions: { zones: ['yul'] } },
  { code: 'child_seat', amountCents: 300, perUnit: false, conditions: {} },
  { code: 'luggage', amountCents: 200, perUnit: false, conditions: {} },
  { code: 'stop', amountCents: 200, perUnit: true, conditions: { unit: 'stop', maxStops: 3 } },
  { code: 'waiting', amountCents: 50, perUnit: true, conditions: { unit: 'minute', freeSeconds: 300 } },
] as const;

/** Forfaits centre-ville et aéroport, prix total affiché, dans les deux sens. */
export const FLAT_RATES = [
  { code: 'yul-centre-premium', category: 'neo_premium', origin: 'centre-ville', destination: 'yul', totalCents: 5500 },
  { code: 'yul-centre-prestige', category: 'neo_prestige', origin: 'centre-ville', destination: 'yul', totalCents: 6900 },
  { code: 'yul-centre-xl', category: 'neo_xl', origin: 'centre-ville', destination: 'yul', totalCents: 7500 },
] as const;

export const PACKS = [
  { code: 'discovery', name: 'Découverte', ridesIncluded: 10, priceCents: 2900, validityDays: 28, rolloverAllowed: true, priorities: {}, sortOrder: 1 },
  { code: 'essential', name: 'Essentiel', ridesIncluded: 25, priceCents: 5900, validityDays: 28, rolloverAllowed: true, priorities: {}, sortOrder: 2 },
  { code: 'pro', name: 'Pro', ridesIncluded: 50, priceCents: 9900, validityDays: 28, rolloverAllowed: true, priorities: {}, sortOrder: 3 },
  { code: 'elite', name: 'Élite', ridesIncluded: 100, priceCents: 16900, validityDays: 28, rolloverAllowed: true, priorities: {}, sortOrder: 4 },
  { code: 'unlimited', name: 'Illimité', ridesIncluded: null, priceCents: 19900, validityDays: 7, rolloverAllowed: false, priorities: { vipBonus: 5, airportBonus: 5, businessBonus: 5 }, sortOrder: 5 },
] as const;

export const PROMOTIONS = [
  { code: 'BIENVENUE3', name: 'Troisième course offerte (jusqu\'à 10 km)', type: 'nth_ride', value: 3, maxDiscountCents: null, conditions: { maxDistanceMeters: 10_000 }, waivesFees: true, globalLimit: null, perClientLimit: 1, budgetCents: 500_000 },
  { code: 'MERCI10', name: 'Dixième course offerte', type: 'nth_ride', value: 10, maxDiscountCents: null, conditions: {}, waivesFees: true, globalLimit: null, perClientLimit: 1, budgetCents: 500_000 },
  { code: 'LANCEMENT30', name: 'Code de lancement : 30 % sur trois courses', type: 'percent', value: 3000, maxDiscountCents: 1500, conditions: { ridesPerClient: 3, maxClients: 1000 }, waivesFees: false, globalLimit: 3000, perClientLimit: 3, budgetCents: 3_000_000 },
] as const;

/** Paramètres d'exploitation (clé, valeur, description). Lus par les moteurs à chaque calcul. */
export const SETTINGS: { key: string; value: unknown; description: string }[] = [
  { key: 'pricing.service_fee_cents', value: 200, description: 'Frais de service Neomoov par course' },
  { key: 'pricing.regulatory_fee_cents', value: 90, description: 'Redevance gouvernementale par course' },
  { key: 'pricing.gst_rate_ppm', value: 50_000, description: 'TPS, en parties par million (5 %)' },
  { key: 'pricing.qst_rate_ppm', value: 99_750, description: 'TVQ, en parties par million (9,975 %)' },
  { key: 'pricing.flex_multiplier_bps', value: 9000, description: 'Offre Flex : tarif × 0,90 hors pointe' },
  { key: 'pricing.priority_multiplier_bps', value: 11_500, description: 'Option Priorité : tarif × 1,15' },
  { key: 'pricing.favourite_driver_cents', value: 300, description: 'Supplément chauffeur favori, versé en entier au chauffeur' },
  { key: 'pricing.max_extra_allowance_cents', value: 2000, description: 'Prix maximal consenti = prix affiché + 20 $ (D. du 22 septembre 2026)' },
  { key: 'pricing.peak_windows', value: [{ days: [1, 2, 3, 4, 5], from: '06:30', to: '09:30' }, { days: [1, 2, 3, 4, 5], from: '15:30', to: '18:30' }, { days: [5, 6], from: '22:00', to: '02:00' }], description: 'Heures de pointe provisoires (D29), Flex refusée' },
  { key: 'pricing.quote_validity_seconds', value: 300, description: 'Durée de validité d\'un devis' },
  { key: 'rides.free_cancellation_seconds', value: 120, description: 'Annulation client gratuite après l\'attribution' },
  { key: 'rides.cancellation_fee_cents', value: 500, description: 'Frais d\'annulation client, 100 % au chauffeur' },
  { key: 'rides.no_show_fee_cents', value: 700, description: 'Frais de non-présentation, 100 % au chauffeur' },
  { key: 'rides.free_wait_seconds', value: 300, description: 'Attente gratuite au point de rendez-vous' },
  { key: 'rides.wait_per_minute_cents', value: 50, description: 'Attente au-delà du délai gratuit, par minute' },
  { key: 'rides.no_show_min_wait_seconds', value: 300, description: 'Attente minimale avant non-présentation' },
  { key: 'rides.no_show_min_contacts', value: 2, description: 'Tentatives de contact avant non-présentation' },
  { key: 'rides.scheduled_min_lead_seconds', value: 1800, description: 'Réservation planifiée : au moins 30 minutes avant' },
  { key: 'rides.scheduled_max_lead_days', value: 30, description: 'Réservation planifiée : au plus 30 jours avant' },
  { key: 'rides.scheduled_assign_before_seconds', value: 3600, description: 'Attribution des planifiées 60 minutes avant' },
  { key: 'rides.scheduled_reassign_before_seconds', value: 1800, description: 'Réattribution si non confirmée 30 minutes avant' },
  { key: 'dispatch.search_radii_m', value: [2000, 5000, 10_000, null], description: 'Rayons de recherche par vague (null = toute la zone)' },
  { key: 'dispatch.wave_seconds', value: 20, description: 'Durée d\'une vague' },
  { key: 'dispatch.offer_seconds', value: 15, description: 'Durée d\'une offre à un chauffeur' },
  { key: 'dispatch.candidates_per_wave', value: 5, description: 'Candidats par vague' },
  { key: 'dispatch.chain_max_seconds', value: 300, description: 'Enchaînement : fin de course à moins de 5 minutes de l\'origine' },
  { key: 'dispatch.no_movement_seconds', value: 180, description: 'Réattribution si le chauffeur ne bouge pas 3 minutes après l\'attribution' },
  { key: 'dispatch.score_weights', value: { distance: 40, rating: 20, fairness: 15, favourite: 15, zone: 10, unlimitedBonus: 5 }, description: 'Poids du score des candidats (section 5.4)' },
  { key: 'packs.low_threshold', value: 3, description: 'Alerte pack presque épuisé' },
  { key: 'packs.rollover_window_days', value: 7, description: 'Report des courses restantes dans les 7 jours' },
  { key: 'packs.discovery_free_first_drivers', value: 100, description: 'Découverte offert aux 100 premiers chauffeurs' },
  { key: 'settlement.negative_balance_threshold_cents', value: 15_000, description: 'Suspension automatique au-delà de 150 $ de solde négatif' },
  { key: 'settlement.unpaid_grace_days', value: 7, description: 'Suspension après 7 jours d\'impayé' },
  { key: 'settlement.generation_day', value: 5, description: 'Relevés générés le vendredi (5)' },
  { key: 'settlement.generation_hour', value: 6, description: 'Heure locale de génération des relevés' },
  { key: 'sanctions.driver_cancellation_threshold', value: 3, description: 'Annulations chauffeur après en_route par semaine avant avertissement' },
  { key: 'sanctions.rating_threshold', value: 4.6, description: 'Note moyenne sous laquelle un entretien est déclenché' },
  { key: 'retention.driver_locations_days', value: 90, description: 'Conservation des positions en clair' },
  { key: 'notifications.quiet_hours', value: { from: '22:00', to: '07:00' }, description: 'Heures silencieuses hors course en cours' },
  { key: 'agents.auto_after_weeks', value: 4, description: 'Passage en automatique après quatre semaines sans erreur, sur décision du fondateur' },
];

export const AGENTS = [
  { code: 'customer_relations', name: 'Relation client (application, web, WhatsApp)', mode: 'approval', effort: 'low', tools: ['lookupRide', 'lookupClient', 'issueCredit', 'refund', 'openIncident', 'escalateToHuman', 'sendMessage'], thresholds: { maxAutoRefundCents: 5000, maxAutoCreditCents: 5000 } },
  { code: 'driver_recruitment', name: 'Recrutement chauffeurs (vérification documentaire)', mode: 'approval', effort: 'high', tools: ['extractDocumentFields', 'compareIdentity', 'proposeDecision'], thresholds: { finalValidation: 'human' } },
  { code: 'accounting', name: 'Comptabilité (contrôle des relevés)', mode: 'approval', effort: 'high', tools: ['listStatementLines', 'flagAnomaly'], thresholds: { unexplainedVarianceCents: 100 } },
  { code: 'analytics', name: 'Analyse et rapports', mode: 'auto', effort: 'high', tools: ['queryMetrics'], thresholds: {} },
  { code: 'voice_call_center', name: 'Centre d\'appels vocal (Vapi)', mode: 'auto', effort: 'low', tools: ['quote', 'createRide', 'rideStatus', 'cancelRide', 'transferToHuman'], thresholds: { transferOnDistress: true } },
] as const;

export const FEATURE_FLAGS = [
  { code: 'negotiation', active: false, description: 'Négociation encadrée (V1.1, après avis juridique)' },
  { code: 'face_check', active: false, description: 'Vérification faciale des chauffeurs (V1.1)' },
  { code: 'scheduled_flight_tracking', active: false, description: 'Suivi de vol pour les réservations planifiées (V2)' },
  { code: 'flex_offer', active: true, description: 'Offre Flex' },
  { code: 'priority_option', active: true, description: 'Option Priorité' },
  { code: 'direct_payment', active: true, description: 'Paiement direct (espèces, Interac, terminal)' },
  { code: 'whatsapp', active: true, description: 'Entrée WhatsApp' },
  { code: 'voice_agent', active: true, description: 'Agent vocal Vapi' },
] as const;

/** Utilisateurs de démonstration : numéros fictifs (+1 514 555 01xx), aucun compte réel. */
export const DEMO_USERS = {
  admin: { phone: '+15145550100', email: 'admin@neomoov.local', firstName: 'Admin', lastName: 'Neomoov', role: 'admin' },
  operator: { phone: '+15145550101', email: 'ops@neomoov.local', firstName: 'Opérateur', lastName: 'De jour', role: 'operator' },
  drivers: [
    { phone: '+15145550110', email: 'samuel.t@neomoov.local', firstName: 'Samuel', lastName: 'Tremblay', vehicle: { category: 'neo_premium', make: 'Tesla', model: 'Model 3', year: 2024, colour: 'blanche', plate: 'N52 KTB', seats: 4 } },
    { phone: '+15145550111', email: 'lea.f@neomoov.local', firstName: 'Léa', lastName: 'Fortin', vehicle: { category: 'neo_prestige', make: 'Tesla', model: 'Model X', year: 2023, colour: 'blanche', plate: 'L20 FGA', seats: 4 } },
    { phone: '+15145550112', email: 'karim.d@neomoov.local', firstName: 'Karim', lastName: 'Diallo', vehicle: { category: 'neo_xl', make: 'Kia', model: 'EV9', year: 2025, colour: 'grise', plate: 'P81 RNM', seats: 6 } },
  ],
  clients: [
    { phone: '+15145550120', firstName: 'Sophie', lastName: 'Martin' },
    { phone: '+15145550121', firstName: 'Jean-Philippe', lastName: 'Roy' },
    { phone: '+15145550122', firstName: 'Amina', lastName: 'Khelifi' },
    { phone: '+15145550123', firstName: 'Marc', lastName: 'Tremblay' },
    { phone: '+15145550124', firstName: 'Élodie', lastName: 'Bergeron' },
  ],
} as const;
