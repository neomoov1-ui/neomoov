// Conditions de vente (page 1909), version du 2 octobre 2026 : la formation s'appelle « Neomoov Chauffeur Pro »,
// l'application fournie « Neomoov Booster ». Prix, accès, remboursement, recours et adresse de la page inchangés
// (l'adresse /conditions-cap-chauffeur/ sert de référence au contrôle du paiement : ne pas la changer).
// Usage : node academy/outils/renommage-conditions-2026-10-02.cjs [--appliquer]   (sans option : simulation)
const wp = require('C:/Users/PC/OneDrive/Desktop/sauvegarde Octobre 2026/Téléchargement/jarvis-starter-kit/jarvis-starter-kit/livrables/sites-web/neomoov-site-wordpress/outils/wp.js');

const edits = [
  ['version du 1er octobre 2026 ; version précédente du 29 septembre 2026 sauvegardée.',
   'version du 2 octobre 2026 (noms Neomoov Chauffeur Pro et Neomoov Booster) ; versions précédentes des 29 septembre et 1er octobre 2026 sauvegardées.', 1],
  ['<p>Version du 1er octobre 2026 · Édition écrite · Paiement unique</p>', '<p>Version du 2 octobre 2026 · Édition écrite · Paiement unique</p>', 1],
  ['l’application Neomoov Chauffeur Pro en version web', 'l’application Neomoov Booster en version web', 1],
  ['L’application Neomoov Chauffeur Pro est fournie en version web', 'L’application Neomoov Booster est fournie en version web', 1],
  ['CAP CHAUFFEUR', 'Neomoov Chauffeur Pro'],
];

(async () => {
  const page = (await wp.api('GET', '/wp/v2/pages/1909?context=edit')).json;
  let raw = page.content.raw;
  if (raw.includes('Version du 2 octobre 2026')) { console.log('déjà en version du 2 octobre 2026 : rien à faire'); return; }
  for (const [from, to, expected] of edits) {
    const n = raw.split(from).length - 1;
    if (expected !== undefined ? n !== expected : n < 1) throw Error(`ancre trouvée ${n} fois : ${from.slice(0, 80)}`);
    raw = raw.split(from).join(to);
    console.log(`${n} × « ${from.slice(0, 60)} »`);
  }
  const titre = 'Conditions de vente — Neomoov Chauffeur Pro';
  console.log(`titre : « ${page.title.raw} » -> « ${titre} » ; contenu ${page.content.raw.length} -> ${raw.length} caractères`);
  if (!process.argv.includes('--appliquer')) { console.log('simulation : rien publié'); return; }
  await wp.api('POST', '/wp/v2/pages/1909', { content: raw, title: titre });
  const after = (await wp.api('GET', '/wp/v2/pages/1909?context=edit')).json;
  console.log(after.content.raw === raw && after.title.raw === titre ? 'conditions publiées et relues à l’identique' : 'ATTENTION : contenu relu différent');
  console.log('adresse inchangée :', after.link);
})().catch((e) => { console.log('erreur :', e.message.slice(0, 300)); process.exit(1); });
