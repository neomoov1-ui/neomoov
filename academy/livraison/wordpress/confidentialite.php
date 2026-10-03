<?php
/** Loi 25 et double consentement (lot D de la revue du 2 octobre 2026) : inscription confirmée par un lien signé (48 h, usage unique),
 *  consentement aux offres daté et versionné, demandes d'accès et de suppression (outils WordPress), exportateur et effaceur des données
 *  Academy, archivage des pièces d'achat à la suppression d'un compte, durées de conservation appliquées chaque jour par WP-Cron,
 *  journal des consultations du personnel, responsable de la protection des renseignements personnels (jamais inventé). */
if(!defined('ABSPATH'))exit;

/* ---------- Textes, versions et traces ---------- */
/* Toute modification du texte de consentement change sa version : la version et l'empreinte du texte accepté sont gardées. */
function nmp_consent_text(){return 'Je souhaite recevoir les conseils et offres de Neomoov Academy par email. Je pourrai me désabonner à tout moment.';}
function nmp_consent_version(){return '2026-10-03';}
function nmp_privacy_version(){return '2026-10-03';}
/* Empreinte salée de l'adresse IP (jamais l'adresse elle-même) et navigateur tronqué : preuve du consentement, sans plus. */
function nmp_ip_hash(){return substr(hash_hmac('sha256',nma_client_ip(),wp_salt('auth')),0,32);}
function nmp_agent(){return mb_substr(sanitize_text_field(wp_unslash((string)($_SERVER['HTTP_USER_AGENT']??''))),0,160);}
function nmp_mask_email($e){$p=explode('@',(string)$e,2);return count($p)===2?mb_substr($p[0],0,1).'***@'.$p[1]:'';}
/* Dernière activité d'un membre (au plus une écriture par jour) : base de la purge des comptes gratuits inactifs. */
function nmp_touch($uid){$uid=(int)$uid;if($uid&&(int)get_user_meta($uid,'nma_last_seen',true)<time()-DAY_IN_SECONDS)update_user_meta($uid,'nma_last_seen',time());}
add_action('wp_login',function($login,$user){if(is_object($user)&&!empty($user->ID))update_user_meta($user->ID,'nma_last_seen',time());},10,2);

/* ---------- Double consentement : demande, lien signé, confirmation ---------- */
function nmp_optin_ttl(){return 48*HOUR_IN_SECONDS;}
function nmp_optin_key($id){return 'nmp_optin_'.hash('sha256',$id);}
function nmp_optin_sign($id,$exp){return hash_hmac('sha256','nmp-optin|'.$id.'|'.$exp,wp_salt('auth'));}
/* Plafonds des courriels de confirmation : 3 par adresse et par jour, 60 par heure pour tout le site (en plus de la limite par adresse IP). */
function nmp_send_allowed($email){
    $a='nmp_addr_'.hash('sha256',strtolower((string)$email));$n=(int)get_transient($a);if($n>=3)return false;
    $g='nmp_global_'.gmdate('YmdH');$m=(int)get_transient($g);if($m>=60)return false;
    set_transient($a,$n+1,DAY_IN_SECONDS);set_transient($g,$m+1,HOUR_IN_SECONDS);return true;
}
/* Enregistre la demande (option non chargée d'office, indexée pour la purge) et envoie le seul courriel autorisé avant confirmation.
   La base ne garde qu'une empreinte de l'identifiant : le lien ne peut pas être reconstitué à partir d'elle. */
function nmp_optin_request($kind,$email,$data){
    $id=bin2hex(random_bytes(16));$exp=time()+nmp_optin_ttl();$key=nmp_optin_key($id);
    $r=array_merge(array('name'=>'','track'=>'','consent'=>false,'uid'=>0),$data,array('kind'=>$kind,'email'=>$email,'expires'=>$exp,'requested_at'=>gmdate('c'),'consent_version'=>nmp_consent_version(),'consent_text_sha256'=>hash('sha256',nmp_consent_text()),'ip_hash'=>nmp_ip_hash(),'agent'=>nmp_agent()));
    if(!add_option($key,$r,'','no'))return false;
    $index=(array)get_option('nmp_optin_index',array());$index[$key]=$exp;update_option('nmp_optin_index',$index,false);
    $link=nma_url('inscription/?confirmer='.rawurlencode($id.'.'.$exp.'.'.nmp_optin_sign($id,$exp)));$join=$kind==='join';$first=trim((string)$r['name']);
    $lines=array('Bonjour'.($first!==''?' '.$first:'').',','',$join?'Pour créer votre espace gratuit Neomoov Academy, confirmez votre adresse en ouvrant ce lien dans les 48 heures :':'Pour recevoir les conseils et offres de Neomoov Academy, confirmez votre adresse en ouvrant ce lien dans les 48 heures :',$link,'');
    if($join&&!empty($r['consent'])){$lines[]='Vous avez aussi demandé à recevoir nos conseils et offres par courriel : ils ne commenceront qu’après cette confirmation.';$lines[]='';}
    $lines[]='Si vous n’êtes pas à l’origine de cette demande, ignorez ce courriel : '.($join?'aucun compte ne sera créé':'aucun abonnement ne sera activé').' et la demande sera effacée après 48 heures.';
    $lines[]='';$lines[]='Neomoov Academy · Neomoov, marque de GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC. · 204 rue du Saint-Sacrement, bureau 300, Montréal (Québec) H2Y 1W8 · contact@neomoov.net';
    $lines[]='Ce courriel de service répond à une demande faite sur neomoov.net.';
    try{return (bool)wp_mail($email,$join?'Confirmez votre inscription à Neomoov Academy':'Confirmez votre abonnement aux conseils Neomoov Academy',implode("\n",$lines),array('From: Neomoov Academy <contact@neomoov.net>','Reply-To: contact@neomoov.net'));}catch(Throwable $e){return false;}
}
/* Signature et échéance vérifiées avant toute lecture de la base. Renvoie la demande, ou 'invalid', 'expired', 'used'. */
function nmp_optin_parse($token){
    if(!is_string($token)||!preg_match('/^([a-f0-9]{32})\.(\d{9,11})\.([a-f0-9]{64})$/D',$token,$m))return 'invalid';
    if(!hash_equals(nmp_optin_sign($m[1],(int)$m[2]),$m[3]))return 'invalid';
    if((int)$m[2]<time())return 'expired';
    $key=nmp_optin_key($m[1]);$r=get_option($key);if(!is_array($r)||(int)($r['expires']??0)!==(int)$m[2])return 'used';
    return array('key'=>$key,'record'=>$r);
}
function nmp_optin_unindex($key){$index=(array)get_option('nmp_optin_index',array());if(isset($index[$key])){unset($index[$key]);update_option('nmp_optin_index',$index,false);}}
/* Confirmation (formulaire POST : un logiciel de messagerie qui ouvre les liens ne confirme rien). Usage unique : seule la requête qui
   efface la demande la confirme. Compte, courriels de service, contact Brevo et séquence ne naissent qu'ici. */
