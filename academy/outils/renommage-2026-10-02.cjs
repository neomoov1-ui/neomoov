// Renommage du 2 octobre 2026 (décision du fondateur) :
//   la formation « CAP CHAUFFEUR » devient « Neomoov Chauffeur Pro » ;
//   l'application « Neomoov Chauffeur Pro » (ex-compagnon web) devient « Neomoov Booster », adresse /academy/booster/.
// Identifiants techniques conservés : cap_chauffeur, CAP_CHAUFFEUR, cap-chauffeur (dont l'adresse des conditions de vente,
// dont dépend le contrôle du paiement). Square accepte les deux noms d'article pendant la transition ; les codes
// d'attestation passent de CAP- à NCP- et les deux préfixes restent vérifiables.
// Usage : node academy/outils/renommage-2026-10-02.cjs   (refuse de s'appliquer deux fois)
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..', '..');
const academy = path.join(repo, 'academy');
const read = (f) => fs.readFileSync(f, 'utf8');
const marker = path.join(academy, 'livraison', 'wordpress', 'neomoov-academy.php');
if (read(marker).includes("'booster'")) throw Error('renommage déjà appliqué');

let total = 0;
function apply(file, steps) {
  let t = read(file);
  let n = 0;
  for (const [from, to, expected] of steps) {
    const count = from instanceof RegExp ? (t.match(from) || []).length : t.split(from).length - 1;
    if (expected !== undefined && count !== expected) throw Error(`${path.relative(repo, file)} : « ${String(from).slice(0, 60)} » trouvé ${count} fois, ${expected} attendu(s)`);
    if (!count) continue;
    t = from instanceof RegExp ? t.replace(from, to) : t.split(from).join(to);
    n += count;
  }
  fs.writeFileSync(file, t);
  total += n;
  console.log(`${path.relative(repo, file)} : ${n} remplacement(s)`);
}

// 1. L'application d'abord (sinon le nouveau nom de la formation serait renommé à son tour), puis la formation.
const APP = [
  ['NEOMOOV CHAUFFEUR PRO', 'NEOMOOV BOOSTER'],
  ['Neomoov Chauffeur Pro', 'Neomoov Booster'],
];
const PRODUCT = [
  ['L’application des chauffeurs CAP CHAUFFEUR', 'L’application de la formation Neomoov Chauffeur Pro'],
  ['CAP CHAUFFEUR', 'Neomoov Chauffeur Pro'],
];

