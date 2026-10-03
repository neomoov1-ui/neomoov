/**
 * Réglages de l'empreinte native (`@expo/fingerprint`) des deux applications, chargés par leur `fingerprint.config.js`
 * (revue du 2 octobre 2026, constat mobile 5). L'empreinte sert de version d'exécution (`runtimeVersion` à la politique
 * `fingerprint`) : une mise à jour à la volée ne vise que les builds de même empreinte. Elle doit donc être identique
 * sur le poste Windows (`eas update`, `eas build`), sur GitHub Actions (`release.yml`) et sur les serveurs d'EAS, et ne
 * suivre que ce qui change la partie native. D'où :
 * - les retours chariot retirés des fichiers texte du projet (copie de travail Windows en CRLF, Linux en LF) ;
 * - hors empreinte : les versions affichées et numéros de build, le projet EAS et les réglages des mises à jour
 *   (`EAS_PROJECT_ID`), les clés Google Maps et le fichier Firebase (lus dans l'environnement du build, absents d'une
 *   mise à jour publiée du poste), les scripts de `package.json` et le `.gitignore` (sans effet sur le code natif d'un
 *   projet sans dossiers `android` et `ios` commités).
 * Fichier CommonJS sans dépendance, chargé par `require` : une erreur ici serait ignorée par Expo (réglages vides),
 * d'où les essais de `test/fingerprint.test.ts`.
 */
'use strict';

/** Fichiers texte du projet dont les fins de ligne dépendent du poste (fichiers à point compris : `.easignore`). */
const TEXT_FILE = /(^|\/)\.[^/]+$|\.(json|js|cjs|mjs|ts|tsx|jsx|xml|plist|gradle|properties|patch|diff|txt|yml|yaml)$/i;

/** Fichiers de clés Firebase : chemin variable selon le poste ou le serveur d'EAS, jamais dans l'empreinte. */
const FIREBASE_FILES = ['**/google-services.json', '**/GoogleService-Info.plist'];

/** Retire les retours chariot d'un morceau de fichier (texte ou octets), sans toucher au reste. */
function withoutCarriageReturns(chunk) {
  if (chunk == null) return chunk;
  if (typeof chunk === 'string') return chunk.includes('\r') ? chunk.replace(/\r/g, '') : chunk;
  return chunk.includes(0x0d) ? Buffer.from(chunk.filter((byte) => byte !== 0x0d)) : chunk;
}

/** Fichier du projet (hors dépendances installées, identiques partout) dont le texte peut varier en fin de ligne. */
function isProjectTextFile(filePath) {
  const posix = String(filePath).replace(/\\/g, '/');
  return !posix.split('/').includes('node_modules') && TEXT_FILE.test(posix);
}

/** Configuration Expo résolue, sans ce qui dépend de l'environnement du build et pas du code natif. */
function stableExpoConfig(contents) {
  const config = JSON.parse(contents);
  // Activation, adresse et vérification des mises à jour : suivent `EAS_PROJECT_ID`, pas la partie native.
  delete config.updates;
  if (config.android && config.android.config) delete config.android.config.googleMaps;
  if (config.ios && config.ios.config) delete config.ios.config.googleMapsApiKey;
  return JSON.stringify(config);
}

/** Crochet d'`@expo/fingerprint` : appelé pour chaque morceau de fichier et pour chaque contenu calculé. */
function fileHookTransform(source, chunk, isEndOfFile, encoding) {
  if (source.type === 'contents') return source.id === 'expoConfig' && typeof chunk === 'string' ? stableExpoConfig(chunk) : chunk;
  return isProjectTextFile(source.filePath) ? withoutCarriageReturns(chunk) : chunk;
}

module.exports = {
  sourceSkips: ['ExpoConfigVersions', 'ExpoConfigEASProject', 'PackageJsonScriptsAll', 'GitIgnore'],
  ignorePaths: FIREBASE_FILES,
  fileHookTransform,
  // Exposés pour les essais.
  withoutCarriageReturns,
  isProjectTextFile,
  stableExpoConfig,
};
