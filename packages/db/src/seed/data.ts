/**
 * Données de départ (cahier des charges 5.1, 5.7, 5.9 et prompt 02). Montants en cents, taux en ppm, durées en secondes.
 * Les polygones des zones sont approximatifs mais réalistes (longitude, latitude, WGS 84).
 */

import { TRAINING_MODULES } from './training.js';
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
  // D8 (fondateur, 26 septembre 2026) : animal de compagnie en cage, Neo XL et Neo Prestige seulement.
  { code: 'pet', amountCents: 500, perUnit: false, conditions: { categories: ['neo_xl', 'neo_prestige'] } },
] as const;

/** Forfaits centre-ville et aéroport, prix total affiché, dans les deux sens. */
export const FLAT_RATES = [
  { code: 'yul-centre-premium', category: 'neo_premium', origin: 'centre-ville', destination: 'yul', totalCents: 4820 },
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
  { code: 'BIENVENUE3', name: 'Troisième course offerte (jusqu\'à 10 km)', type: 'nth_ride', value: 3, maxDiscountCents: null, conditions: { maxDistanceMeters: 10_000, autoApply: true }, waivesFees: true, globalLimit: null, perClientLimit: 1, budgetCents: 500_000 },
  { code: 'MERCI10', name: 'Dixième course offerte', type: 'nth_ride', value: 10, maxDiscountCents: null, conditions: { autoApply: true }, waivesFees: true, globalLimit: null, perClientLimit: 1, budgetCents: 500_000 },
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
  { key: 'pricing.benchmark_margin_ppm', value: 50_000, description: 'D33 : remise d\'alignement si le prix dépasse la référence concurrente × (1 − 5 %)' },
  { key: 'pricing.benchmark_max_age_days', value: 14, description: 'D33 : un relevé concurrentiel de plus de 14 jours est ignoré' },
  { key: 'pricing.negotiation_floor_ppm', value: 700_000, description: 'D34 : proposition client au plus bas 70 % du prix affiché' },
  { key: 'pricing.negotiation_ceiling_ppm', value: 1_300_000, description: 'D34 : contre-offre chauffeur au plus 130 % (derrière FEATURE_NEGOTIATION_ABOVE_MAX)' },
  { key: 'pricing.eta_search_radius_m', value: 10_000, description: 'Rayon de recherche des chauffeurs en ligne pour le temps d\'arrivée estimé d\'un devis' },
  { key: 'pricing.degraded_speed_kmh', value: 30, description: 'Mode dégradé (API Routes indisponible) : vitesse moyenne de l\'estimation interne' },
  { key: 'pricing.degraded_distance_factor_bps', value: 13_000, description: 'Mode dégradé : distance à vol d\'oiseau × 1,3' },
  { key: 'rides.min_lead_seconds', value: 7200, description: 'D32 : toute course est réservée au moins 2 heures avant la prise en charge' },
  { key: 'rides.max_lead_days', value: 90, description: 'Réservation au plus 90 jours à l\'avance (décision D9 du fondateur, 26 septembre 2026)' },
  { key: 'payments.installment_min_cents', value: 15_000, description: 'D36 : paiement échelonné proposé à partir de 150 $' },
  { key: 'referral.client_referrer_cents', value: 1_000, description: 'Parrainage client : crédit du parrain à la première course terminée du filleul (10 $)' },
  { key: 'referral.client_referred_cents', value: 1_000, description: 'Parrainage client : crédit du filleul à sa première course terminée (10 $)' },
  { key: 'referral.driver_referrer_cents', value: 5_000, description: 'Parrainage chauffeur : crédit de pack du parrain après les courses du filleul (50 $)' },
  { key: 'referral.driver_threshold_rides', value: 50, description: 'Parrainage chauffeur : courses terminées du filleul avant la récompense' },
  { key: 'referral.apply_window_days', value: 30, description: 'Délai après l\'inscription pour saisir un code de parrainage (aucune course terminée)' },
  { key: 'referral.link_base_url', value: 'https://neomoov.net/parrainage', description: 'Adresse des liens de parrainage (le code est ajouté à la fin)' },
  { key: 'credits.validity_days', value: 365, description: 'Validité des crédits (12 mois)' },
  { key: 'packs.rluxe_ev_discovery', value: true, description: 'Découverte offert aux locataires R-LuxeEV (5.7)' },
  { key: 'payments.authorization_margin_ppm', value: 150_000, description: 'Marge ajoutée au prix maximal consenti pour l\'autorisation de carte (15 %)' },
  { key: 'payments.authorization_margin_cap_cents', value: 2_000, description: 'Plafond de cette marge (20 $)' },
  { key: 'payments.authorization_lead_days', value: 6, description: 'Autorisation d\'une réservation faite au plus tôt 6 jours avant la prise en charge (une autorisation Stripe expire après 7 jours)' },
  { key: 'payments.capture_attempts', value: 2, description: 'Tentatives de capture avant incident et solde dû' },
  { key: 'payments.webhook_max_attempts', value: 5, description: 'Essais de traitement d\'un webhook de paiement avant abandon' },
  { key: 'payments.apple_pay_merchant_id', value: '', description: 'Identifiant marchand Apple Pay (feuille de paiement native), vide tant qu\'il n\'est pas enregistré' },
  { key: 'rides.tip_max_cents', value: 10_000, description: 'Plafond d\'un pourboire (100 $)' },
  { key: 'rides.free_cancellation_seconds', value: 120, description: 'Annulation client gratuite après l\'attribution' },
  { key: 'rides.cancellation_fee_cents', value: 500, description: 'Frais d\'annulation client, 100 % au chauffeur' },
  { key: 'rides.no_show_fee_cents', value: 700, description: 'Frais de non-présentation, 100 % au chauffeur' },
  { key: 'rides.free_wait_seconds', value: 300, description: 'Attente gratuite au point de rendez-vous' },
  { key: 'rides.wait_per_minute_cents', value: 50, description: 'Attente au-delà du délai gratuit, par minute' },
  { key: 'rides.no_show_min_wait_seconds', value: 300, description: 'Attente minimale avant non-présentation' },
  { key: 'rides.no_show_min_contacts', value: 2, description: 'Tentatives de contact avant non-présentation' },
  { key: 'rides.scheduled_min_lead_seconds', value: 1800, description: 'Réservation planifiée : au moins 30 minutes avant' },
  { key: 'rides.scheduled_max_lead_days', value: 90, description: 'Réservation planifiée : au plus 90 jours avant' },
  { key: 'rides.scheduled_assign_before_seconds', value: 3600, description: 'Attribution des planifiées 60 minutes avant' },
  { key: 'rides.scheduled_reassign_before_seconds', value: 1800, description: 'Réattribution si non confirmée 30 minutes avant' },
  { key: 'alerts.client_cancellations_threshold', value: 3, description: 'Annulations ou absences d\'un client qui déclenchent une alerte à l\'exploitation (5.14)' },
  { key: 'alerts.client_cancellations_window_days', value: 7, description: 'Fenêtre, en jours, du décompte des annulations et absences d\'un client' },
  { key: 'fairness.business_hours', value: { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }, description: 'Charte d\'équité : heures ouvrables du délai de rappel (lundi à vendredi, 9 h à 17 h, heure de Montréal)' },
  { key: 'fairness.callback_business_hours', value: 4, description: 'Charte d\'équité : une personne répond au chauffeur (réponse ou appel) sous 4 heures ouvrables' },
  { key: 'fairness.precautionary_review_hours', value: 24, description: 'Charte d\'équité : une suspension de précaution est réexaminée par une personne sous 24 heures' },
  { key: 'punctuality.enabled', value: false, description: 'Garantie de ponctualité (D10) : désactivée tant que le fondateur n\'a pas validé les montants proposés le 26 septembre 2026' },
  { key: 'punctuality.rules', value: { tiers: [{ minMinutes: 10, creditCents: 500 }, { minMinutes: 20, creditCents: 1000 }], refundAfterMinutes: 30 }, description: 'Garantie de ponctualité (D10) : 5 $ de 10 à 20 minutes de retard, 10 $ de 20 à 30 minutes, course remboursée en crédit au-delà' },
  { key: 'quality.rating_window', value: 100, description: 'Note du chauffeur : les 100 dernières courses notées qui comptent (Charte d\'équité, 26 septembre 2026)' },
  { key: 'pricing.benchmark_below_cents', value: 100, description: 'Veille prix : au moins 1 $ sous le concurrent le moins cher (décision du fondateur, 26 septembre 2026)' },
  { key: 'rides.airport_free_cancellation_before_seconds', value: 3600, description: 'Transfert aéroport : annulation gratuite jusqu\'à 1 heure avant l\'heure prévue (décision D3 du fondateur, 26 septembre 2026)' },
  { key: 'rides.scheduled_driver_reminder_before_seconds', value: 5400, description: 'Rappel au chauffeur 90 minutes avant une réservation (matrice 5.14)' },
  { key: 'rides.scheduled_reminder_before_seconds', value: 86_400, description: 'Rappel la veille (J-1) pour les courses à plus de 24 heures' },
  { key: 'rides.share_link_ttl_hours', value: 24, description: 'Validité du lien public de suivi d\'une course' },
  { key: 'drivers.required_documents', value: ['licence', 'insurance', 'registration'], description: 'Documents approuvés et non expirés exigés pour passer en ligne' },
  { key: 'drivers.require_active_pack', value: false, description: 'Exiger un pack actif pour passer en ligne (activé à l\'étape 8, packs)' },
  // Espace chauffeur (prompt 11) : inscription, documents, formation, tableau de conduite.
  { key: 'drivers.onboarding_documents', value: ['profile_photo', 'licence', 'training', 'background_check', 'insurance', 'registration', 'mechanical_check'], description: 'Documents demandés à l\'inscription, dans l\'ordre de l\'assistant' },
  { key: 'drivers.expiring_documents', value: ['licence', 'training', 'background_check', 'insurance', 'registration', 'mechanical_check'], description: 'Documents qui portent une date d\'échéance (exigée au dépôt)' },
  { key: 'drivers.document_reminder_days', value: [30, 7, 1], description: 'Rappels avant l\'échéance d\'un document (J-30, J-7, J-1)' },
  { key: 'drivers.require_training', value: true, description: 'Attestation de la formation Neomoov exigée pour passer en ligne' },
  { key: 'drivers.require_payout_account', value: false, description: 'Compte de versement Stripe Connect exigé pour passer en ligne (activé avec l\'étape 7)' },
  { key: 'drivers.max_document_bytes', value: 10_485_760, description: 'Taille maximale d\'un document téléversé (10 Mo)' },
  { key: 'training.pass_score_pct', value: 80, description: 'Score minimal pour réussir le quiz d\'un module de formation' },
  { key: 'training.modules', value: TRAINING_MODULES, description: 'Modules de la formation Neomoov (contenu bilingue, quiz corrigé par l\'API)' },
  { key: 'driving.thresholds', value: { harshAccelerationMps2: 2.5, harshBrakingMps2: 3, minGapSeconds: 1, maxGapSeconds: 10 }, description: 'Accélération et freinage brusques : moyenne sur l\'intervalle entre deux positions (m/s²)' },
  { key: 'driving.score_targets', value: { minRating: 4.6, restrictionRating: 4.4, minPunctualityPct: 90, maxCancellations: 2, maxHarshPer100Km: 2 }, description: 'Objectifs du tableau de conduite (5.11 : note minimale 4,60, restriction sous 4,40)' },
  { key: 'driving.score_period_days', value: 30, description: 'Période glissante du tableau de conduite' },
  { key: 'driving.punctuality_tolerance_seconds', value: 120, description: 'Arrivée sur place jugée ponctuelle jusqu\'à 2 minutes après l\'heure de prise en charge' },
  { key: 'presence.expiry_seconds', value: 60, description: 'Présence d\'un chauffeur expirée sans position depuis ce délai' },
  { key: 'presence.location_batch_ms', value: 2000, description: 'Écriture par lots des positions dans driver_locations' },
  { key: 'presence.min_distance_meters', value: 50, description: "Position ignorée si le déplacement est inférieur et que l'intervalle minimal n'est pas écoulé" },
  { key: 'presence.min_interval_seconds', value: 5, description: 'Intervalle minimal entre deux positions rapprochées' },
  { key: 'dispatch.search_radii_m', value: [2000, 5000, 10_000, null], description: 'Rayons de recherche par vague (null = toute la zone)' },
  { key: 'dispatch.wave_seconds', value: 20, description: 'Durée d\'une vague' },
  { key: 'dispatch.offer_seconds', value: 15, description: 'Durée d\'une offre à un chauffeur' },
  { key: 'dispatch.candidates_per_wave', value: 5, description: 'Candidats par vague' },
  { key: 'dispatch.chain_max_seconds', value: 300, description: 'Enchaînement : fin de course à moins de 5 minutes de l\'origine' },
  { key: 'dispatch.no_movement_seconds', value: 180, description: 'Réattribution si le chauffeur ne bouge pas 3 minutes après l\'attribution' },
  { key: 'dispatch.no_movement_meters', value: 50, description: 'Déplacement minimal attendu après l\'attribution (mètres)' },
  { key: 'dispatch.score_weights', value: { eta: 0.55, rating: 0.2, fairness: 0.15, zone: 0.1, favouriteBonus: 100, otherFavouriteBonus: 50, unlimitedBonus: 5, fairnessDecayMinutes: 20 }, description: 'Poids de la formule du score (section 5.4) : 0,55 × ETA + 0,20 × (5 − note) × 4 + 0,15 × équité + 0,10 × zone, moins les bonus' },
  { key: 'dispatch.eta_candidates', value: 10, description: 'Nombre de candidats (les plus proches) dont le temps d\'arrivée est demandé à la matrice' },
  { key: 'dispatch.fallback_speed_mps', value: 8, description: 'Vitesse moyenne (m/s) pour estimer un temps d\'arrivée sans matrice' },
  { key: 'dispatch.empty_sweeps_max', value: 3, description: 'Balayages complets de la zone sans aucun candidat avant de passer la course en « aucun chauffeur »' },
  { key: 'rides.vehicle_mismatch_window_hours', value: 24, description: 'Délai après la fin de course pour signaler un véhicule non conforme (garantie modèle, 5.2)' },
  { key: 'dispatch.scheduled_window_seconds', value: 600, description: 'D40 : fenêtre d\'offres d\'une réservation planifiée (10 minutes), diffusée aux chauffeurs disponibles sur le créneau' },
  { key: 'dispatch.scheduled_candidates_max', value: 20, description: 'Chauffeurs sollicités en même temps pour une réservation planifiée' },
  { key: 'dispatch.favourite_exclusive_seconds', value: 120, description: 'D37 : le chauffeur favori reçoit l\'offre seul pendant ce délai avant les autres' },
  { key: 'favorites.min_rating', value: 4, description: '5.10 : note minimale d\'une course terminée pour ajouter son chauffeur aux favoris' },
  { key: 'dispatch.scheduled_conflict_minutes', value: 90, description: 'Un chauffeur déjà attribué à une planifiée à moins de ce délai n\'est pas candidat' },
  { key: 'dispatch.requested_sweep_seconds', value: 30, description: 'Revue du 2 octobre 2026 : course demandée depuis plus de ce délai sans répartition ouverte (tâche perdue, chauffeur retiré sans relance) : relancée par le balayage du battement' },
  { key: 'negotiation.window_seconds', value: 600, description: 'D34 : fenêtre de négociation d\'une réservation (10 minutes), puis repli au prix affiché' },
  { key: 'negotiation.immediate_window_seconds', value: 60, description: 'Fenêtre de négociation d\'une course immédiate (60 secondes)' },
  { key: 'negotiation.candidates', value: 5, description: 'Chauffeurs qui reçoivent la proposition du client en même temps' },
  { key: 'packs.low_threshold', value: 3, description: 'Alerte pack presque épuisé' },
  { key: 'packs.rollover_window_days', value: 7, description: 'Report des courses restantes dans les 7 jours' },
  { key: 'packs.discovery_free_first_drivers', value: 100, description: 'Découverte offert aux 100 premiers chauffeurs' },
  { key: 'settlement.negative_balance_threshold_cents', value: 15_000, description: 'Suspension automatique au-delà de 150 $ de solde négatif' },
  { key: 'settlement.unpaid_grace_days', value: 7, description: 'Suspension après 7 jours d\'impayé' },
  { key: 'settlement.generation_day', value: 5, description: 'Relevés générés le vendredi (5)' },
  { key: 'settlement.generation_hour', value: 6, description: 'Heure locale de génération des relevés' },
  { key: 'settlement.retry_weekday', value: 1, description: 'Nouvelle tentative des prélèvements échoués le lundi (1)' },
  { key: 'company.legal_name', value: 'Neomoov', description: 'Raison sociale de Neomoov sur les factures (frais de service), à confirmer avec le comptable' },
  { key: 'company.address', value: 'Montréal (Québec)', description: 'Adresse de Neomoov sur les factures, à confirmer' },
  { key: 'company.gst_number', value: '', description: 'Numéro de TPS de Neomoov (vide tant que non fourni)' },
  { key: 'company.qst_number', value: '', description: 'Numéro de TVQ de Neomoov (vide tant que non fourni)' },
  { key: 'invoices.legal_notice', value: 'Le transport est fourni et facturé par le chauffeur indiqué ; les frais de service et la redevance sont facturés par Neomoov. Contenu à confirmer avec le fournisseur du SEV certifié et le comptable.', description: '5.13 : mention légale des factures' },
  { key: 'invoices.verification_base_url', value: 'https://neomoov.net/verifier-facture', description: 'Adresse de vérification publique d\'une facture (code QR)' },
  { key: 'invoices.catchup_days', value: 2, description: 'Reprise des factures manquantes (événement perdu) : courses terminées depuis moins de 2 jours' },
  { key: 'sev.retry_delay_seconds', value: 60, description: 'Délai avant de reprendre une transmission au SEV en attente' },
  { key: 'sev.error_retry_seconds', value: 3600, description: 'Délai entre deux reprises automatiques d\'une facture en erreur au SEV' },
  { key: 'alerts.founder_phone', value: '', description: 'Numéro du fondateur appelé par l\'agent vocal en cas de SOS (vide : pas d\'appel)' },
  { key: 'voice.sos_assistant_id', value: '', description: 'Assistant Vapi qui appelle le fondateur en cas de SOS (vide : pas d\'appel)' },
  { key: 'voice.transfer_number', value: '+15145550100', description: 'Numéro vers lequel l\'agent vocal transfère un appel (humain de garde), à remplacer par le vrai numéro' },
  { key: 'quality.thresholds', value: { warningBelow: 4.6, restrictionBelow: 4.4, suspensionBelow: 4.2, minRatings: 10, lateCancellations: 3, seriousIncidents: 3 }, description: 'Sanctions graduées (5.11) : seuils de la note sur 50 courses, nombre minimal de notes, annulations tardives sur 7 jours, incidents graves' },
  { key: 'quality.late_cancellation_minutes', value: 60, description: 'Annulation tardive d\'une planifiée : à moins de 60 minutes de la prise en charge (toujours tardive après le départ du chauffeur ou sur une immédiate)' },
  { key: 'quality.incident_window_days', value: 90, description: 'Fenêtre des incidents graves comptés par l\'agent qualité' },
  { key: 'quality.warning_cooldown_days', value: 30, description: 'Pas de nouvel avertissement qualité avant 30 jours' },
  { key: 'quality.restriction_days', value: 14, description: 'Durée d\'une restriction de qualité (courses VIP et aéroport retirées)' },
  { key: 'quality.suspension_days', value: 7, description: 'Durée d\'une suspension temporaire de qualité ; la radiation reste humaine' },
  { key: 'quality.run_hour', value: 4, description: 'Heure de Montréal de la passe quotidienne de l\'agent qualité' },
  { key: 'watchdog.arrived_minutes', value: 30, description: 'Course « chauffeur arrivé » sans départ ni absence déclarée : alerte après 30 minutes' },
  { key: 'watchdog.en_route_minutes', value: 90, description: 'Chauffeur en route vers le client : alerte après 90 minutes' },
  { key: 'watchdog.in_progress_minutes', value: 240, description: 'Course en cours : alerte après 4 heures' },
  { key: 'watchdog.scheduled_late_minutes', value: 15, description: 'Réservation attribuée dont l\'heure est passée sans départ : alerte après 15 minutes' },
  { key: 'watchdog.searching_minutes', value: 20, description: 'Recherche de chauffeur au-delà de l\'heure demandée : alerte après 20 minutes' },
  { key: 'watchdog.cancelled_by_driver_minutes', value: 2, description: 'Revue du 2 octobre 2026 : course restée « annulée par le chauffeur » sans remise en demande : alerte après 2 minutes' },
  { key: 'notifications.approach_meters', value: 700, description: 'Distance au point de départ qui déclenche « votre chauffeur approche » (environ 2 minutes en ville)' },
  { key: 'sev.max_attempts', value: 5, description: 'Tentatives de transmission au SEV avant erreur visible dans My Hub' },
  { key: 'geolocation_export.format', value: 'csv-v0', description: 'Format provisoire de l\'export mensuel de géolocalisation (à confirmer avec la CTQ)' },
  { key: 'sanctions.driver_cancellation_threshold', value: 3, description: 'Annulations chauffeur après en_route par semaine avant avertissement' },
  { key: 'sanctions.rating_threshold', value: 4.6, description: 'Note moyenne sous laquelle un entretien est déclenché' },
  { key: 'retention.driver_locations_days', value: 90, description: 'Conservation des positions en clair' },
  { key: 'retention.rides_anonymize_months', value: 12, description: 'Courses anonymisées après 12 mois (tiers, adresses, trajet, messages)' },
  { key: 'retention.driver_documents_months', value: 12, description: 'Documents d\'un chauffeur supprimés 12 mois après la fin de la relation' },
  { key: 'retention.audit_log_years', value: 7, description: 'Conservation du journal d\'audit' },
  { key: 'retention.invoices_years', value: 7, description: 'Conservation des factures et notes de crédit' },
  { key: 'notifications.quiet_hours', value: { from: '22:00', to: '07:00' }, description: 'Heures silencieuses hors course en cours' },
  { key: 'agents.auto_after_weeks', value: 4, description: 'Passage en automatique après quatre semaines sans erreur, sur décision du fondateur' },
  // Agents IA (5.16, prompt 13) : dépense, barème, plafonds des outils, rapports. Montants LLM en micro-dollars.
  { key: 'agents.daily_budget_micros', value: 20_000_000, description: 'Plafond quotidien de dépense LLM de l\'ensemble des agents (20 $, heure de Montréal) ; au-delà, l\'agent qui s\'exécute passe en mode manuel' },
  {
    key: 'agents.llm_pricing',
    value: {
      'claude-opus-5-5': { inputMicrosPerMTok: 4_000_000, outputMicrosPerMTok: 20_000_000, cacheReadMicrosPerMTok: 200_000, cacheWriteMicrosPerMTok: 5_000_000 },
      'claude-opus-5': { inputMicrosPerMTok: 5_000_000, outputMicrosPerMTok: 25_000_000, cacheReadMicrosPerMTok: 500_000, cacheWriteMicrosPerMTok: 6_250_000 },
      'claude-opus-4-8': { inputMicrosPerMTok: 5_000_000, outputMicrosPerMTok: 25_000_000, cacheReadMicrosPerMTok: 500_000, cacheWriteMicrosPerMTok: 6_250_000 },
      default: { inputMicrosPerMTok: 5_000_000, outputMicrosPerMTok: 25_000_000, cacheReadMicrosPerMTok: 500_000, cacheWriteMicrosPerMTok: 6_250_000 },
    },
    description: 'Barème Anthropic en micro-dollars par million de jetons (entrée, sortie, lecture et écriture du cache), par modèle ; à vérifier à chaque changement de prix',
  },
  { key: 'agents.max_refund_cents', value: 5_000, description: 'Plafond de l\'outil de remboursement d\'un agent (50 $) ; au-delà, escalade humaine' },
  { key: 'agents.max_credit_cents', value: 5_000, description: 'Plafond de l\'outil de crédit d\'un agent (50 $) ; au-delà, escalade humaine' },
  { key: 'agents.max_tool_iterations', value: 8, description: 'Requêtes au modèle au plus par exécution d\'un agent qui agit (boucle d\'outils)' },
  { key: 'agents.max_output_tokens', value: 16_000, description: 'Jetons de sortie au plus par requête au modèle (raisonnement compris)' },
  { key: 'agents.conversation_history_messages', value: 20, description: 'Messages précédents d\'une conversation transmis à l\'agent relation client' },
  { key: 'agents.report_hour', value: 7, description: 'Heure d\'envoi des rapports de l\'agent d\'analyse (heure de Montréal)' },
  { key: 'agents.report_weekly_weekday', value: 1, description: 'Jour du rapport hebdomadaire (1 = lundi)' },
  { key: 'agents.report_recipients', value: [], description: 'Courriels qui reçoivent les rapports ; vide : les administrateurs de My Hub' },
  { key: 'agents.client_messages_per_hour', value: 30, description: 'Messages d\'un client à l\'assistance par heure (chaque message coûte un appel au modèle)' },
  { key: 'agents.accounting_max_line_cents', value: 50_000, description: 'Contrôle des relevés : une ligne au-delà de ce montant (500 $) est hors bornes' },
  // Identité et sécurité (section 8, prompt 03) : lus par l'API à chaque calcul, jamais codés en dur.
  { key: 'auth.otp_ttl_seconds', value: 300, description: 'Code SMS valable 5 minutes' },
  { key: 'auth.otp_max_attempts', value: 5, description: 'Tentatives de saisie par code' },
  { key: 'auth.otp_resend_seconds', value: 30, description: 'Délai minimal entre deux codes pour un même numéro' },
  { key: 'auth.otp_per_phone_per_hour', value: 5, description: 'Codes par numéro et par heure' },
  { key: 'auth.otp_per_ip_per_hour', value: 20, description: 'Codes par adresse IP et par heure' },
  { key: 'auth.access_token_ttl_seconds', value: 900, description: "Jeton d'accès : 15 minutes" },
  { key: 'auth.refresh_token_ttl_days', value: 30, description: 'Jeton de rafraîchissement : 30 jours, rotation à chaque usage' },
  { key: 'auth.mfa_token_ttl_seconds', value: 300, description: 'Jeton de passage entre mot de passe et second facteur' },
  { key: 'auth.staff_lockout_threshold', value: 5, description: 'Échecs consécutifs avant verrouillage du compte du personnel' },
  { key: 'auth.staff_lockout_minutes', value: 15, description: 'Durée du premier verrouillage, doublée à chaque récidive' },
  { key: 'auth.staff_login_per_email_per_10min', value: 10, description: 'Tentatives de connexion du personnel par courriel et par 10 minutes' },
  { key: 'auth.staff_login_per_ip_per_10min', value: 30, description: 'Tentatives de connexion du personnel par adresse IP et par 10 minutes' },
  { key: 'auth.link_token_ttl_seconds', value: 600, description: 'Jeton de liaison Apple ou Google à un téléphone : 10 minutes' },
  { key: 'ratelimit.per_ip_per_minute', value: 300, description: 'Requêtes par adresse IP et par minute' },
  { key: 'ratelimit.per_user_per_minute', value: 600, description: 'Requêtes par utilisateur et par minute' },
  { key: 'legal.terms_version', value: '2026-09-01', description: "Version des conditions d'utilisation en vigueur" },
  { key: 'support.phone', value: '', description: 'Téléphone de l\'assistance affiché dans les applications (format international, ex. +15145550100) ; vide : masqué' },
  { key: 'support.email', value: '', description: 'Courriel de l\'assistance affiché dans les applications ; vide : masqué' },
  { key: 'legal.privacy_policy_version', value: '2026-09-01', description: 'Version de la politique de confidentialité en vigueur (5.15 : nouvelle version = nouvelle acceptation)' },
  { key: 'privacy.data_request_due_days', value: 30, description: 'Délai de réponse aux demandes de droits (Loi 25 : 30 jours)' },
  { key: 'privacy.export_link_ttl_days', value: 7, description: 'Validité du lien signé vers un export de données' },
  // Étape 22 : marque par organisation.
  { key: 'public.brand_per_ip_per_hour', value: 300, description: 'Marque publique (GET /v1/public/brand) : demandes par adresse IP et par heure (le serveur web, clé de service, n\'est pas limité)' },
  { key: 'email.sender_domains', value: [], description: 'Domaines d\'envoi authentifiés chez le fournisseur de courriels (Resend) en plus de celui d\'EMAIL_FROM : seule une adresse d\'expéditeur de marque sur l\'un d\'eux est employée' },
  // Neomoov Pilote (étape 24) : acceptation automatique des courses Neomoov selon les critères du chauffeur (montants et facteurs proposés, à valider par le fondateur).
  { key: 'pilot.enabled', value: true, description: 'Neomoov Pilote offert aux chauffeurs (interrupteur général) : acceptation automatique des courses Neomoov selon leurs critères, jamais sur une autre plateforme (D1)' },
  { key: 'pilot.grace_seconds', value: 60, description: 'Pilote : délai pendant lequel le chauffeur annule sans frais, sans pénalité ni effet sur son dossier une course acceptée pour lui (proposé : 60 secondes)' },
  { key: 'pilot.multi_app_factor', value: 1.25, description: 'Pilote, mode multi-applications déclaré : seuils minimaux (montant, gain net au kilomètre et à l\'heure) multipliés par ce facteur (proposé : 1,25)' },
  { key: 'pilot.multi_app_response_seconds', value: 30, description: 'Pilote, mode multi-applications : fenêtre de réponse d\'une offre à ce chauffeur, au lieu de dispatch.offer_seconds (proposé : 30 secondes)' },
  { key: 'pilot.watched_zones', value: [], description: 'Pilote : codes des zones dont l\'exclusion par un chauffeur alerte le personnel (surveillance de la discrimination indirecte) ; vide tant que l\'équipe ne les a pas choisies' },
  { key: 'pilot.near_miss_percent', value: 10, description: 'Pilote : un seuil chiffré manqué de moins de 10 % donne un score jaune (le chauffeur décide) plutôt que rouge' },
  { key: 'pilot.departure_buffer_minutes', value: 5, description: 'Agenda du chauffeur : marge ajoutée au trajet pour l\'heure de départ conseillée' },
  { key: 'pilot.departure_alert_minutes', value: 15, description: 'Agenda du chauffeur : alerte de départ 15 minutes avant l\'heure de départ conseillée' },
  // Facturation de la plateforme (étape 25, amendement v1.2 section 8) : relances et suspension progressive des organisations.
  { key: 'billing.reminder_days', value: [3, 7, 14], description: 'Rappels d\'une facture de la plateforme impayée, en jours après l\'échéance' },
  { key: 'billing.read_only_days', value: 30, description: 'Organisation en lecture seule après 30 jours d\'impayé' },
  { key: 'billing.suspended_days', value: 45, description: 'Organisation suspendue après 45 jours d\'impayé, jamais pendant une course (reportée au lendemain)' },
  { key: 'billing.payment_terms_days', value: 0, description: 'Échéance d\'une facture de la plateforme après son émission (0 : payable à réception, prélèvement automatique)' },
  { key: 'billing.run_hour', value: 5, description: 'Heure de Montréal de la passe quotidienne de la facturation de la plateforme (renouvellements, relances, suspensions)' },
  // Direction commerciale automatisée (phase 1 « entreprise autonome », 2 octobre 2026) : prospection B2B, appels sortants, relances, grille entreprise. Valeurs proposées, à valider par le fondateur.
  { key: 'sales.prospecting_days', value: [1, 2, 3, 4, 5], description: 'Jours de la passe de prospection B2B (1 = lundi … 5 = vendredi)' },
  { key: 'sales.prospecting_hour', value: 9, description: 'Heure de Montréal à partir de laquelle la passe quotidienne de prospection s\'exécute' },
  { key: 'sales.daily_new_prospects', value: 20, description: 'Plafond de nouveaux prospects créés par jour à partir des sources ouvertes (Google Places)' },
  { key: 'sales.sources', value: { places: { categories: ['hôtel', 'agence de voyages', 'salle de réception', 'clinique privée', 'école privée', 'siège social'], zones: ['Montréal, QC', 'Laval, QC', 'Longueuil, QC'] }, csv: true, webLeads: true }, description: 'Sources de la prospection : catégories et zones cherchées dans Google Places (adaptateur simulé sans clé), fichiers CSV importés par My Hub, formulaires entreprise et partenaire du site' },
  { key: 'sales.lost_cooldown_days', value: 180, description: 'Repos après un refus : aucune nouvelle relance d\'un prospect perdu avant 6 mois' },
  { key: 'sales.call_hours', value: { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }, description: 'Heures de bureau des appels sortants (jours ouvrables, heure de Montréal)' },
  { key: 'sales.max_calls_per_tick', value: 5, description: 'Appels sortants lancés au plus par passe de la file des ventes (toutes les 5 minutes)' },
  { key: 'sales.call_retries', value: 2, description: 'Nouvelles tentatives d\'appel après une messagerie ou une absence de réponse (le jour ouvrable suivant)' },
  { key: 'sales.record_calls', value: false, description: 'Enregistrement des appels sortants : seulement avec annonce par l\'assistant (consentement journalisé)' },
  { key: 'sales.followup_days', value: [3, 10, 30], description: 'Relances après le premier contact sans réponse : J+3, J+10, J+30, puis clôture' },
  { key: 'sales.followups_hour', value: 8, description: 'Heure de Montréal de la passe quotidienne des relances' },
  { key: 'sales.candidate_followup_after_days', value: 3, description: 'Candidature de chauffeur incomplète (documents manquants) relancée après ce délai' },
  { key: 'sales.meeting_duration_minutes', value: 30, description: 'Durée d\'un rendez-vous commercial posé dans l\'agenda du fondateur' },
  { key: 'sales.meeting_calendar_email', value: '', description: 'Courriel du fondateur invité aux rendez-vous commerciaux (vide : seulement l\'agenda configuré)' },
  { key: 'sales.business_grid', value: { tiers: [{ minMonthlyRides: 1, discountBps: 0 }, { minMonthlyRides: 20, discountBps: 500 }, { minMonthlyRides: 50, discountBps: 1000 }], maxDiscountBps: 1000, paymentTermsDays: 30, maxPaymentTermsDays: 30, validityDays: 30, minMonthlyRides: 1 }, description: 'Grille entreprise PROPOSÉE (à valider) : remise sur le prix affiché par volume mensuel (0 %, 5 % dès 20 courses, 10 % dès 50), plafond 10 %, facture mensuelle à 30 jours, devis valable 30 jours ; au-delà : approbation humaine' },
  { key: 'sales.sequence_by_segment', value: { hotel: 'b2b_hotel', event: 'b2b_event', agency: 'b2b_hotel' }, description: 'Séquence approuvée (docs/sales/sequences.md) par segment ; les autres segments reçoivent b2b_standard' },
];

