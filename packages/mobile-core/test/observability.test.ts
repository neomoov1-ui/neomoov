import { describe, expect, it } from 'vitest';
import { errorTags, isReportable, mobileSentryConfig, mobileSentryOptions } from '../src/observability';

const base = { app: 'mobile-client' as const, environment: undefined, version: '1.4.0', build: '12', isDev: false };

describe('suivi des erreurs mobile', () => {
  it('inactif sans DSN (aucun démarrage du SDK, aucun appel réseau)', () => {
    expect(mobileSentryConfig({ ...base, dsn: undefined })).toBeNull();
    expect(mobileSentryConfig({ ...base, dsn: ' ' })).toBeNull();
  });

  it('version nommée comme dans les magasins, environnement du build ou déduit', () => {
    expect(mobileSentryConfig({ ...base, dsn: 'https://cle@exemple.invalid/3', environment: 'staging' })).toEqual({
      dsn: 'https://cle@exemple.invalid/3', environment: 'staging', release: 'com.neomoov.client@1.4.0+12', dist: '12', app: 'mobile-client',
    });
    const driver = mobileSentryConfig({ ...base, app: 'mobile-driver', dsn: 'https://cle@exemple.invalid/3', version: null, build: null, isDev: true });
    expect(driver).toMatchObject({ environment: 'development', release: 'com.neomoov.driver@0.0.0', dist: undefined });
    expect(mobileSentryConfig({ ...base, dsn: 'https://cle@exemple.invalid/3' })?.environment).toBe('production');
  });

  it('options : aucune donnée personnelle, ni capture d\'écran ni arbre des vues ; événements filtrés', () => {
    const config = mobileSentryConfig({ ...base, dsn: 'https://cle@exemple.invalid/3' })!;
    const options = mobileSentryOptions(config);
    expect(options).toMatchObject({ sendDefaultPii: false, attachScreenshot: false, attachViewHierarchy: false, dist: '12', initialScope: { tags: { service: 'mobile-client' } } });
    expect(mobileSentryOptions({ ...config, dist: undefined })).not.toHaveProperty('dist');
    expect(options.beforeSend({ message: 'Adresse 4500 rue Saint-Denis, tél. +15145550123', extra: { email: 'a@b.ca' } })).toEqual({ message: 'Adresse [adresse], tél. [téléphone]', extra: { email: '[masqué]' } });
    expect(options.beforeBreadcrumb({ category: 'xhr', data: { url: 'https://api.neomoov.net/v1/places/details?token=abc' } })).toEqual({ category: 'xhr', data: { url: 'https://api.neomoov.net/v1/places/details?token=[masqué]' } });
  });

  it('erreurs d\'API : identifiant de corrélation joint ; pannes du serveur seulement', () => {
    const outage = { status: 502, code: 'BAD_GATEWAY', correlationId: 'mobile-abc123456', message: 'x' };
    expect(errorTags(outage, { source: 'query' })).toEqual({ source: 'query', apiCode: 'BAD_GATEWAY', apiStatus: '502', correlationId: 'mobile-abc123456' });
    expect(errorTags({ status: 500, code: 'INTERNAL_ERROR' })).toEqual({ apiCode: 'INTERNAL_ERROR', apiStatus: '500' });
    expect(errorTags(new Error('x'))).toEqual({});
    expect(errorTags(null)).toEqual({});
    expect(isReportable(outage)).toBe(true);
    expect(isReportable({ status: 0, code: 'NETWORK_ERROR' })).toBe(false);
    expect(isReportable({ status: 422, code: 'VALIDATION_ERROR' })).toBe(false);
    expect(isReportable(new Error('plantage'))).toBe(true);
  });
});