function nmp_optin_confirm($token){
    $p=nmp_optin_parse($token);
    if(!is_array($p))return $p==='expired'?'Ce lien de confirmation a expiré (48 heures) : refaites votre demande.':($p==='used'?'Ce lien a déjà été utilisé.':'Lien de confirmation invalide.');
    if(!delete_option($p['key']))return 'Ce lien a déjà été utilisé.';
    nmp_optin_unindex($p['key']);$r=$p['record'];
    if($r['kind']==='newsletter'){
        $uid=(int)$r['uid'];$u=$uid?get_user_by('id',$uid):false;
        if(!$u||strcasecmp($u->user_email,(string)$r['email'])!==0)return 'L’adresse de ce compte a changé depuis la demande : refaites-la depuis votre espace.';
        nmp_consent_grant($uid,$r,'espace');$GLOBALS['nmp_confirmed']='newsletter';
        return 'Votre abonnement est confirmé : vous recevrez les conseils et offres de Neomoov Academy. Vous pouvez vous désabonner à tout moment.';
    }
    $uid=(int)email_exists((string)$r['email']);$created=false;
    if(!$uid){
        $uid=wp_insert_user(array('user_login'=>'academy_'.wp_generate_password(16,false),'user_email'=>$r['email'],'user_pass'=>wp_generate_password(32,true),'display_name'=>$r['name'],'role'=>'subscriber'));
        if(is_wp_error($uid))return 'Création du compte impossible pour le moment. Écrivez à contact@neomoov.net.';
        $uid=(int)$uid;$created=true;
        update_user_meta($uid,'nma_track',array_key_exists((string)$r['track'],nma_tracks())?$r['track']:'rentabilite');
        update_user_meta($uid,'nmp_optin',array('requested_at'=>$r['requested_at'],'confirmed_at'=>gmdate('c'),'privacy_version'=>nmp_privacy_version(),'ip_hash'=>$r['ip_hash'],'confirm_ip_hash'=>nmp_ip_hash()));
        update_user_meta($uid,'nma_last_seen',time());
    }
    if(!empty($r['consent']))nmp_consent_grant($uid,$r,'inscription');
    elseif($created){update_user_meta($uid,'nma_consent','no');update_user_meta($uid,'nma_consent_date',gmdate('c'));}
    if($created){wp_new_user_notification($uid,null,'user');nma_welcome_package_mail($uid);}
    $GLOBALS['nmp_confirmed']=$created?'join':'existing';
    return $created?'Votre adresse est confirmée et votre espace est créé. Un courriel vous permet maintenant de définir votre mot de passe ; votre package gratuit suit.':'Votre adresse est confirmée. Un compte existait déjà pour elle : connectez-vous ou utilisez « Mot de passe oublié ».';
}
/* Consentement aux offres confirmé : adresse vérifiée (Brevo peut recevoir le contact), trace datée et versionnée, puis séquence
   si le membre n'en a jamais eu (un réabonnement ne renvoie pas les courriels J0 à J7). */
