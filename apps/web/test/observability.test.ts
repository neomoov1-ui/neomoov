import { ApiError } from '@neomoov/api-client';
import { RIDE_STATES } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { resources } from '../src/lib/i18n';
import { errorTags, initBrowserErrorReporting, isReportable, reportBrowserError, sentryConfig, sentryOptions } from '../src/lib/observability';

describe('suivi des erreurs du web', () => {
  it('inactif sans DSN : aucune configuration, le SDK n\'est pas chargé, signaler ne fait rien', () => {
    expect(sentryConfig({ dsn: undefined })).toBeNull();
    expect(sentryConfig({ dsn: '  ' })).toBeNull();
    expect(initBrowserErrorReporting(null)).toBe(false);
    expect(() => reportBrowserError(new Error('rien'))).not.toThrow();
  });

  it('version et environnement : variables publiques, sinon NODE_ENV et 0.0.0', () => {
    expect(sentryConfig({ dsn: 'https://cle@exemple.invalid/2', environment: 'staging', release: '1.4.0', nodeEnv: 'production' })).toEqual({ dsn: 'https://cle@exemple.invalid/2', environment: 'staging', release: '1.4.0' });
    expect(sentryConfig({ dsn: 'https://cle@exemple.invalid/2', nodeEnv: 'production' })).toEqual({ dsn: 'https://cle@exemple.invalid/2', environment: 'production', release: '0.0.0' });
    expect(sentryConfig({ dsn: 'https://cle@exemple.invalid/2' })?.environment).toBe('development');
  });

  it('aucune donnée personnelle collectée ; événements et fils d\'Ariane filtrés avant l\'envoi', () => {
    const options = sentryOptions({ dsn: 'https://cle@exemple.invalid/2', environment: 'test', release: '0.0.0' });
    expect(options.dataCollection).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false });
    expect(options.initialScope.tags.service).toBe('web');
    expect(options.beforeSend({ message: 'réservation de awa@exemple.ca, 514-555-0123', request: { headers: { cookie: 'nm_hub_at=x' } } })).toEqual({ message: 'réservation de [courriel], [téléphone]', request: { headers: { cookie: '[masqué]' } } });
    expect(options.beforeBreadcrumb({ category: 'fetch', data: { url: '/api/v1/places/autocomplete?token=abc' } })).toEqual({ category: 'fetch', data: { url: '/api/v1/places/autocomplete?token=[masqué]' } });
  });

  it('erreurs d\'API : identifiant de corrélation joint ; seules les pannes du serveur sont signalées', () => {
    const outage = new ApiError(503, 'SERVICE_UNAVAILABLE', 'Indisponible', undefined, 'web-hub-12345678');
    expect(errorTags(outage, { source: 'query' })).toEqual({ source: 'query', apiCode: 'SERVICE_UNAVAILABLE', apiStatus: '503', correlationId: 'web-hub-12345678' });
    expect(errorTags(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toEqual({ apiCode: 'INTERNAL_ERROR', apiStatus: '500' });
    expect(errorTags(new Error('x'), { source: 'query' })).toEqual({ source: 'query' });
    expect(isReportable(outage)).toBe(true);
    expect(isReportable(new ApiError(409, 'CONFLICT', 'x'))).toBe(false);
    expect(isReportable(new ApiError(0, 'NETWORK_ERROR', 'hors ligne'))).toBe(false);
    expect(isReportable(new TypeError('x'))).toBe(true);
  });
});

describe('page Métriques de My Hub', () => {
  it('libellés FR et EN : titre, canaux, états des disjoncteurs et des courses', () => {
    for (const language of ['fr-CA', 'en'] as const) {
      const hub = resources[language].translation.hub;
      expect(hub.nav.metrics).toBeTruthy();
      expect(Object.keys(hub.metrics.channels).sort()).toEqual(['email', 'in_app', 'push', 'sms', 'whatsapp']);
      expect(Object.keys(hub.metrics.circuitStates).sort()).toEqual(['closed', 'half_open', 'open']);
      for (const state of RIDE_STATES) expect(resources[language].translation.enum.rideState[state], `${language} ${state}`).toBeTruthy();
    }
  });
});
