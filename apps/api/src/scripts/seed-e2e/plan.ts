/**
 * Jeu de données de bout en bout (étape 15, tâche 2) : plan déterministe, sans base ni horloge. Même graine, même
 * ancre, même plan : chauffeurs, clients et courses passées sont tirés d'un générateur pseudo-aléatoire à graine fixe.
 * L'exécution (`runner.ts`) écrit ce plan en base ; ce module ne fait que le calculer (testé à part).
 *
 * Tout est marqué : téléphones à 12 chiffres `+19995…` (les tests en ont 11 : aucune collision possible avec
 * `testPhone()`), courriels `@<domaine du marqueur>`, plaques et numéros de course reconnaissables, clés
 * d'idempotence `<marqueur>-ride-NNNN`.
 */
import type { GeoPoint } from '../../adapters/types.js';

export type SeedCategory = 'neo_premium' | 'neo_prestige' | 'neo_xl';
export type SeedPaymentMethod = 'card_app' | 'apple_pay' | 'cash' | 'interac';
export type SeedOutcome = 'completed' | 'no_show' | 'cancelled_by_client';
export type PlaceArea = 'centre-ville' | 'vieux-montreal' | 'plateau' | 'yul' | 'ailleurs';

/** Marqueur d'un jeu : tout ce qu'il crée le porte, et `--reset` ne retire que cela. */
export interface SeedMarker {
  /** Préfixe des clés d'idempotence des courses. */
  key: string;
  /** `+1999` suivi de 2 chiffres : les téléphones du jeu ont 12 chiffres (`<préfixe><type><5 chiffres>`). */
  phonePrefix: string;
  emailDomain: string;
  /** Début des plaques des véhicules (lettres et chiffres, 5 caractères au plus). */
  plateTag: string;
  /** Lettre (ou deux) insérée dans le numéro public des courses : `NM-AAAA-MM-JJ-<tag>NNN`. */
  rideTag: string;
}

export const SEED_E2E_MARKER: SeedMarker = { key: 'seed-e2e', phonePrefix: '+199955', emailDomain: 'seed-e2e.neomoov.local', plateTag: 'E2E', rideTag: 'E' };

export interface PlanSizes {
  drivers: number;
  clients: number;
  rides: number;
  /** Semaines passées couvertes par les courses (une semaine de relevé chacune). */
  weeks: number;
}

export const DEFAULT_SIZES: PlanSizes = { drivers: 50, clients: 200, rides: 300, weeks: 6 };
export const DEFAULT_SEED = 20_260_926;

export interface Place {
  address: string;
  lat: number;
  lng: number;
  area: PlaceArea;
}

export interface PlannedDriver {
  index: number;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  language: 'fr' | 'en';
  spokenLanguages: string[];
  experienceYears: number;
  acceptsCash: boolean;
  acceptsInterac: boolean;
  vehicle: { category: SeedCategory; make: string; model: string; year: number; colour: string; plate: string; seats: number };
  /** Position de la présence en ligne, dans une zone de service. */
  home: GeoPoint;
  area: PlaceArea;
}

export interface PlannedClient {
  index: number;
  phone: string;
  email: string | null;
  firstName: string;
  lastName: string;
  language: 'fr' | 'en';
}

export interface PlannedRating {
  score: number;
  tags: string[];
  comment: string | null;
  /** Délai entre la fin de course et l'évaluation. */
  afterSeconds: number;
}

export interface PlannedRide {
  index: number;
  key: string;
  /** Jour de prise en charge (heure de Montréal), pour le numéro public. */
  localDay: string;
  publicNumber: string;
  driverIndex: number;
  clientIndex: number;
  category: SeedCategory;
  origin: Place;
  destination: Place;
  distanceMeters: number;
  durationSeconds: number;
  /** Heure de prise en charge demandée (UTC). */
  pickupAt: Date;
  /** Réservation faite au moins 2 heures avant (préavis D32). */
  bookedAt: Date;
  /** Délai entre la réservation et l'acceptation du chauffeur. */
  acceptedAfterSeconds: number;
  outcome: SeedOutcome;
  paymentMethod: SeedPaymentMethod;
  paymentChoice: 'prepaid' | 'pay_driver_after';
  waitedSeconds: number;
  tipCents: number;
  rating: PlannedRating | null;
}

