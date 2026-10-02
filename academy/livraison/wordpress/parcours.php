<?php
/** Neomoov Chauffeur Pro : examen final, sondages de départ et de fin, espace membre en blocs, parcours « Devenir chauffeur Neomoov », reçu de paiement, package gratuit. */
if (!defined('ABSPATH')) { exit; }

/* ---------- Examen final : 20 questions, 40 minutes, 80 % pour réussir, 3 essais puis 7 jours d'attente ---------- */
function nma_exam(){$e=nma_data()['exam']??null;return is_array($e)&&!empty($e['questions'])?$e+array('pass_percent'=>80,'minutes'=>40,'max_attempts'=>3,'cooldown_days'=>7,'edition'=>''):array('questions'=>array(),'pass_percent'=>80,'minutes'=>40,'max_attempts'=>3,'cooldown_days'=>7,'edition'=>'');}
function nma_exam_state($uid){$s=get_user_meta($uid,'nma_exam',true);$s=is_array($s)?$s:array();$s['attempts']=is_array($s['attempts']??null)?$s['attempts']:array();return $s;}
function nma_exam_passed($uid){$s=nma_exam_state($uid);return !empty($s['passed_at'])?$s:null;}
function nma_exam_pass_mark($e){return (int)ceil(count($e['questions'])*(int)$e['pass_percent']/100);}
function nma_exam_eligible($uid){if(!nma_has_access($uid)&&!current_user_can('manage_options'))return 'access';list($d,$t)=nma_progress($uid);return (!$t||$d<$t)?'modules':'';}
/* Après max_attempts échecs consécutifs dans la fenêtre de cooldown_days, l'examen est fermé jusqu'à la fin de cette fenêtre. */
function nma_exam_wait_until($uid){
    $e=nma_exam();$s=nma_exam_state($uid);if(!empty($s['passed_at']))return 0;
    $window=(int)$e['cooldown_days']*DAY_IN_SECONDS;$fails=0;$last=0;
    foreach(array_reverse($s['attempts']) as $a){$t=(int)strtotime((string)($a['at']??''));if(!empty($a['passed'])||$t<time()-$window)break;$fails++;$last=max($last,$t);}
    return $fails>=(int)$e['max_attempts']&&$last+$window>time()?$last+$window:0;
}
function nma_exam_open($uid){$o=get_user_meta($uid,'nma_exam_open',true);return is_array($o)&&!empty($o['order'])&&!empty($o['started'])&&is_array($o['choices']??null)?$o:null;}
function nma_exam_deadline($open){return (int)$open['started']+(int)nma_exam()['minutes']*60;}
/* Ordre des questions et des choix tiré au sort pour chaque essai, conservé côté serveur. */
function nma_exam_start($uid){
    $e=nma_exam();$open=nma_exam_open($uid);if($open&&nma_exam_deadline($open)>time())return $open;
    $order=array_keys($e['questions']);shuffle($order);$choices=array();
    foreach($e['questions'] as $i=>$q){$c=array_keys($q['choices']);shuffle($c);$choices[$i]=$c;}
    $open=array('started'=>time(),'order'=>$order,'choices'=>$choices,'edition'=>(string)$e['edition']);
    update_user_meta($uid,'nma_exam_open',$open);return $open;
}
function nma_exam_submit($uid){
    $e=nma_exam();$open=nma_exam_open($uid);if(!$open)return 'Aucun examen en cours : cliquez sur « Commencer l’examen ».';
    $late=time()>nma_exam_deadline($open)+120;$given=isset($_POST['q'])&&is_array($_POST['q'])?wp_unslash($_POST['q']):array();
    $score=0;$per=array();$answers=array();
    foreach($e['questions'] as $i=>$q){
        $m=(int)$q['module'];if(!isset($per[$m]))$per[$m]=array(0,0);$per[$m][1]++;
        $j=isset($given[$i])&&is_string($given[$i])&&preg_match('/^[0-9]$/D',$given[$i])?(int)$given[$i]:-1;
        $orig=$j>=0&&isset($open['choices'][$i][$j])?(int)$open['choices'][$i][$j]:-1;$answers[$i]=$orig;
        if($orig===(int)$q['answer']){$score++;$per[$m][0]++;}
    }
    ksort($per);$total=count($e['questions']);$mark=nma_exam_pass_mark($e);$passed=$score>=$mark&&!$late;
    $s=nma_exam_state($uid);$s['attempts'][]=array('at'=>gmdate('c'),'score'=>$score,'total'=>$total,'passed'=>$passed,'late'=>$late,'minutes'=>(int)round((time()-(int)$open['started'])/60),'per'=>$per,'edition'=>(string)$e['edition'],'answers'=>$answers);
    $s['attempts']=array_slice($s['attempts'],-20);$s['best']=max((int)($s['best']??0),$score);if($passed&&empty($s['passed_at'])){$s['passed_at']=gmdate('c');$s['passed_score']=$score;$s['passed_total']=$total;}
    update_user_meta($uid,'nma_exam',$s);delete_user_meta($uid,'nma_exam_open');
    if($late)return 'Temps dépassé : cet essai compte '.$score.' / '.$total.' mais ne peut pas être validé. Reprenez l’examen quand vous disposez de '.(int)$e['minutes'].' minutes.';
    return 'Examen final : '.$score.' / '.$total.($passed?'. Réussi, bravo ! Votre résultat est inscrit sur votre attestation et ouvre le parcours « Devenir chauffeur Neomoov ».':'. Non réussi : '.$mark.' bonnes réponses sont nécessaires. Consultez vos résultats par module avant de reprendre.');
}
function nma_exam_public($uid){$s=nma_exam_passed($uid);if(!$s)return array('passed'=>false);$t=strtotime((string)$s['passed_at']);return array('passed'=>true,'score'=>(int)$s['passed_score'].'/'.(int)$s['passed_total'],'on'=>$t?wp_date('Y-m-d',$t):'');}
function nma_exam_certificate_line($a,$specimen=false){
    if($specimen)return '<p><b>Examen final réussi</b> le [date] avec [score] / 20.</p>';
    $uid=(int)($a['uid']??get_current_user_id());$s=$uid?nma_exam_passed($uid):null;
    return $s?'<p><b>Examen final réussi</b> le '.nma_e(nma_date($s['passed_at'])).' avec '.(int)$s['passed_score'].' / '.(int)$s['passed_total'].'.</p>':'';
}
function nma_exam_form($uid,$open){
    $e=nma_exam();$deadline=nma_exam_deadline($open);
    echo '<div class="exam-timer no-print" data-deadline="'.(int)$deadline.'" data-now="'.time().'" aria-live="polite">Temps restant : <span>'.(int)max(0,round(($deadline-time())/60)).' min</span></div>';
    echo '<form method="post" class="quiz exam" id="examen-form" action="'.esc_url(nma_url('examen/')).'">';nma_nonce('exam_submit');
    $n=0;foreach($open['order'] as $i){$q=$e['questions'][$i]??null;if(!$q)continue;$n++;
        echo '<fieldset><legend>'.$n.'. '.nma_e($q['q']).'</legend>';
        foreach((array)$open['choices'][$i] as $j=>$orig){if(!isset($q['choices'][$orig]))continue;echo '<label class="check-row"><input type="radio" name="q['.(int)$i.']" value="'.(int)$j.'" required> '.nma_e($q['choices'][$orig]).'</label>';}
        echo '</fieldset>';
    }
    echo '<p class="small">Répondez à toutes les questions puis validez avant la fin du temps imparti. Le formulaire se valide seul quand le temps est écoulé.</p><button class="btn">Remettre mon examen</button></form>';
}
function nma_exam_attempts($s,$e){
    if(!$s['attempts'])return;$lessons=nma_lessons();
    echo '<h2>Vos essais</h2><table class="perf"><thead><tr><th>Date</th><th>Résultat</th><th>Durée</th><th>Par module</th></tr></thead><tbody>';
    foreach(array_reverse($s['attempts']) as $a){
        $per=array();foreach((array)($a['per']??array()) as $m=>$v)$per[]='M'.(int)$m.' : '.(int)$v[0].'/'.(int)$v[1];
        echo '<tr><td>'.nma_e(nma_date($a['at'])).'</td><td class="'.(!empty($a['passed'])?'ok':'todo').'">'.(int)$a['score'].' / '.(int)$a['total'].(!empty($a['passed'])?' · réussi':(!empty($a['late'])?' · temps dépassé':' · non réussi')).'</td><td>'.(int)$a['minutes'].' min</td><td>'.nma_e(implode(' · ',$per)).'</td></tr>';
    }
    echo '</tbody></table>';
    $last=end($s['attempts']);if($last&&empty($last['passed'])){$weak=array();foreach((array)($last['per']??array()) as $m=>$v)if($v[0]<$v[1]&&isset($lessons[$m-1]))$weak[]='<a class="text-link" href="'.esc_url(nma_url('formation/#'.$lessons[$m-1]['id'])).'">module '.(int)$m.' : '.nma_e(nma_lesson_title($lessons[$m-1])).'</a>';if($weak)echo '<p>À revoir avant le prochain essai : '.implode(' ; ',$weak).'.</p>';}
}
function nma_exam_page(){
    echo '<section class="wrap section narrow"><p class="eyebrow">NEOMOOV CHAUFFEUR PRO · EXAMEN FINAL</p>';
    if(!is_user_logged_in()){echo '<h1>Connectez-vous pour passer l’examen final.</h1><a class="btn" href="'.esc_url(wp_login_url(nma_url('examen/'))).'">Me connecter</a></section>';return;}
    $uid=get_current_user_id();$e=nma_exam();$s=nma_exam_state($uid);$why=nma_exam_eligible($uid);$total=count($e['questions']);$mark=nma_exam_pass_mark($e);
    if(!$total){echo '<h1>L’examen final n’est pas encore disponible.</h1></section>';return;}
    if($why==='access'){echo '<h1>L’examen final est réservé aux membres de la formation.</h1><p><a class="btn" href="'.esc_url(nma_url('membre/')).'">Revenir à mon espace</a></p></section>';return;}
    if($why==='modules'){list($d,$t)=nma_progress($uid);echo '<h1>Terminez d’abord les 7 modules.</h1><p>Votre progression : '.$d.' / '.$t.' modules réussis. L’examen final s’ouvre quand les 7 quiz sont réussis.</p><a class="btn" href="'.esc_url(nma_url('formation/')).'">Continuer la formation</a></section>';return;}
    $open=nma_exam_open($uid);
    if($open&&nma_exam_deadline($open)>time()){echo '<h1>Examen en cours.</h1><p>'.$total.' questions, '.(int)$e['minutes'].' minutes, '.$mark.' bonnes réponses pour réussir. Une seule réponse par question.</p>';nma_exam_form($uid,$open);echo '</section>';return;}
    if(!empty($s['passed_at'])){
        echo '<h1>Examen final réussi.</h1><div class="panel"><p class="big">'.(int)$s['passed_score'].' / '.(int)$s['passed_total'].'</p><p>Réussi le '.nma_e(nma_date($s['passed_at'])).'. Ce résultat figure sur votre attestation de suivi et ouvre le parcours « Devenir chauffeur Neomoov ».</p><div class="actions"><a class="btn" href="'.esc_url(nma_url('attestation/')).'">Mon attestation</a><a class="btn secondary" href="'.esc_url(nma_url('devenir-chauffeur/')).'">Devenir chauffeur Neomoov</a><a class="text-link" href="'.esc_url(nma_url('sondage/?s=fin')).'">Donner mon avis sur la formation</a></div></div>';
    }else{
        echo '<h1>Examen final Neomoov Chauffeur Pro.</h1><p class="lead">'.$total.' questions tirées des 7 modules, '.(int)$e['minutes'].' minutes, '.(int)$e['pass_percent'].' % de bonnes réponses ('.$mark.' / '.$total.') pour réussir.</p>';
        $wait=nma_exam_wait_until($uid);
        if($wait)echo '<div class="panel"><p><b>Examen fermé jusqu’au '.nma_e(wp_date('j F Y, H:i',$wait)).'.</b> Après '.(int)$e['max_attempts'].' essais non réussis, un délai de '.(int)$e['cooldown_days'].' jours s’applique. Profitez-en pour relire les modules signalés ci-dessous.</p></div>';
        else{
            echo '<div class="panel"><h2>Avant de commencer</h2><ul><li>Les questions et les réponses sont présentées dans un ordre différent à chaque essai ; le corrigé n’est pas affiché, seul le résultat par module l’est.</li><li>'.(int)$e['max_attempts'].' essais au plus, puis '.(int)$e['cooldown_days'].' jours d’attente.</li><li>Le chronomètre démarre dès que vous cliquez sur le bouton ; si vous quittez la page, l’essai continue de courir.</li><li>C’est sur la base de cet examen, de votre dossier et de votre véhicule que Neomoov sélectionne ses chauffeurs.</li></ul><form method="post" action="'.esc_url(nma_url('examen/')).'">';nma_nonce('exam_start');
            echo '<label class="check-row"><input type="checkbox" name="honor" value="1" required> Je réponds seul·e, sans aide ni document ouvert, et je dispose de '.(int)$e['minutes'].' minutes devant moi.</label><button class="btn">Commencer l’examen</button></form></div>';
        }
    }
    nma_exam_attempts($s,$e);echo '</section>';
}
function nma_exam_admin_reset(){
    if(!current_user_can('manage_options'))return 'Accès refusé.';check_admin_referer('nma_exam_reset');
    $uid=absint($_POST['exam_member']??0);if(!$uid||!get_user_by('id',$uid))return 'Membre introuvable.';
    $s=nma_exam_state($uid);$s['reset']=array_merge((array)($s['reset']??array()),array(array('at'=>gmdate('c'),'by'=>get_current_user_id(),'attempts'=>count($s['attempts']))));
    $s['attempts']=array();unset($s['passed_at'],$s['passed_score'],$s['passed_total'],$s['best']);update_user_meta($uid,'nma_exam',$s);delete_user_meta($uid,'nma_exam_open');
    return 'Examen réinitialisé pour le membre #'.$uid.' : essais effacés, nouvel examen possible immédiatement.';
}

