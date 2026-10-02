<?php
/** Neomoov Chauffeur Pro : modules, quiz, progression, attestation de suivi vérifiable et fiche de vérification avant départ. */
if (!defined('ABSPATH')) { exit; }

/* Texte des modules : paragraphes séparés par une ligne vide, listes en lignes commençant par « - ». */
function nma_rich($text){
    $out='';
    foreach(preg_split('/\n{2,}/',trim((string)$text)) as $block){
        $list='';$para=array();
        foreach(explode("\n",$block) as $line){
            $line=trim($line);if($line==='')continue;
            if(strpos($line,'- ')===0){if($para){$out.='<p>'.nma_e(implode(' ',$para)).'</p>';$para=array();}$list.='<li>'.nma_e(substr($line,2)).'</li>';}
            else{if($list!==''){$out.='<ul>'.$list.'</ul>';$list='';}$para[]=$line;}
        }
        if($para)$out.='<p>'.nma_e(implode(' ',$para)).'</p>';
        if($list!=='')$out.='<ul>'.$list.'</ul>';
    }
    return $out;
}
function nma_lessons(){$l=nma_data()['lessons']??array();return is_array($l)?$l:array();}
function nma_lesson_title($l){return preg_replace('/^\d+\.\s*/','',(string)($l['title']??''));}
/* Un module est réussi à 80 % de bonnes réponses : 4 sur 5. */
function nma_quiz_pass($l){return (int)ceil(count($l['quiz']??array())*0.8);}
function nma_quiz_results($uid){$r=get_user_meta($uid,'nma_quiz',true);return is_array($r)?$r:array();}
function nma_progress($uid){
    $res=nma_quiz_results($uid);$done=0;$lessons=nma_lessons();
    foreach($lessons as $l){if((int)($res[$l['id']]['best']??0)>=nma_quiz_pass($l))$done++;}
    return array($done,count($lessons));
}
/* Date en français quelle que soit la langue du serveur : « 1er octobre 2026 ». */
function nma_date($iso){
    $t=strtotime((string)$iso);if(!$t)return '';
    $months=array('janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre');
    $d=(int)wp_date('j',$t);return ($d===1?'1er':$d).' '.$months[(int)wp_date('n',$t)-1].' '.wp_date('Y',$t);
}

/* Conditions de vente du 2 octobre 2026 (noms Neomoov Chauffeur Pro et Neomoov Booster) : dès que la page 1909 porte cette version, l'étiquette de version
   du parcours Square API la suit, une seule fois. Les achats déjà conclus gardent leur copie figée. */
add_action('init',function(){
    if(get_option('nma_terms_20261002_done'))return;
    $p=get_post(1909);if(!$p||strpos((string)$p->post_content,'Version du 2 octobre 2026')===false)return;
    $o=nma_opts();
    if(($o['square_api_terms_version']??'')!==''&&$o['square_api_terms_version']!=='2026-10-02'){$o['square_api_terms_version']='2026-10-02';update_option('nma_settings',$o);}
    add_option('nma_terms_20261002_done',gmdate('c'),'','yes');
});