// Modèle `claude-opus-5-5` (décision du 26 septembre 2026) ; prompt système : `docs/agents/<agent>.v<n>.md`, chargé par les données de départ.
export const AGENTS = [
  { code: 'customer_relations', name: 'Relation client (application, web, WhatsApp)', mode: 'approval', model: 'claude-opus-5-5', effort: 'low', systemPromptKey: 'customer_relations.v1', tools: ['lookupRide', 'lookupClient', 'issueCredit', 'refund', 'openIncident', 'escalateToHuman', 'sendMessage'], thresholds: { maxAutoRefundCents: 5000, maxAutoCreditCents: 5000 } },
  { code: 'driver_recruitment', name: 'Recrutement chauffeurs (vérification documentaire)', mode: 'approval', model: 'claude-opus-5-5', effort: 'high', systemPromptKey: 'driver_recruitment.v1', tools: ['extractDocumentFields', 'compareIdentity', 'proposeDecision'], thresholds: { finalValidation: 'human' } },
  { code: 'accounting', name: 'Comptabilité (contrôle des relevés)', mode: 'approval', model: 'claude-opus-5-5', effort: 'high', systemPromptKey: 'accounting.v1', tools: ['listStatementLines', 'flagAnomaly'], thresholds: { unexplainedVarianceCents: 100 } },
  { code: 'analytics', name: 'Analyse et rapports', mode: 'auto', model: 'claude-opus-5-5', effort: 'high', systemPromptKey: 'analytics.v1', tools: ['queryMetrics'], thresholds: {} },
  { code: 'quality', name: 'Qualité des chauffeurs (sanctions graduées)', mode: 'approval', model: 'claude-opus-5-5', effort: 'low', systemPromptKey: null, tools: ['proposeSanction'], thresholds: { finalSuspension: 'human' } },
  { code: 'voice_call_center', name: 'Centre d\'appels vocal (Vapi)', mode: 'auto', model: 'claude-opus-5-5', effort: 'low', systemPromptKey: null, tools: ['quote', 'createRide', 'rideStatus', 'cancelRide', 'transferToHuman'], thresholds: { transferOnDistress: true } },
  // Direction commerciale automatisée (phase 1 « entreprise autonome », 2 octobre 2026) : mode approbation au départ, passage en automatique après quatre semaines sans erreur.
  { code: 'b2b_prospecting', name: 'Prospection B2B (sources, qualification, séquences)', mode: 'approval', model: 'claude-opus-5-5', effort: 'medium', systemPromptKey: 'b2b_prospecting.v1', tools: ['searchProspects', 'listLeadProspects', 'createProspect', 'qualifyProspect', 'startSequence', 'markDoNotContact'], thresholds: {} },
  { code: 'outbound_calls', name: 'Appels sortants commerciaux (Vapi) et exécution des demandes', mode: 'approval', model: 'claude-opus-5-5', effort: 'low', systemPromptKey: 'outbound_calls.v1', tools: ['scheduleCall', 'scheduleMeeting', 'createBusinessQuote', 'openBusinessAccount', 'markDoNotContact', 'proposeSalesDecision'], thresholds: {} },
  { code: 'followups', name: 'Relances (prospects, devis, candidatures)', mode: 'approval', model: 'claude-opus-5-5', effort: 'low', systemPromptKey: 'followups.v1', tools: ['sendFollowup', 'markDoNotContact'], thresholds: {} },
] as const;