export interface SeedPlan {
  marker: SeedMarker;
  seed: number;
  anchor: Date;
  /** Lundis (AAAA-MM-JJ) des semaines couvertes, de la plus ancienne à la plus récente. */
  weeks: string[];
  drivers: PlannedDriver[];
  clients: PlannedClient[];
  rides: PlannedRide[];
}

/** Générateur mulberry32 : rapide, déterministe, suffisant pour des données de démonstration. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

class Random {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(max: number): number {
    return Math.floor(this.next() * max);
  }
  between(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
  /** Tirage pondéré : `[valeur, poids]`. */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [value, weight] of items) {
      r -= weight;
      if (r < 0) return value;
    }
    return items.at(-1)![0];
  }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}

/** Lieux réels du Grand Montréal (coordonnées approximatives), répartis dans les zones de service des données de départ. */
export const PLACES: readonly Place[] = [
  { address: '1000 rue De La Gauchetière Ouest, Montréal', lat: 45.4995, lng: -73.5665, area: 'centre-ville' },
  { address: '1455 boulevard De Maisonneuve Ouest, Montréal', lat: 45.4972, lng: -73.579, area: 'centre-ville' },
  { address: 'Centre Bell, 1909 avenue des Canadiens-de-Montréal, Montréal', lat: 45.4961, lng: -73.5693, area: 'centre-ville' },
  { address: '550 rue Sherbrooke Ouest, Montréal', lat: 45.504, lng: -73.572, area: 'centre-ville' },
  { address: 'Place des Arts, 175 rue Sainte-Catherine Ouest, Montréal', lat: 45.5081, lng: -73.5664, area: 'centre-ville' },
  { address: 'Basilique Notre-Dame, 110 rue Notre-Dame Ouest, Montréal', lat: 45.5046, lng: -73.5563, area: 'vieux-montreal' },
  { address: 'Marché Bonsecours, 350 rue Saint-Paul Est, Montréal', lat: 45.5086, lng: -73.5516, area: 'vieux-montreal' },
  { address: '400 rue Saint-Antoine Ouest, Montréal', lat: 45.502, lng: -73.562, area: 'vieux-montreal' },
  { address: '4500 rue Saint-Denis, Montréal', lat: 45.523, lng: -73.582, area: 'plateau' },
  { address: 'Parc La Fontaine, 3933 avenue Calixa-Lavallée, Montréal', lat: 45.5227, lng: -73.5695, area: 'plateau' },
  { address: '4200 boulevard Saint-Laurent, Montréal', lat: 45.5185, lng: -73.583, area: 'plateau' },
  { address: '5100 rue Fabre, Montréal', lat: 45.532, lng: -73.579, area: 'plateau' },
  { address: 'Aéroport Montréal-Trudeau, 975 boulevard Roméo-Vachon Nord, Dorval', lat: 45.468, lng: -73.742, area: 'yul' },
  { address: 'Hôtel de l\'aéroport, 800 place Leigh-Capreol, Dorval', lat: 45.4665, lng: -73.744, area: 'yul' },
  { address: 'Stade olympique, 4545 avenue Pierre-De Coubertin, Montréal', lat: 45.558, lng: -73.5515, area: 'ailleurs' },
  { address: 'Marché Jean-Talon, 7070 avenue Henri-Julien, Montréal', lat: 45.5363, lng: -73.6146, area: 'ailleurs' },
  { address: 'Université de Montréal, 2900 boulevard Édouard-Montpetit, Montréal', lat: 45.5048, lng: -73.6132, area: 'ailleurs' },
  { address: 'Oratoire Saint-Joseph, 3800 chemin Queen-Mary, Montréal', lat: 45.4925, lng: -73.618, area: 'ailleurs' },
  { address: 'Marché Atwater, 138 avenue Atwater, Montréal', lat: 45.48, lng: -73.577, area: 'ailleurs' },
  { address: '4000 rue Wellington, Verdun', lat: 45.461, lng: -73.57, area: 'ailleurs' },
  { address: 'CHU Sainte-Justine, 3175 chemin de la Côte-Sainte-Catherine, Montréal', lat: 45.503, lng: -73.624, area: 'ailleurs' },
  { address: 'Centre Rockland, 2305 chemin Rockland, Mont-Royal', lat: 45.518, lng: -73.642, area: 'ailleurs' },
  { address: 'Parc Jean-Drapeau, 1 circuit Gilles-Villeneuve, Montréal', lat: 45.508, lng: -73.529, area: 'ailleurs' },
  { address: '1400 boulevard de la Côte-Vertu, Saint-Laurent', lat: 45.514, lng: -73.683, area: 'ailleurs' },
  { address: '6815 route Transcanadienne, Pointe-Claire', lat: 45.464, lng: -73.826, area: 'ailleurs' },
  { address: '7999 boulevard des Galeries-d\'Anjou, Montréal', lat: 45.598, lng: -73.564, area: 'ailleurs' },
  { address: '3003 boulevard Le Carrefour, Laval', lat: 45.5715, lng: -73.752, area: 'ailleurs' },
  { address: '825 rue Saint-Laurent Ouest, Longueuil', lat: 45.5305, lng: -73.5185, area: 'ailleurs' },
  { address: '2901 rue Rachel Est, Montréal', lat: 45.543, lng: -73.563, area: 'ailleurs' },
  { address: '5655 avenue Monkland, Montréal', lat: 45.4735, lng: -73.6155, area: 'ailleurs' },
];

