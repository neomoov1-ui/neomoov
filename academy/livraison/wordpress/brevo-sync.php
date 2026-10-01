<?php
/** Consent-only Brevo list synchronization. Inactive by default; no campaign/email endpoint. */
if(!defined('ABSPATH')){exit;}
function nma_brevo_tracks(){return array('rentabilite','service','demarrer','entreprise');}
function nma_brevo_config($o=null){
    $o=$o===null?(array)get_option('nma_settings',array()):$o;$lists=array();
    foreach(nma_brevo_tracks()as$track)$lists[$track]=(int)($o['brevo_lists'][$track]??0);
    return array('enabled'=>!empty($o['brevo_sync_enabled']),'reviewed'=>!empty($o['brevo_lists_reviewed']),
        'key'=>defined('NMA_BREVO_API_KEY')?NMA_BREVO_API_KEY:($o['brevo_key']??''),'lists'=>$lists);
}
function nma_brevo_ready($c=null){
    $c=$c===null?nma_brevo_config():$c;
    return $c['enabled']&&$c['reviewed']&&is_string($c['key'])&&strlen($c['key'])>=20&&strlen($c['key'])<=512&&!preg_match('/\s/',$c['key'])
        &&count(array_unique($c['lists']))===4&&min($c['lists'])>0;
}
function nma_brevo_error($code,$retry=false,$delay=60){return new WP_Error('nmb_'.$code,'Synchronisation Brevo non terminée.',array('retry'=>$retry,'delay'=>max(60,min(3600,(int)$delay))));}
function nma_brevo_api($method,$email=null,$body=null){
    $c=nma_brevo_config();if(!nma_brevo_ready($c))return nma_brevo_error('inactive');
    if(!in_array($method,array('GET','POST','PUT'),true)||($method!=='POST'&&!is_email($email)))return nma_brevo_error('request');
    $path=$method==='POST'?'/contacts':'/contacts/'.rawurlencode($email).'?identifierType=email_id';
    $args=array('method'=>$method,'timeout'=>15,'redirection'=>0,'limit_response_size'=>262144,'headers'=>array('api-key'=>$c['key'],'Accept'=>'application/json','Content-Type'=>'application/json'));
    if($body!==null)$args['body']=wp_json_encode($body);
    try{$reply=wp_remote_request('https://api.brevo.com/v3'.$path,$args);}catch(Throwable $e){return nma_brevo_error('network',true);}
    if(is_wp_error($reply))return nma_brevo_error('network',true);
    $http=(int)wp_remote_retrieve_response_code($reply);$raw=wp_remote_retrieve_body($reply);$data=$raw===''?array():json_decode($raw,true);
    if($http===404&&$method==='GET')return array('found'=>false);
    if($http>=200&&$http<300){if(!is_array($data))return nma_brevo_error('response',true);return array('found'=>true,'data'=>$data);}
    $duplicate=$method==='POST'&&$http===400&&is_array($data)&&($data['code']??'')==='duplicate_parameter';
    $retry=$duplicate||$http===408||$http===425||$http===429||$http>=500;
    $delay=(int)wp_remote_retrieve_header($reply,'retry-after');
    // Never persist or display request headers, raw Brevo responses, contact statistics or error details.
    return nma_brevo_error($duplicate?'conflict':('http_'.$http),$retry,$delay?:60);
}
function nma_brevo_buyer($uid){
    if(get_user_meta($uid,'nmb_buyer_excluded',true)==='yes')return true;
    $r=get_user_meta($uid,'nmsa_checkout',true);
    $buyer=in_array(get_user_meta($uid,'nma_paid',true),array('yes','refunded','revoked'),true)
        ||get_user_meta($uid,'nma_payment_intent',true)||get_user_meta($uid,'nma_square_payment_id',true)
        ||(is_array($r)&&($r['environment']??'')==='production'&&!empty($r['confirmed_payment']['id']));
    if($buyer)update_user_meta($uid,'nmb_buyer_excluded','yes');return (bool)$buyer;
}
function nma_brevo_state($uid){
    $u=get_user_by('id',$uid);if(!$u||!is_email($u->user_email))return false;
    $track=get_user_meta($uid,'nma_track',true);$consent=get_user_meta($uid,'nma_consent',true)==='yes';$buyer=nma_brevo_buyer($uid);
    return array('email'=>$u->user_email,'track'=>$track,'consent'=>$consent,'buyer'=>$buyer,
        'eligible'=>$consent&&!$buyer&&get_user_meta($uid,'nmb_email_confirmed',true)==='yes'&&!get_user_meta($uid,'nmb_email_review',true)&&in_array($track,nma_brevo_tracks(),true));
}
function nma_brevo_job_store($uid,$job){update_user_meta($uid,'nmb_sync_job',$job);wp_cache_delete($uid,'user_meta');return get_user_meta($uid,'nmb_sync_job',true)===$job;}
function nma_brevo_schedule($uid,$delay=5){
    if(wp_next_scheduled('nma_brevo_sync_contact',array((int)$uid)))return true;
    $r=wp_schedule_single_event(time()+max(1,(int)$delay),'nma_brevo_sync_contact',array((int)$uid),true);return !is_wp_error($r)&&(bool)$r;
}
function nma_brevo_queue($uid,$reason='change',$force_remove=false){
    $uid=(int)$uid;if(!$uid)return false;$old=get_user_meta($uid,'nmb_sync_job',true);
    $job=array('generation'=>wp_generate_uuid4(),'status'=>nma_brevo_ready()?'queued':'inactive','attempts'=>0,'at'=>gmdate('c'),'reason'=>$reason,
        'force_remove'=>$force_remove||!empty($old['force_remove']));
    if(!nma_brevo_job_store($uid,$job))return false;
    if(nma_brevo_ready()&&!nma_brevo_schedule($uid)){$job['status']='cron_unavailable';nma_brevo_job_store($uid,$job);return false;}
    return true;
}
function nma_brevo_meta_changed($meta_id,$uid,$key,$value,$event){
    if(!in_array($key,array('nma_consent','nma_track','nma_paid','nmsa_checkout'),true))return;
    $withdraw=$key==='nma_consent'&&$value==='no'&&$event==='updated';
    if($withdraw)update_user_meta($uid,'nmb_optout_at',gmdate('c'));
    nma_brevo_queue($uid,$withdraw?'withdrawal':'state_change',$withdraw);
}
add_action('added_user_meta',function($mid,$uid,$key,$value){nma_brevo_meta_changed($mid,$uid,$key,$value,'added');},10,4);
add_action('updated_user_meta',function($mid,$uid,$key,$value){nma_brevo_meta_changed($mid,$uid,$key,$value,'updated');},10,4);
add_action('deleted_user_meta',function($mid,$uid,$key,$value){if(in_array($key,array('nma_consent','nma_track','nma_paid','nmsa_checkout'),true))nma_brevo_queue($uid,'state_removed',$key==='nma_consent');},10,4);
add_action('profile_update',function($uid,$old){$u=get_user_by('id',$uid);if($u&&strcasecmp($u->user_email,$old->user_email)!==0){update_user_meta($uid,'nmb_email_review','yes');nma_brevo_queue($uid,'email_changed',true);}},10,2);
// The first authenticated login proves the new member received their account credentials.
add_action('wp_login',function($login,$user){if(get_user_meta($user->ID,'nma_consent',true)==='yes'&&!get_user_meta($user->ID,'nmb_email_review',true)){update_user_meta($user->ID,'nmb_email_confirmed','yes');nma_brevo_queue($user->ID,'first_login');}},10,2);
function nma_brevo_remote($email){
    $r=nma_brevo_api('GET',$email);if(is_wp_error($r)||!$r['found'])return $r;$d=$r['data'];
    if(!isset($d['emailBlacklisted'])||!is_bool($d['emailBlacklisted'])||!is_array($d['listIds']??null))return nma_brevo_error('response',true);
    if(isset($d['email'])&&(!is_string($d['email'])||strcasecmp($email,$d['email'])!==0))return nma_brevo_error('association');
    return array('found'=>true,'blocked'=>$d['emailBlacklisted'],'lists'=>array_map('intval',$d['listIds']),
        'unsubscribed'=>is_array($d['listUnsubscribed']??null)?array_map('intval',$d['listUnsubscribed']):array());
}
function nma_brevo_remove($email,$lists){
    $r=nma_brevo_remote($email);if(is_wp_error($r)||!$r['found'])return $r;
    $remove=array_values(array_intersect($r['lists'],$lists));if(!$remove)return array('found'=>true);
    return nma_brevo_api('PUT',$email,array('unlinkListIds'=>$remove));
}
function nma_brevo_apply($uid,$state,$job){
    $c=nma_brevo_config();$lists=array_values($c['lists']);$binding=get_user_meta($uid,'nmb_binding',true);
    $old_lists=is_array($binding['lists']??null)?array_map('intval',$binding['lists']):array();$managed=array_values(array_unique(array_merge($lists,$old_lists)));
    $old_email=is_array($binding)?($binding['email']??''):'';
    if(is_email($old_email)&&strcasecmp($old_email,$state['email'])!==0){$r=nma_brevo_remove($old_email,$managed);if(is_wp_error($r))return $r;}
    if(!$state['eligible']){
        // No-consent registrations are never looked up/transferred. Explicit withdrawals and prior bindings are cleaned up.
        if(!$old_email&&!$state['consent'])return 'not_shared';
        if(!$old_email&&get_user_meta($uid,'nmb_email_confirmed',true)!=='yes')return 'awaiting_login';
        $email=is_email($old_email)?$old_email:$state['email'];$r=nma_brevo_remove($email,$managed);if(is_wp_error($r))return $r;
        return $state['buyer']?'buyer_excluded':(get_user_meta($uid,'nmb_email_review',true)?'email_review':'removed');
    }
    // Record the intended binding BEFORE any external write, so a timeout followed by withdrawal can be cleaned up.
    $binding=array('email'=>$state['email'],'lists'=>$managed);update_user_meta($uid,'nmb_binding',$binding);wp_cache_delete($uid,'user_meta');
    if(get_user_meta($uid,'nmb_binding',true)!==$binding)return nma_brevo_error('storage',true);
    $remote=nma_brevo_remote($state['email']);if(is_wp_error($remote))return $remote;
    $fresh=nma_brevo_state($uid);if($fresh!==$state)return nma_brevo_error('changed',true);
    $target=(int)$c['lists'][$state['track']];
    if(!$remote['found'])return is_wp_error($r=nma_brevo_api('POST',null,array('email'=>$state['email'],'listIds'=>array($target),'updateEnabled'=>false,'forceMerge'=>false)))?$r:'synced';
    // Never unblacklist/resubscribe, force-merge, or update EMAIL (which can undo a Brevo block).
    if($remote['blocked']||array_intersect($remote['unsubscribed'],$managed)){
        $r=nma_brevo_remove($state['email'],$managed);return is_wp_error($r)?$r:'remote_suppressed';
    }
    $remove=array_values(array_diff(array_intersect($remote['lists'],$managed),array($target)));$body=array();
    if(!in_array($target,$remote['lists'],true))$body['listIds']=array($target);
    if($remove)$body['unlinkListIds']=$remove;
    if(!$body)return 'synced';$r=nma_brevo_api('PUT',$state['email'],$body);return is_wp_error($r)?$r:'synced';
}
function nma_brevo_process($uid){
    $uid=(int)$uid;$lock='nmb_sync_lock_'.$uid;$held=get_option($lock);if($held&&(int)$held<time()-300)delete_option($lock);
    if(!add_option($lock,time(),'','no'))return 'busy';
    try{
        wp_cache_delete($uid,'user_meta');$job=get_user_meta($uid,'nmb_sync_job',true);if(!is_array($job))return 'no_job';
        if(!nma_brevo_ready()){$job['status']='inactive';nma_brevo_job_store($uid,$job);return 'inactive';}
        if((int)$job['attempts']>=6)return 'failed';$generation=$job['generation'];$state=nma_brevo_state($uid);
        if(!$state){$job['status']='member_missing';nma_brevo_job_store($uid,$job);return 'member_missing';}
        $job['attempts']++;$job['status']='running';$job['last_attempt_at']=gmdate('c');
        if(!nma_brevo_job_store($uid,$job))return 'storage';
        try{$result=nma_brevo_apply($uid,$state,$job);}catch(Throwable $e){$result=nma_brevo_error('internal');}
        wp_cache_delete($uid,'user_meta');$latest=get_user_meta($uid,'nmb_sync_job',true);
        if(($latest['generation']??'')!==$generation){nma_brevo_schedule($uid,5);return 'changed';}
        if(nma_brevo_state($uid)!==$state){nma_brevo_queue($uid,'state_changed_during_sync',true);return 'changed';}
        if(is_wp_error($result)){
            $data=(array)$result->get_error_data();$job['code']=$result->get_error_code();$job['status']=!empty($data['retry'])&&$job['attempts']<6?'retry':'failed';
            if(!nma_brevo_job_store($uid,$job))return 'storage';
            if($job['status']==='retry'&&!nma_brevo_schedule($uid,max((int)($data['delay']??60),min(3600,60*(int)pow(2,$job['attempts']-1))))){$job['status']='cron_unavailable';nma_brevo_job_store($uid,$job);}
            return $job['status'];
        }
        $job['status']=$result;$job['completed_at']=gmdate('c');$job['force_remove']=false;unset($job['code']);
        return nma_brevo_job_store($uid,$job)?$result:'storage';
    }finally{delete_option($lock);}
}
add_action('nma_brevo_sync_contact','nma_brevo_process');
function nma_brevo_save_settings($o){
    if(($_POST['nma_brevo_settings_present']??'')!=='1')return $o;
    if(!empty($_POST['nma_brevo_key_replace'])&&is_string($_POST['nma_brevo_key_new']??null)){
        $key=trim(wp_unslash($_POST['nma_brevo_key_new']));if(strlen($key)>=20&&strlen($key)<=512&&!preg_match('/\s/',$key))$o['brevo_key']=$key;
    }
    $o['brevo_lists']=array();foreach(nma_brevo_tracks()as$track){$raw=$_POST['nma_brevo_list_'.$track]??'';$o['brevo_lists'][$track]=is_string($raw)&&ctype_digit($raw)&&(float)$raw<=2147483647?(int)$raw:0;}
    $o['brevo_lists_reviewed']=!empty($_POST['nma_brevo_lists_reviewed']);$o['brevo_sync_enabled']=!empty($_POST['nma_brevo_sync_enabled']);
    if(!nma_brevo_ready(nma_brevo_config($o)))$o['brevo_sync_enabled']=false;return $o;
}
function nma_brevo_admin_fields($o){
    echo '<tr><th>Brevo — synchronisation consentie</th><td><input type="hidden" name="nma_brevo_settings_present" value="1"><p>Aucun envoi de campagne par ce module. Les quatre listes doivent être dédiées à Academy ; vérifier leurs automatisations avant activation.</p><label>Nouvelle clé API <input type="password" name="nma_brevo_key_new" value="" autocomplete="new-password"></label><label><input type="checkbox" name="nma_brevo_key_replace" value="1"> Remplacer explicitement la clé</label><p>'.(!empty(nma_brevo_config($o)['key'])?'Clé configurée, jamais affichée.':'Clé non configurée.').'</p>';
    foreach(nma_brevo_tracks()as$track)echo '<p><label>ID liste '.esc_html($track).' <input name="nma_brevo_list_'.esc_attr($track).'" type="number" min="1" max="2147483647" value="'.esc_attr($o['brevo_lists'][$track]??'').'"></label></p>';
    echo '<p><label><input name="nma_brevo_lists_reviewed" type="checkbox" value="1" '.checked(!empty($o['brevo_lists_reviewed']),true,false).'> J’ai vérifié ces quatre listes dédiées et leurs scénarios ; aucun envoi non souhaité ne sera déclenché par un ajout.</label></p><p><label><input name="nma_brevo_sync_enabled" type="checkbox" value="1" '.checked(!empty($o['brevo_sync_enabled']),true,false).'> Activer la transmission des seuls contacts consentants et la mise à jour des listes</label></p><p>Aucun import rétroactif automatique. Les contacts déjà présents se traitent individuellement ci-dessous. Les réglages Square et l’ouverture des ventes sont indépendants.</p></td></tr>';
}
function nma_brevo_status_label($status){
    if($status==='awaiting_login')return 'En attente de la première connexion du membre ; aucun contact transmis.';
    $labels=array('inactive'=>'Inactif : clé, listes ou activation incomplètes.','queued'=>'Mise en file.','running'=>'Traitement en cours.','retry'=>'Nouvelle tentative prévue.','failed'=>'Échec : intervention administrateur nécessaire.','synced'=>'Liste de parcours synchronisée, aucun email envoyé par le module.','removed'=>'Retrait des listes dédiées effectué.','not_shared'=>'Sans consentement : contact non transmis.','buyer_excluded'=>'Acheteur exclu des listes de prospection.','remote_suppressed'=>'Retrait ou blocage Brevo respecté.','email_review'=>'Courriel modifié : ancienne adresse retirée, revalidation du consentement nécessaire.','cron_unavailable'=>'Planification indisponible : relancer manuellement.','member_missing'=>'Membre absent ou courriel invalide.','busy'=>'Synchronisation déjà en cours.','changed'=>'État changé ; nouvelle vérification prévue.','storage'=>'Enregistrement impossible : vérifier puis relancer.','no_job'=>'Aucune synchronisation demandée.');
    return $labels[$status]??'État à contrôler.';
}
function nma_brevo_admin_connection(){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!current_user_can('manage_options'))return 'Accès refusé.';
    check_admin_referer('nma_brevo_connection');$c=nma_brevo_config();$check=$c;$check['enabled']=true;$check['reviewed']=true;
    if(!nma_brevo_ready($check))return 'Renseignez une clé et quatre ID de listes valides et distincts.';
    $names=array();foreach($c['lists']as$track=>$id){
        $r=wp_remote_get('https://api.brevo.com/v3/contacts/lists/'.(int)$id,array('timeout'=>10,'redirection'=>0,'limit_response_size'=>65536,'headers'=>array('api-key'=>$c['key'],'Accept'=>'application/json')));
        if(is_wp_error($r)||wp_remote_retrieve_response_code($r)!==200)return 'Connexion Brevo non vérifiée : contrôler la clé, les listes et les restrictions IP dans Brevo.';
        $d=json_decode(wp_remote_retrieve_body($r),true);if(!is_array($d)||(int)($d['id']??0)!==(int)$id||!is_string($d['name']??null))return 'Liste Brevo non vérifiée.';
        $names[]=$track.' → '.$d['name'].' (#'.$id.')';
    }
    return 'Connexion Brevo vérifiée : '.implode(' ; ',$names).'. Aucun contact ajouté, aucun email envoyé, activation inchangée.';
}
function nma_brevo_admin_sync(){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!current_user_can('manage_options'))return 'Accès refusé.';check_admin_referer('nma_brevo_admin_sync');
    if(!nma_brevo_ready())return nma_brevo_status_label('inactive');$uid=absint($_POST['nmb_member']??0);if(!$uid||!get_user_by('id',$uid))return nma_brevo_status_label('member_missing');
    if(!nma_brevo_queue($uid,'administrator'))return nma_brevo_status_label('storage');return nma_brevo_status_label(nma_brevo_process($uid));
}
function nma_brevo_admin_status(){
    if(!current_user_can('manage_options'))return;
    echo '<form method="post"><input type="hidden" name="nma_admin_action" value="brevo_connection">';wp_nonce_field('nma_brevo_connection');echo '<button class="button">Contrôler la connexion Brevo — lecture des listes seulement</button></form>';
    echo '<hr><h2>Brevo — consentements et listes</h2><p>'.esc_html(nma_brevo_ready()?'Synchronisation activée ; aucun envoi de campagne intégré.':nma_brevo_status_label('inactive')).'</p><form method="get"><input type="hidden" name="page" value="neomoov-academy"><label>ID membre <input name="nmb_member" type="number" min="1" required></label><button class="button">Consulter</button></form>';
    $uid=absint($_GET['nmb_member']??($_POST['nmb_member']??0));$u=$uid?get_user_by('id',$uid):false;if(!$u)return;$job=get_user_meta($uid,'nmb_sync_job',true);
    echo '<p>Membre #'.esc_html($uid).' · '.esc_html($u->user_email).' · '.esc_html(nma_brevo_status_label($job['status']??'no_job')).'</p><p>Tentatives : '.esc_html($job['attempts']??0).' / 6 · '.esc_html($job['code']??'').' · '.esc_html($job['completed_at']??$job['last_attempt_at']??$job['at']??'').'</p><form method="post"><input type="hidden" name="nma_admin_action" value="brevo_sync"><input type="hidden" name="nmb_member" value="'.esc_attr($uid).'">';wp_nonce_field('nma_brevo_admin_sync');echo '<button class="button" '.disabled(!nma_brevo_ready(),true,false).'>Synchroniser ce contact — aucun envoi de campagne</button></form>';
}
