// Lot 2 (1er octobre 2026) : conditions de vente CAP CHAUFFEUR (page 1909), version du 1er octobre 2026.
// Remplace la liste des microleçons par les 7 modules, ajoute quiz, attestation de suivi et Neomoov Chauffeur Pro.
// Prix, taxes, accès, remboursement et recours inchangés. Sauvegarder d'abord avec academy-sauvegarde.cjs.
// Usage : node academy/outils/lot2-conditions.cjs [--appliquer]   (sans option : simulation)
const wp = require('C:/Users/PC/OneDrive/Desktop/sauvegarde Octobre 2026/Téléchargement/jarvis-starter-kit/jarvis-starter-kit/livrables/sites-web/neomoov-site-wordpress/outils/wp.js');

const edits = [
  ['publiée le 29 septembre 2026 à 14 h 27 EDT.', 'version du 1er octobre 2026 ; version précédente du 29 septembre 2026 sauvegardée.'],
  ['<p>Version du 29 septembre 2026 · Édition écrite · Paiement unique</p>', '<p>Version du 1er octobre 2026 · Édition écrite · Paiement unique</p>'],
  ['comprenant sept microleçons et huit fiches pratiques, avec exercices, exemples et corrections.</p>',
   'comprenant sept modules et huit fiches pratiques, avec exercices, exemples et corrections, un quiz par module, une attestation de suivi vérifiable et l’application Neomoov Chauffeur Pro en version web.</p>'],
  ['<h3>Les sept microleçons</h3>\n<ul><li>Traiter son activité comme une entreprise organisée.</li><li>Organiser la journée sans courir après chaque course.</li><li>Lire ses chiffres sans confondre recettes et résultat.</li><li>Un véhicule agréable, organisé et préparé.</li><li>Satisfaire le client avec un service simple et constant.</li><li>Gérer une tension et préparer une réclamation utile.</li><li>Progresser en 30 jours et tester un projet de transport.</li></ul>',
   '<h3>Les sept modules</h3>\n<ul><li>Votre entreprise de chauffeur : cadre, conformité et vérification du véhicule.</li><li>Votre journée et chaque prise en charge.</li><li>Votre rentabilité réelle et le choix du véhicule.</li><li>L’expérience client et le kit du bon chauffeur.</li><li>Prévenir les risques et gérer les incidents.</li><li>Outils numériques, paiements et litiges.</li><li>Une activité durable et une clientèle fidèle.</li></ul>\n<h3>Quiz et attestation de suivi</h3>\n<p>Chaque module se termine par un quiz de cinq questions, corrigé en ligne, qui peut être repris autant de fois que nécessaire pendant la période d’accès. Lorsque les sept quiz sont réussis, avec au moins quatre bonnes réponses sur cinq par module, le client peut obtenir une attestation de suivi portant le nom qu’il indique et un code de vérification. Toute personne disposant de ce code peut en vérifier la validité sur le site ; seuls le prénom, l’initiale du nom et la date de réussite y sont affichés. L’attestation confirme le suivi d’une formation complémentaire : elle ne constitue ni un permis, ni une certification, ni une équivalence de la formation obligatoire. Elle cesse d’être valide en cas de remboursement de l’achat.</p>'],
  ['Les applications Play Store et App Store, une licence d’équipe et un accompagnement individuel continu ne font pas partie de cette offre.',
   'L’application Neomoov Chauffeur Pro est fournie en version web ; ses versions Play Store et App Store, une licence d’équipe et un accompagnement individuel continu ne font pas partie de cette offre.'],
  ['La consultation d’une leçon ne fait pas perdre', 'La consultation d’un module ne fait pas perdre'],
  ['y compris lorsqu’ils s’appuient sur des photos et un questionnaire.</p>',
   'y compris lorsqu’ils s’appuient sur des photos et un questionnaire.</p>\n<p>La fiche de vérification avant départ aide le chauffeur à consigner ses propres vérifications ; elle ne remplace ni une inspection mécanique ni les obligations du chauffeur et de l’exploitant du véhicule.</p>'],
];

(async () => {
  const page = (await wp.api('GET', '/wp/v2/pages/1909?context=edit')).json;
  let raw = page.content.raw;
  if (raw.includes('Version du 1er octobre 2026')) { console.log('déjà en version du 1er octobre 2026 : rien à faire'); return; }
  for (const [from, to] of edits) {
    const n = raw.split(from).length - 1;
    if (n !== 1) throw Error(`ancre trouvée ${n} fois : ${from.slice(0, 80)}`);
    raw = raw.replace(from, () => to);
  }
  console.log(`${edits.length} modifications prêtes (${page.content.raw.length} -> ${raw.length} caractères)`);
  if (!process.argv.includes('--appliquer')) { console.log('simulation : rien publié'); return; }
  await wp.api('POST', '/wp/v2/pages/1909', { content: raw });
  const after = (await wp.api('GET', '/wp/v2/pages/1909?context=edit')).json;
  console.log(after.content.raw === raw ? 'conditions publiées et relues à l’identique' : 'ATTENTION : contenu relu différent');
})().catch((e) => { console.log('erreur :', e.message.slice(0, 300)); process.exit(1); });
