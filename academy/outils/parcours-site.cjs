// 2 octobre 2026 : branche le parcours complet de Neomoov Chauffeur Pro dans le site Academy — examen final, sondages
// de départ et de fin, espace membre en blocs, page « Devenir chauffeur Neomoov », reçu de paiement, package gratuit,
// plan de travail simplifié dans le portrait de chauffeur. Chaque ancre doit exister exactement une fois ; refuse de
// s'appliquer deux fois.
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
if (main.includes('nma_exam_page(')) throw Error('déjà appliqué');

// Espace membre : la seconde moitié de nma_member (blocs Booster / formation / bilans / consentement) est remplacée par le hub en blocs.
{
  const file = path.join(wpDir, 'neomoov-academy.php');
  let t = fs.readFileSync(file, 'utf8');
  const start = t.indexOf(" echo '<div class=\"resource-grid\"><div class=\"panel\"><h2>Neomoov Booster</h2>");
  const endMarker = "<p class=\"small\">Pour une copie ou une suppression des données : contact@neomoov.net.</p></section>';}";
  const end = t.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) throw Error('nma_member : ancres introuvables');
  t = t.slice(0, start) + " nma_member_hub($uid,$paid);echo '</section>';}" + t.slice(end + endMarker.length);
  fs.writeFileSync(file, t);
  console.log('neomoov-academy.php : espace membre remplacé par le hub en blocs');
}