function nmp_consent_grant($uid,$r,$source){
    update_user_meta($uid,'nmb_email_confirmed','yes');if(get_user_meta($uid,'nmb_email_review',true))delete_user_meta($uid,'nmb_email_review');
    nmp_consent_log($uid,array('purpose'=>'marketing','granted'=>true,'version'=>nmp_consent_version(),'requested_version'=>(string)($r['consent_version']??''),'text_sha256'=>hash('sha256',nmp_consent_text()),'requested_at'=>(string)($r['requested_at']??''),'confirmed_at'=>gmdate('c'),'source'=>$source,'ip_hash'=>(string)($r['ip_hash']??''),'confirm_ip_hash'=>nmp_ip_hash(),'agent'=>nmp_agent()));
    update_user_meta($uid,'nma_consent_version',nmp_consent_version());update_user_meta($uid,'nma_consent_date',gmdate('c'));update_user_meta($uid,'nma_consent','yes');
    if(function_exists('nma_brevo_queue'))nma_brevo_queue($uid,'double_optin');
    if(function_exists('nms_schedule')&&!nms_state($uid))nms_schedule($uid,'double_optin');
}
function nmp_consent_log($uid,$entry){$log=get_user_meta($uid,'nmp_consent_log',true);$log=is_array($log)?$log:array();$log[]=$entry;update_user_meta($uid,'nmp_consent_log',array_slice($log,-20));}
function nmp_consent_withdraw($uid,$source){nmp_consent_log($uid,array('purpose'=>'marketing','granted'=>false,'at'=>gmdate('c'),'source'=>$source,'ip_hash'=>nmp_ip_hash()));update_user_meta($uid,'nma_consent_date',gmdate('c'));update_user_meta($uid,'nma_consent','no');}
/* Page /academy/inscription/?confirmer=… : vérifie le lien sans le consommer, puis demande un clic. */
function nmp_confirm_page(){
    $token=is_string($_GET['confirmer']??null)?trim(wp_unslash($_GET['confirmer'])):'';$done=(string)($GLOBALS['nmp_confirmed']??'');
    echo '<section class="wrap section narrow"><p class="eyebrow">CONFIRMATION DE VOTRE ADRESSE</p>';
    if($done!==''){echo '<h1>'.($done==='newsletter'?'Votre abonnement est confirmé.':'Votre adresse est confirmée.').'</h1><p><a class="btn" href="'.esc_url(nma_url('membre/')).'">Mon espace</a></p></section>';return;}
    $p=nmp_optin_parse($token);
    if(!is_array($p)){echo '<h1>'.($p==='expired'?'Ce lien a expiré.':($p==='used'?'Ce lien a déjà été utilisé.':'Lien de confirmation invalide.')).'</h1><p>Un lien de confirmation est valable 48 heures et ne sert qu’une fois. Si votre espace est déjà créé, connectez-vous ; sinon, refaites votre demande.</p><div class="actions"><a class="btn" href="'.esc_url(nma_url('inscription/')).'">Refaire ma demande</a><a class="text-link" href="'.esc_url(nma_url('membre/')).'">Me connecter</a></div></section>';return;}
    $r=$p['record'];$join=$r['kind']==='join';
    echo '<h1>'.($join?'Confirmez votre inscription.':'Confirmez votre abonnement.').'</h1><form method="post" class="panel" action="'.esc_url(nma_url('inscription/?confirmer='.rawurlencode($token))).'">';nma_nonce('optin_confirm');
    echo '<input type="hidden" name="token" value="'.esc_attr($token).'"><p>Adresse : <b>'.nma_e(nmp_mask_email($r['email'])).'</b></p>'.($join?'<p>Votre espace gratuit sera créé et un courriel vous permettra de définir votre mot de passe.</p>':'').(!empty($r['consent'])?'<p>Vous demandez : « '.nma_e(nmp_consent_text()).' »</p>':'').'<button class="btn">'.($join?'Confirmer et créer mon espace':'Confirmer mon abonnement').'</button></form><p class="small">Ce bouton évite qu’un logiciel de messagerie qui ouvre les liens ne confirme à votre place.</p></section>';
}

/* ---------- Espace membre : offres, copie et suppression des données ---------- */
function nmp_member_post($act,$uid){
    $u=get_user_by('id',$uid);if(!$u||!is_email($u->user_email))return 'Compte introuvable.';
    if($act==='newsletter'){
        $review=(bool)get_user_meta($uid,'nmb_email_review',true);
        if(get_user_meta($uid,'nma_consent',true)==='yes'&&!$review)return 'Vous recevez déjà les conseils et offres de Neomoov Academy.';
        if(empty($_POST['consent']))return 'Cochez la case pour confirmer votre demande.';
        if(!nma_rate('optin',5)||!nmp_send_allowed($u->user_email))return 'Veuillez patienter avant une nouvelle demande.';
        nmp_optin_request('newsletter',$u->user_email,array('uid'=>(int)$uid,'name'=>trim((string)($u->first_name?:$u->display_name)),'consent'=>true));
        return 'Un courriel de confirmation vient d’être envoyé à '.$u->user_email.' : ouvrez son lien dans les 48 heures pour commencer à recevoir les conseils et offres.';
    }
    if($act==='privacy_request'){
        // Demandes WordPress standard : confirmées par courriel, puis traitées par un administrateur (Outils), avec l'exportateur et l'effaceur ci-dessous.
        $type=sanitize_key($_POST['type']??'');$action=$type==='erase'?'remove_personal_data':($type==='export'?'export_personal_data':'');
        if($action===''||!function_exists('wp_create_user_request'))return 'Écrivez à contact@neomoov.net pour cette demande.';
        if(!nma_rate('privacy',3))return 'Veuillez patienter avant une nouvelle demande.';
        $id=wp_create_user_request($u->user_email,$action);
        if(is_wp_error($id))return $id->get_error_code()==='duplicate_request'?'Une demande identique est déjà en cours : consultez le courriel de confirmation reçu.':'Demande impossible pour le moment : écrivez à contact@neomoov.net.';
        wp_send_user_request($id);
        return 'Demande enregistrée. Confirmez-la avec le lien envoyé à '.$u->user_email.' ; '.($type==='erase'?'votre compte et vos données seront ensuite supprimés dans les 30 jours, sauf les pièces d’achat que la loi oblige à conserver.':'une copie de vos données vous sera ensuite transmise dans les 30 jours.');
    }
    return '';
}
function nmp_member_privacy($uid){
    $consent=get_user_meta($uid,'nma_consent',true)==='yes';$review=(bool)get_user_meta($uid,'nmb_email_review',true);$date=(string)get_user_meta($uid,'nma_consent_date',true);
    echo '<div class="panel no-print" id="mes-donnees"><h2>Mes communications et mes données</h2>';
    if($consent){echo '<p>Vous avez accepté les conseils et offres de Neomoov Academy'.($date?' (choix du '.nma_e(nma_date($date)).')':'').'.</p><form method="post">';nma_nonce('unsubscribe');echo '<button class="text-link">Retirer mon consentement aux emails commerciaux</button></form>';}
    if(!$consent||$review){echo '<form method="post">';nma_nonce('newsletter');echo ($review&&$consent?'<p>Votre adresse a changé : confirmez-la pour continuer à recevoir les conseils et offres.</p>':'').'<label class="check-row"><input type="checkbox" name="consent" value="1" required> '.nma_e(nmp_consent_text()).'</label><p class="small">Un courriel de confirmation vous est envoyé ; rien ne commence avant votre clic sur son lien.</p><button class="btn secondary">Recevoir les conseils et offres</button></form>';}
    echo '<div class="actions">';
    foreach(array('export'=>'Demander une copie de mes données','erase'=>'Demander la suppression de mon compte') as $t=>$label){echo '<form method="post" class="inline"'.($t==='erase'?' onsubmit="return confirm(\'Demander la suppression de votre compte et de vos données ?\')"':'').'>';nma_nonce('privacy_request');echo '<input type="hidden" name="type" value="'.esc_attr($t).'"><button class="text-link">'.nma_e($label).'</button></form>';}
    echo '</div><p class="small">Chaque demande est confirmée par un lien envoyé à votre adresse, puis traitée dans les 30 jours. <a class="text-link" href="'.esc_url(nma_url('confidentialite/')).'">Vos données</a> · contact@neomoov.net</p></div>';
}

