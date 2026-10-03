import { describe, expect, it } from 'vitest';
import fingerprint from '../expo/fingerprint.cjs';

const file = (filePath: string) => ({ type: 'file' as const, filePath });
const bytes = (value: string) => Uint8Array.from(value, (c) => c.charCodeAt(0));
const text = (chunk: string | Uint8Array | null) => (chunk === null ? null : typeof chunk === 'string' ? chunk : String.fromCharCode(...chunk));

describe('empreinte native des applications (politique fingerprint)', () => {
  it('retire les retours chariot des fichiers texte du projet, en texte comme en octets', () => {
    const crlf = bytes('{\r\n  "cli": {}\r\n}\r\n');
    expect(text(fingerprint.fileHookTransform(file('eas.json'), crlf, false, 'buffer'))).toBe('{\n  "cli": {}\n}\n');
    expect(fingerprint.fileHookTransform(file('app.config.ts'), 'a\r\nb', false, 'utf8')).toBe('a\nb');
    expect(fingerprint.fileHookTransform(file('.easignore'), 'x\r\n', false, 'utf8')).toBe('x\n');
    expect(fingerprint.fileHookTransform(file('eas.json'), null, true, 'utf8')).toBeNull();
  });

  it('laisse intacts les fichiers binaires et les dépendances installées', () => {
    const png = new Uint8Array([0x89, 0x50, 0x0d, 0x0a]);
    expect(fingerprint.fileHookTransform(file('assets/images/icon.png'), png, false, 'buffer')).toBe(png);
    expect(fingerprint.fileHookTransform(file('../../node_modules/.pnpm/x/node_modules/x/build.gradle'), 'a\r\n', false, 'utf8')).toBe('a\r\n');
    expect(fingerprint.isProjectTextFile('android\\app\\build.gradle')).toBe(true);
    expect(fingerprint.isProjectTextFile('..\\..\\node_modules\\x\\index.js')).toBe(false);
  });

  it('la même configuration Expo, avec ou sans projet EAS ni clés Google Maps', () => {
    const base = { name: 'Neomoov', runtimeVersion: { policy: 'fingerprint' }, android: { package: 'com.neomoov.client', config: {} }, ios: { config: { usesNonExemptEncryption: false } } };
    const withEnv = {
      ...base,
      updates: { enabled: true, url: 'https://u.expo.dev/03eac131-c27d-4ada-8fac-36b7d96b72e4', checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 },
      android: { ...base.android, config: { googleMaps: { apiKey: 'cle-essai' } } },
      ios: { config: { usesNonExemptEncryption: false, googleMapsApiKey: 'cle-essai' } },
    };
    const withoutEnv = { ...base, updates: { enabled: false } };
    const contents = { type: 'contents' as const, id: 'expoConfig' };
    const a = fingerprint.fileHookTransform(contents, JSON.stringify(withEnv), true, 'utf8');
    const b = fingerprint.fileHookTransform(contents, JSON.stringify(withoutEnv), true, 'utf8');
    expect(a).toBe(b);
    expect(a).not.toContain('cle-essai');
    expect(a).toContain('"usesNonExemptEncryption":false');
    // Les autres contenus calculés (liaison des modules natifs) ne sont pas touchés.
    expect(fingerprint.fileHookTransform({ type: 'contents', id: 'expoAutolinkingConfig:android' }, '{"a":1}', true, 'utf8')).toBe('{"a":1}');
  });

  it('versions, projet EAS, scripts et .gitignore hors empreinte ; fichiers Firebase ignorés', () => {
    expect(fingerprint.sourceSkips).toEqual(['ExpoConfigVersions', 'ExpoConfigEASProject', 'PackageJsonScriptsAll', 'GitIgnore']);
    expect(fingerprint.ignorePaths).toContain('**/google-services.json');
    expect(fingerprint.ignorePaths).toContain('**/GoogleService-Info.plist');
  });
});
