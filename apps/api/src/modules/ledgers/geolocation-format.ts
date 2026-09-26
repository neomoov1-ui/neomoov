/**
 * Export mensuel de géolocalisation (section 5.13) : formats connus et pseudonymisation. Le réglage
 * `geolocation_export.format` choisit un format de ce registre ; un nouveau format demandé par la CTQ s'ajoute ici avec
 * un nouveau code, sans changer les exports déjà archivés. Description du format provisoire : `docs/geolocation-export.md`.
 *
 * Pseudonymes : HMAC-SHA256 tronqué à 128 bits, avec une clé dérivée par HKDF-SHA256 de `ENCRYPTION_KEY` et d'une
 * étiquette propre à cet usage (jamais la clé brute) : stables d'un mois à l'autre, non réversibles sans la clé.
 */
import { createHmac, hkdfSync } from 'node:crypto';
import { csvDocument, csvLine, type CsvValue } from './csv.js';

/** Étiquette HKDF de l'export de géolocalisation : changer de version change tous les pseudonymes. */
export const GEOLOCATION_KEY_INFO = 'neomoov/geolocation-export/v1';
const GEOLOCATION_KEY_SALT = 'neomoov';

export function geolocationKey(encryptionKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', encryptionKey, GEOLOCATION_KEY_SALT, GEOLOCATION_KEY_INFO, 32));
}

/** Pseudonyme d'un identifiant interne (course, chauffeur, véhicule) : 32 caractères hexadécimaux. */
export function pseudonym(key: Buffer, kind: 'ride' | 'driver' | 'vehicle', id: string): string {
  return createHmac('sha256', key).update(`${kind}:${id}`).digest('hex').slice(0, 32);
}

/** Course terminée telle que lue pour l'export (coordonnées WGS 84, horodatages ISO 8601). */
export interface GeolocationRide {
  id: string;
  driverId: string | null;
  vehicleId: string | null;
  category: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  pickedUpAt: string | null;
  completedAt: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export interface GeolocationFormat {
  code: string;
  separator: string;
  /** Décimales des coordonnées (3 : environ 110 m en latitude, 80 m en longitude à Montréal). */
  coordinateDecimals: number;
  header: string[];
  row: (ride: GeolocationRide, key: Buffer) => CsvValue[];
}

/** Coordonnée arrondie, écrite comme un nombre (une longitude négative n'est pas une formule). */
function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** Horodatage UTC à la seconde (ISO 8601, suffixe Z). */
function utc(value: string | null): string | null {
  return value ? new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
}

const CSV_V0: GeolocationFormat = {
  code: 'csv-v0',
  separator: ',',
  coordinateDecimals: 3,
  header: ['trajet', 'chauffeur', 'vehicule', 'categorie', 'origine_lat', 'origine_lng', 'destination_lat', 'destination_lng', 'prise_en_charge_utc', 'arrivee_utc', 'distance_m', 'duree_s'],
  row: (ride, key) => [
    pseudonym(key, 'ride', ride.id),
    ride.driverId ? pseudonym(key, 'driver', ride.driverId) : null,
    ride.vehicleId ? pseudonym(key, 'vehicle', ride.vehicleId) : null,
    ride.category,
    round(ride.originLat, CSV_V0.coordinateDecimals),
    round(ride.originLng, CSV_V0.coordinateDecimals),
    round(ride.destinationLat, CSV_V0.coordinateDecimals),
    round(ride.destinationLng, CSV_V0.coordinateDecimals),
    utc(ride.pickedUpAt),
    utc(ride.completedAt),
    ride.distanceMeters,
    ride.durationSeconds,
  ],
};

export const GEOLOCATION_FORMATS: Readonly<Record<string, GeolocationFormat>> = { [CSV_V0.code]: CSV_V0 };

export function geolocationFormat(code: string): GeolocationFormat {
  const format = GEOLOCATION_FORMATS[code];
  if (!format) throw new Error(`Format d'export de géolocalisation inconnu : ${code} (connus : ${Object.keys(GEOLOCATION_FORMATS).join(', ')})`);
  return format;
}

export function buildGeolocationCsv(format: GeolocationFormat, rides: GeolocationRide[], key: Buffer): string {
  return csvDocument([csvLine(format.header, format.separator), ...rides.map((ride) => csvLine(format.row(ride, key), format.separator))]);
}