/* ---------- Responsable, fournisseurs et durées (page « Vos données ») ---------- */
/* Jamais de nom par défaut : affiché seulement si l'administrateur a renseigné le nom et un courriel valide. */
function nmp_officer($o=null){$o=$o===null?nma_opts():$o;$name=trim((string)($o['privacy_officer_name']??''));$email=trim((string)($o['privacy_officer_email']??''));if($name===''||!is_email($email))return null;return array('name'=>$name,'title'=>trim((string)($o['privacy_officer_title']??'')),'email'=>$email);}
function nmp_providers(){return array(
 array('LWS','Hébergement du site neomoov.net, de Neomoov Academy et des serveurs d’application de la plateforme','Toutes les données de votre compte Academy','France'),
 array('Brevo','Courriels de Neomoov Academy et gestion des listes, si vous acceptez les offres','Adresse email, prénom, parcours choisi','Union européenne'),
 array('Square','Paiement de la formation et, sur la plateforme, des courses','Nom, adresse de facturation, courriel, références de paiement (aucun numéro de carte chez Neomoov)','Canada et États-Unis'),
 array('Anthropic','Analyse facultative de vos photos dans Neomoov Booster, avec votre accord à chaque fois ; assistants de la plateforme','Photos le temps de l’analyse, non conservées ; messages adressés aux assistants','États-Unis'),
 array('Supabase (plateforme)','Base de données de la plateforme Neomoov','Comptes, courses, documents des chauffeurs','Canada'),
 array('HubSpot (plateforme)','Suivi des prospects et des demandes commerciales','Nom, coordonnées, échanges','États-Unis'),
 array('Twilio (plateforme)','Textos et appels','Numéro de téléphone, contenu des textos','États-Unis'),
 array('Vapi (plateforme)','Agent vocal','Voix et transcription des appels','États-Unis'),
 array('Resend (plateforme)','Courriels de la plateforme (confirmations, factures)','Adresse email, contenu des messages','États-Unis'),
 array('Meta (plateforme)','WhatsApp, Facebook et Instagram, si vous nous écrivez par ces canaux','Numéro ou profil, messages','États-Unis'),
);}
/* Durées appliquées par nmp_retention_run() (en jours) ; valeurs proposées par la revue, à confirmer par le fondateur. */
function nmp_retention_rules(){return array(
 'optin'=>array('label'=>'Demandes d’inscription non confirmées','public'=>'48 heures, puis effacées','days'=>2),
 'free_inactive'=>array('label'=>'Comptes gratuits sans achat','public'=>'24 mois sans connexion ni activité, puis compte et données supprimés','days'=>730),
 'purchase'=>array('label'=>'Pièces d’achat (contrat, références de paiement, facturation, journal des activations)','public'=>'7 ans après l’achat, même après la suppression du compte, puis effacées','days'=>2557),
 'sequence'=>array('label'=>'Suivi des envois de la séquence de courriels','public'=>'12 mois après le début de la séquence','days'=>365),
 'staff_log'=>array('label'=>'Journal des consultations du personnel','public'=>'12 mois','days'=>365),
 'account'=>array('label'=>'Autres données du compte (bilans, rapports Neomoov Booster, quiz, examen, attestation, sondages, messages de la communauté)','public'=>'tant que le compte existe ; supprimées avec lui ou sur demande','days'=>0),
);}