/* ---------- Sondages de départ et de fin ---------- */
function nma_surveys(){
    $mods=array();foreach(nma_lessons() as $i=>$l)$mods['m'.($i+1)]='Module '.($i+1).' : '.nma_lesson_title($l);
    return array(
     'debut'=>array('title'=>'Sondage de départ','intro'=>'Cinq minutes pour nous dire d’où vous partez et ce que vous attendez. Vos réponses orientent nos conseils et nos prochains outils ; elles ne sont jamais publiées.','paid'=>false,'questions'=>array(
        array('id'=>'situation','label'=>'Votre situation aujourd’hui','type'=>'choice','options'=>array('taxi'=>'Chauffeur de taxi','vtc'=>'Chauffeur VTC (Uber, Lyft, Eva…)','deux'=>'Taxi et VTC','futur'=>'Futur chauffeur','exploitant'=>'Exploitant ou propriétaire de véhicules','autre'=>'Autre acteur du secteur')),
        array('id'=>'objectif','label'=>'Votre objectif principal avec cette formation','type'=>'choice','options'=>array('revenu'=>'Augmenter mon revenu net','conformite'=>'Être certain d’être en règle','service'=>'Améliorer mon service et fidéliser','securite'=>'Travailler plus en sécurité','neomoov'=>'Devenir chauffeur Neomoov','demarrer'=>'Démarrer dans le métier','entreprise'=>'Structurer une entreprise avec plusieurs véhicules')),
        array('id'=>'attentes','label'=>'Ce que vous attendez surtout (plusieurs choix possibles)','type'=>'multi','options'=>array('chiffres'=>'Comprendre mes vrais chiffres','regles'=>'Les règles du Québec expliquées simplement','clients'=>'Des clients qui reviennent','incidents'=>'Gérer les incidents et les plaintes','vehicule'=>'Choisir ou rentabiliser mon véhicule','outils'=>'Des outils concrets : rapports, fiches, application','reseau'=>'Échanger avec d’autres chauffeurs')),
        array('id'=>'frein','label'=>'Votre plus grand frein actuel','type'=>'choice','options'=>array('revenus'=>'Revenus irréguliers ou trop bas','couts'=>'Coûts du véhicule et de l’énergie','temps'=>'Temps morts et kilomètres à vide','plateformes'=>'Dépendance aux plateformes','stress'=>'Stress, fatigue, sécurité','admin'=>'Paperasse, taxes, autorisations','aucun'=>'Aucun frein majeur')),
        array('id'=>'revenu_vise','label'=>'Revenu net visé par semaine (après les coûts du véhicule, avant impôts)','type'=>'choice','options'=>array('800'=>'Moins de 800 $','1200'=>'800 à 1 200 $','1800'=>'1 200 à 1 800 $','1801'=>'Plus de 1 800 $','pnr'=>'Je préfère ne pas répondre')),
        array('id'=>'heures','label'=>'Heures de travail par semaine prévues','type'=>'choice','options'=>array('20'=>'Moins de 20 h','35'=>'20 à 35 h','50'=>'35 à 50 h','51'=>'Plus de 50 h')),
        array('id'=>'vehicule','label'=>'Votre véhicule','type'=>'choice','options'=>array('electrique'=>'100 % électrique','hybride'=>'Hybride','essence'=>'Essence ou diesel','projet'=>'Je prévois passer à l’électrique','aucun'=>'Pas encore de véhicule')),
        array('id'=>'connu','label'=>'Comment avez-vous connu Neomoov Academy ?','type'=>'choice','options'=>array('bouche'=>'Un autre chauffeur','site'=>'Le site neomoov.net','reseaux'=>'Réseaux sociaux','recherche'=>'Une recherche sur Internet','qr'=>'Un code QR ou une carte de visite','courriel'=>'Un courriel','autre'=>'Autre')),
        array('id'=>'souhait','label'=>'En une phrase : ce que vous voulez avoir changé dans 30 jours','type'=>'text'),
     )),
     'fin'=>array('title'=>'Sondage de fin','intro'=>'Votre avis sur la formation et les outils nous sert à les améliorer. Deux minutes. Un témoignage n’est cité qu’avec votre autorisation.','paid'=>true,'questions'=>array(
        array('id'=>'satisfaction','label'=>'Satisfaction globale','type'=>'scale','max'=>5),
        array('id'=>'clarte','label'=>'Clarté et utilité des 7 modules','type'=>'scale','max'=>5),
        array('id'=>'medias','label'=>'Vidéos, narration audio et PDF','type'=>'scale','max'=>5),
        array('id'=>'booster','label'=>'Utilité de Neomoov Booster (vérification, performance, portrait)','type'=>'scale','max'=>5),
        array('id'=>'examen','label'=>'L’examen final vous a semblé…','type'=>'choice','options'=>array('juste'=>'Juste','difficile'=>'Trop difficile','facile'=>'Trop facile','pas'=>'Je ne l’ai pas encore passé')),
        array('id'=>'module_utile','label'=>'Le module le plus utile pour vous','type'=>'choice','options'=>$mods),
        array('id'=>'nps','label'=>'Recommanderiez-vous Neomoov Chauffeur Pro à un autre chauffeur ? (0 = pas du tout, 10 = certainement)','type'=>'scale','max'=>10,'min'=>0),
        array('id'=>'neomoov','label'=>'Souhaitez-vous devenir chauffeur Neomoov ?','type'=>'choice','options'=>array('oui'=>'Oui, dès que possible','plus_tard'=>'Plus tard','non'=>'Non','deja'=>'Je suis déjà préinscrit')),
        array('id'=>'manque','label'=>'Ce qui manque, ou ce que vous amélioreriez','type'=>'text'),
        array('id'=>'temoignage','label'=>'Un mot pour les futurs participants (facultatif)','type'=>'text'),
        array('id'=>'temoignage_ok','label'=>'J’autorise Neomoov à citer ce mot avec mon prénom et l’initiale de mon nom','type'=>'check'),
     )));
}
function nma_survey_get($uid,$key){$s=get_user_meta($uid,'nma_survey_'.$key,true);return is_array($s)&&!empty($s['at'])?$s:null;}
function nma_survey_from_post($def){
    $out=array();
    foreach($def['questions'] as $q){$raw=$_POST['s_'.$q['id']]??null;
        if($q['type']==='multi'){$v=is_array($raw)?array_map('sanitize_key',wp_unslash($raw)):array();$out[$q['id']]=array_values(array_intersect($v,array_keys($q['options'])));}
        elseif($q['type']==='text')$out[$q['id']]=mb_substr(sanitize_textarea_field(wp_unslash((string)$raw)),0,600);
        elseif($q['type']==='check')$out[$q['id']]=!empty($raw)?'yes':'no';
        elseif($q['type']==='scale'){$v=is_string($raw)&&preg_match('/^\d{1,2}$/D',$raw)?(int)$raw:null;$out[$q['id']]=$v!==null&&$v>=(int)($q['min']??1)&&$v<=(int)$q['max']?$v:null;}
        else{$v=sanitize_key(wp_unslash((string)$raw));$out[$q['id']]=array_key_exists($v,$q['options'])?$v:'';}
    }
    return $out;
}
function nma_survey_submit($uid){
    $key=sanitize_key($_POST['s']??'');$defs=nma_surveys();if(!isset($defs[$key]))return 'Sondage introuvable.';$def=$defs[$key];
    if($def['paid']&&!nma_has_access($uid)&&!current_user_can('manage_options'))return 'Ce sondage est réservé aux membres de la formation.';
    $a=nma_survey_from_post($def);$n=0;foreach($a as $v){if($v!==''&&$v!==null&&$v!==array()&&$v!=='no')$n++;}if($n<3)return 'Répondez à au moins trois questions.';
    $prev=nma_survey_get($uid,$key);update_user_meta($uid,'nma_survey_'.$key,array('answers'=>$a,'at'=>$prev['at']??gmdate('c'),'updated'=>gmdate('c')));
    return 'Merci, vos réponses au '.mb_strtolower($def['title']).' sont enregistrées.';
}
function nma_survey_form($key,$def,$saved){
    $a=(array)($saved['answers']??array());
    echo '<form method="post" class="panel" action="'.esc_url(nma_url('sondage/?s='.$key)).'">';nma_nonce('survey');echo '<input type="hidden" name="s" value="'.esc_attr($key).'">';
    foreach($def['questions'] as $q){$id='s_'.$q['id'];$cur=$a[$q['id']]??'';
        if($q['type']==='check'){echo '<label class="check-row"><input type="checkbox" name="'.esc_attr($id).'" value="1"'.($cur==='yes'?' checked':'').'> '.nma_e($q['label']).'</label>';continue;}
        echo '<div class="field"><span class="q-label">'.nma_e($q['label']).'</span>';
        if($q['type']==='choice')echo nmb_select($id,array(''=>'Choisir…')+$q['options'],$cur);
        elseif($q['type']==='multi'){foreach($q['options'] as $v=>$l)echo '<label class="check-row"><input type="checkbox" name="'.esc_attr($id).'[]" value="'.esc_attr($v).'"'.(in_array($v,(array)$cur,true)?' checked':'').'> '.nma_e($l).'</label>';}
        elseif($q['type']==='scale'){echo '<div class="scale">';for($i=(int)($q['min']??1);$i<=(int)$q['max'];$i++)echo '<label><input type="radio" name="'.esc_attr($id).'" value="'.$i.'"'.((string)$cur===(string)$i?' checked':'').'>'.$i.'</label>';echo '</div>';}
        else echo '<textarea name="'.esc_attr($id).'" rows="3" maxlength="600">'.nma_e($cur).'</textarea>';
        echo '</div>';
    }
    echo '<div class="actions"><button class="btn">'.($saved?'Mettre à jour mes réponses':'Envoyer mes réponses').'</button><a class="text-link" href="'.esc_url(nma_url('membre/')).'">Revenir à mon espace</a></div></form>';
}
function nma_survey_page(){
    $key=sanitize_key($_GET['s']??'debut');$defs=nma_surveys();if(!isset($defs[$key]))$key='debut';$def=$defs[$key];
    echo '<section class="wrap section narrow"><p class="eyebrow">NEOMOOV CHAUFFEUR PRO · '.nma_e(mb_strtoupper($def['title'])).'</p>';
    if(!is_user_logged_in()){echo '<h1>Connectez-vous pour répondre.</h1><a class="btn" href="'.esc_url(wp_login_url(nma_url('sondage/?s='.$key))).'">Me connecter</a></section>';return;}
    $uid=get_current_user_id();
    if($def['paid']&&!nma_has_access($uid)&&!current_user_can('manage_options')){echo '<h1>Ce sondage est réservé aux membres de la formation.</h1><a class="btn" href="'.esc_url(nma_url('membre/')).'">Revenir à mon espace</a></section>';return;}
    $saved=nma_survey_get($uid,$key);echo '<h1>'.nma_e($def['title']).'.</h1><p class="lead">'.nma_e($def['intro']).'</p>';
    if($saved)echo '<p class="small">Répondu le '.nma_e(nma_date($saved['at'])).'. Vous pouvez modifier vos réponses.</p>';
    nma_survey_form($key,$def,$saved);echo '</section>';
}
/* Synthèse administrateur : effectifs, répartition des réponses, derniers textes. */
function nma_survey_admin(){
    foreach(nma_surveys() as $key=>$def){
        $ids=get_users(array('meta_key'=>'nma_survey_'.$key,'fields'=>'ID','number'=>5000));$rows=array();foreach($ids as $id){$s=nma_survey_get((int)$id,$key);if($s)$rows[(int)$id]=$s;}
        echo '<h3>'.esc_html($def['title']).' : '.count($rows).' réponse(s)</h3>';if(!$rows)continue;
        foreach($def['questions'] as $q){
            if($q['type']==='text'){$texts=array();foreach($rows as $id=>$s){$v=trim((string)($s['answers'][$q['id']]??''));if($v!=='')$texts[]='#'.$id.' ('.substr((string)$s['at'],0,10).') : '.$v;}if($texts){echo '<p><b>'.esc_html($q['label']).'</b></p><ul>';foreach(array_slice(array_reverse($texts),0,30) as $t)echo '<li>'.esc_html($t).'</li>';echo '</ul>';}continue;}
            $counts=array();$sum=0;$n=0;
            foreach($rows as $s){$v=$s['answers'][$q['id']]??null;if($q['type']==='multi'){foreach((array)$v as $x)$counts[$x]=($counts[$x]??0)+1;}elseif($q['type']==='scale'){if($v!==null&&$v!==''){$sum+=(int)$v;$n++;$counts[(string)$v]=($counts[(string)$v]??0)+1;}}elseif($v!==''&&$v!==null)$counts[(string)$v]=($counts[(string)$v]??0)+1;}
            arsort($counts);$parts=array();foreach($counts as $k=>$c)$parts[]=(isset($q['options'][$k])?$q['options'][$k]:$k).' : '.$c;
            echo '<p><b>'.esc_html($q['label']).'</b>'.($q['type']==='scale'&&$n?' · moyenne '.esc_html(number_format($sum/$n,1,',',' ')).' sur '.(int)$q['max']:'').'<br>'.esc_html(implode(' · ',$parts)).'</p>';
        }
    }
}
function nma_parcours_admin(){
    if(!current_user_can('manage_options'))return;
    echo '<hr><h2>Examen final et sondages</h2>';
    $ids=get_users(array('meta_key'=>'nma_exam','fields'=>'ID','number'=>5000));$passed=0;$attempts=0;foreach($ids as $id){$s=nma_exam_state((int)$id);$attempts+=count($s['attempts']);if(!empty($s['passed_at']))$passed++;}
    echo '<p>'.count($ids).' membre(s) ont tenté l’examen final, '.$attempts.' essai(s), '.$passed.' réussite(s). Réglages : '.count(nma_exam()['questions']).' questions, '.(int)nma_exam()['minutes'].' minutes, '.(int)nma_exam()['pass_percent'].' %, '.(int)nma_exam()['max_attempts'].' essais puis '.(int)nma_exam()['cooldown_days'].' jours.</p>';
    echo '<form method="post"><input type="hidden" name="nma_admin_action" value="exam_reset">';wp_nonce_field('nma_exam_reset');echo '<label>Réinitialiser l’examen du membre n° <input type="number" name="exam_member" min="1" required></label> <button class="button">Réinitialiser (efface les essais et la réussite)</button></form>';
    nma_survey_admin();
}