/* Actions POST appelées par nma_post() pour un membre connecté. */
function nma_formation_post($act,$uid){
    if($act==='quiz'){
        if(!nma_has_access($uid)&&!current_user_can('manage_options'))return 'Le quiz est réservé aux membres de la formation.';
        $mid=sanitize_key(wp_unslash($_POST['module']??''));$lesson=null;
        foreach(nma_lessons() as $l){if(($l['id']??'')===$mid)$lesson=$l;}
        if(!$lesson||empty($lesson['quiz']))return 'Module introuvable. Actualisez la page puis réessayez.';
        $given=isset($_POST['q'])&&is_array($_POST['q'])?wp_unslash($_POST['q']):array();
        $answers=array();$score=0;
        foreach($lesson['quiz'] as $i=>$q){
            $a=isset($given[$i])&&is_string($given[$i])&&preg_match('/^[0-9]$/D',$given[$i])?(int)$given[$i]:-1;
            $answers[$i]=$a;if($a===(int)$q['answer'])$score++;
        }
        $all=nma_quiz_results($uid);$prev=is_array($all[$mid]??null)?$all[$mid]:array();$pass=nma_quiz_pass($lesson);
        $all[$mid]=array('best'=>max((int)($prev['best']??0),$score),'last'=>$score,'answers'=>$answers,'attempts'=>(int)($prev['attempts']??0)+1,'at'=>gmdate('c'),'passed_at'=>!empty($prev['passed_at'])?$prev['passed_at']:($score>=$pass?gmdate('c'):''));
        update_user_meta($uid,'nma_quiz',$all);
        list($done,$total)=nma_progress($uid);
        return 'Quiz « '.nma_lesson_title($lesson).' » : '.$score.' / '.count($lesson['quiz']).($score>=$pass?', module réussi.':', à reprendre : '.$pass.' bonnes réponses sont nécessaires.').' Progression : '.$done.' / '.$total.' modules réussis.'.($total&&$done===$total&&nma_has_access($uid)?' Votre attestation de suivi est disponible.':'');
    }
    if($act==='attestation'){
        if(!nma_has_access($uid))return 'L’attestation de suivi est réservée aux membres de la formation.';
        $name=trim(preg_replace('/\s+/u',' ',sanitize_text_field(wp_unslash($_POST['name']??''))));
        if(mb_strlen($name)<3||mb_strlen($name)>80||preg_match('#[@<>/\\\\]|https?:#i',$name))return 'Indiquez votre prénom et votre nom, de 3 à 80 caractères.';
        $a=nma_attestation_issue($uid,$name);
        return $a?'Votre attestation de suivi est délivrée. Code de vérification : '.$a['code'].'.':'L’attestation sera disponible quand les 7 quiz seront réussis.';
    }
    return '';
}

/* Attestation : délivrée une seule fois, nom figé, code NCP-XXXX-XXXX vérifiable publiquement. */
function nma_attestation_get($uid){$a=get_user_meta($uid,'nma_attestation',true);return is_array($a)&&!empty($a['code'])?$a:null;}
function nma_attestation_issue($uid,$name){
    $existing=nma_attestation_get($uid);if($existing)return $existing;
    list($done,$total)=nma_progress($uid);if(!$total||$done<$total)return null;
    $lock='nma_attestation_lock_'.$uid;$held=get_option($lock);if($held&&(int)$held<time()-120)delete_option($lock);
    if(!add_option($lock,time(),'','no'))return null;
    try{
        wp_cache_delete($uid,'user_meta');$existing=nma_attestation_get($uid);if($existing)return $existing;
        $alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        do{$code='NCP-';for($i=0;$i<8;$i++){$code.=$alphabet[random_int(0,31)];if($i===3)$code.='-';}}while(nma_attestation_find($code));
        $completed='';foreach(nma_quiz_results($uid) as $r){if(is_array($r)&&!empty($r['passed_at'])&&$r['passed_at']>$completed)$completed=$r['passed_at'];}
        $a=array('code'=>$code,'name'=>$name,'completed_at'=>$completed?:gmdate('c'),'issued_at'=>gmdate('c'),'edition'=>'2026-10-01','modules'=>$total);
        update_user_meta($uid,'nma_attestation',$a);update_user_meta($uid,'nma_attestation_code',$code);
        return $a;
    }finally{delete_option($lock);}
}
function nma_attestation_find($code){
    $c=strtoupper(preg_replace('/[^A-Za-z0-9]/','',(string)$code));
    if(!preg_match('/^(CAP|NCP)([A-Z0-9]{4})([A-Z0-9]{4})$/D',$c,$m))return null;
    $c=$m[1].'-'.$m[2].'-'.$m[3];
    $ids=get_users(array('meta_key'=>'nma_attestation_code','meta_value'=>$c,'number'=>2,'fields'=>'ID'));
    if(count($ids)!==1)return null;
    $a=nma_attestation_get((int)$ids[0]);
    return $a&&$a['code']===$c?$a+array('uid'=>(int)$ids[0]):null;
}
/* Une attestation n'est plus valide après un remboursement ou une révocation de l'accès payé. */
function nma_attestation_valid($a){return is_array($a)&&!empty($a['uid'])&&get_user_meta($a['uid'],'nma_paid',true)==='yes';}
/* Vérification publique minimale : prénom et initiale du nom. */
function nma_public_name($n){$p=preg_split('/\s+/u',trim((string)$n));$first=$p[0]??'';$last=count($p)>1?end($p):'';return trim($first.($last!==''?' '.mb_strtoupper(mb_substr($last,0,1)).'.':''));}
add_action('rest_api_init',function(){register_rest_route('neomoov-academy/v1','/attestation/(?P<code>[A-Za-z0-9-]{11,20})',array('methods'=>'GET','permission_callback'=>'__return_true','callback'=>function($r){
    $a=nma_attestation_find($r['code']);
    if(!nma_attestation_valid($a))return new WP_REST_Response(array('valid'=>false),200);
    $t=strtotime((string)$a['completed_at']);
    return new WP_REST_Response(array('valid'=>true,'code'=>$a['code'],'name'=>nma_public_name($a['name']),'program'=>'Neomoov Chauffeur Pro','modules'=>(int)($a['modules']??7),'completed_on'=>$t?wp_date('Y-m-d',$t):'','verify_url'=>nma_url('attestation/?code='.rawurlencode($a['code']))),200);
}));});