/* ---------- Journal des consultations du personnel ---------- */
/* Une entrée par consultation d'un dossier de membre dans l'administration (même action, même membre, même administrateur : une fois par 10 minutes). */
function nmp_staff_log($action,$member){
    if(!is_user_logged_in())return;$by=get_current_user_id();$action=sanitize_key($action);$member=(int)$member;$log=get_option('nmp_staff_log',array());$log=is_array($log)?$log:array();
    foreach(array_slice($log,-20) as $e)if(($e['by']??0)===$by&&($e['action']??'')===$action&&($e['member']??-1)===$member&&strtotime((string)($e['at']??''))>time()-600)return;
    $log[]=array('at'=>gmdate('c'),'by'=>$by,'action'=>$action,'member'=>$member);update_option('nmp_staff_log',array_slice($log,-5000),false);
}

/* ---------- Exportateur et effaceur WordPress (Outils, données personnelles) ---------- */
function nmp_purchase_keys(){return array('nma_paid','nma_payment_provider','nma_access_started','nma_access_until','nma_square_payment_id','nma_square_api_payment_id','nma_square_checkout_notice','nma_square_access_audit','nmsa_checkout','nmsa_audit','nma_payment_intent','nma_session','nma_checkout','nma_stripe_attempt','nmcd_contract','nmcd_activation','nmcd_review','nmcd_issue','nmb_buyer_excluded');}
function nmp_member_keys(){return array('nma_track','nma_consent','nma_consent_date','nma_consent_version','nmp_consent_log','nmp_optin','nma_last_seen','nmb_email_confirmed','nmb_optout_at','nmb_email_review','nmb_binding','nmb_sync_job','nma_balances','nma_quiz','nma_attestation','nma_attestation_code','nma_exam','nma_exam_open','nma_survey_debut','nma_survey_fin','nmb_profile','nmb_performance','nmb_inspections','nmb_alerts','nmbp_quota','nmc_pseudo','nmc_notify','nmc_rate','nma_sequence');}
function nmp_key_group($k){
    if(in_array($k,nmp_purchase_keys(),true))return 'achat';
    if(in_array($k,array('nma_quiz','nma_attestation','nma_attestation_code','nma_exam','nma_exam_open','nma_survey_debut','nma_survey_fin'),true))return 'formation';
    if(in_array($k,array('nma_balances','nmb_profile','nmb_performance','nmb_inspections','nmb_alerts','nmbp_quota'),true))return 'booster';
    return strpos($k,'nmc_')===0?'communaute':'compte';
}
function nmp_groups(){return array('compte'=>'Neomoov Academy : compte et consentements','formation'=>'Neomoov Academy : formation','booster'=>'Neomoov Academy : Neomoov Booster','communaute'=>'Neomoov Academy : communauté','achat'=>'Neomoov Academy : achat et documents');}
function nmp_export_value($v){if(is_bool($v))return $v?'oui':'non';if($v===null||is_scalar($v))return (string)$v;return (string)wp_json_encode($v,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT);}
/* Ni requête technique envoyée à Square ni copie HTML des documents (téléchargeables depuis l'espace membre) : seulement leurs références. */
function nmp_export_clean($k,$v){
    if($k==='nmsa_checkout'&&is_array($v)){unset($v['payload']);if(is_array($v['terms_snapshot']??null))$v['terms_snapshot']=array('version'=>$v['terms_snapshot']['version']??'','sha256'=>$v['terms_snapshot']['sha256']??'');}
    if(strpos($k,'nmcd_')===0&&is_array($v)&&isset($v['html']))$v['html']='(document téléchargeable depuis votre espace membre)';
    return $v;
}
function nmp_export($email,$page=1){
    $u=get_user_by('email',$email);if(!$u)return array('data'=>array(),'done'=>true);$uid=(int)$u->ID;$groups=nmp_groups();$items=array();
    foreach(array_merge(nmp_member_keys(),nmp_purchase_keys()) as $k){
        $vals=get_user_meta($uid,$k,false);if(!$vals)continue;$g=nmp_key_group($k);$data=array();
        foreach(array_values($vals) as $i=>$v)$data[]=array('name'=>$k.(count($vals)>1?' ('.($i+1).')':''),'value'=>nmp_export_value(nmp_export_clean($k,$v)));
        $items[]=array('group_id'=>'neomoov-academy-'.$g,'group_label'=>$groups[$g],'item_id'=>'nma-'.$uid.'-'.$k,'data'=>$data);
    }
    foreach(get_posts(array('post_type'=>array('nma_topic','nma_reply'),'post_status'=>array('publish','pending'),'author'=>$uid,'numberposts'=>-1)) as $p)
        $items[]=array('group_id'=>'neomoov-academy-communaute','group_label'=>$groups['communaute'],'item_id'=>'nmc-'.$p->ID,'data'=>array(array('name'=>'Type','value'=>$p->post_type==='nma_topic'?'Sujet':'Réponse'),array('name'=>'Date','value'=>(string)$p->post_date_gmt),array('name'=>'Titre','value'=>(string)$p->post_title),array('name'=>'Message','value'=>(string)$p->post_content)));
    return array('data'=>$items,'done'=>true);
}
/* Retrait des listes Brevo d'Academy, fait AVANT l'effacement : la liaison (adresse, listes) enregistrée sert à le faire. */
function nmp_brevo_detach($uid,$email){
    $b=get_user_meta($uid,'nmb_binding',true);$bound=is_array($b)&&is_email($b['email']??'');
    if(!$bound&&get_user_meta($uid,'nma_consent',true)!=='yes')return '';$target=$bound?$b['email']:$email;
    if(!function_exists('nma_brevo_ready')||!nma_brevo_ready())return 'Brevo : synchronisation inactive ; vérifier à la main que '.$target.' ne figure plus dans les listes Academy.';
    $lists=array_values(array_unique(array_merge(array_values(nma_brevo_config()['lists']),$bound?array_map('intval',(array)($b['lists']??array())):array())));
    $r=nma_brevo_remove($target,$lists);
    return is_wp_error($r)?'Brevo : retrait des listes Academy non confirmé ('.$r->get_error_code().') ; le refaire depuis Brevo.':'';
}
/* Messages du membre (un sujet supprimé emporte ses réponses, comme une suppression par le membre) et marques laissées chez les autres. */
function nmp_erase_community($uid){
    $uid=(int)$uid;$n=0;
    foreach(get_posts(array('post_type'=>array('nma_topic','nma_reply'),'post_status'=>array('publish','pending'),'author'=>$uid,'numberposts'=>-1)) as $p){
        if((int)$p->post_author!==$uid)continue;
        if($p->post_type==='nma_topic'){foreach(nmc_replies($p->ID) as $r)wp_delete_post($r->ID,true);}else{$parent=(int)$p->post_parent;if($parent)update_post_meta($parent,'nmc_replies',max(0,(int)get_post_meta($parent,'nmc_replies',true)-1));}
        wp_delete_post($p->ID,true);$n++;
    }
    foreach(get_posts(array('post_type'=>array('nma_topic','nma_reply'),'post_status'=>array('publish','pending'),'numberposts'=>-1,'fields'=>'ids')) as $id)foreach(array('nmc_likes','nmc_reports') as $k){$v=get_post_meta($id,$k,true);if(is_array($v)&&in_array($uid,array_map('intval',$v),true))update_post_meta($id,$k,array_values(array_filter($v,function($x)use($uid){return (int)$x!==$uid;})));}
    return $n;
}
function nmp_clear_member_events($uid){$uid=(int)$uid;foreach(array(1,2,3,4,5) as $n)wp_clear_scheduled_hook('nma_sequence_send',array($uid,$n));wp_clear_scheduled_hook('nma_brevo_sync_contact',array($uid));}
function nmp_purchase_time($uid,$meta=null){
    $get=function($k)use($uid,$meta){return is_array($meta)?($meta[$k]??null):get_user_meta($uid,$k,true);};$t=0;
    $r=$get('nmsa_checkout');if(is_array($r))$t=max($t,(int)strtotime((string)($r['confirmed_payment']['created_at']??($r['created_at']??''))));
    $t=max($t,(int)$get('nma_access_started'));
    $audit=is_array($meta)?(array)($meta['nma_square_access_audit']??array()):get_user_meta($uid,'nma_square_access_audit',false);if(isset($audit['at']))$audit=array($audit);
    foreach($audit as $a)if(is_array($a))$t=max($t,(int)strtotime((string)($a['at']??'')));
    return $t;
}
function nmp_has_purchase($uid){foreach(nmp_purchase_keys() as $k)if($k!=='nmb_buyer_excluded'&&get_user_meta($uid,$k,true))return true;return false;}
function nmp_erase($email,$page=1){
    $out=array('items_removed'=>false,'items_retained'=>false,'messages'=>array(),'done'=>true);$u=get_user_by('email',$email);if(!$u)return $out;$uid=(int)$u->ID;
    $msg=nmp_brevo_detach($uid,$u->user_email);if($msg!==''){$out['messages'][]=$msg;$out['items_retained']=true;}
    if(function_exists('nms_stop'))nms_stop($uid,'erased');
    if(nmp_erase_community($uid))$out['items_removed']=true;
    foreach(nmp_member_keys() as $k)if(get_user_meta($uid,$k,false)){delete_user_meta($uid,$k);$out['items_removed']=true;}
    // Le retrait du consentement a pu remettre une synchronisation Brevo en file : elle n'a plus d'objet.
    delete_user_meta($uid,'nmb_sync_job');nmp_clear_member_events($uid);
    if(nmp_has_purchase($uid)){$out['items_retained']=true;$out['messages'][]='Neomoov Academy : pièces d’achat (contrat, références de paiement, facturation) conservées jusqu’au '.wp_date('Y-m-d',nmp_purchase_time($uid)+nmp_retention_rules()['purchase']['days']*DAY_IN_SECONDS).', puis effacées automatiquement.';}
    return $out;
}
add_filter('wp_privacy_personal_data_exporters',function($e){$e['neomoov-academy']=array('exporter_friendly_name'=>'Neomoov Academy','callback'=>'nmp_export');return $e;});
add_filter('wp_privacy_personal_data_erasers',function($e){$e['neomoov-academy']=array('eraser_friendly_name'=>'Neomoov Academy','callback'=>'nmp_erase');return $e;});

