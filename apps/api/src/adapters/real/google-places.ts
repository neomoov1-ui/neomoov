/**
 * Google Places (nouvelle API, `places:searchText`) pour la prospection B2B (phase 1 « entreprise autonome ») : recherche
 * d'établissements par catégorie et zone, avec la clé serveur des cartes. Seules les données publiques d'une organisation
 * sont lues (nom, ville, téléphone, site, réputation) ; aucune donnée d'une personne. Délai d'attente et nouvelles
 * tentatives sur erreur passagère.
 */
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { PlaceCandidate, PlacesProvider } from '../types.js';

export interface GooglePlacesOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  language?: string;
  region?: string;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.types,places.businessStatus';

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; types?: string[] }>;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  businessStatus?: string;
}

/** Numéro au format E.164 (Google rend « +1 514-555-0100 »). */
export function normalizePhone(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

export class GooglePlacesProvider implements PlacesProvider {
  readonly name = 'google-places';
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly language: string;
  private readonly region: string;

  constructor(
    private readonly apiKey: string,
    options: GooglePlacesOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.retries = options.retries ?? 2;
    this.language = options.language ?? 'fr-CA';
    this.region = options.region ?? 'ca';
  }

  toJSON() {
    return { name: this.name, configured: true };
  }

  async searchText(input: { query: string; maxResults?: number; language?: string; region?: string }): Promise<PlaceCandidate[]> {
    const body = JSON.stringify({ textQuery: input.query, languageCode: input.language ?? this.language, regionCode: (input.region ?? this.region).toUpperCase(), pageSize: Math.min(20, Math.max(1, input.maxResults ?? 10)) });
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)));
      try {
        const response = await this.fetchImpl('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': FIELD_MASK },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (RETRYABLE_STATUS.has(response.status)) {
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        const json = (await response.json().catch(() => ({}))) as { places?: GooglePlace[]; error?: { message?: string } };
        if (!response.ok) throw new AppError('PLACES_REQUEST_REJECTED', `Google Places : ${json.error?.message ?? `HTTP ${response.status}`}`, HttpStatus.BAD_GATEWAY);
        return (json.places ?? []).filter((p) => p.id).map((p) => ({
          placeId: p.id,
          name: p.displayName?.text ?? p.id,
          formattedAddress: p.formattedAddress ?? null,
          city: p.addressComponents?.find((c) => c.types?.includes('locality'))?.longText ?? null,
          phone: normalizePhone(p.internationalPhoneNumber ?? p.nationalPhoneNumber),
          website: p.websiteUri ?? null,
          rating: typeof p.rating === 'number' ? p.rating : null,
          reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
          types: p.types ?? [],
          businessStatus: p.businessStatus ?? null,
        }));
      } catch (error) {
        if (error instanceof AppError) throw error;
        lastError = error;
      }
    }
    throw new AppError('PLACES_UNAVAILABLE', `Google Places injoignable après ${this.retries + 1} tentative(s)`, HttpStatus.SERVICE_UNAVAILABLE, { cause: lastError instanceof Error ? lastError.message : String(lastError) });
  }
}