function nma_attestation_scope(){return '<p class="small">L’attestation de suivi confirme que son titulaire a terminé les 7 modules de Neomoov Chauffeur Pro, formation complémentaire de Neomoov Academy, et réussi leurs quiz (au moins 4 bonnes réponses sur 5 par module). Elle ne constitue ni un permis, ni une certification, ni une équivalence de la formation obligatoire au Québec.</p>';}
function nma_attestation_verify_form(){echo '<form method="get" action="'.esc_url(nma_url('attestation/')).'" class="panel no-print"><label class="field">Code de l’attestation<input name="code" required maxlength="20" placeholder="NCP-XXXX-XXXX" autocomplete="off" autocapitalize="characters"></label><div class="actions"><button class="btn">Vérifier l’attestation</button></div></form>';}
function nma_join_neomoov(){return '<div class="panel join no-print"><p class="eyebrow">ROULER AVEC NEOMOOV</p><h2>Vous roulez en 100 % électrique ?</h2><p>Neomoov, plateforme de transport premium 100 % électrique à Montréal, sélectionne ses chauffeurs : dossier en règle, véhicule électrique admissible et service conforme aux standards de Neomoov Chauffeur Pro. L’attestation de suivi est un atout dans votre candidature, sans garantie d’admission, de courses ni de revenus.</p><a class="btn" href="https://reserver.neomoov.net/chauffeurs">Me préinscrire comme chauffeur Neomoov</a></div>';}
function nma_certificate($a,$specimen=false){
    $url=nma_url('attestation/?code='.rawurlencode($a['code']));
    echo '<div class="certificate">'.($specimen?'<p class="specimen">SPÉCIMEN : aperçu administrateur, aucune attestation délivrée</p>':'').'<p class="eyebrow">NEOMOOV ACADEMY · Neomoov Chauffeur Pro</p><h1>Attestation de suivi</h1><p>Neomoov Academy atteste que</p><p class="certificate-name">'.nma_e($a['name']).'</p><p>a terminé les 7 modules de la formation complémentaire <b>Neomoov Chauffeur Pro</b> et réussi leurs quiz le '.nma_e(nma_date($a['completed_at'])).'.</p><ol class="certificate-modules">';
    foreach(nma_lessons() as $l)echo '<li>'.nma_e(nma_lesson_title($l)).'</li>';
    echo '</ol><p>Code de vérification : <b>'.nma_e($a['code']).'</b><br>À vérifier sur '.nma_e(preg_replace('#^https?://#','',nma_url('attestation/'))).'</p>'.nma_attestation_scope().'<p class="small">Délivrée le '.nma_e(nma_date($a['issued_at'])).' par Neomoov Academy, marque de GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC., Montréal.</p></div><div class="actions no-print"><button type="button" class="btn" onclick="window.print()">Imprimer / Enregistrer en PDF</button>'.($specimen?'':'<a class="text-link" href="'.esc_url($url).'">Voir la page de vérification publique</a>').'</div>';
}
function nma_attestation_page(){
    $code=isset($_GET['code'])&&is_string($_GET['code'])?substr(sanitize_text_field(wp_unslash($_GET['code'])),0,40):'';
    echo '<section class="wrap section narrow">';
    if($code!==''){
        $a=nma_attestation_find($code);echo '<p class="eyebrow">VÉRIFICATION D’UNE ATTESTATION</p>';
        if(nma_attestation_valid($a))echo '<h1>Attestation valide.</h1><div class="panel"><p><b>'.nma_e(nma_public_name($a['name'])).'</b> a terminé les 7 modules de Neomoov Chauffeur Pro et réussi leurs quiz le '.nma_e(nma_date($a['completed_at'])).'.</p><p>Code vérifié : <b>'.nma_e($a['code']).'</b></p></div>';
        else echo '<h1>Aucune attestation valide pour ce code.</h1><p>Vérifiez la saisie, au format NCP-XXXX-XXXX. Pour toute question : contact@neomoov.net.</p>';
        echo nma_attestation_scope();nma_attestation_verify_form();echo '</section>';return;
    }
    if(!is_user_logged_in()){
        echo '<p class="eyebrow">ATTESTATION DE SUIVI</p><h1>Vérifier une attestation Neomoov Chauffeur Pro.</h1><p>Saisissez le code inscrit sur l’attestation présentée par le chauffeur.</p>';nma_attestation_verify_form();
        echo nma_attestation_scope().'<p>Vous suivez la formation ? <a class="text-link" href="'.esc_url(wp_login_url(nma_url('attestation/'))).'">Connectez-vous pour obtenir votre attestation</a></p></section>';return;
    }
    $uid=get_current_user_id();$a=nma_attestation_get($uid);list($done,$total)=nma_progress($uid);
    if($a){nma_certificate($a);echo nma_join_neomoov();}
    elseif(!nma_has_access($uid)){
        if(current_user_can('manage_options'))nma_certificate(array('code'=>'NCP-XXXX-XXXX','name'=>'Prénom Nom','completed_at'=>gmdate('c'),'issued_at'=>gmdate('c')),true);
        else{echo '<p class="eyebrow">ATTESTATION DE SUIVI</p><h1>L’attestation est réservée aux membres de la formation.</h1><p><a class="btn" href="'.esc_url(nma_url('membre/')).'">Revenir à mon espace</a></p>';nma_attestation_verify_form();}
    }elseif($done<$total){
        $left=$total-$done;echo '<p class="eyebrow">ATTESTATION DE SUIVI</p><h1>Encore '.$left.' module'.($left>1?'s':'').' à réussir.</h1><p>Votre progression : '.$done.' / '.$total.' modules réussis. Réussissez le quiz de chaque module pour obtenir votre attestation.</p><a class="btn" href="'.esc_url(nma_url('formation/')).'">Continuer la formation</a>'.nma_attestation_scope();
    }else{
        $u=wp_get_current_user();$suggest=trim($u->first_name.' '.$u->last_name);if($suggest==='')$suggest=$u->display_name;if(strpos($suggest,'@')!==false)$suggest='';
        echo '<p class="eyebrow">ATTESTATION DE SUIVI</p><h1>Bravo : les 7 modules sont réussis.</h1><form method="post" class="panel">';nma_nonce('attestation');
        echo '<label class="field">Nom à inscrire sur l’attestation<input name="name" required minlength="3" maxlength="80" value="'.esc_attr($suggest).'"></label><p class="small">Vérifiez l’orthographe : le nom ne peut plus être modifié après la délivrance, sauf demande à contact@neomoov.net.</p><button class="btn">Obtenir mon attestation</button></form>'.nma_attestation_scope();
    }
    echo '</section>';
}

