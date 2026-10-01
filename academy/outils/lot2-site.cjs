// Lot 2 (1er octobre 2026) : branche les 7 modules, les quiz, l'attestation de suivi et Neomoov Chauffeur Pro
// dans le code du site Academy. Chaque remplacement doit trouver son ancre exactement une fois.
// Usage : node academy/outils/lot2-site.cjs   (refuse de s'appliquer deux fois)
const fs = require('fs');
const path = require('path');

const wpDir = path.join(__dirname, '..', 'livraison', 'wordpress');
function patch(fileName, edits) {
  const file = path.join(wpDir, fileName);
  let t = fs.readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    const n = t.split(from).length - 1;
    if (n !== 1) throw Error(`${fileName} : ancre trouvée ${n} fois : ${from.slice(0, 90)}`);
    t = t.replace(from, () => to);
  }
  fs.writeFileSync(file, t);
  console.log(`${fileName} : ${edits.length} remplacements`);
}

const main = fs.readFileSync(path.join(wpDir, 'neomoov-academy.php'), 'utf8');
if (main.includes('nma_formation(')) throw Error('lot 2 déjà appliqué');

const modules = [
  ['Votre entreprise de chauffeur, en règle', 'Statut, inscriptions TPS et TVQ, facturation obligatoire, documents à bord et vérification du véhicule avant chaque mise en service.'],
  ['Votre journée et chaque prise en charge', 'Temps réel, choix des courses, rencontre réussie, zones de l’aéroport, hiver et fatigue.'],
  ['Votre rentabilité réelle et le choix du véhicule', 'Prix client, recette et versement, tous les coûts, indicateurs de la semaine ; électrique ou essence.'],
  ['L’expérience client et le kit du bon chauffeur', 'Habitacle, kit recommandé par le fondateur, accueil, conduite souple, accessibilité et objets oubliés.'],
  ['Prévenir les risques et gérer les incidents', 'Reconnaissance mutuelle, nuit, désescalade, dossier factuel et caméra de bord encadrée.'],
  ['Outils numériques, paiements et litiges', 'Téléphone au volant, communications masquées, reçus, rapprochement hebdomadaire et contestation efficace.'],
  ['Une activité durable et une clientèle fidèle', 'Segments, clientèle directe dans les règles, fidélisation, santé, plan de 30 jours et parcours pour rejoindre Neomoov.'],
];
const modulesPhp = `function nma_modules(){return array(${modules.map(([k, v]) => `'${k.replace(/'/g, "\\'")}'=>'${v.replace(/'/g, "\\'")}'`).join(',')});}`;
const oldModules = main.split('\n').find((l) => l.startsWith('function nma_modules(){'));

patch('neomoov-academy.php', [
  // Référencement
  ["$d='Sept microleçons écrites et huit fiches pratiques pour mieux organiser vos journées, soigner chaque trajet et lire vos chiffres. Chauffeurs taxi et VTC à Montréal.';",
   "$d='Sept modules avec quiz et attestation de suivi, huit fiches pratiques et l’application Neomoov Chauffeur Pro, pour chauffeurs taxi et VTC à Montréal.';"],
  ["'Compte gratuit : compagnon web, bilans de journée et fiches pratiques imprimables pour chauffeurs taxi et VTC.'",
   "'Compte gratuit : Neomoov Chauffeur Pro, bilans de journée et fiches pratiques imprimables pour chauffeurs taxi et VTC.'"],
  ["'compagnon'=>array('Compagnon web : bilan de journée et préparation du véhicule'.$s,'Calculez recettes par heure et par kilomètre sur toute votre journée et obtenez une liste de priorités pour votre véhicule. Gratuit, à utiliser à l’arrêt.',false),",
   "'chauffeur-pro'=>array('Neomoov Chauffeur Pro : bilan de journée et vérification du véhicule'.$s,'L’application des chauffeurs CAP CHAUFFEUR : recette par heure et par kilomètre, fiche de vérification avant départ et plan d’amélioration du véhicule. Gratuit, à utiliser à l’arrêt.',false),'attestation'=>array('Vérifier une attestation CAP CHAUFFEUR'.$s,'Vérifiez une attestation de suivi CAP CHAUFFEUR délivrée par Neomoov Academy à partir de son code.',true),"],
  [oldModules, modulesPhp],
  // Actions des membres
  ["\n if($act==='balance'){", "\n if($act==='quiz'||$act==='attestation')return nma_formation_post($act,$uid);\n if($act==='balance'){"],
  // Page de vente
  ['<p class="edition">CAP CHAUFFEUR / Le programme pratique</p>', '<p class="edition">CAP CHAUFFEUR / 7 modules, quiz et attestation de suivi</p>'],
  ['<h2>7 microleçons écrites pour faire progresser votre pratique.</h2><p>L’offre de lancement comprend 7 microleçons écrites avec exercices et corrigés, ainsi que 8 fiches pratiques. Accès formation pendant 12 mois calendaires à compter de l’activation. Les vidéos ne sont pas incluses dans cette offre.</p>',
   '<h2>7 modules pour exercer en règle, en sécurité et avec de meilleurs résultats.</h2><p>Chaque module comprend un exercice corrigé, un quiz de 5 questions et ses sources officielles. Les 7 quiz réussis donnent droit à une attestation de suivi vérifiable par code. L’offre de lancement comprend aussi 8 fiches pratiques et l’application Neomoov Chauffeur Pro en version web. Accès pendant 12 mois calendaires à compter de l’activation. Les vidéos ne sont pas incluses dans cette offre.</p>'],
  ['<p class="eyebrow">LE COMPAGNON WEB</p><h2>Moins d’approximations.<br>Plus de repères.</h2><p>Calculez un bilan d’exploitation et préparez un plan d’amélioration de votre véhicule avec vos observations et votre questionnaire.</p><a class="btn" href="\'.esc_url(nma_url(\'compagnon/\')).\'">Ouvrir les outils</a><p class="small">Application web. Versions PlayStore et AppStore envisagées ultérieurement.</p>',
   '<p class="eyebrow">NEOMOOV CHAUFFEUR PRO</p><h2>Moins d’approximations.<br>Plus de repères.</h2><p>L’application qui accompagne la formation : bilan de journée, fiche de vérification du véhicule avant départ et plan d’amélioration de l’habitacle.</p><a class="btn" href="\'.esc_url(nma_url(\'chauffeur-pro/\')).\'">Ouvrir Neomoov Chauffeur Pro</a><p class="small">Version web, gratuite avec votre espace. Versions Android et iPhone en préparation.</p>'],
  ['<p>Habitacle dégagé</p><p>Point de rencontre confirmé</p><p>Accessoires utiles à portée</p><p>Temps et frais suivis</p>',
   '<p>Vérification avant départ consignée</p><p>Habitacle dégagé, kit à portée</p><p>Point de rencontre confirmé</p><p>Temps et frais suivis</p>'],
  ['<li>7 microleçons écrites avec exercices et corrigés</li><li>8 fiches pratiques imprimables</li><li>Accès formation pendant 12 mois calendaires</li><li>Compagnon web et plan d’action à 30 jours</li>',
   '<li>7 modules écrits avec exercices corrigés et quiz</li><li>Attestation de suivi vérifiable par code</li><li>8 fiches pratiques imprimables</li><li>Neomoov Chauffeur Pro, version web</li><li>Accès formation pendant 12 mois calendaires</li>'],
  ['<section class="wrap section faq">', '<section class="wrap section">\'.nma_join_neomoov().\'</section><section class="wrap section faq">'],
  ['<p>Le compagnon web, les 8 fiches pratiques et l’espace gratuit sont accessibles. L’offre CAP CHAUFFEUR donne accès aux 7 microleçons écrites avec exercices et corrigés pendant 12 mois calendaires après activation. Les vidéos ne sont pas incluses.</p>',
   '<p>Neomoov Chauffeur Pro en version web, les 8 fiches pratiques et l’espace gratuit sont accessibles. L’offre CAP CHAUFFEUR donne accès pendant 12 mois calendaires après activation aux 7 modules écrits, avec exercices corrigés, quiz et attestation de suivi. Les vidéos ne sont pas incluses.</p>'],
  ['Les photos ne quittent pas votre navigateur.</p></details></section>\';}',
   'Les photos ne quittent pas votre navigateur.</p></details><details><summary>Qu’est-ce que l’attestation de suivi ?</summary><p>Elle est délivrée quand les 7 quiz sont réussis, avec au moins 4 bonnes réponses sur 5 par module. Elle porte un code que toute personne, un employeur ou un opérateur par exemple, peut vérifier sur <a class="text-link" href="\'.esc_url(nma_url(\'attestation/\')).\'">la page de vérification</a>. Elle ne remplace aucun permis, aucune formation obligatoire et aucune certification.</p></details><details><summary>La formation permet-elle de rouler avec Neomoov ?</summary><p>Neomoov, plateforme 100 % électrique, sélectionne ses chauffeurs : dossier en règle, véhicule électrique admissible et niveau de service. L’attestation CAP CHAUFFEUR est un atout dans votre candidature, sans garantie d’admission ni de courses.</p></details></section>\';}'],
  // Neomoov Chauffeur Pro (ancien compagnon web)
  ['<p class="eyebrow">LE COMPAGNON WEB</p><h1>Votre activité, plus claire.</h1><p>À utiliser à l’arrêt. Les données du bilan ne sont conservées que si vous choisissez de les enregistrer dans votre compte.</p><section class="panel"><h2>Comptez toute votre journée.</h2>',
   '<p class="eyebrow">NEOMOOV CHAUFFEUR PRO</p><h1>Votre activité, plus claire.</h1><p>L’application des chauffeurs CAP CHAUFFEUR, en version web. À utiliser à l’arrêt. Les données du bilan ne sont conservées que si vous choisissez de les enregistrer dans votre compte ; la fiche de vérification reste sur votre appareil.</p><nav class="toc no-print" aria-label="Outils de Neomoov Chauffeur Pro"><a href="#bilan">Bilan de journée</a><a href="#verification">Vérification avant départ</a><a href="#habitacle">Plan d’amélioration du véhicule</a></nav><section class="panel" id="bilan"><h2>Comptez toute votre journée.</h2>'],
  ['</form></section><section class="panel"><h2>Votre plan d’amélioration du véhicule.</h2>',
   '</form></section>\';nma_check_sheet();echo \'<section class="panel" id="habitacle"><h2>Votre plan d’amélioration du véhicule.</h2>'],
  // Espace membre et formation
  ['echo \'<p>Votre offre de lancement écrite : 7 microleçons avec exercices et corrigés, accompagnées de 8 fiches pratiques. Accès pendant 12 mois calendaires à compter de l’activation. Les vidéos ne sont pas incluses.</p>\';',
   'echo \'<p>Votre offre de lancement écrite : 7 modules avec exercices corrigés, quiz et attestation de suivi, 8 fiches pratiques et l’application Neomoov Chauffeur Pro. Accès pendant 12 mois calendaires à compter de l’activation. Les vidéos ne sont pas incluses.</p>\';'],
  ["foreach((nma_data()['lessons']??array())as$l){echo '<article class=\"panel\"><p class=\"eyebrow\">MICROLEÇON '.nma_e($l['id']).'</p><h2>'.nma_e($l['title']).'</h2><p>'.nma_e($l['intro']).'</p>';foreach($l['sections']as$s)echo '<h3>'.nma_e($s['title']).'</h3><p>'.nma_e($s['text']).'</p>';echo '<h3>Exercice</h3><p>'.nma_e($l['exercise']).'</p><details><summary>Voir le corrigé</summary><p>'.nma_e($l['answer']).'</p></details></article>';}",
   'nma_formation($uid);'],
  ['<h2>Mes outils gratuits</h2><p>Préparez votre véhicule et faites le bilan de votre journée.</p><a class="btn" href="\'.esc_url(nma_url(\'compagnon/\')).\'">Compagnon web</a>',
   '<h2>Neomoov Chauffeur Pro</h2><p>Bilan de journée, fiche de vérification avant départ et plan d’amélioration du véhicule.</p><a class="btn" href="\'.esc_url(nma_url(\'chauffeur-pro/\')).\'">Ouvrir Neomoov Chauffeur Pro</a>'],
  ["if($paid){echo '<p>Votre accès formation est actif.</p><a class=\"btn\" href=\"'.esc_url(nma_url('formation/')).'\">Ouvrir la formation</a>';}",
   "if($paid){list($done,$total)=nma_progress($uid);echo '<p>Votre accès formation est actif. Progression : '.$done.' / '.$total.' modules réussis.</p><a class=\"btn\" href=\"'.esc_url(nma_url('formation/')).'\">Ouvrir la formation</a>';if($total&&$done===$total)echo '<p><a class=\"text-link\" href=\"'.esc_url(nma_url('attestation/')).'\">Mon attestation de suivi</a></p>';}"],
  // Confidentialité
  ['Les photos du compagnon restent dans votre navigateur et ne sont pas transmises à Neomoov.</p>',
   'Les photos de Neomoov Chauffeur Pro restent dans votre navigateur et ne sont pas transmises à Neomoov ; la fiche de vérification avant départ n’est pas enregistrée par Neomoov.</p><h2>Quiz et attestation</h2><p>Vos réponses aux quiz et vos résultats sont enregistrés dans votre compte pour suivre votre progression. L’attestation de suivi conserve le nom que vous indiquez, la date de réussite et un code de vérification. Pour un code exact, la page publique de vérification n’affiche que votre prénom, l’initiale de votre nom et la date de réussite.</p>'],
  // Routeur
  ["'inscription','compagnon','ressources',", "'inscription','compagnon','chauffeur-pro','attestation','ressources',"],
  ['if(!in_array($page,$allowed,true))return;', "if(!in_array($page,$allowed,true))return;if($page==='compagnon'){wp_safe_redirect(nma_url('chauffeur-pro/'),301);exit;}"],
  ["if(in_array($page,array('membre','formation','inscription')))", "if(in_array($page,array('membre','formation','inscription','attestation'),true))"],
  ['<a href="\'.esc_url(nma_url(\'compagnon/\')).\'">Compagnon web</a>', '<a href="\'.esc_url(nma_url(\'chauffeur-pro/\')).\'">Chauffeur Pro</a>'],
  ["elseif($page==='compagnon')nma_companion();", "elseif($page==='chauffeur-pro')nma_companion();elseif($page==='attestation')nma_attestation_page();"],
  ['<nav><a href="\'.esc_url(nma_url(\'passagers/\')).\'">Pour les passagers</a>', '<nav><a href="\'.esc_url(nma_url(\'attestation/\')).\'">Vérifier une attestation</a><a href="\'.esc_url(nma_url(\'passagers/\')).\'">Pour les passagers</a>'],
  // Impression d'un seul module ou de la fiche, date préremplie
  ['\nJS;\n', "\n(()=>{const now=new Date(),p=n=>String(n).padStart(2,'0');document.querySelectorAll('input[data-now]').forEach(i=>{if(!i.value)i.value=now.getFullYear()+'-'+p(now.getMonth()+1)+'-'+p(now.getDate())+'T'+p(now.getHours())+':'+p(now.getMinutes())});document.querySelectorAll('[data-print]').forEach(b=>b.addEventListener('click',()=>{const t=document.getElementById(b.dataset.print);if(!t)return;t.querySelectorAll('details').forEach(d=>{d.open=true});document.body.classList.add('nma-print-one');t.classList.add('nma-print-target');window.print()}));window.addEventListener('afterprint',()=>{document.body.classList.remove('nma-print-one');document.querySelectorAll('.nma-print-target').forEach(e=>e.classList.remove('nma-print-target'))});})();\nJS;\n"],
]);

patch('contract-delivery.php', [
  ['<p>CAP CHAUFFEUR — première édition écrite : 7 microleçons avec exercices et corrigés, 8 fiches pratiques et compagnon web. Les vidéos, applications mobiles et accompagnement individuel continu ne sont pas inclus.</p>',
   '<p>CAP CHAUFFEUR — première édition écrite : 7 modules avec exercices corrigés, quiz et attestation de suivi, 8 fiches pratiques et l’application Neomoov Chauffeur Pro en version web. Les vidéos, les versions mobiles de l’application et l’accompagnement individuel continu ne sont pas inclus.</p>'],
]);

patch('build-export.cjs', [
  ["for(const module of ['contract-delivery.php',", "for(const module of ['formation-attestation.php','contract-delivery.php',"],
  ["desc:'Academy, compagnon et paiements configurables.", "desc:'Academy, Neomoov Chauffeur Pro, quiz, attestation et paiements configurables."],
]);

const css = path.join(wpDir, 'academy.css');
let c = fs.readFileSync(css, 'utf8');
if (!c.includes('.nma-print-target')) {
  c = c.replace(/\s*$/, '\n') + [
    '.lesson .lead{font-size:18px}.lesson ul{padding-left:22px;margin:0 0 20px}.lesson li{margin:6px 0}.exercise{background:#edf3f1;padding:22px;border-radius:6px;margin:28px 0}.exercise summary{font-weight:700;cursor:pointer}.exercise details{margin-top:12px}.sources{font-size:15px;padding-left:22px}.sources a{text-decoration:underline;text-underline-offset:4px}.quiz{border-top:1px solid #ccd7dc;margin-top:30px;padding-top:10px}.quiz fieldset{border:0;padding:0;margin:0 0 22px;min-width:0}.quiz legend{font-weight:700;margin-bottom:6px}.quiz .check-row{margin:8px 0}.quiz input[type=radio]{margin-top:6px;min-width:18px;height:18px;accent-color:#0a2431}.ok{color:#3b6b0b}.todo{color:#9f2424}.quiz p.ok,.quiz p.todo{font-size:15px;margin:6px 0 0}.quiz-score{font-weight:700}.progress{height:12px;background:#e3eaec;border-radius:6px;overflow:hidden;margin:10px 0 18px}.progress span{display:block;height:100%;background:#5c8413}.module-toc{padding-left:22px}.module-toc li{margin:6px 0}.module-toc a{text-decoration:underline;text-underline-offset:4px}.module-toc span{font-size:13px;font-weight:700;margin-left:6px}.certificate{border:2px solid #0a2431;border-radius:8px;padding:40px;text-align:center}.certificate h1{font-size:44px;letter-spacing:-1.5px}.certificate-name{font-size:30px;font-weight:800;margin:10px 0 20px}.certificate-modules{text-align:left;display:inline-block;font-size:15px;margin:0 0 20px}.specimen{color:#9f2424;font-weight:800;letter-spacing:1px}.join{background:#0a2431;color:#fff;border:0}.join p{color:#cedae0}.join .eyebrow{color:#c4f45c}.sheet-row{display:grid;grid-template-columns:1.4fr auto 1fr;gap:14px;align-items:center;border-top:1px solid #dde5e7;padding:8px 0}.sheet-row .check-row{margin:0;white-space:nowrap}.sheet-row input[type=text],.check-sheet textarea{border:1px solid #9fb3bd;border-radius:4px;padding:10px;font:inherit;font-size:16px;width:100%;background:#fff}.check-sheet .field{margin:18px 0}.toc{display:flex;flex-wrap:wrap;gap:18px;margin:0 0 25px;font-weight:700;font-size:15px}.toc a{text-decoration:underline;text-underline-offset:5px}',
    '@media(max-width:640px){.sheet-row{grid-template-columns:1fr auto}.sheet-row input[type=text]{grid-column:1/-1}.certificate{padding:22px}.certificate h1{font-size:34px}}',
    '@media print{body.nma-print-one main .wrap>*:not(.nma-print-target),body.nma-print-one main>.message{display:none!important}.sheet-row input[type=text],.check-sheet textarea{border:0;border-bottom:1px solid #777;border-radius:0}.lesson,.check-sheet{border:0;padding:0}.certificate{border:2px solid #000}}',
  ].join('\n') + '\n';
  fs.writeFileSync(css, c);
  console.log('academy.css : styles des modules, quiz, attestation et fiche ajoutés');
}

const dep = path.join(__dirname, 'academy-deployer.cjs');
let d = fs.readFileSync(dep, 'utf8');
d = d.replace("'formation/', 'compagnon/',", "'formation/', 'chauffeur-pro/', 'attestation/', 'attestation/?code=CAP-AAAA-AAAA',")
  .replace(/douze routes/g, 'routes').replace("contrôle les douze routes", 'contrôle les routes');
fs.writeFileSync(dep, d);
console.log('academy-deployer.cjs : routes chauffeur-pro et attestation contrôlées');