/* ---------- Actions POST ---------- */
function nma_parcours_post($act,$uid){
    if($act==='exam_start'){if(nma_exam_eligible($uid)!=='')return 'L’examen final s’ouvre quand les 7 modules sont réussis.';if(nma_exam_passed($uid))return 'Votre examen final est déjà réussi : le résultat est acquis.';if(empty($_POST['honor']))return 'Cochez l’engagement avant de commencer.';if(nma_exam_wait_until($uid))return 'L’examen est temporairement fermé : consultez la date de réouverture.';nma_exam_start($uid);return 'L’examen est lancé : le chronomètre a démarré.';}
    if($act==='exam_submit')return nma_exam_submit($uid);
    if($act==='survey')return nma_survey_submit($uid);
    return '';
}

/* ---------- Espace membre en blocs ---------- */
function nma_hub_block($num,$title,$text,$state,$pill,$links,$extra=''){
    $h='<div class="hub-block '.esc_attr($state).($extra?' '.esc_attr($extra):'').'"><span class="hub-num">'.nma_e($num).'</span>'.($pill!==''?'<span class="hub-pill">'.nma_e($pill).'</span>':'').'<h2>'.nma_e($title).'</h2><p>'.$text.'</p>';
    if($links){$h.='<div class="hub-links">';foreach($links as $i=>$l)$h.='<a class="'.($i===0?'btn':'text-link').'" href="'.esc_url($l[0]).'">'.nma_e($l[1]).'</a>';$h.='</div>';}
    return $h.'</div>';
}
function nma_member_hub($uid,$paid){
    $admin=current_user_can('manage_options');$can=$paid||$admin;$u=wp_get_current_user();
    list($done,$total)=nma_progress($uid);$res=nma_quiz_results($uid);$exam=nma_exam_state($uid);$att=nma_attestation_get($uid);
    $sd=nma_survey_get($uid,'debut');$sf=nma_survey_get($uid,'fin');$data=nma_data();$intro=is_array($data['intro']??null)?$data['intro']:array();$ebook=$data['ebook']??'';$guide=$data['guide']??'';
    $until=(int)get_user_meta($uid,'nma_access_until',true);
    echo '<p class="hub-status">'.($paid?'<b>Accès Neomoov Chauffeur Pro actif</b>'.($until?' jusqu’au '.nma_e(nma_date(gmdate('c',$until))):'').' · '.$done.' / '.$total.' modules réussis':'<b>Espace gratuit</b> · Neomoov Booster, fiches, package gratuit et sondage de départ sont ouverts ; la formation s’active après l’achat.').'</p>';
    /* Bloc d'introduction, en pleine largeur */
    echo '<div class="panel hub-intro"><div class="hub-intro-grid"><div><p class="eyebrow">01 · INTRODUCTION</p><h2>Bienvenue dans Neomoov Chauffeur Pro.</h2><p>Votre parcours, dans l’ordre : le sondage de départ, les 7 modules avec leur quiz, l’examen final, puis le parcours « Devenir chauffeur Neomoov ». Neomoov Booster vous accompagne chaque jour de travail, et le bloc Bonus réunit votre package gratuit. Comptez une à deux heures par module ; vous pouvez tout reprendre autant de fois que nécessaire.</p><p class="small"><a class="text-link" href="https://neomoov.net/conditions-cap-chauffeur/">Conditions de vente Neomoov Chauffeur Pro</a> · <a class="text-link" href="'.esc_url(nma_url('confidentialite/')).'">Vos données</a>'.($can&&$guide&&nma_https_url($guide)?' · <a class="text-link" href="'.esc_url($guide).'">Guide complet des 7 modules (PDF)</a>':'').'</p></div><div class="media">';
    if(!empty($intro['video'])&&nma_https_url($intro['video']))echo '<video controls preload="none" playsinline src="'.esc_url($intro['video']).'"></video>';
    elseif(!empty($intro['audio'])&&nma_https_url($intro['audio']))echo '<audio controls preload="none" src="'.esc_url($intro['audio']).'"></audio>';
    else echo '<div class="hub-video-soon"><span>VIDÉO DE BIENVENUE</span><p>Le mot d’accueil du fondateur arrive ici.</p></div>';
    echo '</div></div></div>';
    echo '<div class="hub-grid">';
    echo nma_hub_block('02','Sondage de départ','Vos aspirations et vos attentes, en cinq minutes : la formation et nos conseils s’y adaptent.',$sd?'done':'todo',$sd?'Fait':'À faire',array(array(nma_url('sondage/?s=debut'),$sd?'Revoir mes réponses':'Répondre')));
    if(!$can){
        $o=nma_opts();ob_start();if(nma_ready())nma_checkout_form($o);else echo '<p>Les paiements sont en préparation. Vos ressources gratuites sont accessibles dès maintenant.</p>';$form=ob_get_clean();
        echo '<div class="hub-block featured"><span class="hub-num">03 À 11</span><h2>Accéder à la formation</h2><p>7 modules avec exercices corrigés, quiz, vidéos, narration audio et PDF, examen final, attestation de suivi vérifiable et parcours « Devenir chauffeur Neomoov ». Accès 12 mois.</p>'.$form.'</div>';
    }
    foreach(nma_lessons() as $i=>$l){$r=is_array($res[$l['id']]??null)?$res[$l['id']]:array();$ok=(int)($r['best']??0)>=nma_quiz_pass($l);$state=!$can?'lock':($ok?'done':'todo');$pill=!$can?'Réservé':($ok?'Réussi':($r?'À reprendre':'À faire'));
        echo nma_hub_block(str_pad((string)($i+3),2,'0',STR_PAD_LEFT),'Module '.($i+1).' · '.nma_lesson_title($l),nma_e($l['intro']),$state,$pill,$can?array(array(nma_url('formation/#'.$l['id']),$ok?'Revoir le module':'Ouvrir le module')):array());}
    $exOk=!empty($exam['passed_at']);$exState=!$can?'lock':($exOk?'done':($done>=$total&&$total?'todo':'lock'));$exPill=!$can?'Réservé':($exOk?'Réussi '.(int)$exam['passed_score'].'/'.(int)$exam['passed_total']:($done>=$total&&$total?($exam['attempts']?'À reprendre':'À faire'):'Après les 7 modules'));
    echo nma_hub_block('10','Examen final','20 questions, 40 minutes, 80 % pour réussir. Le résultat s’inscrit sur votre attestation et compte pour la sélection des chauffeurs Neomoov.',$exState,$exPill,$can?array(array(nma_url('examen/'),$exOk?'Voir mon résultat':'Passer l’examen'),array(nma_url('attestation/'),$att?'Mon attestation':'Attestation de suivi')):array());
    $nb=count(nmb_meta($uid,'nmb_inspections'));$np=count(nmb_meta($uid,'nmb_performance'));$prof=nmb_meta($uid,'nmb_profile');
    echo nma_hub_block('11','Neomoov Booster','Rapport de vérification sommaire ('.$nb.' enregistré'.($nb>1?'s':'').'), rapport de performance ('.$np.' session'.($np>1?'s':'').'), portrait de chauffeur'.($prof?' (fait)':'').' et bilan de journée.','done','Ouvert',array(array(nma_url('booster/verification/'),'Vérification du jour'),array(nma_url('booster/performance/'),'Performance'),array(nma_url('booster/profil/'),'Portrait et plan'),array(nma_url('booster/'),'Bilan de journée')));
    $bonus=array();if($ebook&&nma_https_url($ebook))$bonus[]=array($ebook,'Télécharger l’ebook « Le chauffeur qui compte » (PDF)');$bonus[]=array(nma_url('booster/profil/'),'Mon évaluation et mon plan simplifié');$bonus[]=array(nma_url('ressources/'),'Les 8 fiches pratiques');if($can&&$guide&&nma_https_url($guide))$bonus[]=array($guide,'Guide complet des 7 modules (PDF)');
    echo nma_hub_block('12','Bonus','Votre package gratuit Neomoov : l’ebook'.($ebook?'':' (bientôt)').', l’évaluation sommaire de votre profil de chauffeur et votre plan de travail simplifié, plus les fiches pratiques'.($can?' et le guide complet':'').'.','done','Inclus',$bonus);
    $elig=nma_driver_eligibility($uid);$okCount=0;foreach($elig as $e)if($e[0])$okCount++;
    echo nma_hub_block('13','Devenir chauffeur Neomoov','Les meilleurs participants qui réussissent l’examen et roulent en 100 % électrique de 5 ans ou moins peuvent rejoindre Neomoov. Votre dossier : '.$okCount.' / '.count($elig).' conditions vérifiables remplies.',$okCount===count($elig)?'done':'todo',$okCount===count($elig)?'Prêt':'En cours',array(array(nma_url('devenir-chauffeur/'),'Voir les conditions'),array('https://reserver.neomoov.net/chauffeurs','Me préinscrire')));
    echo nma_hub_block('14','Sondage de fin','Votre avis sur la formation et les outils, après l’examen. Deux minutes qui améliorent le programme.',!$can?'lock':($sf?'done':'todo'),!$can?'Réservé':($sf?'Fait':'À faire'),$can?array(array(nma_url('sondage/?s=fin'),$sf?'Revoir mes réponses':'Donner mon avis')):array());
    echo '</div>';
    /* Documents, bilans et compte */
    echo '<div class="two-col-tight"><div class="panel"><h2>Mes documents</h2>';
    if(function_exists('nmcd_member_documents'))nmcd_member_documents($uid);
    if(nma_receipt_data($uid)||($admin&&!$paid))echo '<p><a href="'.esc_url(nma_url('recu/')).'">Mon reçu de paiement Neomoov</a></p>';
    if($att)echo '<p><a href="'.esc_url(nma_url('attestation/')).'">Mon attestation de suivi</a></p>';
    if(function_exists('nmsa_member_status'))nmsa_member_status($uid);
    echo '</div><div class="panel"><h2>Mes derniers bilans</h2>';$items=(array)get_user_meta($uid,'nma_balances',true);if(!$items)echo '<p>Aucun bilan enregistré. <a class="text-link" href="'.esc_url(nma_url('booster/')).'">Calculer ma journée</a></p>';else{echo '<div class="module-list">';foreach(array_slice($items,0,10) as $b)if(is_array($b))echo '<article><span>•</span><h3>'.nma_e(substr($b['date'],0,10)).'</h3><p>'.number_format($b['receipts']-$b['costs'],2,',',' ').' $ CA · '.nma_e($b['hours']).' h · '.nma_e($b['km']).' km</p></article>';echo '</div>';}
    echo '</div></div><form method="post">';nma_nonce('unsubscribe');echo '<button class="text-link">Retirer mon consentement aux emails commerciaux</button></form><p class="small">Pour une copie ou une suppression des données : contact@neomoov.net.</p>';
}

