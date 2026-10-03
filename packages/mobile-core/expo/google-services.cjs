/**
 * Script `eas-build-pre-install` des deux applications, exécuté sur les serveurs d'EAS avant l'installation des
 * dépendances (dossier courant : celui de l'application). Copie le fichier Firebase de la variable EAS de type fichier
 * `GOOGLE_SERVICES_JSON` en `google-services.json` dans le dossier de l'application : `app.config.ts` le trouve à ce
 * chemin fixe, que l'empreinte native ignore (`fingerprint.cjs`), d'où la même version d'exécution que sur le poste.
 * Sans variable, ou si le fichier est déjà là, rien n'est fait. Le contenu n'est jamais affiché.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const source = (process.env.GOOGLE_SERVICES_JSON || '').trim();
const target = path.join(process.cwd(), 'google-services.json');

if (!source) {
  console.log('GOOGLE_SERVICES_JSON absent : aucun fichier Firebase (notifications Android sans jeton).');
} else if (fs.existsSync(target)) {
  console.log('google-services.json déjà présent dans le dossier de l\'application : gardé.');
} else if (!fs.existsSync(source)) {
  console.log('GOOGLE_SERVICES_JSON ne désigne pas un fichier : variable EAS de type « file » attendue.');
} else {
  fs.copyFileSync(source, target);
  console.log('google-services.json copié depuis la variable EAS GOOGLE_SERVICES_JSON.');
}