const FIRST_NAMES = [
  'Samuel', 'Léa', 'Olivier', 'Chloé', 'William', 'Emma', 'Thomas', 'Florence', 'Gabriel', 'Alice', 'Félix', 'Rosalie', 'Nathan', 'Juliette', 'Antoine',
  'Camille', 'Mathis', 'Béatrice', 'Louis', 'Charlotte', 'Karim', 'Amina', 'Mamadou', 'Fatou', 'Jean-Philippe', 'Marie-Ève', 'Yves', 'Nadia', 'Hugo',
  'Sophie', 'Émile', 'Laurence', 'Raphaël', 'Maëlle', 'Vincent', 'Isabelle', 'Marc-André', 'Sarah', 'Alexis', 'Mélissa', 'Ibrahim', 'Aïcha', 'Luca',
  'Noah', 'Zoé', 'Jacob', 'Océane', 'Élodie', 'Patrick', 'Julie',
] as const;

const LAST_NAMES = [
  'Tremblay', 'Gagnon', 'Roy', 'Côté', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'Fortin', 'Gagné', 'Ouellet', 'Pelletier', 'Bélanger', 'Lévesque',
  'Bergeron', 'Leblanc', 'Paquette', 'Girard', 'Simard', 'Boucher', 'Caron', 'Beaulieu', 'Cloutier', 'Dubé', 'Poirier', 'Fournier', 'Lapointe',
  'Diallo', 'Traoré', 'Nguyen', 'Martin', 'Khelifi', 'Haddad', 'Pierre', 'Joseph', 'Mercier', 'Lefebvre', 'Dufour', 'Bernier', 'Leclerc',
] as const;

const VEHICLES: Record<SeedCategory, ReadonlyArray<{ make: string; model: string; seats: number; minYear: number }>> = {
  neo_premium: [
    { make: 'Tesla', model: 'Model 3', seats: 4, minYear: 2021 }, { make: 'Tesla', model: 'Model Y', seats: 4, minYear: 2021 }, { make: 'Hyundai', model: 'Ioniq 5', seats: 4, minYear: 2022 },
    { make: 'Hyundai', model: 'Ioniq 6', seats: 4, minYear: 2023 }, { make: 'Kia', model: 'EV6', seats: 4, minYear: 2022 }, { make: 'Polestar', model: '2', seats: 4, minYear: 2021 },
  ],
  neo_prestige: [
    { make: 'Tesla', model: 'Model S', seats: 4, minYear: 2021 }, { make: 'Mercedes', model: 'EQE', seats: 4, minYear: 2023 }, { make: 'BMW', model: 'i5', seats: 4, minYear: 2024 },
    { make: 'Audi', model: 'e-tron GT', seats: 4, minYear: 2022 },
  ],
  neo_xl: [{ make: 'Kia', model: 'EV9', seats: 6, minYear: 2024 }, { make: 'Volvo', model: 'EX90', seats: 6, minYear: 2025 }],
};