/* ---------- Devenir chauffeur Neomoov ---------- */
function nma_driver_conditions(){return array(
 array('Dossier en règle','Permis de chauffeur autorisé (chauffeur qualifié selon la SAAQ), certificat de vérification des antécédents judiciaires récent, inscription à la TPS et à la TVQ, assurance couvrant le transport rémunéré de personnes.'),
 array('Véhicule 100 % électrique admissible','5 ans ou moins et 120 000 km ou moins, 4 portes et 5 places, attestation du véhicule autorisé, carrosserie et habitacle irréprochables, autonomie adaptée à une journée complète.'),
 array('Examen final Neomoov Chauffeur Pro réussi','80 % de bonnes réponses ou plus, attestation de suivi valide. C’est sur cette base que Neomoov retient les candidatures et attribue les premières courses.'),
 array('Vérification sommaire consignée chaque jour','Rapport de vérification sommaire tenu dans Neomoov Booster avant la première utilisation de la journée, disponible sur demande.'),
 array('Standard de service Neomoov','Kit du bon chauffeur à bord, tenue professionnelle, français et anglais de base, téléphone professionnel sur support fixe, conduite souple, discrétion.'),
 array('Période d’intégration de 30 jours','Ponctualité, taux d’annulation du chauffeur sous 5 %, note moyenne de 4,7 sur 5 ou plus, aucune plainte fondée ; les premières courses sont attribuées progressivement.'),
 array('Engagements','Adhésion à la Charte d’équité Neomoov, acceptation des vérifications (documents, véhicule, antécédents) et des conditions financières précisées dans le contrat de chauffeur Neomoov.'),
);}
function nma_driver_eligibility($uid){
    $p=nmb_meta($uid,'nmb_profile');$a=(array)($p['answers']??array());$aut=(array)($a['autorisations']??array());
    $exam=nma_exam_passed($uid);$att=nma_attestation_get($uid);
    return array(
     array((bool)$exam,'Examen final réussi',$exam?'Réussi le '.nma_date($exam['passed_at']).' ('.(int)$exam['passed_score'].' / '.(int)$exam['passed_total'].')':'À passer après les 7 modules'),
     array((bool)$att,'Attestation de suivi délivrée',$att?'Code '.$att['code']:'Après les 7 quiz'),
     array($p&&($a['vehicule']??'')==='electrique'&&in_array($a['vehicule_age']??'',array('3','5'),true),'Véhicule 100 % électrique de 5 ans ou moins',$p?'D’après votre portrait de chauffeur':'Complétez votre portrait de chauffeur'),
     array($p&&in_array('permis',$aut,true)&&in_array('assurance',$aut,true)&&in_array('tps',$aut,true),'Permis de chauffeur autorisé, assurance et TPS/TVQ',$p?'D’après votre portrait de chauffeur':'Complétez votre portrait de chauffeur'),
     array(count(nmb_meta($uid,'nmb_inspections'))>0,'Au moins un rapport de vérification sommaire enregistré','Neomoov Booster · Vérification du jour'),
    );
}
function nma_driver_page(){
    echo '<section class="wrap section narrow"><p class="eyebrow">ROULER AVEC NEOMOOV</p><h1>Devenir chauffeur Neomoov.</h1><p class="lead">Neomoov est une plateforme de transport premium 100 % électrique à Montréal : prix confirmé avant la réservation, réservations à l’avance, chauffeurs et véhicules vérifiés. Dans le cadre de Neomoov Chauffeur Pro, les meilleurs participants qui réussissent l’examen final et roulent en véhicule 100 % électrique de 5 ans ou moins peuvent rejoindre le programme de chauffeurs Neomoov.</p>';
    if(is_user_logged_in()){$elig=nma_driver_eligibility(get_current_user_id());echo '<div class="panel"><h2>Votre dossier</h2><ul class="checklist">';foreach($elig as $e)echo '<li class="'.($e[0]?'ok':'ko').'"><b>'.nma_e($e[1]).'</b> · '.nma_e($e[2]).'</li>';echo '</ul><p class="small">Les autres conditions sont vérifiées lors de l’entretien et de l’inspection du véhicule.</p></div>';}
    echo '<h2>Les conditions</h2><ol class="conditions">';foreach(nma_driver_conditions() as $c)echo '<li><b>'.nma_e($c[0]).'.</b> '.nma_e($c[1]).'</li>';echo '</ol>';
    echo '<h2>Les étapes</h2><ol class="steps"><li>Préinscription en ligne : identité, véhicule, autorisations, attestation Neomoov Chauffeur Pro.</li><li>Vérification du dossier et entretien (en personne ou en vidéo).</li><li>Inspection du véhicule et prise en main de l’application chauffeur Neomoov.</li><li>Période d’intégration de 30 jours avec des courses attribuées progressivement.</li></ol>';
    echo '<div class="panel join"><p class="eyebrow">CANDIDATURE</p><h2>Prêt à rouler avec Neomoov ?</h2><p>La préinscription prend cinq minutes. Aucune garantie d’admission, de courses ni de revenus : Neomoov sélectionne ses chauffeurs sur dossier, examen et niveau de service.</p><a class="btn" href="https://reserver.neomoov.net/chauffeurs">Me préinscrire comme chauffeur Neomoov</a>'.(is_user_logged_in()?'':' <a class="text-link" href="'.esc_url(nma_url('membre/')).'">Suivre la formation d’abord</a>').'</div></section>';
}