patch('neomoov-academy.php', [
  // Routes
  ["'booster/verification','attestation','ressources','passagers','membre','formation','confidentialite');", "'booster/verification','attestation','examen','sondage','devenir-chauffeur','recu','ressources','passagers','membre','formation','confidentialite');"],
  ["function nma_public_routes(){return array('','rentabilite','service','demarrer','entreprise','booster','ressources','passagers','confidentialite','attestation');}", "function nma_public_routes(){return array('','rentabilite','service','demarrer','entreprise','booster','ressources','passagers','confidentialite','attestation','devenir-chauffeur');}"],
  // Référencement
  ["'attestation'=>array('Vérifier une attestation Neomoov Chauffeur Pro'.$s,", "'examen'=>array('Examen final · Neomoov Chauffeur Pro'.$s,'Vingt questions tirées des sept modules, quarante minutes, 80 % pour réussir : le résultat figure sur l’attestation de suivi.',true),'sondage'=>array('Sondage · Neomoov Chauffeur Pro'.$s,'Sondage de départ et sondage de fin des participants à Neomoov Chauffeur Pro.',true),'devenir-chauffeur'=>array('Devenir chauffeur Neomoov'.$s,'Les conditions pour rejoindre Neomoov, plateforme 100 % électrique à Montréal : dossier en règle, véhicule électrique admissible, examen Neomoov Chauffeur Pro réussi, standard de service.',false),'recu'=>array('Reçu de paiement'.$s,'Reçu de paiement Neomoov Chauffeur Pro, imprimable et exportable en image.',true),'attestation'=>array('Vérifier une attestation Neomoov Chauffeur Pro'.$s,"],
  ["if(in_array($page,array('membre','formation','inscription','attestation','booster/profil','booster/performance','booster/verification'),true))echo '<meta name=\"robots\"", "if(in_array($page,array('membre','formation','inscription','attestation','booster/profil','booster/performance','booster/verification','examen','sondage','recu'),true))echo '<meta name=\"robots\""],
  // Pages
  ["elseif($page==='attestation')nma_attestation_page();", "elseif($page==='attestation')nma_attestation_page();elseif($page==='examen')nma_exam_page();elseif($page==='sondage')nma_survey_page();elseif($page==='devenir-chauffeur')nma_driver_page();elseif($page==='recu')nma_receipt_page();"],
  // Actions des membres
  ["if(in_array($act,array('profile','profile_delete','performance','inspection'),true))return nmb_post($act,$uid);", "if(in_array($act,array('profile','profile_delete','performance','inspection'),true))return nmb_post($act,$uid);\n if(in_array($act,array('exam_start','exam_submit','survey'),true))return nma_parcours_post($act,$uid);"],
  // Administration
  ["elseif(($_POST['nma_admin_action']??'')==='brevo_sender_migration'){$notice=nmbt_admin_migrate_sender();}", "elseif(($_POST['nma_admin_action']??'')==='brevo_sender_migration'){$notice=nmbt_admin_migrate_sender();}\n  elseif(($_POST['nma_admin_action']??'')==='exam_reset'){$notice=nma_exam_admin_reset();}"],
  [" nmbt_admin_status();\n echo '</div>';", " nmbt_admin_status();\n nma_parcours_admin();\n echo '</div>';"],
  // Export en image sur le reçu
  ["(strpos($page,'booster')===0?'<script src=\"https://cdnjs.cloudflare.com", "(strpos($page,'booster')===0||$page==='recu'?'<script src=\"https://cdnjs.cloudflare.com"],
  ["'<script>'.nma_script().'</script></body></html>'", "'<script>'.nma_script().nma_parcours_script().'</script></body></html>'"],
  // Package gratuit à la création du compte
  ["wp_new_user_notification($uid,null,'user');}", "wp_new_user_notification($uid,null,'user');nma_welcome_package_mail($uid);}"],
  // Confidentialité
  ["<h2>Communications</h2><p>L’inscription gratuite n’exige pas", "<h2>Examen et sondages</h2><p>Vos essais à l’examen final (date, score, résultat par module) et vos réponses aux sondages de départ et de fin sont enregistrés dans votre compte. Les réponses aux sondages servent à améliorer la formation ; un témoignage n’est cité qu’avec votre autorisation explicite. Votre reçu de paiement est produit à partir des informations de votre achat. Le courriel « Votre package gratuit Neomoov », envoyé à la création du compte, est un message de service.</p><h2>Communications</h2><p>L’inscription gratuite n’exige pas"],
  // Textes commerciaux : les vidéos et la narration audio font désormais partie de l'offre ; examen final ; parcours chauffeur
  ["Accès pendant 12 mois calendaires à compter de l’activation. Les vidéos ne sont pas incluses dans cette offre.</p><div class=\"module-list\">", "Chaque module existe aussi en vidéo, en narration audio et en PDF. Les 7 modules réussis ouvrent l’examen final et le parcours « Devenir chauffeur Neomoov ». Accès pendant 12 mois calendaires à compter de l’activation.</p><div class=\"module-list\">"],
  ["<li>7 modules écrits avec exercices corrigés et quiz</li><li>Attestation de suivi vérifiable par code</li>", "<li>7 modules avec exercices corrigés, quiz, vidéo, audio et PDF</li><li>Examen final et attestation de suivi vérifiable par code</li><li>Parcours « Devenir chauffeur Neomoov »</li>"],
  ["<li>Accès formation pendant 12 mois calendaires</li><li>Offre de lancement écrite : vidéos non incluses</li>", "<li>Accès formation pendant 12 mois calendaires</li>"],
  ["aux 7 modules écrits, avec exercices corrigés, quiz et attestation de suivi. Les vidéos ne sont pas incluses.</p>", "aux 7 modules (texte, vidéo, narration audio et PDF), avec exercices corrigés, quiz, examen final et attestation de suivi.</p>"],
  ["echo '<p>Votre offre de lancement écrite : 7 modules avec exercices corrigés, quiz et attestation de suivi, 8 fiches pratiques et l’application Neomoov Booster. Accès pendant 12 mois calendaires à compter de l’activation. Les vidéos ne sont pas incluses.</p>';", "echo '<p>Votre formation : 7 modules avec exercices corrigés, quiz, vidéo, narration audio et PDF, examen final et attestation de suivi, 8 fiches pratiques et l’application Neomoov Booster. Accès pendant 12 mois calendaires à compter de l’activation. <a class=\"text-link\" href=\"'.esc_url(nma_url('membre/')).'\">Voir mon parcours en blocs</a></p>';"],
  ["<nav><a href=\"'.esc_url(nma_url('attestation/')).'\">Vérifier une attestation</a>", "<nav><a href=\"'.esc_url(nma_url('devenir-chauffeur/')).'\">Devenir chauffeur Neomoov</a><a href=\"'.esc_url(nma_url('attestation/')).'\">Vérifier une attestation</a>"],
]);

