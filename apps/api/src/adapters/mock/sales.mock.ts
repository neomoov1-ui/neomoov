/**
 * Simulateurs de la direction commerciale (phase 1 « entreprise autonome ») : établissements d'une source ouverte et
 * agenda du fondateur. Déterministes, en mémoire, sans réseau ; ils gardent leurs appels pour les tests.
 */
import { createHash } from 'node:crypto';
import type { CalendarEventInput, CalendarProvider, PlaceCandidate, PlacesProvider } from '../types.js';

/**
 * Établissements simulés : trois par requête, dérivés de son texte (noms, numéros fictifs +1 514 555 02xx, sites
 * `.example`), réputation variée ; jamais une personne. Les tests peuvent fixer `results` pour une requête précise.
 */
export class MockPlacesProvider implements PlacesProvider {
  readonly name = 'mock';
  readonly calls: Array<{ query: string; maxResults: number }> = [];
  /** Réponses imposées par un test, par requête exacte. */
  readonly results = new Map<string, PlaceCandidate[]>();

  async searchText(input: { query: string; maxResults?: number }): Promise<PlaceCandidate[]> {
    const maxResults = input.maxResults ?? 10;
    this.calls.push({ query: input.query, maxResults });
    const fixed = this.results.get(input.query);
    if (fixed) return fixed.slice(0, maxResults);
    const hash = createHash('sha256').update(input.query).digest('hex');
    const city = /laval/i.test(input.query) ? 'Laval' : /longueuil/i.test(input.query) ? 'Longueuil' : 'Montréal';
    const label = input.query.split(/\s+/)[0] ?? 'Établissement';
    return Array.from({ length: Math.min(3, maxResults) }, (_, i) => {
      const code = hash.slice(i * 6, i * 6 + 6);
      return {
        placeId: `mock-place-${code}`,
        name: `${label.charAt(0).toUpperCase()}${label.slice(1)} ${city} ${i + 1}`,
        formattedAddress: `${100 + i} rue Simulée, ${city}, QC`,
        city,
        phone: `+15145550${(200 + (Number.parseInt(code, 16) % 100)).toString().padStart(3, '0')}`,
        website: `https://${label.toLowerCase().replace(/[^a-z]/g, '')}-${code}.example`,
        rating: 3.5 + (Number.parseInt(code.slice(0, 2), 16) % 15) / 10,
        reviewCount: Number.parseInt(code.slice(2, 4), 16),
        types: [label.toLowerCase()],
        businessStatus: 'OPERATIONAL',
      };
    });
  }
}

/** Agenda simulé : chaque événement reçoit un identifiant et un lien fictif ; `events` sert aux tests. */
export class MockCalendarProvider implements CalendarProvider {
  readonly name = 'mock';
  readonly events: Array<CalendarEventInput & { eventId: string }> = [];
  private counter = 0;

  async createEvent(input: CalendarEventInput): Promise<{ eventId: string; htmlLink: string | null }> {
    this.counter += 1;
    const eventId = `cal_mock_${this.counter.toString(36).padStart(6, '0')}`;
    this.events.push({ ...input, eventId });
    return { eventId, htmlLink: `mock://calendar/${eventId}` };
  }
}
