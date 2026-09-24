import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

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

  it('exige les secrets et Redis en production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' }, { dotenv: false })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'b', ENCRYPTION_KEY: 'c' }, { dotenv: false })).toThrow(/REDIS_URL/);
  });

  it('fournit des secrets de repli non secrets hors production', () => {
    const env = loadEnv(base, { dotenv: false });
    expect(env.JWT_ACCESS_SECRET).toMatch(/non-secret/);
  });
});