patch('formation-attestation.php', [
  ["Les 7 modules réussis donnent droit à votre <a class=\"text-link\" href=\"'.esc_url(nma_url('attestation/')).'\">attestation de suivi</a>.</p>", "Les 7 modules réussis donnent droit à votre <a class=\"text-link\" href=\"'.esc_url(nma_url('attestation/')).'\">attestation de suivi</a> et ouvrent l’<a class=\"text-link\" href=\"'.esc_url(nma_url('examen/')).'\">examen final</a>.</p>"],
  ["echo '</ol><p>Code de vérification : <b>'.nma_e($a['code']).'</b><br>", "echo '</ol>'.nma_exam_certificate_line($a,$specimen).'<p>Code de vérification : <b>'.nma_e($a['code']).'</b><br>"],
  ["'completed_on'=>$t?wp_date('Y-m-d',$t):'','verify_url'=>", "'completed_on'=>$t?wp_date('Y-m-d',$t):'','exam'=>nma_exam_public((int)$a['uid']),'verify_url'=>"],
  ["<p>Code vérifié : <b>'.nma_e($a['code']).'</b></p></div>';", "<p>Code vérifié : <b>'.nma_e($a['code']).'</b></p>'.nma_exam_certificate_line($a).'</div>';"],
]);

patch('contract-delivery.php', [
  // Marque et quatre derniers chiffres de la carte (jamais le numéro) pour le reçu Neomoov.
  ["if(is_string($captured)&&strtotime($captured)!==false)$out['captured_at']=$captured;", "if(is_string($captured)&&strtotime($captured)!==false)$out['captured_at']=$captured;\n    $card=is_array($p['card_details']['card']??null)?$p['card_details']['card']:array();if(!empty($card['last_4'])&&preg_match('/^\\d{4}$/',(string)$card['last_4']))$out['card']=trim(sanitize_text_field((string)($card['card_brand']??'')).' ****'.$card['last_4']);"],
]);

patch('booster.php', [
  ["echo '<h3>Vos recommandations</h3><ol>';foreach($r['recommandations'] as $t)echo '<li>'.nma_e($t).'</li>';echo '</ol>'.nmb_print_buttons('portrait').'</section>';", "echo '<h3>Vos recommandations</h3><ol>';foreach($r['recommandations'] as $t)echo '<li>'.nma_e($t).'</li>';echo '</ol>';nmb_plan_html((array)($saved['answers']??array()),$r);echo nmb_print_buttons('portrait').'</section>';"],
  ["/* ---------- Rapport de performance Neomoov ---------- */", `/* ---------- Plan de travail simplifié (package gratuit) : semaine type, objectifs, trois priorités, routine ---------- */
function nmb_plan_html($a,$r){
    $hours=(int)($a['heures']??27)?:27;$days=(array)($a['jours']??array());$slots=(array)($a['creneaux']??array());
    $list=array();if(in_array('semaine',$days,true))$list=array('Lundi','Mardi','Mercredi','Jeudi','Vendredi');if(in_array('samedi',$days,true))$list[]='Samedi';if(in_array('dimanche',$days,true))$list[]='Dimanche';if(!$list)$list=array('Lundi','Mardi','Mercredi','Jeudi','Vendredi');
    $n=count($list);$per=min(10,max(3,round($hours/$n)));$sessions=min($n,max(1,(int)round($hours/$per)));
    $win=array('matin'=>'5 h à 9 h','journee'=>'9 h à 17 h','soiree'=>'17 h à 22 h','nuit'=>'22 h à 5 h');$plages=array();foreach($win as $k=>$l)if(in_array($k,$slots,true))$plages[]=$l;if(!$plages)$plages=array('7 h à 15 h');
    $rv=(array)($r['revenu']??array('bas'=>0,'haut'=>0));$objSession=$sessions?(int)round((((int)$rv['bas']+(int)$rv['haut'])/2)/$sessions/10)*10:0;
    echo '<section id="plan" class="plan"><h3>Votre plan de travail simplifié</h3><p class="small">Généré à partir de vos réponses : une semaine type, des objectifs réalistes et trois priorités. Ajustez-le après deux semaines de rapports de performance.</p><table class="perf"><thead><tr><th>Jour</th><th>Plage</th><th>Heures</th><th>Objectif net</th></tr></thead><tbody>';
    foreach(array_slice($list,0,$sessions) as $i=>$d)echo '<tr><th scope="row">'.nma_e($d).'</th><td>'.nma_e($plages[$i%count($plages)]).'</td><td>'.(int)$per.' h</td><td>'.($objSession?nma_e(number_format($objSession,0,',',' ')).' $':'—').'</td></tr>';
    echo '</tbody></table><div class="two-col-tight"><div><h4>Objectifs de la semaine</h4><ul><li>'.$sessions.' session'.($sessions>1?'s':'').' de '.(int)$per.' h, soit environ '.(int)($sessions*$per).' h, pauses toutes les 2 à 3 heures.</li><li>Solde net visé : '.nma_e(number_format((int)$rv['bas'],0,',',' ')).' à '.nma_e(number_format((int)$rv['haut'],0,',',' ')).' $ (estimation indicative).</li><li>Rapport de performance rempli à la fin de chaque session.</li></ul></div><div><h4>Vos trois priorités</h4><ol>';
    foreach(array_slice((array)($r['recommandations']??array()),0,3) as $t)echo '<li>'.nma_e(preg_replace('/\\s*\\(module \\d\\)\\.?$/u','',$t)).'</li>';
    echo '</ol></div></div><h4>Routine quotidienne</h4><ol><li>Avant la première utilisation : vérification sommaire du véhicule, rapport enregistré dans Neomoov Booster (5 minutes).</li><li>Au départ : odomètre, autonomie et heure notés dans le rapport de performance.</li><li>À l’arrivée : montants, pourboires, énergie, courses ; lecture du solde par heure.</li><li>Chaque dimanche : récapitulatif hebdomadaire, un irritant à corriger la semaine suivante.</li></ol><h4>Les quatre prochaines semaines</h4><ol><li>Semaine 1 : mesurer sans rien changer.</li><li>Semaines 2 et 3 : tester une seule amélioration à la fois (première priorité, puis deuxième).</li><li>Semaine 4 : comparer avec la semaine 1 et fixer votre standard en trois phrases.</li></ol></section>';
}

/* ---------- Rapport de performance Neomoov ---------- */`],
]);