export const FEATURE_FLAGS = [
  { code: 'negotiation', active: false, description: 'Négociation encadrée (V1.1, après avis juridique)' },
  { code: 'face_check', active: false, description: 'Vérification faciale des chauffeurs (V1.1)' },
  { code: 'scheduled_flight_tracking', active: false, description: 'Suivi de vol pour les réservations planifiées (V2)' },
  { code: 'immediate_rides', active: false, description: 'Courses immédiates (D32 : désactivé en V1, préavis de 2 heures)' },
  { code: 'negotiation_above_max', active: false, description: 'Contre-offre chauffeur au-dessus du prix affiché (avis juridique en attente)' },
  { code: 'installments', active: false, description: 'Paiement échelonné au-delà de 150 $ (V1.1)' },
  { code: 'ride_series', active: false, description: 'Lots de courses récurrentes (V1.1)' },
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

/**
 * Formules de la plateforme (étape 25, décision D2 : grille Solo, Pro, Entreprise de l'étude 03, section 5.2). Montants
 * PROPOSÉS au fondateur, à valider (l'étude donne des fourchettes) : Solo 99 $ d'installation et 49 $ par mois ; Pro
 * 1 500 $ et 199 $ par mois, 10 véhicules inclus puis 15 $ par véhicule actif ; Entreprise 3 500 $ et 199 $ plus 12 $ par
 * véhicule actif ; licence annuelle = 10 mois payés pour 12. Taxes en sus. Modules : modules de permissions inclus.
 */
export const PLANS = [
  {
    code: 'solo', name: 'Solo', setupFeeCents: 9_900, monthlyPriceCents: 4_900, annualPriceCents: 49_000, perActiveVehicleCents: 0, includedVehicles: 1,
    modules: ['organization', 'rides', 'clients', 'payments', 'finance', 'reports', 'vehicles'], limits: { vehicles: 1, subOrganizations: 0 },
  },
  {
    code: 'pro', name: 'Pro', setupFeeCents: 150_000, monthlyPriceCents: 19_900, annualPriceCents: 199_000, perActiveVehicleCents: 1_500, includedVehicles: 10,
    modules: ['organization', 'rides', 'clients', 'payments', 'finance', 'reports', 'vehicles', 'dispatch', 'drivers', 'incidents', 'privacy', 'operations'], limits: { subOrganizations: 10 },
  },
  {
    code: 'entreprise', name: 'Entreprise', setupFeeCents: 350_000, monthlyPriceCents: 19_900, annualPriceCents: 199_000, perActiveVehicleCents: 1_200, includedVehicles: 0,
    modules: ['organization', 'rides', 'clients', 'payments', 'finance', 'reports', 'vehicles', 'dispatch', 'drivers', 'incidents', 'privacy', 'operations', 'pricing', 'offers', 'agents'], limits: {},
  },
] as const;
