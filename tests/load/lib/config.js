/**
 * Profils et cibles des tests de charge (section 2.2 du cahier des charges, section 9.1 pour la charge).
 *
 * - `full` : 2 000 sockets chauffeurs qui envoient une position toutes les 5 s (400 positions par seconde) pendant
 *   15 minutes ; 500 demandes de course simultanées avec attribution ; 100 devis par seconde pendant 5 minutes.
 *   Préproduction isolée seulement (jamais la production, jamais la base de développement partagée).
 * - `smoke` : même enchaînement réduit (12 chauffeurs, 3 courses, 2 devis par seconde), moins d'une minute, pour
 *   vérifier les scripts contre une API locale.
 *
 * Chaque valeur se règle par variable (`-e NOM=valeur`) ; `LOAD_SCALE` (0 à 1) réduit le profil complet d'un coup.
 */

export const TARGETS = {
  /** Calcul d'un devis hors appel cartographique : mesuré de bout en bout avec l'adaptateur cartographique simulé. */
  quoteComputeP95Ms: 100,
  /** Devis complet avec itinéraire (adaptateur Google réel). */
  quoteFullP95Ms: 800,
  /** Attribution d'une course immédiate : première offre à un chauffeur. */
  firstOfferP95Ms: 3000,
  /** Diffusion de la position d'un chauffeur au client. */
  locationBroadcastP95Ms: 2000,
  /** Latence de l'API hors services externes (requêtes HTTP et acquittements des sockets). */
  apiP95Ms: 300,
  /** Capacité V1. */
  drivers: 2000,
  positionsPerSecond: 400,
};

const PROFILES = {
  smoke: {
    drivers: 12, positionIntervalS: 2, positionsDurationS: 50,
    rides: 3, ridesStartS: 14, rideFollowS: 30, ridePickupS: 4, rideTripS: 8,
    quotesRate: 2, quotesStartS: 12, quotesDurationS: 15,
  },
  full: {
    drivers: 2000, positionIntervalS: 5, positionsDurationS: 900,
    rides: 500, ridesStartS: 90, rideFollowS: 150, ridePickupS: 20, rideTripS: 40,
    quotesRate: 100, quotesStartS: 240, quotesDurationS: 300,
  },
};

