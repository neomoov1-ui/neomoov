// Configuration Metro : celle d'Expo (monorepo détecté d'office), plus l'identifiant de débogage de Sentry écrit dans
// chaque paquet JavaScript et dans sa carte de source (revue du 2 octobre 2026, constat mobile 14) : les erreurs reçues
// par Sentry sont relues sur le code d'origine, après un build EAS comme après une mise à jour à la volée. Sans DSN
// (`EXPO_PUBLIC_SENTRY_DSN`), l'application n'envoie rien ; l'identifiant reste sans effet.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
