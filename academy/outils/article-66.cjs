// 2 octobre 2026 : la fiche de vérification de Neomoov Booster devient un rapport de vérification sommaire conforme à
// l'article 66 du Règlement sur le transport rémunéré de personnes par automobile (RLRQ, c. T-11.2, r. 1) ; le module 1
// décrit ce contenu et cite le Règlement. Rejouable une seule fois.
const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..');
const REG = { label: 'Règlement sur le transport rémunéré de personnes par automobile (RLRQ, c. T-11.2, r. 1), articles 65 et 66 : éléments à vérifier et contenu du rapport', url: 'https://www.legisquebec.gouv.qc.ca/fr/document/rc/T-11.2,%20r.%201' };

const php = path.join(A, 'livraison/wordpress/formation-attestation.php');
let t = fs.readFileSync(php, 'utf8');
if (t.includes('sheet_accessory')) throw Error('déjà appliqué');
const start = t.indexOf('function nma_check_sheet(){');
const end = t.indexOf('\n}\n', start) + 3;
if (start < 0 || end < 3) throw Error('fonction nma_check_sheet introuvable');
const fn = `function nma_check_sheet(){
    $saaq=array('Liquide de frein','Frein de stationnement (frein à main)','Phares, feux et clignotants','Klaxon','Pneus et valves (pneus d’hiver du 1er décembre au 15 mars)','Essuie-glaces et liquide lave-glace','Rétroviseurs','Batterie (véhicule électrique)','Rampe ou plateforme et ancrages (véhicule adapté)');
    $plus=array('Ceintures de sécurité à toutes les places','Documents à bord (permis de chauffeur autorisé, attestation du véhicule autorisé, assurance, immatriculation)','Habitacle propre, coffre libre et kit du chauffeur en place');
    echo '<section class="panel check-sheet" id="verification"><form autocomplete="off" onsubmit="return false"><h2>Rapport de vérification sommaire avant départ.</h2><p>L’article 55 de la Loi concernant le transport rémunéré de personnes par automobile impose au chauffeur qualifié une vérification sommaire de son véhicule avant la première utilisation de la journée pour le transport rémunéré ; les articles 65 et 66 du Règlement fixent les éléments à vérifier et le contenu du rapport, à conserver dans le véhicule. Cette fiche reprend ces renseignements : remplissez-la à l’arrêt, puis imprimez-la ou enregistrez-la en PDF. Elle n’est pas transmise à Neomoov.</p><div class="form-grid">';
    $fields=array('date'=>array('1° Date et heure de la vérification','datetime-local'),'plate'=>array('2° Numéro de la plaque d’immatriculation','text'),'accessory'=>array('3° Numéro de l’accessoire apposé sur l’automobile','text'),'driver'=>array('4° Nom du chauffeur qualifié','text'),'permit'=>array('4° Numéro de permis de chauffeur (le cas échéant)','text'),'odometer'=>array('7° Lecture de l’odomètre (km)','number'),'battery'=>array('État de charge de la batterie (véhicule électrique, %)','number'),'vehicle'=>array('Véhicule (marque et modèle)','text'));
    foreach($fields as $k=>$f)echo '<label class="field">'.nma_e($f[0]).'<input type="'.$f[1].'" name="sheet_'.$k.'"'.($k==='date'?' data-now':'').($k==='odometer'?' min="0" step="1"':'').($k==='battery'?' min="0" max="100" step="1"':'').'></label>';
    echo '</div><h3>8° Éléments à vérifier (article 65 du Règlement, liste de la SAAQ)</h3>';nma_check_rows($saaq);
    echo '<label class="check-row"><input type="checkbox" name="sheet_all"> <b>Tous les éléments prévus à l’article 65 ont été vérifiés.</b></label>';
    echo '<h3>6° Voyants du tableau de bord</h3><label class="check-row"><input type="radio" name="sheet_light" value="none" checked> Aucun voyant allumé</label><label class="check-row"><input type="radio" name="sheet_light" value="on"> Un voyant est allumé, motif :</label><label class="field"><input type="text" name="sheet_light_reason" placeholder="Motif pour lequel le voyant est allumé"></label>';
    echo '<h3>5° Défectuosités</h3><label class="check-row"><input type="radio" name="sheet_defects" value="none" checked> Aucune défectuosité constatée</label><label class="check-row"><input type="radio" name="sheet_defects" value="some"> Défectuosités constatées (description et mesures prises) :</label><label class="field"><textarea name="sheet_notes" rows="4"></textarea></label>';
    echo '<h3>Compléments Neomoov (hors rapport réglementaire)</h3>';nma_check_rows($plus);
    echo '<p class="print-only">Signature du chauffeur qualifié : ______________________________</p><p class="small">Une défectuosité qui touche la sécurité se règle avant de prendre des clients. Cette fiche aide à consigner votre vérification ; elle ne remplace ni une inspection mécanique ni les exigences de votre opérateur.</p><div class="actions no-print"><button type="button" class="btn" data-print="verification">Imprimer / Enregistrer en PDF</button><button type="reset" class="text-link">Effacer la fiche</button></div></form></section>';
}
`;
t = t.slice(0, start) + fn + t.slice(end);
fs.writeFileSync(php, t);
console.log('formation-attestation.php : rapport de vérification sommaire (article 66)');

const m1 = path.join(A, 'livraison/formation/modules/m1.json');
let m = fs.readFileSync(m1, 'utf8');
const pairs = [
  ['Selon la SAAQ, cette vérification porte sur : le liquide', "Les éléments à vérifier sont fixés par l'article 65 du Règlement sur le transport rémunéré de personnes par automobile ; selon la SAAQ, ils comprennent : le liquide"],
  ['Vous devez consigner vos observations dans un rapport de vérification sommaire et le conserver dans le véhicule.',
   "Vous devez consigner vos observations dans un rapport de vérification sommaire, conservé dans le véhicule. L'article 66 du Règlement en fixe le contenu : date et heure, numéro de plaque, numéro de l'accessoire apposé sur l'automobile, nom du chauffeur qualifié et numéro de permis de chauffeur, défectuosités constatées ou mention de leur absence, motif de tout voyant allumé au tableau de bord, lecture de l'odomètre, et mention que tous les éléments prévus à l'article 65 ont été vérifiés ; pour un véhicule électrique, l'état de charge de la batterie."],
  ['vous propose une fiche de vérification datée, à remplir sur votre téléphone puis à imprimer ou à enregistrer en PDF.',
   "vous propose un rapport de vérification sommaire reprenant les renseignements de l'article 66, à remplir sur votre téléphone puis à imprimer ou à enregistrer en PDF."],
];
for (const [a, b] of pairs) {
  if (m.split(a).length !== 2) throw Error('m1 : ancre « ' + a.slice(0, 50) + ' »');
  m = m.replace(a, () => b);
}
const before = JSON.parse(m);
m = m.replace(/("sources": \[\n    \{[^\n]*\n)/, (_, first) => first + `    ${JSON.stringify(REG)},\n`);
const after = JSON.parse(m);
if (after.sources.length !== before.sources.length + 1 || after.sources[1].url !== REG.url) throw Error('m1 : source du Règlement');
fs.writeFileSync(m1, m);
console.log('m1.json : contenu du rapport (article 66) et source du Règlement');