/* ---------- Suppression d'un compte : pièces d'achat archivées, reste effacé ---------- */
/* Options rattachées à un achat (association commande, paiement, courriels du contrat), effacées avec les pièces à l'échéance. */
function nmp_purchase_options($uid,$meta=null){
    $get=function($k)use($uid,$meta){return is_array($meta)?($meta[$k]??null):get_user_meta($uid,$k,true);};$o=array();
    $r=$get('nmsa_checkout');if(is_array($r)){if(!empty($r['order_id']))$o[]='nmsa_order_'.hash('sha256',$r['order_id']);$pid=(string)($r['payment_id']??($r['confirmed_payment']['id']??''));if($pid!==''){$o[]='nmsa_payment_'.hash('sha256',$pid);$o[]='nmsa_job_'.hash('sha256',$pid);}if(!empty($r['reference'])&&function_exists('nmcd_job_key'))foreach(array('contract','activation','review') as $k)$o[]=nmcd_job_key((int)$uid,$k,$r['reference']);}
    $sq=$get('nma_square_payment_id');if(is_string($sq)&&$sq!=='')$o[]='nma_square_payment_'.hash('sha256',$sq);
    $pi=$get('nma_payment_intent');if(is_string($pi)&&$pi!=='')$o[]='nma_refunded_'.hash('sha256',$pi);
    return $o;
}
function nmp_archive_purchase($uid){
    $a=array('uid'=>(int)$uid,'archived_at'=>gmdate('c'),'meta'=>array());$u=get_user_by('id',$uid);if($u)$a['email']=$u->user_email;
    foreach(nmp_purchase_keys() as $k){$v=get_user_meta($uid,$k,false);if($v)$a['meta'][$k]=count($v)>1?array_values($v):$v[0];}
    $a['purchase_time']=nmp_purchase_time($uid,$a['meta'])?:time();
    if(!add_option('nmp_archive_'.(int)$uid,$a,'','no'))update_option('nmp_archive_'.(int)$uid,$a,false);
    $idx=(array)get_option('nmp_archives',array());$idx[(int)$uid]=$a['purchase_time']+nmp_retention_rules()['purchase']['days']*DAY_IN_SECONDS;update_option('nmp_archives',$idx,false);
}
add_action('delete_user',function($uid){
    $uid=(int)$uid;if(nmp_has_purchase($uid))nmp_archive_purchase($uid);
    $u=get_user_by('id',$uid);if($u)nmp_brevo_detach($uid,$u->user_email);
    if(function_exists('nms_stop'))nms_stop($uid,'deleted');nmp_erase_community($uid);nmp_clear_member_events($uid);wp_clear_scheduled_hook('nmcd_fulfill_retry',array($uid));
    foreach(array('nma_access_lock_','nms_lock_','nmb_sync_lock_','nma_attestation_lock_','nmcd_fulfill_') as $p)delete_option($p.$uid);
},5);