/* ---------- Reçu de paiement Neomoov ---------- */
function nma_receipt_data($uid){
    $prov=get_user_meta($uid,'nma_payment_provider',true);
    if($prov==='square_api'){$r=get_user_meta($uid,'nmsa_checkout',true);if(!is_array($r)||empty($r['confirmed_payment']['id'])||($r['environment']??'')!=='production')return null;$p=$r['confirmed_payment'];$b=(array)($r['buyer']??array());
        return array('reference'=>(string)($r['reference']??''),'order_id'=>(string)($r['order_id']??''),'payment_id'=>(string)$p['id'],'paid_at'=>(string)($p['captured_at']??$p['created_at']??''),'buyer_name'=>(string)($b['name']??''),'buyer_email'=>(string)($b['email']??''),'buyer_address'=>implode(', ',array_filter(array($b['address_line_1']??'',$b['address_line_2']??'',$b['city']??'','Québec',$b['postal_code']??'','Canada'))),'card'=>(string)($p['card']??''),'method'=>'Carte par Square','price_cents'=>9900,'gst_cents'=>495,'qst_cents'=>988,'total_cents'=>11383,'access_started'=>(int)($r['access_started']??0),'access_until'=>(int)($r['access_until']??0));}
    if($prov==='square_manual'){$pid=get_user_meta($uid,'nma_square_payment_id',true);$rec=$pid?get_option('nma_square_payment_'.hash('sha256',$pid),false):false;if(!is_array($rec)||get_user_meta($uid,'nma_paid',true)!=='yes')return null;$u=get_user_by('id',$uid);
        $total=(int)($rec['amount_cents']??0);$price=(int)round($total/1.14975);$gst=(int)round($price*0.05);$qst=$total-$price-$gst;
        return array('reference'=>'SQM-'.strtoupper(substr(hash('sha256',$pid),0,10)),'order_id'=>'','payment_id'=>(string)$pid,'paid_at'=>(string)($rec['created_at']??''),'buyer_name'=>$u?trim($u->first_name.' '.$u->last_name)?:$u->display_name:'','buyer_email'=>$u?$u->user_email:'','buyer_address'=>'','card'=>'','method'=>'Paiement Square vérifié manuellement','price_cents'=>$price,'gst_cents'=>$gst,'qst_cents'=>$qst,'total_cents'=>$total,'access_started'=>(int)($rec['access_started']??0),'access_until'=>(int)($rec['access_until']??0));}
    return null;
}
function nma_receipt_render($d,$specimen=false){
    $seller=function_exists('nmcd_seller')?nmcd_seller():array('name'=>'GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC.','neq'=>'','address'=>'204 rue du Saint-Sacrement, bureau 300, Montréal (Québec) H2Y 1W8, Canada','email'=>'contact@neomoov.net','phone'=>'','seller_gst'=>'','seller_qst'=>'');
    $tz=wp_timezone();$fmt=function($iso)use($tz){$t=strtotime((string)$iso);return $t?nma_date(gmdate('c',$t)).' à '.wp_date('H:i',$t,$tz):'—';};
    echo '<div class="receipt panel" id="recu">'.($specimen?'<p class="specimen">SPÉCIMEN : aperçu administrateur, aucun paiement associé</p>':'').'<div class="receipt-head"><div><p class="brand">neomoov<span>ACADEMY</span></p><p class="small">'.nma_e($seller['name']).'<br>'.nma_e($seller['address']).'<br>'.nma_e(trim(($seller['phone']?'Tél. : '.$seller['phone'].' · ':'').'Courriel : '.$seller['email'])).'</p></div><div class="receipt-title"><h1>Reçu de paiement</h1><p><b>Numéro de référence :</b> '.nma_e($d['reference']).'<br><b>Date du paiement :</b> '.nma_e($fmt($d['paid_at'])).'<br><b>Total payé :</b> '.nma_e(nma_money($d['total_cents'])).'</p></div></div>';
    echo '<table><tbody><tr><th>Neomoov Chauffeur Pro — formation complémentaire pour chauffeurs taxi et VTC</th><td>'.nma_e(nma_money($d['price_cents'])).'</td></tr><tr><th>Sous-total</th><td>'.nma_e(nma_money($d['price_cents'])).'</td></tr><tr><th>TPS (5 %)</th><td>'.nma_e(nma_money($d['gst_cents'])).'</td></tr><tr><th>TVQ (9,975 %)</th><td>'.nma_e(nma_money($d['qst_cents'])).'</td></tr><tr class="total"><th>Montant total</th><td>'.nma_e(nma_money($d['total_cents'])).'</td></tr></tbody></table>';
    echo '<div class="receipt-block"><p><b>Inscription à :</b> Neomoov Chauffeur Pro (7 modules, quiz, examen final, attestation de suivi, 8 fiches, Neomoov Booster)</p><p><b>Session :</b> accès en ligne de 12 mois calendaires'.($d['access_started']?' · du '.nma_e(nma_date(gmdate('c',$d['access_started']))).($d['access_until']?' au '.nma_e(nma_date(gmdate('c',$d['access_until']))):''):'').'</p><p><b>Facturé à :</b> '.nma_e($d['buyer_name']).($d['buyer_address']?'<br>'.nma_e($d['buyer_address']):'').'<br>'.nma_e($d['buyer_email']).'</p></div>';
    echo '<div class="receipt-block"><p><b>Paiement reçu :</b> '.nma_e(nma_money($d['total_cents'])).'</p><p><b>Méthode de paiement :</b> '.nma_e($d['method'].($d['card']?' : '.$d['card']:'')).'</p><p><b>Au nom de :</b> '.nma_e($d['buyer_name']).'</p><p><b>Référence du fournisseur de paiement :</b> '.nma_e($d['payment_id']).($d['order_id']?' · commande '.nma_e($d['order_id']):'').'</p><p><b>Payé le :</b> '.nma_e($fmt($d['paid_at'])).'</p></div>';
    echo '<p class="small">'.nma_e(trim(($seller['seller_gst']?'No TPS/TVH : '.$seller['seller_gst'].'  ':'').($seller['seller_qst']?'No TVQ : '.$seller['seller_qst'].'  ':'').($seller['neq']?'NEQ : '.$seller['neq'].'  ':''))).'Document émis le '.nma_e(wp_date('Y-m-d',time(),$tz)).'. Paiement unique, sans renouvellement automatique. Remboursement selon les conditions de vente acceptées.</p></div>'.nmb_print_buttons('recu');
}
function nma_receipt_page(){
    echo '<section class="wrap section narrow">';
    if(!is_user_logged_in()){echo '<p class="eyebrow">REÇU DE PAIEMENT</p><h1>Connectez-vous pour consulter votre reçu.</h1><a class="btn" href="'.esc_url(wp_login_url(nma_url('recu/'))).'">Me connecter</a></section>';return;}
    $uid=get_current_user_id();$d=nma_receipt_data($uid);
    if($d)nma_receipt_render($d);
    elseif(current_user_can('manage_options'))nma_receipt_render(array('reference'=>'NCP-2026-000123','order_id'=>'ORDER-XXXX','payment_id'=>'PAYMENT-XXXX','paid_at'=>gmdate('c'),'buyer_name'=>'Prénom Nom','buyer_email'=>'prenom@example.com','buyer_address'=>'123 rue Exemple, Montréal, Québec, H2Y 1W8, Canada','card'=>'VISA ****1234','method'=>'Carte par Square','price_cents'=>9900,'gst_cents'=>495,'qst_cents'=>988,'total_cents'=>11383,'access_started'=>time(),'access_until'=>nma_calendar_access_end(time())),true);
    else echo '<p class="eyebrow">REÇU DE PAIEMENT</p><h1>Aucun paiement associé à ce compte.</h1><p>Le reçu apparaît ici après la confirmation de votre achat. Pour toute question : contact@neomoov.net.</p><a class="btn" href="'.esc_url(nma_url('membre/')).'">Revenir à mon espace</a>';
    echo '</section>';
}

