// 2 octobre 2026 : les quatre séquences passent de 7 à 5 courriels (J0, J1, J3, J5, J7), modèles Brevo renommés
// NCP_<id>_<jour>_VENTE_20261002 (les 28 brouillons CAP_… déjà créés dans Brevo restent inactifs et ne sont plus gérés).
// Rejouable une seule fois : chaque ancre doit exister exactement une fois.
const fs = require('fs');
const path = require('path');
const wpDir = path.join(__dirname, '..', 'livraison', 'wordpress');
function patch(fileName, edits) {
  const file = path.join(wpDir, fileName);
  let t = fs.readFileSync(file, 'utf8');
  for (const [from, to, all] of edits) {
    const n = t.split(from).length - 1;
    if (all ? n < 1 : n !== 1) throw Error(`${fileName} : ancre trouvée ${n} fois : ${from.slice(0, 90)}`);
    t = all ? t.split(from).join(to) : t.replace(from, () => to);
  }
  fs.writeFileSync(file, t);
  console.log(`${fileName} : ${edits.length} remplacements`);
}
if (fs.readFileSync(path.join(wpDir, 'brevo-templates.php'), 'utf8').includes('NCP_[RSDE]')) throw Error('déjà appliqué');
patch('brevo-templates.php', [
  ["/^CAP_[RSDE]0[1-7]_J[0-9]+_VENTE_20260930$/D", "/^NCP_[RSDE]0[1-5]_J[0-9]+_VENTE_20261002$/D"],
  ["count($pack)!==28", "count($pack)!==20", true],
  ["Le lot local doit contenir exactement 28 emails.", "Le lot local doit contenir exactement 20 emails."],
  ["' / 28 templates retrouvés ou créés dans Brevo. '", "' / 20 templates retrouvés ou créés dans Brevo. '"],
  ["if(!is_int($id)||$id<0||$id>28)return new WP_Error('scope','Identifiant hors du lot autorisé.');", "if(!is_int($id)||$id<0||$id>1000000)return new WP_Error('scope','Identifiant hors du lot autorisé.');"],
  ["$days=array(0,1,3,5,8,11,15);$expected=array();foreach(array('R','S','D','E')as$track)foreach($days as$i=>$day)$expected['CAP_'.$track.'0'.($i+1).'_J'.$day.'_VENTE_20260930']=true;", "$days=array(0,1,3,5,7);$expected=array();foreach(array('R','S','D','E')as$track)foreach($days as$i=>$day)$expected['NCP_'.$track.'0'.($i+1).'_J'.$day.'_VENTE_20261002']=true;"],
  ["if(!is_int($id)||$id<1||$id>28||isset($seen_ids[$id])", "if(!is_int($id)||$id<1||$id>1000000||isset($seen_ids[$id])"],
  ["les 28 modèles doivent être uniques et inactifs.", "les 20 modèles doivent être uniques et inactifs."],
  ["' / 28 modèles inactifs confirmés", "' / 20 modèles inactifs confirmés"],
  ["<h2>Brevo — 28 modèles Neomoov Chauffeur Pro</h2><p>'.count($done).' / 28 identifiants", "<h2>Brevo — 20 modèles Neomoov Chauffeur Pro (4 séquences de 5 courriels, version du 2 octobre 2026)</h2><p>'.count($done).' / 20 identifiants"],
  ["La migration vérifie l’expéditeur actif et les 28 modèles inactifs avant chaque lot de deux ; leurs objets et contenus restent inchangés. Les messages d’automatisation 29 et suivants sont exclus.", "La migration vérifie l’expéditeur actif et les 20 modèles inactifs avant chaque lot de deux ; leurs objets et contenus restent inchangés. Les anciens brouillons CAP_… du 30 septembre et les messages d’automatisation sont exclus."],
]);
{
  const file = path.join(wpDir, 'build-export.cjs');
  let t = fs.readFileSync(file, 'utf8');
  const edits = [
    ["templateName:`CAP_${e.id}_${e.jour}_VENTE_20261002`", "templateName:`NCP_${e.id}_${e.jour}_VENTE_20261002`"],
    ["if(templates.length!==28||", "if(templates.length!==20||"],
    ["tag:'CAP_CHAUFFEUR_20260930'", "tag:'NCP_20261002'"],
  ];
  for (const [from, to] of edits) { if (t.split(from).length !== 2) throw Error('build-export.cjs : ancre ' + from.slice(0, 60)); t = t.replace(from, () => to); }
  fs.writeFileSync(file, t);
  console.log('build-export.cjs : lot de 20 modèles NCP');
}