// 2. Code du site.
const wp = path.join(academy, 'livraison', 'wordpress');
apply(path.join(wp, 'neomoov-academy.php'), [
  ...APP,
  ["'chauffeur-pro'=>array(", "'booster'=>array(", 1],
  ["nma_url('chauffeur-pro/')", "nma_url('booster/')"],
  ['>Chauffeur Pro</a>', '>Neomoov Booster</a>', 1],
  ["'inscription','compagnon','chauffeur-pro','attestation',", "'inscription','compagnon','chauffeur-pro','booster','attestation',", 1],
  ["if($page==='compagnon'){wp_safe_redirect(nma_url('booster/'),301);exit;}", "if($page==='compagnon'||$page==='chauffeur-pro'){wp_safe_redirect(nma_url('booster/'),301);exit;}", 1],
  ["elseif($page==='chauffeur-pro')nma_companion();", "elseif($page==='booster')nma_companion();", 1],
  ["'entreprise','chauffeur-pro','ressources'", "'entreprise','booster','ressources'", 1],
  ["foreach(nma_public_routes() as $p){", "foreach(array_merge(nma_public_routes(),array('chauffeur-pro','compagnon')) as $p){", 1],
  ...PRODUCT,
]);
apply(path.join(wp, 'formation-attestation.php'), [
  ...APP,
  ["$code='CAP-';", "$code='NCP-';", 1],
  ["if(!preg_match('/^CAP([A-Z0-9]{4})([A-Z0-9]{4})$/D',$c,$m))return null;\n    $c='CAP-'.$m[1].'-'.$m[2];",
   "if(!preg_match('/^(CAP|NCP)([A-Z0-9]{4})([A-Z0-9]{4})$/D',$c,$m))return null;\n    $c=$m[1].'-'.$m[2].'-'.$m[3];", 1],
  ['CAP-XXXX-XXXX', 'NCP-XXXX-XXXX'],
  ["'Version du 1er octobre 2026'", "'Version du 2 octobre 2026'", 1],
  ["get_option('nma_terms_20261001_done')", "get_option('nma_terms_20261002_done')", 1],
  ["!=='2026-10-01'){$o['square_api_terms_version']='2026-10-01';", "!=='2026-10-02'){$o['square_api_terms_version']='2026-10-02';", 1],
  ["add_option('nma_terms_20261001_done'", "add_option('nma_terms_20261002_done'", 1],
  ['/* Conditions de vente du 1er octobre 2026 :', '/* Conditions de vente du 2 octobre 2026 (noms Neomoov Chauffeur Pro et Neomoov Booster) :', 1],
  ...PRODUCT,
]);
apply(path.join(wp, 'contract-delivery.php'), [...APP, ...PRODUCT]);
apply(path.join(wp, 'brevo-templates.php'), [...PRODUCT]);
apply(path.join(wp, 'square-checkout-api.php'), [
  ["($line['name']??'')!=='CAP CHAUFFEUR'", "!in_array(($line['name']??''),array('Neomoov Chauffeur Pro','CAP'.' CHAUFFEUR'),true)", 1],
  ["'name'=>'CAP CHAUFFEUR'", "'name'=>'Neomoov Chauffeur Pro'", 1],
  ["echo '<p>CAP CHAUFFEUR : 99,00 $ CA", "echo '<p>Neomoov Chauffeur Pro : 99,00 $ CA", 1],
]);
apply(path.join(wp, 'build-export.cjs'), [
  ...APP,
  ['templateName:`CAP_${e.id}_${e.jour}_VENTE_20260930`', 'templateName:`CAP_${e.id}_${e.jour}_VENTE_20261002`', 1],
  ["name:'Neomoov Academy CAP CHAUFFEUR'", "name:'Neomoov Academy Neomoov Chauffeur Pro'", 1],
]);

// 3. Contenu de la formation, courriels, PDF.
const formation = path.join(academy, 'livraison', 'formation');
for (const f of ['data.json', ...[1, 2, 3, 4, 5, 6, 7].map((n) => `modules/m${n}.json`)]) apply(path.join(formation, f), [...APP, ...PRODUCT]);
const marketing = path.join(academy, 'livraison', 'marketing');
apply(path.join(marketing, 'emails_source.json'), [...PRODUCT]);
for (const f of fs.readdirSync(path.join(marketing, 'emails_html', 'brevo-ready'))) apply(path.join(marketing, 'emails_html', 'brevo-ready', f), [...PRODUCT]);
apply(path.join(academy, 'outils', 'modules-pdf.cjs'), [
  ['CAP-CHAUFFEUR-module-', 'Neomoov-Chauffeur-Pro-module-', 1],
  ["'CAP-CHAUFFEUR-guide-complet.html'", "'Neomoov-Chauffeur-Pro-guide-complet.html'", 1],
  ["'CAP-CHAUFFEUR-guide-complet.pdf'", "'Neomoov-Chauffeur-Pro-guide-complet.pdf'", 1],
  ['l’acheteur de CAP CHAUFFEUR', 'l’acheteur de Neomoov Chauffeur Pro', 1],
  ...PRODUCT,
]);
apply(path.join(academy, 'outils', 'academy-deployer.cjs'), [
  ["'chauffeur-pro/', 'attestation/', 'attestation/?code=CAP-AAAA-AAAA',", "'booster/', 'attestation/', 'attestation/?code=NCP-AAAA-AAAA',", 1],
]);

// 4. Applications de la plateforme (site de réservation et application chauffeur).
apply(path.join(repo, 'apps', 'web', 'src', 'lib', 'i18n-site.ts'), [...PRODUCT]);
apply(path.join(repo, 'apps', 'mobile-driver', 'src', 'i18n.ts'), [...PRODUCT]);

console.log(`total : ${total} remplacements`);