// Assemblage : nouveau module et données de l'examen.
{
  const file = path.join(wpDir, 'build-export.cjs');
  let t = fs.readFileSync(file, 'utf8');
  const edits = [
    ["'formation-attestation.php','booster.php','contract-delivery.php'", "'formation-attestation.php','booster.php','parcours.php','contract-delivery.php'"],
    ["if(media.guide)parsed.guide=media.guide;", "if(media.guide)parsed.guide=media.guide;if(media.intro)parsed.intro=media.intro;if(media.ebook)parsed.ebook=media.ebook;"],
    ["const data=JSON.stringify(parsed);", "parsed.exam=JSON.parse(fs.readFileSync('livraison/formation/examen.json','utf8').replace(/^\\uFEFF/,''));\nconst data=JSON.stringify(parsed);"],
  ];
  for (const [from, to] of edits) { if (t.split(from).length !== 2) throw Error('build-export.cjs : ancre ' + from.slice(0, 60)); t = t.replace(from, () => to); }
  fs.writeFileSync(file, t);
  console.log('build-export.cjs : module parcours.php et examen.json');
}
// Déploiement : routes contrôlées.
{
  const file = path.join(__dirname, 'academy-deployer.cjs');
  let t = fs.readFileSync(file, 'utf8');
  const from = "'attestation/?code=NCP-AAAA-AAAA', 'ressources/'";
  if (t.split(from).length !== 2) throw Error('academy-deployer.cjs : ancre');
  t = t.replace(from, "'attestation/?code=NCP-AAAA-AAAA', 'examen/', 'sondage/?s=debut', 'devenir-chauffeur/', 'recu/', 'ressources/'");
  fs.writeFileSync(file, t);
  console.log('academy-deployer.cjs : 4 routes ajoutées');
}
// Styles
{
  const file = path.join(wpDir, 'academy.css');
  let css = fs.readFileSync(file, 'utf8');
  if (css.includes('.hub-grid')) throw Error('academy.css : déjà appliqué');
  css = css.replace(/\s*$/, '\n') + `.hub-status{font-size:15px;color:#405c68;margin:0 0 22px}.hub-intro{background:#0a2431;color:#fff;border:0}.hub-intro .eyebrow{color:#c4f45c}.hub-intro p{color:#cedae0}.hub-intro h2{color:#fff}.hub-intro a{color:#fff}.hub-intro-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:30px;align-items:center}.hub-intro .media{margin:0}.hub-video-soon{border:1px dashed #5b7380;border-radius:8px;padding:40px 24px;text-align:center;color:#cedae0}.hub-video-soon span{font-size:11px;letter-spacing:3px;color:#c4f45c}.hub-video-soon p{margin:10px 0 0}.hub-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:0 0 30px}.hub-block{border:1px solid #ccd7dc;border-radius:8px;padding:22px 22px 18px;display:flex;flex-direction:column;gap:6px;position:relative;background:#fff}.hub-block h2{font-size:21px;letter-spacing:-.5px;margin:4px 70px 6px 0}.hub-block p{font-size:15px;margin:0 0 10px;flex:1}.hub-num{font-size:12px;letter-spacing:2px;color:#687e88;font-weight:800}.hub-pill{position:absolute;top:18px;right:18px;font-size:12px;font-weight:800;padding:4px 10px;border-radius:12px;background:#e3eaec;color:#405c68;white-space:nowrap}.hub-block.done .hub-pill{background:#dcefc4;color:#3b6b0b}.hub-block.todo .hub-pill{background:#fff3cd;color:#8a6d00}.hub-block.lock{background:#f6f8f9;color:#506671}.hub-block.featured{background:#0a2431;color:#fff;border:0}.hub-block.featured .hub-num{color:#c4f45c}.hub-block.featured p{color:#cedae0}.hub-block.featured a{color:#fff}.hub-links{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center}.hub-links .btn{padding:11px 16px;min-height:42px;font-size:14px}.exam-timer{position:sticky;top:8px;z-index:3;background:#0a2431;color:#fff;padding:12px 18px;border-radius:6px;font-weight:800;margin:0 0 18px}.exam-timer.urgent{background:#9f2424}.exam legend{font-size:17px}.scale{display:flex;gap:6px;flex-wrap:wrap}.scale label{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:13px;min-width:34px;cursor:pointer}.scale input{margin:0;width:20px;height:20px;accent-color:#0a2431}.checklist{list-style:none;padding:0}.checklist li{padding:8px 0 8px 30px;position:relative;border-top:1px solid #dde5e7}.checklist li:before{position:absolute;left:0;font-weight:800}.checklist li.ok:before{content:'✔';color:#3b6b0b}.checklist li.ko:before{content:'✘';color:#9f2424}.conditions li{margin:0 0 12px}.plan{margin:28px 0 0;padding:22px;background:#edf3f1;border-radius:8px}.plan h4{margin:16px 0 8px;font-size:17px}.receipt{max-width:760px}.receipt .brand{font-size:30px;margin:0 0 8px}.receipt-head{display:grid;grid-template-columns:1.1fr 1fr;gap:24px;align-items:start;margin-bottom:18px}.receipt-title h1{font-size:30px;letter-spacing:-1px;margin:0 0 10px}.receipt-title p{font-size:15px}.receipt table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:15px}.receipt th,.receipt td{padding:8px;border-top:1px solid #dde5e7;text-align:left}.receipt td{text-align:right;white-space:nowrap}.receipt tr.total th,.receipt tr.total td{font-weight:800;font-size:18px;border-top:2px solid #0a2431}.receipt-block{margin:12px 0;padding:14px 16px;background:#f3f7f6;border-radius:6px}.receipt-block p{margin:4px 0;font-size:15px}
@media(max-width:900px){.hub-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.hub-grid,.hub-intro-grid,.receipt-head{grid-template-columns:1fr}.hub-block h2{margin-right:0;padding-right:0}.hub-pill{position:static;align-self:flex-start}}
@media print{.hub-grid{grid-template-columns:1fr 1fr}.exam-timer{display:none}.receipt{border:0;padding:0}}
`;
  fs.writeFileSync(file, css);
  console.log('academy.css : styles du parcours');
}
console.log('terminé : relancer node livraison/wordpress/build-export.cjs');