const COLOURS = ['blanche', 'noire', 'grise', 'bleue', 'argent', 'rouge'] as const;

const RATING_TAGS: Record<number, readonly string[]> = {
  5: ['ponctuel', 'conduite_douce', 'vehicule_propre', 'courtois', 'bonne_musique'],
  4: ['ponctuel', 'vehicule_propre', 'courtois'],
  3: ['retard', 'conduite_brusque'],
  2: ['retard', 'itineraire'],
};

const COMMENTS: Record<number, readonly string[]> = {
  5: ['Excellent service, merci !', 'Très agréable, je recommande.', 'Parfait, chauffeur très professionnel.', 'Great ride, thank you!'],
  4: ['Bien, un peu d\'attente au départ.', 'Bon trajet.'],
  3: ['Correct, mais conduite un peu rapide.'],
  2: ['Chauffeur en retard de dix minutes.'],
};

/** Téléphone d'un compte du jeu : `<préfixe><type><5 chiffres>` (type 0 : chauffeur, 1 : client, 2 à 9 : autres usages). */
export function markedPhone(marker: Pick<SeedMarker, 'phonePrefix'>, kind: number, index: number): string {
  if (!/^\+1999\d{2}$/.test(marker.phonePrefix)) throw new Error(`Préfixe de téléphone invalide : ${marker.phonePrefix} (+1999 suivi de 2 chiffres attendu)`);
  if (!Number.isInteger(kind) || kind < 0 || kind > 9) throw new Error(`Type de compte invalide : ${kind}`);
  if (!Number.isInteger(index) || index < 0 || index > 99_999) throw new Error(`Rang de compte invalide : ${index}`);
  return `${marker.phonePrefix}${kind}${String(index).padStart(5, '0')}`;
}

/** Motif SQL `LIKE` des téléphones d'un marqueur (13 caractères, signe plus compris). */
export function markedPhonePattern(marker: Pick<SeedMarker, 'phonePrefix'>): string {
  return `${marker.phonePrefix}______`;
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Parties locales d'un instant dans un fuseau (année, mois, jour, heure, minute, jour de la semaine ISO). */
export function zonedParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), hour: Number(get('hour')), minute: Number(get('minute')), weekday };
}

/** Instant UTC d'une heure locale (jour AAAA-MM-JJ, heure, minute) dans un fuseau, heure d'été comprise. */
export function zonedTime(day: string, hour: number, minute: number, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let result = guess;
  for (let i = 0; i < 2; i += 1) {
    const p = zonedParts(new Date(result), timeZone);
    const asLocal = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    result += guess - asLocal;
  }
  return new Date(result);
}

export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lundi (AAAA-MM-JJ, heure de Montréal) de la semaine de `now` : ancre du jeu, les courses sont toutes avant. */
export function weekAnchor(now: Date, timeZone: string): string {
  const p = zonedParts(now, timeZone);
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return shiftDay(today, 1 - p.weekday);
}

function jitter(rng: Random, point: GeoPoint, meters: number): GeoPoint {
  const dLat = ((rng.float() * 2 - 1) * meters) / 111_320;
  const dLng = ((rng.float() * 2 - 1) * meters) / (111_320 * Math.cos((point.lat * Math.PI) / 180));
  return { lat: Number((point.lat + dLat).toFixed(6)), lng: Number((point.lng + dLng).toFixed(6)) };
}

function validateSizes(sizes: PlanSizes): void {
  for (const [key, value] of Object.entries(sizes)) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`Taille invalide pour ${key} : ${value}`);
  }
  if (sizes.drivers > 99_999 || sizes.clients > 99_999) throw new Error('Au plus 99 999 comptes par type');
  if (sizes.rides > 999 * sizes.weeks * 7) throw new Error('Trop de courses pour la période');
}