/* ---------- Package gratuit : courriel de bienvenue après la création du compte ---------- */
function nma_welcome_package_mail($uid){
    $u=get_user_by('id',$uid);if(!$u||!is_email($u->user_email))return false;$ebook=nma_data()['ebook']??'';
    $lines=array('Bonjour '.($u->display_name?:'').',','','Votre espace gratuit Neomoov Academy est créé. Un courriel séparé vous permet de définir votre mot de passe.','','Votre package gratuit Neomoov :',($ebook&&nma_https_url($ebook)?'1. L’ebook « Le chauffeur qui compte » (PDF) : '.$ebook:'1. L’ebook « Le chauffeur qui compte » : bientôt disponible dans le bloc Bonus de votre espace.'),'2. Votre évaluation sommaire de profil de chauffeur et votre plan de travail simplifié : '.nma_url('booster/profil/'),'3. Les 8 fiches pratiques : '.nma_url('ressources/'),'','Chaque jour de travail : le rapport de vérification sommaire et le rapport de performance dans Neomoov Booster : '.nma_url('booster/'),'','Pour aller plus loin, la formation Neomoov Chauffeur Pro (7 modules, quiz, examen final, attestation) : '.nma_url('#programme'),'','L’équipe Neomoov Academy','Neomoov, marque de GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC. · 204 rue du Saint-Sacrement, bureau 300, Montréal (Québec) H2Y 1W8 · contact@neomoov.net','Ce courriel de service accompagne la création de votre compte ; il ne dépend pas de votre consentement aux offres commerciales.');
    return wp_mail($u->user_email,'Votre package gratuit Neomoov',implode("\n",$lines),array('From: Neomoov Academy <contact@neomoov.net>','Reply-To: contact@neomoov.net'));
}

/* ---------- Script : chronomètre de l'examen ---------- */
function nma_parcours_script(){return <<<'JS'
(()=>{const t=document.querySelector('.exam-timer');if(!t)return;const form=document.getElementById('examen-form');const deadline=Number(t.dataset.deadline)*1000,skew=Date.now()-Number(t.dataset.now)*1000;const span=t.querySelector('span');let sent=false;const tick=()=>{const left=Math.max(0,Math.round((deadline-(Date.now()-skew))/1000));const m=Math.floor(left/60),s=left%60;span.textContent=m+' min '+String(s).padStart(2,'0')+' s';if(left<=300)t.classList.add('urgent');if(left<=0&&form&&!sent){sent=true;form.querySelectorAll('input[required]').forEach(i=>i.required=false);form.submit()}};tick();setInterval(tick,1000)})();
JS;
}
