// Empreinte native (`runtimeVersion` à la politique `fingerprint`, `app.config.ts`) : réglages communs aux deux
// applications, chemin relatif pour être lu avant comme après l'installation des dépendances (serveurs d'EAS compris).
module.exports = require('../../packages/mobile-core/expo/fingerprint.cjs');