function num(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Variable ${name} invalide : ${raw}`);
  return value;
}

export function loadConfig() {
  const profileName = __ENV.LOAD_PROFILE || 'smoke';
  const base = PROFILES[profileName];
  if (!base) throw new Error(`Profil inconnu : ${profileName} (smoke ou full)`);
  const scale = profileName === 'full' ? num('LOAD_SCALE', 1) : 1;
  if (scale <= 0 || scale > 1) throw new Error('LOAD_SCALE doit être compris entre 0 (exclu) et 1');
  const scaled = (n) => Math.max(1, Math.round(n * scale));
  const config = {
    profile: profileName,
    scale,
    baseUrl: (__ENV.LOAD_BASE_URL || 'http://127.0.0.1:4000').replace(/\/+$/, ''),
    fixtures: __ENV.LOAD_FIXTURES || '',
    maps: __ENV.LOAD_MAPS === 'real' ? 'real' : 'mock',
    rideType: __ENV.LOAD_RIDE_TYPE === 'scheduled' ? 'scheduled' : 'immediate',
    spreadIps: __ENV.LOAD_SPREAD_IPS === '1',
    scenarios: (__ENV.LOAD_SCENARIOS || 'drivers,rides,quotes').split(',').map((s) => s.trim()).filter(Boolean),
    drivers: num('LOAD_DRIVERS', scaled(base.drivers)),
    positionIntervalS: num('LOAD_POSITION_INTERVAL_S', base.positionIntervalS),
    positionsDurationS: num('LOAD_DURATION_S', base.positionsDurationS),
    rides: num('LOAD_RIDES', scaled(base.rides)),
    ridesStartS: num('LOAD_RIDES_START_S', base.ridesStartS),
    rideFollowS: num('LOAD_RIDE_FOLLOW_S', base.rideFollowS),
    ridePickupS: num('LOAD_RIDE_PICKUP_S', base.ridePickupS),
    rideTripS: num('LOAD_RIDE_TRIP_S', base.rideTripS),
    acceptDelayMs: num('LOAD_ACCEPT_DELAY_MS', 400),
    quotesRate: num('LOAD_QUOTES_RATE', scaled(base.quotesRate)),
    quotesStartS: num('LOAD_QUOTES_START_S', base.quotesStartS),
    quotesDurationS: num('LOAD_QUOTES_DURATION_S', base.quotesDurationS),
  };
  return config;
}

/** Montée des chauffeurs (secondes) : une minute au plus, le cinquième de la durée pour un essai court. */
export function rampSeconds(config) {
  return Math.max(1, Math.min(60, Math.round(config.positionsDurationS / 5)));
}

/** Positions attendues sur l'essai : chaque chauffeur en ligne envoie une position par intervalle (montée comptée à moitié). */
export function expectedPositions(config) {
  return Math.max(0, Math.floor((config.drivers * (config.positionsDurationS - rampSeconds(config) / 2 - config.positionIntervalS)) / config.positionIntervalS));
}

/** Requêtes suivies une à une dans le rapport (information, sans seuil propre). */
export const ENDPOINTS = ['quote', 'ride_create', 'ride_get', 'driver_accept', 'driver_depart', 'driver_arrive', 'driver_start', 'driver_complete'];
export const SOCKET_EVENTS = ['status.update', 'location.update', 'ride.subscribe'];

/** Seuils k6 : chaque cible de la section 2.2 devient un seuil qui fait échouer l'essai au-delà. */
export function thresholdsFor(config) {
  const t = {
    // Latence de l'API hors services externes : toutes les requêtes HTTP autres que les devis, et les acquittements des sockets.
    'http_req_duration{kind:api}': [`p(95)<${TARGETS.apiP95Ms}`],
    ws_ack_ms: [`p(95)<${TARGETS.apiP95Ms}`],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  };
  if (config.scenarios.includes('drivers')) {
    t.driver_sockets_opened = [`count>=${Math.floor(config.drivers * 0.99)}`];
    t.socket_connect_ok = ['rate>0.99'];
    t.location_ok = ['rate>0.99'];
    // Débit tenu : au moins 90 % des positions attendues (un envoi par chauffeur et par intervalle, montée comprise).
    t.positions_sent = [`count>=${Math.floor(expectedPositions(config) * 0.9)}`];
  }
  if (config.scenarios.includes('rides')) {
    t.dispatch_first_offer_ms = [`p(95)<${TARGETS.firstOfferP95Ms}`];
    t.ride_assigned = ['rate>0.99'];
    if (config.scenarios.includes('drivers')) t.location_broadcast_ms = [`p(95)<${TARGETS.locationBroadcastP95Ms}`];
  }
  if (config.scenarios.includes('quotes') || config.scenarios.includes('rides')) {
    t.quote_ms = [`p(95)<${config.maps === 'real' ? TARGETS.quoteFullP95Ms : TARGETS.quoteComputeP95Ms}`];
  }
  // Sous-métriques d'information (seuil toujours vrai) : elles apparaissent ainsi dans le résumé, point par point.
  for (const name of ENDPOINTS) t[`http_req_duration{name:${name}}`] = ['max>=0'];
  for (const event of SOCKET_EVENTS) t[`ws_ack_ms{event:${event}}`] = ['max>=0'];
  return t;
}

/** Libellés du rapport : métrique, statistique, cible, lecture. */
export function reportRows(config) {
  const rows = [
    { metric: 'quote_ms', stat: 'p(95)', target: config.maps === 'real' ? TARGETS.quoteFullP95Ms : TARGETS.quoteComputeP95Ms, unit: 'ms', label: config.maps === 'real' ? 'Devis complet avec itinéraire (95e centile)' : 'Calcul d\'un devis, cartographie simulée (95e centile)' },
    { metric: 'dispatch_first_offer_ms', stat: 'p(95)', target: TARGETS.firstOfferP95Ms, unit: 'ms', label: 'Première offre d\'une course immédiate (95e centile)' },
    { metric: 'dispatch_assigned_ms', stat: 'p(95)', target: null, unit: 'ms', label: 'Attribution complète : acceptation du chauffeur (95e centile, information)' },
    { metric: 'location_broadcast_ms', stat: 'p(95)', target: TARGETS.locationBroadcastP95Ms, unit: 'ms', label: 'Position du chauffeur reçue par le client (95e centile)' },
    { metric: 'http_req_duration{kind:api}', stat: 'p(95)', target: TARGETS.apiP95Ms, unit: 'ms', label: 'Latence de l\'API, HTTP hors devis (95e centile)' },
    { metric: 'ws_ack_ms', stat: 'p(95)', target: TARGETS.apiP95Ms, unit: 'ms', label: 'Latence de l\'API, acquittement des sockets (95e centile)' },
    { metric: 'driver_sockets_opened', stat: 'count', target: config.drivers, unit: '', label: `Sockets chauffeurs connectés (cible du profil : ${config.drivers}, V1 : ${TARGETS.drivers})` },
    { metric: 'positions_sent', stat: 'count', target: Math.floor(expectedPositions(config) * 0.9), unit: '', label: `Positions envoyées (90 % des ${expectedPositions(config)} attendues)` },
    { metric: 'positions_sent', stat: 'rate', target: null, unit: '/s', label: `Positions par seconde, moyenne de l'essai montée comprise (régime : ${config.drivers / config.positionIntervalS}/s ; V1 : ${TARGETS.positionsPerSecond}/s)` },
    { metric: 'ride_assigned', stat: 'rate', target: 0.99, unit: '', label: 'Courses attribuées' },
    { metric: 'http_req_failed', stat: 'rate', target: 0.01, unit: '', label: 'Requêtes HTTP en échec (au plus)' },
  ];
  return rows;
}
