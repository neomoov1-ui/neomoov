/**
 * Google Maps Platform (prompt 04) : Routes API (itinéraire avec trafic à l'heure prévue et péages, matrice de temps
 * d'arrivée), Places API nouvelle version (autocomplétion, détails d'un lieu), Geocoding. Clé serveur uniquement.
 * Délais d'attente, nouvelles tentatives avec attente croissante et disjoncteur : après plusieurs échecs consécutifs,
 * les appels sont refusés d'emblée pendant un temps de repos, et le service de devis passe en mode dégradé.
 */
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { AutocompleteSuggestion, GeoPoint, GeocodeResult, MapsProvider, RouteRequest, RouteResult } from '../types.js';

export interface GoogleMapsOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Nouvelles tentatives après la première (défaut 2). */
  retries?: number;
  /** Échecs consécutifs qui ouvrent le disjoncteur (défaut 5). */
  breakerThreshold?: number;
  /** Repos du disjoncteur ouvert (défaut 30 s). */
  breakerCooldownMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  language?: string;
  region?: string;
}

/** Réponse non exploitable ou service en panne : le service de devis bascule en mode dégradé. */
export class MapsUnavailableError extends AppError {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super('MAPS_UNAVAILABLE', message, HttpStatus.SERVICE_UNAVAILABLE);
    this.name = 'MapsUnavailableError';
    this.cause = cause;
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class GoogleMapsProvider implements MapsProvider {
  readonly name = 'google-maps';
  private failures = 0;
  private openUntil = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly language: string;
  private readonly region: string;

  constructor(
    private readonly apiKey: string,
    options: GoogleMapsOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.retries = options.retries ?? 2;
    this.breakerThreshold = options.breakerThreshold ?? 5;
    this.breakerCooldownMs = options.breakerCooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.language = options.language ?? 'fr-CA';
    this.region = options.region ?? 'ca';
  }

  toJSON() {
    return { name: this.name, configured: true, breakerOpen: this.breakerOpen };
  }

  get breakerOpen(): boolean {
    return this.openUntil > this.now();
  }

  /** Appel HTTP avec délai, nouvelles tentatives sur erreur réseau, 408, 429 et 5xx, et disjoncteur. */
  private async call<T>(url: string, init: RequestInit & { headers?: Record<string, string> }): Promise<T> {
    if (this.breakerOpen) throw new MapsUnavailableError('Google Maps : disjoncteur ouvert après des échecs répétés');
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      if (attempt > 0) await this.sleep(200 * 2 ** (attempt - 1));
      try {
        const response = await this.fetchImpl(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(this.timeoutMs) });
        if (RETRYABLE_STATUS.has(response.status)) {
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; status?: string }; status?: string; error_message?: string };
        if (!response.ok) {
          // Erreur définitive (clé refusée, requête invalide) : pas de nouvelle tentative, pas d'ouverture du disjoncteur.
          this.failures = 0;
          throw new AppError('MAPS_REQUEST_REJECTED', `Google Maps : ${body.error?.message ?? body.error_message ?? `HTTP ${response.status}`}`, HttpStatus.BAD_GATEWAY);
        }
        this.failures = 0;
        return body as T;
      } catch (error) {
        if (error instanceof AppError) throw error;
        lastError = error;
      }
    }
    this.failures += 1;
    if (this.failures >= this.breakerThreshold) this.openUntil = this.now() + this.breakerCooldownMs;
    throw new MapsUnavailableError(`Google Maps injoignable après ${this.retries + 1} tentative(s)`, lastError);
  }

  async geocode(address: string): Promise<GeocodeResult> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=${this.region}&language=${this.language}&key=${encodeURIComponent(this.apiKey)}`;
    const body = await this.call<{ status: string; results: Array<{ formatted_address: string; place_id: string; geometry: { location: { lat: number; lng: number } } }> }>(url, { method: 'GET' });
    const first = body.results?.[0];
    if (!first) throw new AppError('ADDRESS_NOT_FOUND', `Adresse introuvable : ${address}`, HttpStatus.NOT_FOUND);
    return { lat: first.geometry.location.lat, lng: first.geometry.location.lng, formattedAddress: first.formatted_address, placeId: first.place_id };
  }

  async reverseGeocode(point: GeoPoint): Promise<GeocodeResult> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.lat},${point.lng}&language=${this.language}&key=${encodeURIComponent(this.apiKey)}`;
    const body = await this.call<{ results: Array<{ formatted_address: string; place_id: string }> }>(url, { method: 'GET' });
    const first = body.results?.[0];
    return { ...point, formattedAddress: first?.formatted_address ?? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`, ...(first ? { placeId: first.place_id } : {}) };
  }

  async autocomplete(input: string, sessionToken?: string, near?: GeoPoint): Promise<AutocompleteSuggestion[]> {
    const body = await this.call<{ suggestions?: Array<{ placePrediction?: { placeId: string; text?: { text?: string } } }> }>('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      body: JSON.stringify({
        input,
        languageCode: this.language,
        includedRegionCodes: [this.region],
        ...(sessionToken ? { sessionToken } : {}),
        ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30_000 } } } : {}),
      }),
    });
    return (body.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
      .map((p) => ({ placeId: p.placeId, description: p.text?.text ?? p.placeId }));
  }

  async placeDetails(placeId: string, sessionToken?: string): Promise<GeocodeResult> {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=${this.language}${sessionToken ? `&sessionToken=${encodeURIComponent(sessionToken)}` : ''}`;
    const body = await this.call<{ id?: string; formattedAddress?: string; location?: { latitude: number; longitude: number } }>(url, { method: 'GET', headers: { 'X-Goog-FieldMask': 'id,formattedAddress,location' } });
    if (!body.location) throw new AppError('PLACE_NOT_FOUND', `Lieu introuvable : ${placeId}`, HttpStatus.NOT_FOUND);
    return { lat: body.location.latitude, lng: body.location.longitude, formattedAddress: body.formattedAddress ?? placeId, placeId: body.id ?? placeId };
  }

  /** Itinéraire avec trafic à l'heure de départ (D33) et péages (`extraComputations: TOLLS`). */
  async route(request: RouteRequest): Promise<RouteResult> {
    const departure = request.departureTime && request.departureTime.getTime() > this.now() + 60_000 ? request.departureTime.toISOString() : undefined;
    const body = await this.call<{ routes?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string }; travelAdvisory?: { tollInfo?: { estimatedPrice?: Array<{ currencyCode: string; units?: string; nanos?: number }> } } }> }>(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: { 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.travelAdvisory.tollInfo' },
        body: JSON.stringify({
          origin: waypoint(request.origin),
          destination: waypoint(request.destination),
          ...(request.waypoints?.length ? { intermediates: request.waypoints.map(waypoint) } : {}),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          ...(departure ? { departureTime: departure } : {}),
          extraComputations: ['TOLLS'],
          languageCode: this.language,
          units: 'METRIC',
        }),
      },
    );
    const route = body.routes?.[0];
    if (!route || typeof route.distanceMeters !== 'number' || !route.duration) throw new MapsUnavailableError('Google Routes : aucun itinéraire dans la réponse');
    const tolls = (route.travelAdvisory?.tollInfo?.estimatedPrice ?? []).filter((p) => p.currencyCode === 'CAD');
    const tollsCents = tolls.reduce((sum, p) => sum + Number(p.units ?? 0) * 100 + Math.round((p.nanos ?? 0) / 1e7), 0);
    const result: RouteResult = { distanceMeters: route.distanceMeters, durationSeconds: parseDuration(route.duration), tollsCents };
    if (route.polyline?.encodedPolyline) result.polyline = route.polyline.encodedPolyline;
    return result;
  }

  /** Temps de trajet (secondes) de chaque origine vers la destination ; une origine injoignable vaut l'infini. */
  async etaMatrix(origins: GeoPoint[], destination: GeoPoint): Promise<number[]> {
    if (!origins.length) return [];
    const body = await this.call<Array<{ originIndex?: number; duration?: string; condition?: string }>>('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: { 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition' },
      body: JSON.stringify({ origins: origins.map((o) => ({ waypoint: waypoint(o) })), destinations: [{ waypoint: waypoint(destination) }], travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' }),
    });
    const result = origins.map(() => Number.POSITIVE_INFINITY);
    for (const element of Array.isArray(body) ? body : []) {
      if (typeof element.originIndex !== 'number' || element.condition !== 'ROUTE_EXISTS' || !element.duration) continue;
      result[element.originIndex] = parseDuration(element.duration);
    }
    return result;
  }
}

function waypoint(point: GeoPoint) {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

/** « 1234s » ou « 1234.5s » (format Duration de Google) en secondes entières. */
export function parseDuration(value: string): number {
  const seconds = Number.parseFloat(value.replace(/s$/, ''));
  return Number.isFinite(seconds) ? Math.round(seconds) : 0;
}
