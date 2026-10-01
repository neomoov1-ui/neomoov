// Lot 2 (1er octobre 2026) : aligne les documents du dossier academy sur la version en ligne
// (conditions du 1er octobre 2026, 7 modules, quiz, attestation, Neomoov Chauffeur Pro). Rejouable.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function edit(rel, pairs) {
  const f = path.join(root, rel);
  let t = fs.readFileSync(f, 'utf8');
  let changed = 0;
  for (const [from, to] of pairs) {
    if (t.includes(to) && !t.includes(from)) continue;
    const n = t.split(from).length - 1;
    if (n !== 1) throw Error(`${rel} : ancre trouvée ${n} fois : ${from.slice(0, 70)}`);
    t = t.replace(from, () => to);
    changed++;
  }
  fs.writeFileSync(f, t);
  console.log(`${rel} : ${changed} modification(s)`);
}

edit('docs/CONDITIONS_CAP_CHAUFFEUR_PUBLICATION.md', [
  ['Version du 29 septembre 2026 · Édition écrite · Paiement unique', 'Version du 1er octobre 2026 · Édition écrite · Paiement unique'],
  ['comprenant sept microleçons et huit fiches pratiques, avec exercices, exemples et corrections.',
   'comprenant sept modules et huit fiches pratiques, avec exercices, exemples et corrections, un quiz par module, une attestation de suivi vérifiable et l’application Neomoov Chauffeur Pro en version web.'],
  ['### Les sept microleçons\n\n- Traiter son activité comme une entreprise organisée.\n- Organiser la journée sans courir après chaque course.\n- Lire ses chiffres sans confondre recettes et résultat.\n- Un véhicule agréable, organisé et préparé.\n- Satisfaire le client avec un service simple et constant.\n- Gérer une tension et préparer une réclamation utile.\n- Progresser en 30 jours et tester un projet de transport.\n',
   '### Les sept modules\n\n- Votre entreprise de chauffeur : cadre, conformité et vérification du véhicule.\n- Votre journée et chaque prise en charge.\n- Votre rentabilité réelle et le choix du véhicule.\n- L’expérience client et le kit du bon chauffeur.\n- Prévenir les risques et gérer les incidents.\n- Outils numériques, paiements et litiges.\n- Une activité durable et une clientèle fidèle.\n\n### Quiz et attestation de suivi\n\nChaque module se termine par un quiz de cinq questions, corrigé en ligne, qui peut être repris autant de fois que nécessaire pendant la période d’accès. Lorsque les sept quiz sont réussis, avec au moins quatre bonnes réponses sur cinq par module, le client peut obtenir une attestation de suivi portant le nom qu’il indique et un code de vérification. Toute personne disposant de ce code peut en vérifier la validité sur le site ; seuls le prénom, l’initiale du nom et la date de réussite y sont affichés. L’attestation confirme le suivi d’une formation complémentaire : elle ne constitue ni un permis, ni une certification, ni une équivalence de la formation obligatoire. Elle cesse d’être valide en cas de remboursement de l’achat.\n'],
  ['Les applications Play Store et App Store, une licence d’équipe et un accompagnement individuel continu ne font pas partie de cette offre.',
   'L’application Neomoov Chauffeur Pro est fournie en version web ; ses versions Play Store et App Store, une licence d’équipe et un accompagnement individuel continu ne font pas partie de cette offre.'],
  ['La consultation d’une leçon ne fait pas perdre', 'La consultation d’un module ne fait pas perdre'],
  ['y compris lorsqu’ils s’appuient sur des photos et un questionnaire.\n',
   'y compris lorsqu’ils s’appuient sur des photos et un questionnaire.\n\nLa fiche de vérification avant départ aide le chauffeur à consigner ses propres vérifications ; elle ne remplace ni une inspection mécanique ni les obligations du chauffeur et de l’exploitant du véhicule.\n'],
]);

