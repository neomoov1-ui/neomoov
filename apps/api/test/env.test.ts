import { describe, expect, it } from 'vitest';
import { apiDocsServed, cardPaymentsEnabled, loadEnv, MIN_SECRET_LENGTH, squareConfig } from '../src/config/env.js';

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
    const secrets = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), ENCRYPTION_KEY: 'c'.repeat(32) };
    expect(() => loadEnv(secrets, { dotenv: false })).toThrow(/REDIS_URL/);
    expect(() => loadEnv({ ...secrets, REDIS_URL: 'redis://redis:6379' }, { dotenv: false })).toThrow(/SOCIAL_LOGIN_PROVIDER/);
    expect(() => loadEnv({ ...secrets, REDIS_URL: 'redis://redis:6379', SOCIAL_LOGIN_PROVIDER: 'mock' }, { dotenv: false })).toThrow(/SOCIAL_LOGIN_PROVIDER/);
    const ready = { ...secrets, REDIS_URL: 'redis://redis:6379', SOCIAL_LOGIN_PROVIDER: 'real' };
    // Revue finale : aucun retour silencieux aux simulateurs en production ; chaque simulation est déclarée.
    expect(() => loadEnv(ready, { dotenv: false })).toThrow(/fournisseurs simulés non déclarés.*SMS_PROVIDER/);
    // Phase 1 « entreprise autonome » : le marketing (onze espaces, site, voix, Search Console) est un fournisseur de plus (alias `marketing`).
    const all = 'payment,maps,sms,email,push,whatsapp,voice,llm,sev,storage,antivirus,crm,billing,marketing';
    expect(loadEnv({ ...ready, ALLOW_MOCK_PROVIDERS: all }, { dotenv: false }).SOCIAL_LOGIN_PROVIDER).toBe('real');
    expect(() => loadEnv({ ...ready, ALLOW_MOCK_PROVIDERS: 'payment,sev' }, { dotenv: false })).toThrow(/storage/);
    expect(() => loadEnv({ ...ready, ALLOW_MOCK_PROVIDERS: 'payment,maps,sms,email,push,whatsapp,voice,llm,sev,storage,antivirus,crm,billing' }, { dotenv: false })).toThrow(/MARKETING_PROVIDER/);
    const real = { ...ready, SMS_PROVIDER: 'real', EMAIL_PROVIDER: 'real', PUSH_PROVIDER: 'real', MAPS_PROVIDER: 'real', STORAGE_PROVIDER: 'real', LLM_PROVIDER: 'real', VIRUS_SCANNER_PROVIDER: 'real', CRM_PROVIDER: 'real', BILLING_PROVIDER: 'real', MARKETING_PROVIDER: 'real' };
    expect(loadEnv({ ...real, ALLOW_MOCK_PROVIDERS: 'payment, SEV ,whatsapp,voice' }, { dotenv: false }).PAYMENT_PROVIDER).toBe('mock');
  });

  it('revue du 2 octobre 2026 (sécurité 12) : secrets JWT et clé de chiffrement de 32 caractères au moins en production, pas de minimum ailleurs', () => {
    expect(MIN_SECRET_LENGTH).toBe(32);
    const ready = { ...base, NODE_ENV: 'production', REDIS_URL: 'redis://redis:6379', SOCIAL_LOGIN_PROVIDER: 'real', ALLOW_MOCK_PROVIDERS: 'payment,maps,sms,email,push,whatsapp,voice,llm,sev,storage,antivirus,crm,billing,marketing' };
    const long = { JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(40), ENCRYPTION_KEY: 'c'.repeat(64) };
    expect(loadEnv({ ...ready, ...long }, { dotenv: false }).ENCRYPTION_KEY).toBe('c'.repeat(64));
    expect(() => loadEnv({ ...ready, ...long, JWT_ACCESS_SECRET: 'a'.repeat(31) }, { dotenv: false })).toThrow(/JWT_ACCESS_SECRET : 32 caractères au moins/);
    expect(() => loadEnv({ ...ready, ...long, JWT_REFRESH_SECRET: 'court' }, { dotenv: false })).toThrow(/JWT_REFRESH_SECRET : 32 caractères/);
    expect(() => loadEnv({ ...ready, ...long, ENCRYPTION_KEY: 'dev-encryption-key-non-secret-32b'.slice(0, 20) }, { dotenv: false })).toThrow(/ENCRYPTION_KEY : 32 caractères/);
    // Les secrets manquants restent signalés comme tels, avant la longueur.
    expect(() => loadEnv({ ...ready, ...long, ENCRYPTION_KEY: '' }, { dotenv: false })).toThrow(/ENCRYPTION_KEY obligatoire/);
    // Hors production : un secret court est accepté (valeurs de repli en développement et en test).
    expect(loadEnv({ ...base, JWT_ACCESS_SECRET: 'court' }, { dotenv: false }).JWT_ACCESS_SECRET).toBe('court');
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

  it('Square (étape 26) : valeurs de l\'environnement effectif, démarrage refusé en production sans ses variables', () => {
    const square = { SQUARE_ACCESS_TOKEN: 'EAAAprod', SQUARE_APPLICATION_ID: 'sq0idp-x', SQUARE_LOCATION_ID: 'LPROD', SQUARE_SANDBOX_ACCESS_TOKEN: 'EAAAsandbox', SQUARE_SANDBOX_APPLICATION_ID: 'sandbox-sq0idb-x', SQUARE_SANDBOX_LOCATION_ID: 'LSANDBOX' };
    // Hors production : bac à sable par défaut, jamais les valeurs de production.
    const dev = squareConfig(loadEnv({ ...base, PAYMENT_PROVIDER: 'square', ...square }, { dotenv: false }));
    expect(dev).toMatchObject({ environment: 'sandbox', accessToken: 'EAAAsandbox', applicationId: 'sandbox-sq0idb-x', locationId: 'LSANDBOX' });
    expect(dev.missing).toEqual(['SQUARE_WEBHOOK_SIGNATURE_KEY', 'SQUARE_WEBHOOK_URL']);
    const noSandboxLocation = squareConfig(loadEnv({ ...base, ...square, SQUARE_SANDBOX_LOCATION_ID: '' }, { dotenv: false }));
    expect(noSandboxLocation.locationId).toBeUndefined();
    expect(noSandboxLocation.missing).toContain('SQUARE_SANDBOX_LOCATION_ID');
    expect(squareConfig(loadEnv({ ...base, ...square, SQUARE_ENVIRONMENT: 'production' }, { dotenv: false }))).toMatchObject({ environment: 'production', accessToken: 'EAAAprod', locationId: 'LPROD' });
    expect(() => loadEnv({ ...base, SQUARE_ENVIRONMENT: 'live' }, { dotenv: false })).toThrow(/SQUARE_ENVIRONMENT/);
    expect(() => loadEnv({ ...base, PAYMENT_PROVIDER: 'paypal' }, { dotenv: false })).toThrow(/PAYMENT_PROVIDER/);

    const ready = {
      ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), ENCRYPTION_KEY: 'c'.repeat(32), REDIS_URL: 'redis://redis:6379', SOCIAL_LOGIN_PROVIDER: 'real',
      ALLOW_MOCK_PROVIDERS: 'maps,sms,email,push,whatsapp,voice,llm,sev,storage,antivirus,crm,billing', PAYMENT_PROVIDER: 'square',
    };
    expect(() => loadEnv(ready, { dotenv: false })).toThrow(/PAYMENT_PROVIDER=square.*SQUARE_ACCESS_TOKEN, SQUARE_APPLICATION_ID, SQUARE_LOCATION_ID, SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL/);
    expect(() => loadEnv({ ...ready, ...square }, { dotenv: false })).toThrow(/SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL/);
    const live = loadEnv({ ...ready, ...square, SQUARE_WEBHOOK_SIGNATURE_KEY: 'cle', SQUARE_WEBHOOK_URL: 'https://api.neomoov.net/v1/webhooks/square' }, { dotenv: false });
    expect(squareConfig(live)).toMatchObject({ environment: 'production', accessToken: 'EAAAprod', missing: [] });
    // Paiement par carte proposé en production avec Square comme avec Stripe ; jamais avec le simulateur.
    expect(cardPaymentsEnabled(live)).toBe(true);
    expect(cardPaymentsEnabled({ ...live, PAYMENT_PROVIDER: 'mock' })).toBe(false);
    expect(cardPaymentsEnabled({ ...live, PAYMENT_PROVIDER: 'stripe' })).toBe(true);
  });
});