/* ---------- Durées de conservation : purge quotidienne par WP-Cron ---------- */
function nmp_retention_run(){
    $now=time();$rules=nmp_retention_rules();$out=array('at'=>gmdate('c'),'optin'=>0,'accounts'=>0,'purchases'=>0,'archives'=>0,'sequences'=>0,'staff_log'=>0);
    // Demandes d'inscription non confirmées et échues.
    $idx=(array)get_option('nmp_optin_index',array());foreach($idx as $key=>$exp)if((int)$exp<$now){delete_option($key);unset($idx[$key]);$out['optin']++;}if($out['optin'])update_option('nmp_optin_index',$idx,false);
    // Comptes gratuits Academy inactifs (abonnés avec un parcours, jamais un compte lié à un achat), 50 par passage.
    $cut=$now-$rules['free_inactive']['days']*DAY_IN_SECONDS;
    $ids=get_users(array('role'=>'subscriber','fields'=>'ID','number'=>50,'date_query'=>array(array('before'=>gmdate('Y-m-d H:i:s',$cut),'column'=>'user_registered','inclusive'=>true)),'meta_query'=>array('relation'=>'AND',array('key'=>'nma_track','compare'=>'EXISTS'),array('relation'=>'OR',array('key'=>'nma_last_seen','value'=>$cut,'compare'=>'<','type'=>'NUMERIC'),array('key'=>'nma_last_seen','compare'=>'NOT EXISTS')))));
    if($ids&&!function_exists('wp_delete_user'))require_once ABSPATH.'wp-admin/includes/user.php';
    foreach($ids as $id){$id=(int)$id;if(nmp_has_purchase($id)||(int)get_user_meta($id,'nma_last_seen',true)>=$cut)continue;if(wp_delete_user($id))$out['accounts']++;}
    // Pièces d'achat échues des comptes encore ouverts.
    $pcut=$now-$rules['purchase']['days']*DAY_IN_SECONDS;
    $buyers=get_users(array('fields'=>'ID','number'=>500,'meta_query'=>array('relation'=>'OR',array('key'=>'nma_payment_provider','compare'=>'EXISTS'),array('key'=>'nmsa_checkout','compare'=>'EXISTS'),array('key'=>'nma_paid','compare'=>'EXISTS'))));
    foreach($buyers as $id){$id=(int)$id;$t=nmp_purchase_time($id);if(!$t||$t>=$pcut)continue;foreach(nmp_purchase_options($id) as $opt)delete_option($opt);foreach(nmp_purchase_keys() as $k)delete_user_meta($id,$k);$out['purchases']++;}
    // Archives des comptes supprimés.
    $arch=(array)get_option('nmp_archives',array());foreach($arch as $uid=>$until)if((int)$until<$now){$a=get_option('nmp_archive_'.(int)$uid);if(is_array($a))foreach(nmp_purchase_options((int)$uid,(array)($a['meta']??array())) as $opt)delete_option($opt);delete_option('nmp_archive_'.(int)$uid);unset($arch[$uid]);$out['archives']++;}if($out['archives'])update_option('nmp_archives',$arch,false);
    // Suivi des séquences de courriels.
    $scut=$now-$rules['sequence']['days']*DAY_IN_SECONDS;
    foreach(get_users(array('meta_key'=>'nma_sequence','fields'=>'ID','number'=>500)) as $id){$s=get_user_meta((int)$id,'nma_sequence',true);$t=is_array($s)?(int)strtotime((string)($s['started']??'')):0;if($t&&$t<$scut){delete_user_meta((int)$id,'nma_sequence');$out['sequences']++;}}
    // Journal des consultations du personnel.
    $log=(array)get_option('nmp_staff_log',array());$lcut=$now-$rules['staff_log']['days']*DAY_IN_SECONDS;$keep=array_values(array_filter($log,function($e)use($lcut){return (int)strtotime((string)($e['at']??''))>=$lcut;}));$out['staff_log']=count($log)-count($keep);if($out['staff_log'])update_option('nmp_staff_log',$keep,false);
    update_option('nmp_retention_last',$out,false);return $out;
}
add_action('nmp_retention_daily','nmp_retention_run');
add_action('init',function(){if(!wp_next_scheduled('nmp_retention_daily'))wp_schedule_event(time()+HOUR_IN_SECONDS,'daily','nmp_retention_daily');});

