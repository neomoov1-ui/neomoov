<?php
/** Séquences de courriels automatiques (4 parcours × 5 courriels, J0, J1, J3, J5, J7) : planifiées à l'inscription consentie,
 *  envoyées par l'API transactionnelle de Brevo avec les 20 modèles NCP_… déjà importés, arrêtées à l'achat, au retrait du
 *  consentement, au changement de courriel ou au désabonnement Brevo. Aucun envoi sans consentement ; aucune valeur secrète affichée. */
if(!defined('ABSPATH'))exit;
function nms_letters(){return array('rentabilite'=>'R','service'=>'S','demarrer'=>'D','entreprise'=>'E');}
function nms_days(){return array(1=>0,2=>1,3=>3,4=>5,5=>7);}
function nms_name($track,$n){return 'NCP_'.nms_letters()[$track].'0'.$n.'_J'.nms_days()[$n].'_VENTE_20261002';}
function nms_key(){$c=nma_brevo_config();return is_string($c['key'])&&strlen($c['key'])>=20&&!preg_match('/\s/',$c['key'])?$c['key']:'';}
function nms_template_ids(){$done=(array)get_option('nmbt_template_ids',array());$ids=array();foreach(nms_letters() as $track=>$L){$ids[$track]=array();foreach(nms_days() as $n=>$day){$id=(int)($done[nms_name($track,$n)]??0);if($id>0)$ids[$track][$n]=$id;}}return $ids;}
function nms_enabled(){$o=nma_opts();return !empty($o['sequences_enabled']);}
function nms_ready(){if(!nms_enabled()||nms_key()==='')return false;foreach(nms_template_ids() as $t=>$ids)if(count($ids)!==5)return false;return true;}
function nms_state($uid){$s=get_user_meta($uid,'nma_sequence',true);return is_array($s)?$s:array();}
function nms_save($uid,$s){update_user_meta($uid,'nma_sequence',$s);wp_cache_delete($uid,'user_meta');}
/* J0 dix minutes après l'inscription ; J1, J3, J5 et J7 à 9 h 30, heure de Montréal. */
function nms_plan_times($start){$tz=wp_timezone();$plan=array();foreach(nms_days() as $n=>$day){if($day===0){$plan[$n]=$start+600;continue;}$d=(new DateTimeImmutable('@'.$start))->setTimezone($tz)->modify('+'.$day.' days')->setTime(9,30);$plan[$n]=$d->getTimestamp();}return $plan;}
function nms_eligible($uid){
    $u=get_user_by('id',$uid);if(!$u||!is_email($u->user_email))return 'member_missing';
    if(get_user_meta($uid,'nma_consent',true)!=='yes')return 'no_consent';
    if(get_user_meta($uid,'nmb_email_review',true))return 'email_review';
    if(nma_brevo_buyer($uid))return 'buyer';
    if(!isset(nms_letters()[get_user_meta($uid,'nma_track',true)]))return 'track';
    return '';
}
function nms_schedule($uid,$reason='join'){
    $uid=(int)$uid;if(!$uid||nms_eligible($uid)!=='')return false;
    $s=nms_state($uid);if(!empty($s['plan'])&&empty($s['stopped']))return true;
    $track=get_user_meta($uid,'nma_track',true);$plan=array();
    foreach(nms_plan_times(time()) as $n=>$at){$plan[$n]=array('at'=>$at,'status'=>'planned','attempts'=>0);wp_schedule_single_event($at,'nma_sequence_send',array($uid,$n));}
    nms_save($uid,array('track'=>$track,'started'=>gmdate('c'),'reason'=>$reason,'plan'=>$plan,'stopped'=>null));return true;
}
function nms_stop($uid,$reason){
    $uid=(int)$uid;$s=nms_state($uid);if(!$s||!empty($s['stopped']))return;
    $s['stopped']=array('at'=>gmdate('c'),'reason'=>$reason);
    foreach((array)$s['plan'] as $n=>$p){if(($p['status']??'')==='planned'){$s['plan'][$n]['status']='stopped';wp_clear_scheduled_hook('nma_sequence_send',array($uid,(int)$n));}}
    nms_save($uid,$s);
}
function nms_api($method,$path,$body=null){
    $key=nms_key();if($key==='')return new WP_Error('key','Clé Brevo absente.');
    $args=array('method'=>$method,'timeout'=>15,'redirection'=>0,'limit_response_size'=>262144,'headers'=>array('api-key'=>$key,'Accept'=>'application/json','Content-Type'=>'application/json'));
    if($body!==null)$args['body']=wp_json_encode($body);
    try{$r=wp_remote_request('https://api.brevo.com/v3'.$path,$args);}catch(Throwable $e){return new WP_Error('network','Brevo injoignable.',array('retry'=>true));}
    if(is_wp_error($r))return new WP_Error('network','Brevo injoignable.',array('retry'=>true));
    $http=(int)wp_remote_retrieve_response_code($r);$d=json_decode((string)wp_remote_retrieve_body($r),true);
    if($http>=200&&$http<300)return is_array($d)?$d:array();
    if($http===404)return new WP_Error('not_found','Introuvable.');
    // Jamais de détail de réponse conservé ni affiché : code HTTP seulement.
    return new WP_Error('http_'.$http,'Brevo a refusé la demande.',array('retry'=>$http===429||$http>=500,'delay'=>(int)wp_remote_retrieve_header($r,'retry-after')));
}
function nms_blacklisted($email){$r=nms_api('GET','/contacts/'.rawurlencode($email).'?identifierType=email_id');if(is_wp_error($r))return $r->get_error_code()==='not_found'?false:$r;return !empty($r['emailBlacklisted']);}
function nms_retry($uid,$n,$s,$err){
    $data=(array)$err->get_error_data();$att=(int)($s['plan'][$n]['attempts']??0)+1;$s['plan'][$n]['attempts']=$att;$s['plan'][$n]['error']=$err->get_error_code();
    if(!empty($data['retry'])&&$att<4){$delay=max(600,(int)($data['delay']??0),600*$att);wp_schedule_single_event(time()+$delay,'nma_sequence_send',array((int)$uid,(int)$n));nms_save($uid,$s);return 'retry';}
    $s['plan'][$n]['status']='failed';nms_save($uid,$s);return 'failed';
}
function nms_send($uid,$n){
    $uid=(int)$uid;$n=(int)$n;$lock='nms_lock_'.$uid;if(!nma_lock($lock,300))return 'busy';
    try{
        wp_cache_delete($uid,'user_meta');$s=nms_state($uid);$p=$s['plan'][$n]??null;
        if(!$p||!empty($s['stopped'])||($p['status']??'')!=='planned')return 'skip';
        if(!nms_ready()){$s['plan'][$n]['status']='inactive';nms_save($uid,$s);return 'inactive';}
        $why=nms_eligible($uid);if($why!==''){nms_stop($uid,$why);return $why;}
        $u=get_user_by('id',$uid);$ids=nms_template_ids();$tid=(int)($ids[$s['track']][$n]??0);
        if(!$tid){$s['plan'][$n]['status']='failed';$s['plan'][$n]['error']='template';nms_save($uid,$s);return 'template';}
        $bl=nms_blacklisted($u->user_email);if(is_wp_error($bl))return nms_retry($uid,$n,$s,$bl);if($bl){nms_stop($uid,'unsubscribed');return 'unsubscribed';}
        $first=trim((string)($u->first_name?:$u->display_name));
        $r=nms_api('POST','/smtp/email',array('templateId'=>$tid,'to'=>array(array('email'=>$u->user_email,'name'=>$first!==''?$first:$u->user_email)),'params'=>array('PRENOM'=>$first),'tags'=>array('NCP_sequence',(string)$s['track'])));
        if(is_wp_error($r))return nms_retry($uid,$n,$s,$r);
        $s['plan'][$n]['status']='sent';$s['plan'][$n]['sent_at']=gmdate('c');$s['plan'][$n]['message_id']=mb_substr((string)($r['messageId']??''),0,120);nms_save($uid,$s);return 'sent';
    }finally{delete_option($lock);}
}
add_action('nma_sequence_send','nms_send',10,2);
/* Arrêt dès qu'un membre devient inéligible (achat, retrait du consentement, courriel modifié). */
function nms_meta_changed($uid,$key){if(!in_array($key,array('nma_consent','nma_paid','nmsa_checkout','nma_payment_intent','nma_square_payment_id','nmb_email_review','nma_track'),true))return;wp_cache_delete($uid,'user_meta');$s=nms_state($uid);if(!$s||!empty($s['stopped']))return;$why=nms_eligible($uid);if($why!=='')nms_stop($uid,$why);}
add_action('added_user_meta',function($mid,$uid,$key){nms_meta_changed($uid,$key);},20,3);
add_action('updated_user_meta',function($mid,$uid,$key){nms_meta_changed($uid,$key);},20,3);
/* Rattrapage : un envoi dont l'événement planifié a été perdu (WP-Cron) est fait au plus tard dix minutes après son heure. */
function nms_tick($force=false){
    if(!$force){if(get_transient('nms_tick'))return array();set_transient('nms_tick',1,10*MINUTE_IN_SECONDS);}
    if(!nms_ready())return array();$out=array();
    foreach(get_users(array('meta_key'=>'nma_sequence','fields'=>'ID','number'=>2000)) as $id){$uid=(int)$id;$s=nms_state($uid);if(!$s||!empty($s['stopped']))continue;
        foreach((array)$s['plan'] as $n=>$p){if(($p['status']??'')==='planned'&&(int)$p['at']<=time()-120&&!wp_next_scheduled('nma_sequence_send',array($uid,(int)$n)))$out[$uid.'-'.$n]=nms_send($uid,(int)$n);}
    }
    return $out;
}
add_action('init',function(){if(!is_admin()&&($_SERVER['REQUEST_METHOD']??'GET')==='GET'&&!wp_doing_cron())nms_tick();},99);
add_action('nma_sequences_tick','nms_tick');
if(!wp_next_scheduled('nma_sequences_tick'))wp_schedule_event(time()+300,'hourly','nma_sequences_tick');
/* Activation des 20 modèles chez Brevo : prénom par paramètre d'envoi (params.PRENOM), expéditeur Neomoov Academy, modèle actif. */
function nms_activate_templates(){
    if(nms_key()==='')return 'Clé Brevo absente.';$pack=nma_brevo_template_data();$byName=array();foreach($pack as $t)$byName[$t['templateName']]=$t;
    $done=(array)get_option('nmbt_template_ids',array());$ok=0;$errors=array();
    foreach(nms_letters() as $track=>$L)foreach(nms_days() as $n=>$day){$name=nms_name($track,$n);$id=(int)($done[$name]??0);$t=$byName[$name]??null;if(!$id||!$t){$errors[]=$name.' absent';continue;}
        $html=str_replace('contact.PRENOM','params.PRENOM',$t['htmlContent']);
        $r=nms_api('PUT','/smtp/templates/'.$id,array('htmlContent'=>$html,'subject'=>$t['subject'],'sender'=>array('name'=>'Neomoov Academy','email'=>'contact@neomoov.net'),'replyTo'=>'contact@neomoov.net','isActive'=>true));
        if(is_wp_error($r))$errors[]=$name.' : '.$r->get_error_code();else $ok++;}
    update_option('nms_templates_activated',array('at'=>gmdate('c'),'ok'=>$ok,'errors'=>$errors),false);
    return $ok.' / 20 modèles activés chez Brevo'.($errors?' ; erreurs : '.implode(', ',$errors):'').'.';
}
function nms_stats(){
    $st=array('members'=>0,'planned'=>0,'sent'=>0,'failed'=>0,'stopped'=>0,'tracks'=>array());
    foreach(get_users(array('meta_key'=>'nma_sequence','fields'=>'ID','number'=>5000)) as $id){$s=nms_state((int)$id);if(!$s)continue;$st['members']++;$st['tracks'][$s['track']]=($st['tracks'][$s['track']]??0)+1;if(!empty($s['stopped']))$st['stopped']++;
        foreach((array)$s['plan'] as $p){$k=$p['status']??'';if(isset($st[$k]))$st[$k]++;}}
    return $st;
}
function nms_save_settings($o){if(($_POST['nma_sequences_present']??'')!=='1')return $o;$o['sequences_enabled']=!empty($_POST['nma_sequences_enabled']);return $o;}
function nms_admin_fields($o){
    echo '<tr><th>Séquences de courriels automatiques</th><td><input type="hidden" name="nma_sequences_present" value="1"><label><input type="checkbox" name="nma_sequences_enabled" value="1" '.checked(!empty($o['sequences_enabled']),true,false).'> Envoyer automatiquement la séquence de 5 courriels (J0, J1, J3, J5, J7) du parcours choisi à chaque inscription gratuite consentie, jusqu’à l’achat ou au désabonnement.</label><p>Envois par l’API transactionnelle de Brevo avec les 20 modèles NCP_… (à activer une fois, ci-dessous). Aucune automatisation à créer dans Brevo.</p></td></tr>';
}
function nms_admin_action($what){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!current_user_can('manage_options'))return 'Accès refusé.';check_admin_referer('nms_admin');
    if($what==='sequences_activate')return nms_activate_templates();
    if($what==='sequences_tick'){$r=nms_tick(true);return count($r).' envoi(s) traité(s) : '.(implode(', ',array_map(function($k,$v){return $k.' '.$v;},array_keys($r),$r))?:'aucun dû');}
    if($what==='sequences_start'){$uid=absint($_POST['nms_member']??0);if(!$uid||!get_user_by('id',$uid))return 'Membre introuvable.';$why=nms_eligible($uid);if($why!=='')return 'Membre non éligible ('.$why.').';$s=nms_state($uid);if($s&&!empty($s['stopped'])){delete_user_meta($uid,'nma_sequence');}return nms_schedule($uid,'administrator')?'Séquence planifiée pour le membre #'.$uid.'.':'Planification impossible.';}
    return '';
}
function nms_admin_status(){
    if(!current_user_can('manage_options'))return;$st=nms_stats();$act=(array)get_option('nms_templates_activated',array());$ids=nms_template_ids();$n=0;foreach($ids as $t)$n+=count($t);
    echo '<hr><h2>Séquences automatiques (4 parcours × 5 courriels)</h2><p>État : '.(nms_ready()?'<b>actives</b>':'<b>inactives</b> ('.(nms_enabled()?'':'case non cochée ; ').(nms_key()===''?'clé Brevo absente ; ':'').($n<20?$n.' / 20 identifiants de modèles':'').')').' · '.(int)$st['members'].' membre(s) en séquence · envois planifiés '.(int)$st['planned'].', envoyés '.(int)$st['sent'].', en échec '.(int)$st['failed'].', séquences arrêtées '.(int)$st['stopped'].'.'.($act?' Modèles activés chez Brevo le '.esc_html(substr((string)($act['at']??''),0,16)).' ('.(int)($act['ok']??0).' / 20).':' Modèles Brevo pas encore activés.').'</p>';
    foreach(array('sequences_activate'=>'Activer les 20 modèles chez Brevo (expéditeur Neomoov Academy, prénom par paramètre)','sequences_tick'=>'Traiter maintenant les envois dus') as $a=>$label){echo '<form method="post" style="display:inline-block;margin-right:8px"><input type="hidden" name="nma_admin_action" value="'.esc_attr($a).'">';wp_nonce_field('nms_admin');echo '<button class="button">'.esc_html($label).'</button></form>';}
    echo '<form method="post" style="display:inline-block"><input type="hidden" name="nma_admin_action" value="sequences_start">';wp_nonce_field('nms_admin');echo '<label>Planifier la séquence du membre n° <input type="number" name="nms_member" min="1" required></label> <button class="button">Planifier</button></form>';
}
/* Même administration par l'API REST (mot de passe d'application d'un administrateur). */
add_action('rest_api_init',function(){register_rest_route('neomoov-academy/v1','/sequences/(?P<what>activate|tick|status|enable)',array('methods'=>'POST','permission_callback'=>function(){return current_user_can('manage_options');},'callback'=>function($req){$what=$req['what'];
    if($what==='enable'){$o=nma_opts();$o['sequences_enabled']=true;update_option('nma_settings',$o,false);}
    $message=$what==='activate'?nms_activate_templates():($what==='tick'?count(nms_tick(true)).' envoi(s) traité(s)':'');
    return new WP_REST_Response(array('message'=>$message,'ready'=>nms_ready(),'stats'=>nms_stats(),'activated'=>get_option('nms_templates_activated',null)),200);}));});
