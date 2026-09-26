import { describe, expect, it } from 'vitest';
import {
  adminMetricsSchema, API_KEY_SCOPES, isRedactedKey, PERFORMANCE_TARGETS, PERSONAL_KEYS, REDACTED, REDACTED_KEYS, scrubErrorEvent, scrubText, scrubValue, SECRET_KEYS,
} from '../src/index.js';

describe('masquage des textes libres', () => {
  it('masque les jetons, les en-têtes d\'autorisation et les clés de service', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefGHIJKL_mnop';
    expect(scrubText(`jeton refusé : ${jwt}`)).toBe('jeton refusé : [jeton]');
    expect(scrubText('Authorization: Bearer abc.def-ghi')).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(scrubText('bearer eyJ-pas-un-jwt-mais-long')).toBe(`bearer ${REDACTED}`);
    expect(scrubText('the bearer of bad news')).toBe('the bearer of bad news');
    expect(scrubText('clé sk_live_abcdefgh12345678 et rk_test_ZZZZZZZZ1')).toBe('clé [clé] et [clé]');
    expect(scrubText('whsec_0123456789abcdef nmk_abc123_def456789')).toBe('[clé] [clé]');
    // Une clé publique Stripe n'est pas secrète.
    expect(scrubText('pk_live_abcdefgh12345678')).toBe('pk_live_abcdefgh12345678');
  });

  it('masque les paramètres sensibles des adresses web, sans toucher aux autres', () => {
    expect(scrubText('GET https://maps.googleapis.com/x?origin=a&key=AIzaSy123&mode=driving')).toBe(`GET https://maps.googleapis.com/x?origin=a&key=${REDACTED}&mode=driving`);
    expect(scrubText('/callback?code=123456&state=ok')).toBe(`/callback?code=${REDACTED}&state=ok`);
    expect(scrubText('/v1/rides?page=2')).toBe('/v1/rides?page=2');
    // Requête SQL en échec : le texte (paramètres $1, $2) reste, les valeurs sont masquées.
    expect(scrubText('Failed query: select * from users where first_name = $1\nparams: Awa,Diallo')).toBe(`Failed query: select * from users where first_name = $1\nparams: ${REDACTED}`);
  });

  it('masque courriels, téléphones, codes postaux et adresses postales', () => {
    expect(scrubText('client awa.diallo@exemple.ca introuvable')).toBe('client [courriel] introuvable');
    expect(scrubText('appel au +1 514 555-0123 échoué')).toBe('appel au [téléphone] échoué');
    expect(scrubText('numéro +15145550123')).toBe('numéro [téléphone]');
    expect(scrubText('rappeler (514) 555-0123 ou 514.555.0123')).toBe('rappeler [téléphone] ou [téléphone]');
    expect(scrubText('code postal H2X 1Y4 et h3b2y5')).toBe('code postal [code postal] et [code postal]');
    expect(scrubText('départ : 4500 rue Saint-Denis, Montréal')).toBe('départ : [adresse], Montréal');
    expect(scrubText('pickup at 1200 Main Street; ok')).toBe('pickup at [adresse]; ok');
  });

  it('laisse intacts les identifiants, dates, versions et chemins', () => {
    const untouched = [
      'course 3f2a1b4c-1234-4567-8901-234567890123 introuvable',
      '2026-09-26T12:34:56.789Z',
      'node_modules/.pnpm/@sentry+node@11.0.0/node_modules/@sentry/node/build/esm/index.js',
      'identifiant de tâche deliver-1790000000000',
      'Délai de 15000 ms dépassé (GET /health)',
    ];
    for (const text of untouched) expect(scrubText(text)).toBe(text);
  });
});

