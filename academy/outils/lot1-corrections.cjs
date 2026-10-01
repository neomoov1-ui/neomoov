// Lot 1 de la révision (1er octobre 2026) : textes seulement, aucune logique de paiement, d'accès ou de données touchée.
// 1. Programme de l'accueil aligné sur les sept leçons réellement livrées (publicité conforme au contenu).
// 2. Titre, description et adresse canonique propres à chaque page ; espace membre et formation hors index.
// 3. Promesse du parcours « Démarrer » ramenée à ce que couvre la formation.
// 4. Formulations internes (« le fondateur propose », « nos documents de recherche ») réécrites pour le client.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function edit(rel, pairs) {
  const p = path.join(root, rel);
  let s = fs.readFileSync(p, 'utf8');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${rel} : ancre trouvée ${n} fois : ${a.slice(0, 80)}`);
    s = s.split(a).join(b);
  }
  fs.writeFileSync(p, s);
  console.log('ok', rel, `(${pairs.length} remplacement(s))`);
}

const W = 'livraison/wordpress/neomoov-academy.php';
edit(W, [
  // 1. Programme.
  [
    "function nma_modules(){return array('Comprendre son activité'=>'Cadre local, documents et organisation professionnelle.','Organiser sa journée'=>'Approche, attente, aéroport et prise en charge.','Mesurer ses résultats'=>'Coûts complets, temps total et choix du véhicule.','Soigner chaque trajet'=>'Accueil, confort, discrétion et kit du bon chauffeur.','Prévenir et gérer les incidents'=>'Fatigue, désescalade et dossier factuel.','Maîtriser ses outils'=>'Navigation, paiements et réclamations.','Développer son activité'=>'Fidélisation autorisée et plan d’action à 30 jours.');}",
    "function nma_modules(){return array('Organiser son activité'=>'Dossier professionnel, vérifications officielles, conditions d’opérateur et numéro dédié.','Organiser sa journée'=>'Temps réel, attentes, prises en charge claires et marges d’organisation.','Lire ses chiffres'=>'Recettes, heures et kilomètres complets, sans confondre solde et bénéfice.','Préparer un véhicule agréable'=>'Confort, rangement, kit du bon chauffeur ; électrique ou essence.','Servir simplement et avec constance'=>'Accueil, informations honnêtes, adaptation au passager et fin de trajet.','Gérer une tension et une réclamation'=>'Désescalade, faits datés, pièces utiles et demande vérifiable.','Progresser en 30 jours'=>'Un changement mesuré à la fois, puis un standard ; volet exploitant.');}",
  ],
  // 3. Parcours « Démarrer ».
  ["'Chiffrer véhicule et organisation'", "'Lister les coûts à prévoir avant de démarrer'"],
  // 4. Accueil : origine du contenu.
  [
    'Conçu à partir de l’expérience de terrain du fondateur, chauffeur et exploitant, et des besoins recueillis dans nos documents de recherche.',
    'Conçu à partir de l’expérience de terrain de notre fondateur, chauffeur et exploitant à Montréal, et des difficultés rapportées par des chauffeurs et des passagers.',
  ],
  // 2. Titre, description, canonique, indexation.
  [
    "$title=isset($tracks[$page])?$tracks[$page][1]:'CAP CHAUFFEUR — Neomoov Academy';",
    "list($title,$description,$robots)=nma_seo($page,$tracks);",
  ],
  [
    '<meta name="description" content="Méthodes de terrain et outils pratiques pour les chauffeurs taxi et VTC à Montréal. Organisation, expérience client et suivi des résultats.">',
    '<meta name="description" content="\'.esc_attr($description).\'"><link rel="canonical" href="\'.esc_url(home_url(\'/academy/\'.($page!==\'\'?$page.\'/\':\'\'))).\'">\'.($robots?\'<meta name="robots" content="noindex,follow">\':\'\').\'',
  ],
  // Fonction des titres et descriptions, placée avant les modules.
  [
    'function nma_modules(){',
    "function nma_seo($page,$tracks){$s=' | Neomoov Academy';$d='Sept microleçons écrites et huit fiches pratiques pour mieux organiser vos journées, soigner chaque trajet et lire vos chiffres. Chauffeurs taxi et VTC à Montréal.';$m=array(''=>array('CAP CHAUFFEUR — formation pratique taxi et VTC à Montréal'.$s,$d,false),'inscription'=>array('Créer mon espace gratuit'.$s,'Compte gratuit : compagnon web, bilans de journée et fiches pratiques imprimables pour chauffeurs taxi et VTC.',false),'membre'=>array('Mon espace'.$s,$d,true),'formation'=>array('Ma formation CAP CHAUFFEUR'.$s,$d,true),'compagnon'=>array('Compagnon web : bilan de journée et préparation du véhicule'.$s,'Calculez recettes par heure et par kilomètre sur toute votre journée et obtenez une liste de priorités pour votre véhicule. Gratuit, à utiliser à l’arrêt.',false),'ressources'=>array('Fiches pratiques gratuites pour chauffeurs taxi et VTC'.$s,'Huit fiches à imprimer : bilan de journée, kit du chauffeur, démarches au Québec, prise en charge, réclamation, plan sur 30 jours.',false),'passagers'=>array('Guide passagers : un trajet plus simple'.$s,'Conseils pour préparer une prise en charge claire, voyager sereinement et signaler un problème utilement.',false),'confidentialite'=>array('Vos données'.$s,'Comment Neomoov Academy utilise et protège les données de votre compte, de vos bilans et de vos achats.',false));if(isset($tracks[$page]))return array($tracks[$page][1].' — CAP CHAUFFEUR'.$s,$tracks[$page][2],false);return $m[$page]??$m[''];}\nfunction nma_modules(){",
  ],
]);

const D = 'livraison/formation/data.json';
edit(D, [
  ["L'apport du fondateur est concret : un numéro professionnel", 'Conseil de terrain : un numéro professionnel'],
  ['Le fondateur propose des rangements, mouchoirs, eau et câbles de charge.', 'Sur le terrain, un kit simple suffit souvent : rangements, mouchoirs, eau et câbles de charge.'],
  ['Le fondateur insiste sur un espace organisé, une ligne professionnelle et des accessoires à portée des passagers.', 'Un espace organisé, une ligne professionnelle et des accessoires à portée des passagers font la différence.'],
]);
JSON.parse(fs.readFileSync(path.join(root, D), 'utf8'));
console.log('data.json : JSON valide');
