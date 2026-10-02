// 2 octobre 2026 : la vérification sommaire du véhicule est alignée sur l'article 55 de la Loi concernant le transport
// rémunéré de personnes par automobile (RLRQ, c. T-11.2) : « avant la première utilisation de la journée », et non
// « avant chaque mise en service » (formulation de la page de la SAAQ). Module 1, fiche Neomoov Booster, programme.
const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..');
const LOI = { label: 'Loi concernant le transport rémunéré de personnes par automobile (RLRQ, c. T-11.2), article 55 : vérification sommaire', url: 'https://www.legisquebec.gouv.qc.ca/fr/document/lc/T-11.2' };

function edit(rel, pairs) {
  const f = path.join(A, rel);
  let t = fs.readFileSync(f, 'utf8');
  let n = 0;
  for (const [a, b] of pairs) {
    const c = t.split(a).length - 1;
    if (c !== 1) throw Error(`${rel} : « ${a.slice(0, 60)} » trouvé ${c} fois`);
    t = t.replace(a, () => b);
    n++;
  }
  fs.writeFileSync(f, t);
  console.log(`${rel} : ${n} remplacement(s)`);
}

const m1 = path.join(A, 'livraison/formation/modules/m1.json');
const m = JSON.parse(fs.readFileSync(m1, 'utf8'));
if (m.sources.some((s) => s.url === LOI.url)) throw Error('déjà appliqué');
edit('livraison/formation/modules/m1.json', [
  ['la routine de vérification du véhicule que la SAAQ exige avant chaque mise en service.', 'la routine de vérification sommaire du véhicule que la loi impose avant la première utilisation de la journée.'],
  ['"title": "La vérification avant chaque mise en service"', '"title": "La vérification sommaire avant la première utilisation de la journée"'],
  ["C'est l'obligation la plus souvent oubliée. Avant chaque nouvelle mise en service, la SAAQ demande au chauffeur de vérifier : le liquide",
   "C'est l'obligation la plus souvent oubliée. L'article 55 de la Loi concernant le transport rémunéré de personnes par automobile impose au chauffeur qualifié une vérification sommaire de l'automobile avant sa première utilisation de la journée pour le transport rémunéré de personnes. Selon la SAAQ, cette vérification porte sur : le liquide"],
  ['Faites-en une routine de cinq minutes, toujours dans le même ordre', 'Faites-en une routine de cinq minutes au début de chaque journée de travail, toujours dans le même ordre'],
  ['rapport de vérification sommaire avant chaque mise en service.', "rapport de vérification sommaire avant la première utilisation de la journée (article 55 de la Loi)."],
  ['"q":"Quand la SAAQ demande-t-elle de vérifier le véhicule ?"', '"q":"Quand la loi impose-t-elle la vérification sommaire du véhicule ?"'],
  ['"Avant chaque nouvelle mise en service"', '"Avant la première utilisation de la journée pour le transport rémunéré"'],
  ['"explain":"La vérification se fait avant chaque nouvelle mise en service, et les observations sont consignées dans un rapport."',
   '"explain":"Article 55 de la Loi concernant le transport rémunéré de personnes par automobile ; les observations sont consignées dans un rapport de vérification sommaire."'],
]);
const m2 = JSON.parse(fs.readFileSync(m1, 'utf8'));
m2.sources.unshift(LOI);
let text = fs.readFileSync(m1, 'utf8');
text = text.replace(/"sources": \[\n/, `"sources": [\n    ${JSON.stringify(LOI)},\n`);
if (JSON.stringify(JSON.parse(text).sources) !== JSON.stringify(m2.sources)) throw Error('sources : réécriture');
fs.writeFileSync(m1, text);
console.log('m1.json : source de la Loi ajoutée');

edit('livraison/wordpress/formation-attestation.php', [
  ['<p>Avant chaque nouvelle mise en service, la SAAQ demande au chauffeur de vérifier les points ci-dessous et de consigner ses observations dans un rapport de vérification sommaire conservé dans le véhicule.',
   '<p>La loi (article 55 de la Loi concernant le transport rémunéré de personnes par automobile) impose au chauffeur qualifié une vérification sommaire de son véhicule avant la première utilisation de la journée pour le transport rémunéré ; la SAAQ en précise les points ci-dessous, à consigner dans un rapport de vérification sommaire conservé dans le véhicule.'],
]);
edit('livraison/wordpress/neomoov-academy.php', [
  ['documents à bord et vérification du véhicule avant chaque mise en service.', 'documents à bord et vérification sommaire du véhicule au début de chaque journée (article 55 de la Loi).'],
]);
