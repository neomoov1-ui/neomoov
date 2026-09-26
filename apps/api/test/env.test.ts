import { describe, expect, it } from 'vitest';
import { apiDocsServed, loadEnv } from '../src/config/env.js';

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/neomoov_test' };

describe('configuration', () => {
  it('applique les valeurs par défaut : port 4000, fournisseurs simulés, drapeaux désactivés', () => {
    const env = loadEnv(base, { dotenv: false });
    expect(env.PORT).toBe(4000);
    expect(env.PAYMENT_PROVIDER).toBe('mock');
    expect(env.MAPS_PROVIDER).toBe('mock');
    expect(env.FEATURE_NEGOTIATION).toBe(false);
    expect(env.FEATURE_IMMEDIATE_RIDES).toBe(false);
    expect(env.TIMEZONE).toBe('America/Toronto');
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('traite une valeur vide comme une variable absente (fichier .env copié du modèle)', () => {
    const env = loadEnv({ ...base, PORT: '', PAYMENT_PROVIDER: '', MAPS_PROVIDER: '  ', REDIS_URL: '', FEATURE_NEGOTIATION: '', APP_BASE_URL: '' }, { dotenv: false });
    expect(env.PORT).toBe(4000);
    expect(env.PAYMENT_PROVIDER).toBe('mock');
    expect(env.MAPS_PROVIDER).toBe('mock');
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.FEATURE_NEGOTIATION).toBe(false);
    expect(env.APP_BASE_URL).toBe('http://localhost:4000');
    expect(() => loadEnv({ NODE_ENV: 'test', DATABASE_URL: '' }, { dotenv: false })).toThrow(/DATABASE_URL/);
  });

  it('refuse un démarrage sans DATABASE_URL avec un message explicite', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' }, { dotenv: false })).toThrow(/DATABASE_URL/);
  });

  it('lit les drapeaux sous plusieurs formes et les modes réels', () => {
    const env = loadEnv({ ...base, FEATURE_NEGOTIATION: 'on', FEATURE_FACE_CHECK: 'true', FEATURE_INSTALLMENTS: '1', SMS_PROVIDER: 'real', PORT: '4100' }, { dotenv: false });
    expect(env.FEATURE_NEGOTIATION).toBe(true);
    expect(env.FEATURE_FACE_CHECK).toBe(true);
    expect(env.FEATURE_INSTALLMENTS).toBe(true);
    expect(env.SMS_PROVIDER).toBe('real');
    expect(env.PORT).toBe(4100);
  });

  it('exige les secrets, Redis et la vérification réelle des jetons Apple et Google en production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' }, { dotenv: false })).toThrow(/JWT_ACCESS_SECRET/);
    const secrets = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'b', ENCRYPTION_KEY: 'c' };
    expect(() => loadEnv(secrets, { dotenv: false })).toThrow(/REDIS_URL/);
    expect(() => loadEnv({ ...secrets, REDIS_URL: 'redis://redis:6379' }, { dotenv: false })).toThrow(/SOCIAL_LOGIN_PROVIDER/);
    expect(() => loadEnv({ ...secrets, REDIS_URL: 'redis://redis:6379', SOCIAL_LOGIN_PROVIDER: 'mock' }, { dotenv: false })).toThrow(/SOCIAL_LOGIN_PROVIDER/);
    const ready = { ...secrets, REDIS_URL: 'redis://redis:6379', SOCIAL_LOGIN_PROVIDER: 'real' };
    // Revue finale : aucun retour silencieux aux simulateurs en production ; chaque simulation est déclarée.
    expect(() => loadEnv(ready, { dotenv: false })).toThrow(/fournisseurs simulés non déclarés.*SMS_PROVIDER/);
    const all = 'payment,maps,sms,email,push,whatsapp,voice,llm,sev,storage,antivirus';
    expect(loadEnv({ ...ready, ALLOW_MOCK_PROVIDERS: all }, { dotenv: false }).SOCIAL_LOGIN_PROVIDER).toBe('real');
    expect(() => loadEnv({ ...ready, ALLOW_MOCK_PROVIDERS: 'payment,sev' }, { dotenv: false })).toThrow(/storage/);
    const real = { ...ready, SMS_PROVIDER: 'real', EMAIL_PROVIDER: 'real', PUSH_PROVIDER: 'real', MAPS_PROVIDER: 'real', STORAGE_PROVIDER: 'real', LLM_PROVIDER: 'real', VIRUS_SCANNER_PROVIDER: 'real' };
    expect(loadEnv({ ...real, ALLOW_MOCK_PROVIDERS: 'payment, SEV ,whatsapp,voice' }, { dotenv: false }).PAYMENT_PROVIDER).toBe('mock');
  });

  it('documentation OpenAPI : servie hors production, fermée en production sauf demande', () => {
    expect(apiDocsServed({ NODE_ENV: 'development', API_DOCS: undefined })).toBe(true);
    expect(apiDocsServed({ NODE_ENV: 'production', API_DOCS: undefined })).toBe(false);
    expect(apiDocsServed({ NODE_ENV: 'production', API_DOCS: 'on' })).toBe(true);
  });

  it('fournit des secrets de repli non secrets hors production', () => {
    const env = loadEnv(base, { dotenv: false });
    expect(env.JWT_ACCESS_SECRET).toMatch(/non-secret/);
  });
});