edit('README.md', [
  ['https://neomoov.net/academy/ (douze routes)', 'https://neomoov.net/academy/ (quatorze routes, dont `/academy/chauffeur-pro/` et `/academy/attestation/`)'],
  ['7 microleçons écrites, 8 fiches pratiques (gratuites), exercices et corrigés ; accès 12 mois',
   '7 modules écrits avec exercices corrigés, quiz (5 questions, 4 bonnes réponses pour valider) et sources officielles ; attestation de suivi vérifiable par code ; 8 fiches pratiques (gratuites) ; application Neomoov Chauffeur Pro (version web, ex-compagnon web) ; accès 12 mois'],
  ['vidéos non produites (scripts) ; applications mobiles non livrées', 'vidéos non produites (scripts à réécrire pour les nouveaux modules) ; Neomoov Chauffeur Pro en version web seulement'],
  ['- `livraison/wordpress/` : sources du code (routeur `neomoov-academy.php`, `square-checkout-api.php`,',
   '- `livraison/wordpress/` : sources du code (routeur `neomoov-academy.php`, `formation-attestation.php` pour les modules,\n  les quiz, l’attestation et la fiche de vérification, `square-checkout-api.php`,'],
  ['- `livraison/formation/data.json` : source structurée des leçons et des fiches (une correction pédagogique se fait ici).',
   '- `livraison/formation/modules/m1.json` à `m7.json` : source des sept modules (texte, exercice, quiz, sources) ;\n  `node outils/lot2-modules.cjs` les intègre à `livraison/formation/data.json`, qui porte aussi les huit fiches.'],
  ['(contrôle des douze\n   routes ; restauration si une page n\'est pas saine).',
   '(contrôle des quatorze\n   adresses ; restauration si une page n\'est pas saine).'],
  ['Voir `docs/REVISION_2026-10-01.md`, section 4 : contenu enrichi (lot 2), recette de vente réelle (lot 3), performance',
   'Voir `docs/REVISION_2026-10-01.md` : lot 2 livré le 1er octobre 2026 (section 6) ; restent la recette de vente réelle (lot 3), la performance'],
]);

const rev = path.join(root, 'docs/REVISION_2026-10-01.md');
let r = fs.readFileSync(rev, 'utf8');
if (!r.includes('## 6. Lot 2 livré')) {
  r = r.replace(/\s*$/, '\n') + `
## 6. Lot 2 livré le 1er octobre 2026 (soir)

- **Contenu** : sept modules réécrits à partir des notes du fondateur (kit du bon chauffeur, numéro dédié, tablette,
  vérification avant départ, véhicule 100 % électrique, études de marché, plaintes des clients et des chauffeurs,
  formations existantes) ; 5 817 mots, 35 questions, sources officielles vérifiées (SAAQ, CTQ, Revenu Québec, CAI, CDPDJ,
  CAA-Québec). Sources : \`livraison/formation/modules/m1.json\` à \`m7.json\`, intégrées par \`outils/lot2-modules.cjs\`.
- **Quiz** : cinq questions par module, corrigées côté serveur ; quatre bonnes réponses valident le module ; reprise
  illimitée ; explication après chaque essai ; bonnes réponses réparties sur les trois positions.
- **Progression** « x / 7 » dans la formation et l'espace membre ; impression d'un module seul en PDF.
- **Attestation de suivi** : délivrée après les sept quiz, nom confirmé par le membre puis figé, code \`CAP-XXXX-XXXX\` ;
  vérification publique \`/academy/attestation/?code=…\` (prénom, initiale du nom, date) et
  \`GET /wp-json/neomoov-academy/v1/attestation/{code}\` (réponse \`{"valid": …}\`) ; invalide après remboursement ou révocation.
- **Neomoov Chauffeur Pro** (nom choisi par le fondateur le 1er octobre 2026) : remplace « compagnon web » partout ;
  adresse \`/academy/chauffeur-pro/\` (l'ancienne redirige en 301) ; nouvelle fiche de vérification avant départ (points
  demandés par la SAAQ et bonnes pratiques), imprimable, jamais transmise à Neomoov.
- **Lien Neomoov** : bloc « Rouler avec Neomoov » (page de vente, formation, attestation) vers la préinscription des
  chauffeurs, sans garantie d'admission, de courses ni de revenus.
- **Conditions de vente** : version du 1er octobre 2026 publiée (page 1909) ; prix, accès, remboursement et recours
  inchangés ; version précédente sauvegardée dans \`neomoov-outils/academy/sauvegardes\` ; l'étiquette de version du
  parcours Square passe automatiquement à \`2026-10-01\` (les achats conclus gardent leur copie figée). Le contrat envoyé
  aux acheteurs décrit le nouveau contenu.
- **Essais** : banc PHP 8.3 hors ligne (visiteur, membre payé, membre gratuit, administrateur ; quiz, attestation,
  vérification, remboursement) sans échec ; mise en ligne avec contrôle des quatorze adresses.

Restent à décider ou à produire : vidéos et retranscriptions audio des sept modules (les scripts vidéo datent des
anciennes leçons), PDF de retranscription par module, recette de vente réelle (lot 3), lots 4 et 5.
`;
  fs.writeFileSync(rev, r);
  console.log('docs/REVISION_2026-10-01.md : section 6 ajoutée');
}