/* Page de formation d'un membre : progression, modules, sources, quiz corrigé côté serveur. */
function nma_formation($uid){
    $lessons=nma_lessons();$res=nma_quiz_results($uid);list($done,$total)=nma_progress($uid);
    echo '<div class="panel no-print"><h2>Votre progression : '.$done.' / '.$total.' modules réussis</h2><div class="progress" role="progressbar" aria-label="Modules réussis" aria-valuemin="0" aria-valuemax="'.$total.'" aria-valuenow="'.$done.'"><span style="width:'.($total?round($done*100/$total):0).'%"></span></div><p>Chaque module se termine par un quiz de 5 questions : 4 bonnes réponses le valident, et vous pouvez le reprendre autant de fois que nécessaire. Les 7 modules réussis donnent droit à votre <a class="text-link" href="'.esc_url(nma_url('attestation/')).'">attestation de suivi</a>.</p><ol class="module-toc">';
    foreach($lessons as $l){$ok=(int)($res[$l['id']]['best']??0)>=nma_quiz_pass($l);echo '<li><a href="#'.esc_attr($l['id']).'">'.nma_e(nma_lesson_title($l)).'</a> <span class="'.($ok?'ok':'todo').'">'.($ok?'Réussi':'À faire').'</span></li>';}
    echo '</ol></div>';
    foreach($lessons as $n=>$l){
        $r=is_array($res[$l['id']]??null)?$res[$l['id']]:array();$pass=nma_quiz_pass($l);$count=count($l['quiz']??array());
        echo '<article class="panel lesson" id="'.esc_attr($l['id']).'"><p class="eyebrow">MODULE '.($n+1).' SUR '.count($lessons).'</p><h2>'.nma_e(nma_lesson_title($l)).'</h2><p class="lead">'.nma_e($l['intro']).'</p>';
        foreach($l['sections'] as $s)echo '<h3>'.nma_e($s['title']).'</h3>'.nma_rich($s['text']);
        echo '<div class="exercise"><h3>Exercice</h3>'.nma_rich($l['exercise']).'<details><summary>Voir le corrigé</summary>'.nma_rich($l['answer']).'</details></div>';
        if(!empty($l['sources'])){
            echo '<h3>Sources officielles</h3><ul class="sources">';
            foreach($l['sources'] as $src){if(is_array($src)&&nma_https_url($src['url']??''))echo '<li><a href="'.esc_url($src['url']).'" rel="noopener" target="_blank">'.nma_e($src['label']??$src['url']).'</a></li>';}
            echo '</ul>';
        }
        if($count){
            echo '<form method="post" class="quiz no-print" action="'.esc_url(nma_url('formation/')).'#'.esc_attr($l['id']).'">';nma_nonce('quiz');
            echo '<input type="hidden" name="module" value="'.esc_attr($l['id']).'"><h3>Quiz du module</h3>';
            if($r)echo '<p class="quiz-score '.((int)($r['best']??0)>=$pass?'ok':'todo').'">Dernier essai : '.(int)($r['last']??0).' / '.$count.' · meilleur résultat : '.(int)($r['best']??0).' / '.$count.((int)($r['best']??0)>=$pass?' · module réussi':' · '.$pass.' bonnes réponses nécessaires').'</p>';
            foreach($l['quiz'] as $i=>$q){
                $given=isset($r['answers'][$i])?(int)$r['answers'][$i]:-1;$right=$given===(int)$q['answer'];
                echo '<fieldset><legend>'.($i+1).'. '.nma_e($q['q']).'</legend>';
                foreach($q['choices'] as $j=>$c)echo '<label class="check-row"><input type="radio" name="q['.(int)$i.']" value="'.(int)$j.'" required'.($given===$j?' checked':'').'> '.nma_e($c).'</label>';
                if($r&&$given>=0)echo '<p class="'.($right?'ok':'todo').'">'.($right?'Bonne réponse. ':'À revoir. ').nma_e($q['explain']).'</p>';
                echo '</fieldset>';
            }
            echo '<button class="btn">Valider mes réponses</button></form>';
        }
        echo '<div class="actions no-print"><button type="button" class="btn secondary" data-print="'.esc_attr($l['id']).'">Imprimer ce module / PDF</button></div></article>';
    }
    echo nma_join_neomoov();
}

/* Fiche de vérification avant départ (SAAQ) : remplie et imprimée sur l'appareil, jamais transmise. */
function nma_check_rows($items){
    echo '<div class="sheet-rows">';
    foreach($items as $label)echo '<div class="sheet-row"><span>'.nma_e($label).'</span><label class="check-row"><input type="checkbox"> Conforme</label><input type="text" aria-label="'.esc_attr('Observation : '.$label).'" placeholder="Observation"></div>';
    echo '</div>';
}
function nma_check_sheet(){
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
