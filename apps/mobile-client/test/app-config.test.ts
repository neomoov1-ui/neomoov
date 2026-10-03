import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import appConfig, { assertReleaseApiUrl } from '../app.config';
import appJson from '../app.json';
import easJson from '../eas.json';

/** Variables lues par `app.config.ts`, remises dans leur état après chaque essai. */
const ENV = ['EAS_PROJECT_ID', 'GOOGLE_MAPS_ANDROID_KEY', 'GOOGLE_MAPS_IOS_KEY', 'GOOGLE_SERVICES_JSON'] as const;
const WELL_KNOWN = join(__dirname, '..', '..', '..', 'infra', 'well-known');

let saved: Record<string, string | undefined> = {};
let root = '';

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  for (const name of ENV) delete process.env[name];
  root = mkdtempSync(join(tmpdir(), 'neomoov-client-config-'));
});

afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  rmSync(root, { recursive: true, force: true });
});

/** Configuration résolue comme par Expo, avec un dossier d'application temporaire (fichier Firebase ou non). */
function resolve(projectRoot = root): ExpoConfig {
  const context = { config: appJson.expo as unknown as ExpoConfig, projectRoot, staticConfigPath: null, packageJsonPath: null };
  return appConfig(context as unknown as ConfigContext);
}

describe('configuration Expo de l\'application client', () => {
  it('version d\'exécution par empreinte native', () => {
    expect(resolve().runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it('fichier Firebase seulement s\'il existe : copie locale d\'abord, sinon variable EAS de type fichier', () => {
    expect(resolve().android?.googleServicesFile).toBeUndefined();
    const fromEas = join(root, 'variable-eas.json');
    writeFileSync(fromEas, '{}');
    process.env['GOOGLE_SERVICES_JSON'] = fromEas;
    expect(resolve().android?.googleServicesFile).toBe(fromEas);
    writeFileSync(join(root, 'google-services.json'), '{}');
    expect(resolve().android?.googleServicesFile).toBe('./google-services.json');
    process.env['GOOGLE_SERVICES_JSON'] = join(root, 'absent.json');
    rmSync(join(root, 'google-services.json'));
    expect(resolve().android?.googleServicesFile).toBeUndefined();
  });

  it('liens universels : neomoov.net/c/ pour l\'application client', () => {
    const config = resolve();
    expect(config.ios?.associatedDomains).toEqual(['applinks:neomoov.net']);
    expect(config.android?.intentFilters).toEqual([{ action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host: 'neomoov.net', pathPrefix: '/c/' }], category: ['BROWSABLE', 'DEFAULT'] }]);
  });

  it('fichiers d\'association à publier, accordés à la configuration', () => {
    const aasa = JSON.parse(readFileSync(join(WELL_KNOWN, 'apple-app-site-association'), 'utf8')) as { applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] } };
    const teamId = easJson.submit.production.ios.appleTeamId;
    const client = aasa.applinks.details.find((d) => d.appIDs.includes(`${teamId}.${appJson.expo.ios.bundleIdentifier}`));
    expect(client?.components.map((c) => c['/'])).toEqual(['/c/*']);
    const others = aasa.applinks.details.filter((d) => d !== client).flatMap((d) => d.components.map((c) => c['/']));
    expect(others).not.toContain('/c/*');

    const links = JSON.parse(readFileSync(join(WELL_KNOWN, 'assetlinks.json'), 'utf8')) as { relation: string[]; target: { package_name: string; sha256_cert_fingerprints: string[] } }[];
    const statement = links.find((l) => l.target.package_name === appJson.expo.android.package);
    expect(statement?.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    // Empreinte SHA-256 (32 octets en hexadécimal, séparés par « : ») ou valeur à compléter signalée comme telle.
    for (const value of statement?.target.sha256_cert_fingerprints ?? []) expect(value).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$|^A_COMPLETER_/);
    expect(statement?.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
  });

  it('Sentry : greffon Expo sans réglage secret, envoi des cartes de source facultatif dans les builds', () => {
    expect(appJson.expo.plugins).toContain('@sentry/react-native/expo');
    expect(easJson.build.base.env).toEqual({ SENTRY_ALLOW_FAILURE: 'true' });
  });

  it('build de prévisualisation ou de production : adresse HTTPS de l\'API exigée, jamais l\'adresse locale de repli (constat mobile 21)', () => {
    expect(() => assertReleaseApiUrl({ EAS_BUILD_PROFILE: 'production' })).toThrow(/EXPO_PUBLIC_API_BASE_URL/);
    expect(() => assertReleaseApiUrl({ EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_API_BASE_URL: 'http://localhost:4000' })).toThrow();
    expect(() => assertReleaseApiUrl({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_API_BASE_URL: 'https://127.0.0.1:4000' })).toThrow();
    expect(() => assertReleaseApiUrl({ EAS_BUILD_PROFILE: 'development', EXPO_PUBLIC_API_BASE_URL: 'http://10.0.2.2:4000' })).not.toThrow();
    expect(() => assertReleaseApiUrl({})).not.toThrow();
    for (const profile of ['preview', 'production'] as const) {
      expect(() => assertReleaseApiUrl({ EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_BASE_URL: easJson.build[profile].env.EXPO_PUBLIC_API_BASE_URL })).not.toThrow();
    }
  });
});