/* ---------- Administration ---------- */
function nmp_save_settings($o){
    if(($_POST['nmp_present']??'')!=='1')return $o;
    $o['privacy_officer_name']=mb_substr(sanitize_text_field(wp_unslash($_POST['nmp_officer_name']??'')),0,120);$o['privacy_officer_title']=mb_substr(sanitize_text_field(wp_unslash($_POST['nmp_officer_title']??'')),0,120);
    $e=sanitize_email(wp_unslash($_POST['nmp_officer_email']??''));$o['privacy_officer_email']=is_email($e)?$e:'';return $o;
}
function nmp_admin_fields($o){
    echo '<tr><th>Loi 25 : responsable de la protection des renseignements personnels</th><td><input type="hidden" name="nmp_present" value="1"><p>Affiché sur la page publique « Vos données » seulement si le nom et un courriel valide sont renseignés. Aucun nom n’est proposé par défaut.</p>';
    foreach(array('nmp_officer_name'=>array('Nom','privacy_officer_name','text'),'nmp_officer_title'=>array('Fonction (facultatif)','privacy_officer_title','text'),'nmp_officer_email'=>array('Courriel dédié','privacy_officer_email','email')) as $k=>$f)echo '<p><label>'.esc_html($f[0]).' <input name="'.esc_attr($k).'" type="'.$f[2].'" class="regular-text" value="'.esc_attr($o[$f[1]]??'').'"></label></p>';
    echo '</td></tr>';
}
/* Repères en tête de l'écran : secrets encore dans la base, responsable non renseigné. */
function nmp_admin_warnings($o){
    $db=array();foreach(nma_secret_defs() as $id=>$d)if(nma_secret_stored($id,$o))$db[]=$d[2];
    if($db)echo '<div class="notice notice-warning"><p>Secrets encore enregistrés dans la base : '.esc_html(implode(', ',$db)).'. Déplacez-les dans wp-config.php (constantes NMA_…), puis cochez « Effacer la valeur enregistrée dans la base » à côté de chacun.</p></div>';
    if(!nmp_officer($o))echo '<div class="notice notice-warning"><p>Repère Loi 25 : responsable de la protection des renseignements personnels non renseigné (réglages ci-dessous). La page publique « Vos données » n’affiche que contact@neomoov.net tant que ce champ est vide.</p></div>';
}
function nmp_admin_status(){
    if(!current_user_can('manage_options'))return;$last=get_option('nmp_retention_last',array());$log=(array)get_option('nmp_staff_log',array());
    echo '<hr><h2>Loi 25 : conservation, demandes et journal du personnel</h2><p>Inscriptions en attente de confirmation : '.count((array)get_option('nmp_optin_index',array())).' · pièces d’achat archivées de comptes supprimés : '.count((array)get_option('nmp_archives',array())).' · dernière purge automatique : '.esc_html(is_array($last)&&!empty($last['at'])?substr($last['at'],0,16).' (demandes '.(int)$last['optin'].', comptes '.(int)$last['accounts'].', achats '.(int)$last['purchases'].', archives '.(int)$last['archives'].', séquences '.(int)$last['sequences'].', journal '.(int)$last['staff_log'].')':'pas encore exécutée').'.</p><ul>';
    foreach(nmp_retention_rules() as $r)echo '<li>'.esc_html($r['label'].' : '.$r['public']).'</li>';
    echo '</ul><p>Demandes d’accès et de suppression : Outils, « Exporter les données personnelles » et « Effacer les données personnelles » (l’exportateur et l’effaceur Neomoov Academy y sont inscrits). Après un effacement, supprimez le compte dans Utilisateurs : ses pièces d’achat sont alors archivées jusqu’à la fin de leur durée légale.</p>';
    echo '<h3>Journal des consultations du personnel ('.count($log).' entrées, 12 mois)</h3>';if(!$log){echo '<p>Aucune consultation enregistrée.</p>';return;}
    echo '<table class="widefat"><thead><tr><th>UTC</th><th>Administrateur</th><th>Action</th><th>Membre</th></tr></thead><tbody>';
    foreach(array_slice(array_reverse($log),0,50) as $e)echo '<tr><td>'.esc_html($e['at']??'').'</td><td>#'.esc_html($e['by']??'').'</td><td>'.esc_html($e['action']??'').'</td><td>'.(!empty($e['member'])?'#'.esc_html($e['member']):'tous').'</td></tr>';
    echo '</tbody></table>';
}