/**
 * Plan complet. `anchorDay` : lundi de la semaine en cours (heure de Montréal) ; les courses tombent dans les `weeks`
 * semaines qui le précèdent, toutes terminées avant lui.
 */
export function planE2eDataset(options: { anchorDay: string; timeZone?: string; sizes?: Partial<PlanSizes>; seed?: number; marker?: SeedMarker }): SeedPlan {
  const sizes: PlanSizes = { ...DEFAULT_SIZES, ...options.sizes };
  validateSizes(sizes);
  const marker = options.marker ?? SEED_E2E_MARKER;
  const seed = options.seed ?? DEFAULT_SEED;
  const timeZone = options.timeZone ?? 'America/Toronto';
  const rng = new Random(seed);
  const anchor = zonedTime(options.anchorDay, 0, 0, timeZone);
  const weeks = Array.from({ length: sizes.weeks }, (_, i) => shiftDay(options.anchorDay, -7 * (sizes.weeks - i)));

  // Chauffeurs : 70 % Neo Premium, 20 % Neo Prestige, 10 % Neo XL ; présence répartie dans les zones.
  const areaWeights: ReadonlyArray<readonly [PlaceArea, number]> = [['centre-ville', 30], ['vieux-montreal', 15], ['plateau', 20], ['yul', 10], ['ailleurs', 25]];
  const drivers: PlannedDriver[] = [];
  for (let i = 0; i < sizes.drivers; i += 1) {
    const category = rng.weighted<SeedCategory>([['neo_premium', 70], ['neo_prestige', 20], ['neo_xl', 10]]);
    const model = rng.pick(VEHICLES[category]);
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const area = rng.weighted(areaWeights);
    const anchorPlace = rng.pick(PLACES.filter((p) => p.area === area));
    const english = rng.float() < 0.25;
    drivers.push({
      index: i,
      phone: markedPhone(marker, 0, i + 1),
      email: `${slug(firstName)}.${slug(lastName)}.${String(i + 1).padStart(3, '0')}@${marker.emailDomain}`,
      firstName,
      lastName,
      language: english ? 'en' : 'fr',
      spokenLanguages: english ? ['en', 'fr'] : rng.float() < 0.6 ? ['fr', 'en'] : ['fr'],
      experienceYears: rng.between(1, 20),
      acceptsCash: rng.float() < 0.8,
      acceptsInterac: rng.float() < 0.7,
      vehicle: {
        category, make: model.make, model: model.model, year: rng.between(model.minYear, 2026), colour: rng.pick(COLOURS),
        plate: `${marker.plateTag}${String(i + 1).padStart(3, '0')}`.slice(0, 12), seats: model.seats,
      },
      home: jitter(rng, anchorPlace, area === 'yul' ? 250 : 700),
      area,
    });
  }

  const clients: PlannedClient[] = [];
  for (let i = 0; i < sizes.clients; i += 1) {
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    clients.push({
      index: i,
      phone: markedPhone(marker, 1, i + 1),
      email: rng.float() < 0.6 ? `${slug(firstName)}.${slug(lastName)}.${String(i + 1).padStart(4, '0')}@${marker.emailDomain}` : null,
      firstName,
      lastName,
      language: rng.float() < 0.8 ? 'fr' : 'en',
    });
  }

  // Chaque chauffeur et chaque client a au moins une course quand le volume le permet ; le reste est tiré au sort.
  const driverOrder = rng.shuffle(Array.from({ length: sizes.drivers }, (_, i) => i));
  const clientOrder = rng.shuffle(Array.from({ length: sizes.clients }, (_, i) => i));
  const rides: PlannedRide[] = [];
  const perDay = new Map<string, number>();
  for (let i = 0; i < sizes.rides; i += 1) {
    const driverIndex = i < sizes.drivers ? driverOrder[i]! : rng.int(sizes.drivers);
    const clientIndex = i < sizes.clients ? clientOrder[i]! : rng.int(sizes.clients);
    const driver = drivers[driverIndex]!;
    const airportTrip = rng.float() < 0.18;
    const origin = airportTrip && rng.float() < 0.5 ? rng.pick(PLACES.filter((p) => p.area === 'yul')) : rng.pick(PLACES.filter((p) => p.area !== 'yul'));
    const destinations = airportTrip && origin.area !== 'yul' ? PLACES.filter((p) => p.area === 'yul') : PLACES.filter((p) => p.address !== origin.address && (p.area !== 'yul' || origin.area !== 'yul'));
    const destination = rng.pick(destinations);
    const straight = haversineMeters(origin, destination);
    const distanceMeters = Math.max(1500, Math.round(straight * (1.25 + rng.float() * 0.2)));
    const speed = 7 + rng.float() * 5;
    const durationSeconds = Math.round(distanceMeters / speed) + 120;
    const week = i % sizes.weeks;
    const day = shiftDay(weeks[week]!, rng.int(7));
    const drawnHour = rng.weighted<number>([[6, 3], [7, 8], [8, 9], [9, 6], [10, 4], [11, 4], [12, 5], [13, 4], [14, 4], [15, 5], [16, 7], [17, 9], [18, 8], [19, 6], [20, 5], [21, 4], [22, 3], [23, 3]]);
    // La veille de l'ancre, la course se termine avant minuit : chaque course tombe dans une semaine de relevé passée.
    const hour = day === shiftDay(options.anchorDay, -1) ? Math.min(drawnHour, 20) : drawnHour;
    const minute = rng.int(60);
    const pickupAt = zonedTime(day, hour, minute, timeZone);
    const bookedAt = new Date(pickupAt.getTime() - (2 * 3600 + rng.int(3 * 86_400 - 2 * 3600)) * 1000);
    // Environ 4 % de non-présentations et 2 % d'annulations tardives (frais), le reste terminé.
    const outcome: SeedOutcome = i % 25 === 7 ? 'no_show' : i % 50 === 13 ? 'cancelled_by_client' : 'completed';
    let paymentMethod: SeedPaymentMethod = 'card_app';
    let paymentChoice: 'prepaid' | 'pay_driver_after' = 'prepaid';
    if (outcome === 'completed') {
      const choice = rng.weighted<SeedPaymentMethod>([['card_app', 78], ['apple_pay', 7], ['cash', 9], ['interac', 6]]);
      const direct = choice === 'cash' ? driver.acceptsCash : choice === 'interac' ? driver.acceptsInterac : false;
      if (direct) {
        paymentMethod = choice;
        paymentChoice = 'pay_driver_after';
      } else paymentMethod = choice === 'apple_pay' ? 'apple_pay' : 'card_app';
    }
    const waitedSeconds = outcome === 'no_show' ? 330 + rng.int(180) : rng.float() < 0.12 ? 300 + rng.int(420) : rng.int(240);
    const tipCents = outcome === 'completed' && paymentChoice === 'prepaid' && rng.float() < 0.4 ? rng.pick([200, 300, 400, 500, 800]) : 0;
    let rating: PlannedRating | null = null;
    if (outcome === 'completed' && rng.float() < 0.75) {
      const score = rng.weighted<number>([[5, 70], [4, 22], [3, 6], [2, 2]]);
      const tags = rng.shuffle([...RATING_TAGS[score]!]).slice(0, rng.between(0, 2));
      rating = { score, tags, comment: rng.float() < 0.35 ? rng.pick(COMMENTS[score]!) : null, afterSeconds: 300 + rng.int(3 * 3600) };
    }
    const n = (perDay.get(day) ?? 0) + 1;
    perDay.set(day, n);
    rides.push({
      index: i,
      key: `${marker.key}-ride-${String(i + 1).padStart(4, '0')}`,
      localDay: day,
      publicNumber: `NM-${day}-${marker.rideTag}${String(i + 1).padStart(3, '0')}`,
      driverIndex,
      clientIndex,
      category: driver.vehicle.category,
      origin,
      destination,
      distanceMeters,
      durationSeconds,
      pickupAt,
      bookedAt,
      acceptedAfterSeconds: 20 + rng.int(600),
      outcome,
      paymentMethod,
      paymentChoice,
      waitedSeconds,
      tipCents,
      rating,
    });
  }
  return { marker, seed, anchor, weeks, drivers, clients, rides };
}