describe('masquage des valeurs et des événements d\'erreur', () => {
  it('masque les clés sensibles à tout niveau, quel que soit le type, et nettoie les textes', () => {
    const value = {
      rideId: 'r1',
      phone: '+15145550123',
      nested: { password: 'x', coordinates: { lat: 45.5, lng: -73.5 }, note: 'écrire à a@b.ca' },
      list: [{ email: 'a@b.ca' }, 'tel 514-555-0123', 3, true],
      absent: null,
      emptyPhone: undefined,
      lat: 45.5,
      guest_phone: null,
      'x-api-key': 'nmk_secret',
    };
    expect(scrubValue(value)).toEqual({
      rideId: 'r1',
      phone: REDACTED,
      nested: { password: REDACTED, coordinates: REDACTED, note: 'écrire à [courriel]' },
      list: [{ email: REDACTED }, 'tel [téléphone]', 3, true],
      absent: null,
      emptyPhone: undefined,
      lat: REDACTED,
      guest_phone: null,
      'x-api-key': REDACTED,
    });
    // L'original n'est pas modifié.
    expect(value.phone).toBe('+15145550123');
    expect(scrubValue('texte a@b.ca')).toBe('texte [courriel]');
    expect(scrubValue(42)).toBe(42);
  });

  it('garde les clés techniques demandées, coupe les cycles et les niveaux trop profonds', () => {
    const cyclic: Record<string, unknown> = { name: 'boucle' };
    cyclic['self'] = cyclic;
    expect(scrubValue(cyclic)).toEqual({ name: 'boucle', self: '[circulaire]' });
    expect(scrubValue({ a: { b: { c: 'profond' } } }, { maxDepth: 2 })).toEqual({ a: { b: '[tronqué]' } });
    expect(scrubValue({ stacktrace: { file: 'a@b.ca' }, other: 'a@b.ca' }, { skipKeys: ['stacktrace'] })).toEqual({ stacktrace: { file: 'a@b.ca' }, other: '[courriel]' });
  });

  it('nettoie un événement Sentry : message, exception, requête, fils d\'Ariane ; piles et SDK intacts ; utilisateur réduit à son identifiant', () => {
    const event = {
      event_id: 'e1',
      message: 'Échec pour awa@exemple.ca',
      exception: { values: [{ type: 'Error', value: 'Téléphone +15145550123 refusé', stacktrace: { frames: [{ filename: '/app/dist/a@b.ca.js', lineno: 3 }] } }] },
      request: { url: 'https://api.neomoov.net/v1/x?token=abc', headers: { authorization: 'Bearer x', 'user-agent': 'expo' } },
      breadcrumbs: [{ message: 'GET https://maps.googleapis.com/?key=AIza', data: { url: '/v1/places?key=abc' } }],
      sdk: { name: 'sentry.javascript.node', version: '11.0.0' },
      user: { id: 'u1', email: 'a@b.ca', ip_address: '1.2.3.4' },
      tags: { correlationId: 'abc12345' },
    };
    const clean = scrubErrorEvent(event);
    expect(clean.message).toBe('Échec pour [courriel]');
    expect(clean.exception.values[0]!.value).toBe('Téléphone [téléphone] refusé');
    expect(clean.exception.values[0]!.stacktrace.frames[0]!.filename).toBe('/app/dist/a@b.ca.js');
    expect(clean.request).toEqual({ url: `https://api.neomoov.net/v1/x?token=${REDACTED}`, headers: { authorization: REDACTED, 'user-agent': 'expo' } });
    expect(clean.breadcrumbs[0]).toEqual({ message: `GET https://maps.googleapis.com/?key=${REDACTED}`, data: { url: `/v1/places?key=${REDACTED}` } });
    expect(clean.sdk).toEqual(event.sdk);
    expect(clean.user).toEqual({ id: 'u1' });
    expect(clean.tags).toEqual({ correlationId: 'abc12345' });
    expect(scrubErrorEvent({ user: { id: 7, email: 'a@b.ca' } }).user).toEqual({ id: 7 });
    expect(scrubErrorEvent({ user: { email: 'a@b.ca' } }).user).toEqual({});
    expect(scrubErrorEvent({ user: 'texte' as unknown }).user).toBe('texte');
    expect(scrubErrorEvent({ message: 'sans utilisateur' })).toEqual({ message: 'sans utilisateur' });
  });

  it('une seule liste de clés pour le journal et le suivi des erreurs', () => {
    expect(REDACTED_KEYS).toEqual([...SECRET_KEYS, ...PERSONAL_KEYS]);
    expect(isRedactedKey('Authorization')).toBe(true);
    expect(isRedactedKey('api_key')).toBe(true);
    expect(isRedactedKey('phone_number')).toBe(true);
    expect(isRedactedKey('code')).toBe(false);
    expect(isRedactedKey('rideId')).toBe(false);
  });
});

describe('métriques d\'exploitation', () => {
  it('valide la réponse de GET /v1/admin/metrics et expose les cibles de la section 2.2', () => {
    const empty = { count: 0, p50: null, p95: null, max: null };
    const metrics = {
      generatedAt: '2026-09-26T12:00:00.000Z',
      windowHours: 24,
      rides: { byState: [{ state: 'assigned', count: 3, current: true }, { state: 'completed', count: 12, current: false }], assignmentSeconds: { count: 2, p50: 4.5, p95: 5.9, max: 6 }, firstOfferSeconds: empty },
      api: { instance: 'api-1', windowSeconds: 900, requests: 10, errors: 0, p50Ms: 12, p95Ms: 80, routes: [{ method: 'GET', route: '/v1/health', count: 10, errors: 0, p50Ms: 12, p95Ms: 80, maxMs: 90 }] },
      queues: { mode: 'memory', waiting: 0, active: 0, failed: 1, dropped: 0, items: [{ name: 'payments', waiting: 0, active: 0, failed: 1, dropped: 0 }] },
      payments: { failed: 1, byCode: [{ code: 'card_declined', count: 1 }] },
      providers: { circuits: [{ name: 'maps.routes', state: 'closed', failures: 0, totalFailures: 2, openings: 0, lastFailureAt: null }], notificationErrors: 1, notificationErrorsByChannel: [{ channel: 'sms', count: 1 }] },
    };
    expect(adminMetricsSchema.parse(metrics)).toEqual(metrics);
    expect(adminMetricsSchema.safeParse({ ...metrics, rides: { ...metrics.rides, byState: [{ state: 'inconnu', count: 1, current: true }] } }).success).toBe(false);
    expect(PERFORMANCE_TARGETS).toEqual({ firstOfferSeconds: 3, apiP95Ms: 300, quoteP95Ms: 800 });
    expect(API_KEY_SCOPES).toContain('metrics:read');
  });
});
