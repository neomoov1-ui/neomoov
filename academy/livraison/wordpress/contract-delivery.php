<?php
/** Neomoov Chauffeur Pro: frozen contracts and transactional mail. No access is granted here. */
if (!defined('ABSPATH')) { exit; }

function nmcd_error($code='contract'){return new WP_Error('nmcd_'.$code,'Le contrat ne peut pas être préparé. Aucun nouveau paiement ne doit être effectué ; contactez Neomoov.');}
function nmcd_lock($key){$held=get_option($key);if($held&&(int)$held<time()-600)delete_option($key);return add_option($key,time(),'','no');}
function nmcd_seller(){
    // Tax registrations supplied by the owner; not independently verified with Revenu Québec.
    $o=(array)get_option('nma_settings',array());$seller=array('name'=>'GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC.','neq'=>'1181499600','address'=>'204 rue du Saint-Sacrement, bureau 300, Montréal (Québec) H2Y 1W8, Canada','email'=>'contact@neomoov.net','phone'=>'+1 367 763-9063','seller_gst'=>'755212438 RT0001','seller_qst'=>'1233281863 TQ0001');
    foreach(array('seller_gst','seller_qst')as$key)if(!empty($o[$key])&&is_string($o[$key]))$seller[$key]=substr(sanitize_text_field($o[$key]),0,40);
    return $seller;
}
function nmcd_allowed_html(){return array('h1'=>array(),'h2'=>array(),'h3'=>array(),'h4'=>array(),'p'=>array(),'br'=>array(),'strong'=>array(),'b'=>array(),'em'=>array(),'i'=>array(),'ul'=>array(),'ol'=>array(),'li'=>array(),'table'=>array(),'thead'=>array(),'tbody'=>array(),'tr'=>array(),'th'=>array(),'td'=>array(),'blockquote'=>array(),'hr'=>array(),'a'=>array('href'=>true));}
function nmcd_terms_hash($snapshot){unset($snapshot['sha256']);return hash('sha256',wp_json_encode($snapshot,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));}
function nmcd_terms_valid($snapshot){return is_array($snapshot)&&($snapshot['page_id']??0)===1909&&!empty($snapshot['html'])&&strlen($snapshot['html'])<=131072&&!empty($snapshot['sha256'])&&hash_equals(nmcd_terms_hash($snapshot),(string)$snapshot['sha256']);}
function nmcd_capture_terms($url,$version){
    // Only this local published WordPress page is a source. No arbitrary URL request or shortcode execution.
    $p=get_post(1909);$canonical=get_permalink(1909);
    if(!$p||$p->post_type!=='page'||$p->post_status!=='publish'||!empty($p->post_password)||!$canonical||untrailingslashit($url)!==untrailingslashit($canonical)||!is_string($version)||trim($version)===''||strlen($version)>160)return nmcd_error('terms');
    $raw=(string)$p->post_content;if(strlen($raw)>262144)return nmcd_error('terms_size');
    $html=wp_kses(wpautop(strip_shortcodes($raw)),nmcd_allowed_html(),array('https','mailto'));
    if(strlen($html)>131072||strlen(trim(wp_strip_all_tags($html)))<500)return nmcd_error('terms_content');
    $snapshot=array('page_id'=>1909,'url'=>$canonical,'version'=>$version,'modified_gmt'=>$p->post_modified_gmt,'title'=>sanitize_text_field($p->post_title),'html'=>$html);
    $snapshot['sha256']=nmcd_terms_hash($snapshot);return $snapshot;
}
function nmcd_buyer_from_request($uid){
    $u=get_user_by('id',$uid);if(!$u||!is_email($u->user_email))return nmcd_error('buyer');
    $buyer=array('email'=>$u->user_email,'country'=>'CA','province'=>'QC');
    foreach(array('name'=>160,'address_line_1'=>180,'address_line_2'=>180,'city'=>100,'postal_code'=>10)as$key=>$limit){
        $raw=$_POST['buyer_'.$key]??'';if(!is_string($raw)||strlen($raw)>$limit)return nmcd_error('buyer');
        $buyer[$key]=sanitize_text_field(wp_unslash($raw));
    }
    $buyer['postal_code']=strtoupper(preg_replace('/\s+/','',$buyer['postal_code']));
    if(strlen($buyer['name'])<3||strlen($buyer['address_line_1'])<3||strlen($buyer['city'])<2||!preg_match('/^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z][0-9][ABCEGHJ-NPRSTV-Z][0-9]$/',$buyer['postal_code']))return nmcd_error('buyer');
    return $buyer;
}
function nmcd_payment_details($p){
    $out=array('id'=>sanitize_text_field($p['id']??''),'created_at'=>sanitize_text_field($p['created_at']??''),'confirmed_observed_at'=>gmdate('c'),'billing_address'=>array());
    $a=is_array($p['billing_address']??null)?$p['billing_address']:array();
    foreach(array('first_name','last_name','address_line_1','address_line_2','locality','administrative_district_level_1','postal_code','country')as$key){if(isset($a[$key])&&is_string($a[$key]))$out['billing_address'][$key]=substr(sanitize_text_field($a[$key]),0,200);}
    $captured=$p['card_details']['card_payment_timeline']['captured_at']??'';
    if(is_string($captured)&&strtotime($captured)!==false)$out['captured_at']=$captured;
    return $out;
}
function nmcd_html($title,$body){return '<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'.esc_html($title).'</title></head><body><main><h1>'.esc_html($title).'</h1>'.$body.'</main></body></html>';}
function nmcd_row($label,$value){return '<tr><th scope="row">'.esc_html($label).'</th><td>'.esc_html($value).'</td></tr>';}
function nmcd_contract_html($r){
    $b=$r['buyer'];$p=$r['confirmed_payment'];$terms=$r['terms_snapshot'];$seller=$r['seller']??nmcd_seller();
    $body='<p>Ce document est votre copie personnelle et conservable du contrat Neomoov Chauffeur Pro. Vous pouvez enregistrer cet email ou le document HTML et l’imprimer. Le reçu Square est un document de paiement distinct.</p><h2>Vendeur</h2><p>'.esc_html($seller['name']).', marque Neomoov / Neomoov Academy.<br>NEQ : '.esc_html($seller['neq']).'<br>'.esc_html($seller['address']).'.<br>'.esc_html($seller['email'].' · '.$seller['phone']).'</p>';
    foreach(array('seller_gst'=>'Numéro d’inscription TPS','seller_qst'=>'Numéro d’inscription TVQ')as$key=>$label)if(!empty($seller[$key]))$body.='<p>'.esc_html($label.' : '.$seller[$key]).'</p>';
    $body.='<h2>Votre commande</h2><table>';
    foreach(array('Référence Neomoov'=>$r['reference'],'Commande Square'=>$r['order_id'],'Paiement Square'=>$p['id'],'Date de commande'=>$r['created_at'],'Date du paiement Square'=>$p['created_at'],'Confirmation vérifiée par Neomoov'=>$p['confirmed_observed_at'],'Acheteur'=>$b['name'],'Courriel du compte'=>$b['email'],'Adresse de facturation déclarée'=>implode(', ',array_filter(array($b['address_line_1'],$b['address_line_2'],$b['city'],'Québec',$b['postal_code'],'Canada'))),'Quantité'=>'1','Formation — prix avant taxes'=>'99,00 CAD','TPS — 5 %'=>'4,95 CAD','TVQ — 9,975 %'=>'9,88 CAD','Total confirmé'=>'113,83 CAD','Paiement'=>'Paiement unique, sans renouvellement automatique')as$k=>$v)$body.=nmcd_row($k,$v);
    $body.='</table><h2>Contenu et livraison</h2><p>Neomoov Chauffeur Pro — première édition écrite : 7 modules avec exercices corrigés, quiz et attestation de suivi, 8 fiches pratiques et l’application Neomoov Booster en version web. Les vidéos, les versions mobiles de l’application et l’accompagnement individuel continu ne sont pas inclus.</p><p>Activation dans les 24 heures suivant la confirmation du paiement. L’accès dure 12 mois calendaires à compter de l’activation effective ; ses dates sont communiquées dans une confirmation distincte. Une revue de facturation, si nécessaire, doit être traitée dans ce délai. Accès : '.esc_html(home_url('/academy/membre/')).'.</p><p>Remboursement intégral sur demande dans les 14 jours suivant l’activation, selon les conditions ci-dessous. Support : contact@neomoov.net, première réponse sous 2 jours ouvrés. Ce délai de support ne prolonge pas le délai de livraison.</p>';
    if(!empty($p['billing_address'])){$body.='<h2>Adresse transmise par Square</h2><p>'.esc_html(implode(', ',array_filter($p['billing_address']))).'</p><p>Si elle diffère de votre déclaration, contactez Neomoov pour vérification. La présence de ce document ne vaut pas validation fiscale d’une adresse différente.</p>';}
    $body.='<hr><h2>Conditions acceptées — copie figée</h2><p>Version : '.esc_html($terms['version']).' · acceptation : '.esc_html($r['terms_accepted_at']).' · SHA-256 : '.esc_html($terms['sha256']).'</p>'.$terms['html'];
    return nmcd_html('Votre contrat Neomoov Chauffeur Pro — '.$r['reference'],$body);
}
function nmcd_doc($uid,$kind){
    if(!in_array($kind,array('contract','activation','review'),true))return false;
    $doc=get_user_meta($uid,'nmcd_'.$kind,true);
    return is_array($doc)&&($doc['environment']??'')==='production'&&!empty($doc['html'])&&strlen($doc['html'])<=262144&&!empty($doc['sha256'])&&hash_equals(hash('sha256',$doc['html']),$doc['sha256'])?$doc:false;
}
function nmcd_store_doc($uid,$kind,$r,$subject,$body,$recipient){
    $old=nmcd_doc($uid,$kind);if($old)return ($old['reference']??'')===$r['reference']?true:nmcd_error('association');
    if(!is_email($recipient)||strlen($body)>262144)return nmcd_error('document');
    $doc=array('environment'=>'production','reference'=>$r['reference'],'payment_id'=>$r['confirmed_payment']['id'],'created_at'=>gmdate('c'),'recipient'=>$recipient,'subject'=>$subject,'html'=>$body,'sha256'=>hash('sha256',$body));
    // Unique metadata and the fulfillment lock make the accepted copy append-only. Never replace a document.
    add_user_meta($uid,'nmcd_'.$kind,$doc,true);wp_cache_delete($uid,'user_meta');$saved=nmcd_doc($uid,$kind);
    return $saved&&$saved['sha256']===$doc['sha256']?true:nmcd_error('storage');
}
function nmcd_job_key($uid,$kind,$reference){return 'nmcd_mail_'.hash('sha256',$uid.'|'.$kind.'|'.$reference);}
function nmcd_store_job($key,$job){update_option($key,$job,false);return get_option($key)===$job;}
function nmcd_schedule_mail($key,$delay=60){if(!wp_next_scheduled('nmcd_send_mail',array($key)))wp_schedule_single_event(time()+$delay,'nmcd_send_mail',array($key));}
function nmcd_queue($uid,$kind){
    $doc=nmcd_doc($uid,$kind);if(!$doc)return false;$key=nmcd_job_key($uid,$kind,$doc['reference']);
    $job=array('uid'=>$uid,'kind'=>$kind,'reference'=>$doc['reference'],'status'=>'queued','attempts'=>0,'created_at'=>gmdate('c'));
    if(!get_option($key))add_option($key,$job,'','no');
    $job=get_option($key);if(!is_array($job))return false;
    if(($job['status']??'')!=='transport_accepted'){nmcd_schedule_mail($key,60);nmcd_send_mail($key);}
    return true;
}
function nmcd_send_mail($key){
    if(!is_string($key)||!preg_match('/^nmcd_mail_[a-f0-9]{64}$/',$key))return;
    $job=get_option($key);if(!is_array($job)||($job['status']??'')==='transport_accepted')return;
    $lock=$key.'_lock';if(!nmcd_lock($lock))return;
    try{
        $job=get_option($key);if(!is_array($job)||($job['status']??'')==='transport_accepted')return;$doc=nmcd_doc((int)$job['uid'],$job['kind']);
        if(!$doc||$doc['reference']!==$job['reference'])return;
        if(in_array($job['kind'],array('activation','review'),true)){
            wp_cache_delete((int)$job['uid'],'user_meta');$current=get_user_meta((int)$job['uid'],'nmsa_checkout',true);
            $active=$job['kind']==='activation'?((($current['status']??'')==='paid')&&function_exists('nma_has_access')&&nma_has_access((int)$job['uid'])):(($current['status']??'')==='billing_review');
            if(!$active||($current['reference']??'')!==$job['reference']){$job['status']='cancelled_state_changed';if(!nmcd_store_job($key,$job))update_user_meta((int)$job['uid'],'nmcd_issue','mail_job_storage');return;}
        }
        if(!empty($job['last_attempt_at'])&&strtotime($job['last_attempt_at'])>time()-60){nmcd_schedule_mail($key,60);return;}
        // Sandbox records never create documents or jobs. No token/card details enter these mails.
        $job['attempts']=(int)$job['attempts']+1;$job['last_attempt_at']=gmdate('c');$job['status']='sending';
        if(!nmcd_store_job($key,$job)){update_user_meta((int)$job['uid'],'nmcd_issue','mail_job_storage');nmcd_schedule_mail($key,300);return;}
        try{$accepted=wp_mail($doc['recipient'],$doc['subject'],$doc['html'],array('Content-Type: text/html; charset=UTF-8','Reply-To: Neomoov <contact@neomoov.net>'));}catch(Throwable $e){$accepted=false;}
        $job['status']=$accepted?'transport_accepted':'retry_required';
        if($accepted)$job['accepted_at']=gmdate('c');
        if(!nmcd_store_job($key,$job)){
            // A crash/DB failure after transport acceptance can cause a duplicate on retry, never an access grant.
            update_user_meta((int)$job['uid'],'nmcd_issue','mail_result_unknown');nmcd_schedule_mail($key,300);return;
        }
        if(!$accepted)nmcd_schedule_mail($key,min(3600,60*(int)pow(2,min($job['attempts'],6))));
    }finally{delete_option($lock);}
}
add_action('nmcd_send_mail','nmcd_send_mail');
function nmcd_fulfill($uid){
    $uid=(int)$uid;$lock='nmcd_fulfill_'.$uid;if(!$uid||!nmcd_lock($lock))return;
    try{
        wp_cache_delete($uid,'user_meta');$r=get_user_meta($uid,'nmsa_checkout',true);
        if(!is_array($r)||($r['environment']??'')!=='production'||empty($r['confirmed_payment']['id']))return;
        if(!nmcd_terms_valid($r['terms_snapshot']??null)||empty($r['buyer']['name'])||empty($r['buyer']['address_line_1'])||empty($r['buyer']['email'])){update_user_meta($uid,'nmcd_issue','snapshot_or_identity_missing');return;}
        $made=nmcd_store_doc($uid,'contract',$r,'Votre contrat Neomoov Chauffeur Pro — Neomoov Academy',nmcd_contract_html($r),$r['buyer']['email']);
        if(is_wp_error($made)){update_user_meta($uid,'nmcd_issue',$made->get_error_code());return;}
        delete_user_meta($uid,'nmcd_issue');if(!nmcd_queue($uid,'contract'))update_user_meta($uid,'nmcd_issue','contract_mail_job_storage');
        if(($r['status']??'')==='billing_review'){
            $body=nmcd_html('Paiement confirmé : revue de facturation requise','<p>Membre #'.esc_html($uid).' · référence '.esc_html($r['reference']).' · paiement '.esc_html($r['confirmed_payment']['id']).'.</p><p>Le paiement de 113,83 CAD est confirmé. Traiter la revue de facturation et l’activation dans les 24 h suivant la confirmation du paiement. La copie du contrat est mise en file séparément, sans attendre cette revue.</p><p>Consulter le dossier dans l’administration Neomoov Academy. Ne demander aucune donnée de carte par email.</p>');
            $made=nmcd_store_doc($uid,'review',$r,'Action requise : paiement Neomoov Chauffeur Pro à vérifier',$body,'contact@neomoov.net');if(is_wp_error($made))update_user_meta($uid,'nmcd_issue',$made->get_error_code());elseif(!nmcd_queue($uid,'review'))update_user_meta($uid,'nmcd_issue','review_mail_job_storage');
        }
        if(($r['status']??'')==='paid'&&get_user_meta($uid,'nma_paid',true)==='yes'&&!empty($r['access_started'])&&!empty($r['access_until'])){
            $tz=new DateTimeZone('America/Toronto');$body=nmcd_html('Votre accès Neomoov Chauffeur Pro est activé','<p>Référence : '.esc_html($r['reference']).'.</p><p>Votre compte '.esc_html($r['buyer']['email']).' a accès à la formation du <strong>'.esc_html(wp_date('d/m/Y H:i T',(int)$r['access_started'],$tz)).'</strong> au <strong>'.esc_html(wp_date('d/m/Y H:i T',(int)$r['access_until'],$tz)).'</strong> (12 mois calendaires). Aucun renouvellement automatique.</p><p><a href="'.esc_url(home_url('/academy/formation/')).'">Ouvrir ma formation</a>. Votre contrat et les conditions acceptées restent téléchargeables dans votre espace membre.</p><p>Remboursement intégral sur demande dans les 14 jours suivant l’activation selon les conditions acceptées. Contact : contact@neomoov.net.</p>');
            $made=nmcd_store_doc($uid,'activation',$r,'Votre accès Neomoov Chauffeur Pro est activé',$body,$r['buyer']['email']);if(is_wp_error($made))update_user_meta($uid,'nmcd_issue',$made->get_error_code());elseif(!nmcd_queue($uid,'activation'))update_user_meta($uid,'nmcd_issue','activation_mail_job_storage');
        }
    }finally{delete_option($lock);if(get_user_meta($uid,'nmcd_issue',true)&&!wp_next_scheduled('nmcd_fulfill_retry',array($uid)))wp_schedule_single_event(time()+900,'nmcd_fulfill_retry',array($uid));}
}
add_action('nmcd_fulfill_retry','nmcd_fulfill');
function nmcd_after_verified($uid){
    // Durable fallback before the immediate attempt; repeated reconciliation is safe.
    if(!wp_next_scheduled('nmcd_fulfill_retry',array((int)$uid)))wp_schedule_single_event(time()+300,'nmcd_fulfill_retry',array((int)$uid));
    // Fulfill at request shutdown, after the payment/access lock is released. Slow mail cannot block activation.
    $GLOBALS['nmcd_pending_fulfill'][(int)$uid]=true;
}
add_action('shutdown',function(){foreach(array_keys($GLOBALS['nmcd_pending_fulfill']??array())as$uid)nmcd_fulfill((int)$uid);},20);
function nmcd_download_url($uid,$kind){return wp_nonce_url(add_query_arg(array('action'=>'nmcd_download','member'=>(int)$uid,'kind'=>$kind),admin_url('admin-post.php')),'nmcd_download_'.$uid.'_'.$kind);}
add_action('admin_post_nmcd_download',function(){
    if(!is_user_logged_in())wp_die('Connexion requise.',403);$uid=absint($_GET['member']??0);$kind=is_string($_GET['kind']??null)?sanitize_key($_GET['kind']):'';
    if((get_current_user_id()!==$uid&&!current_user_can('manage_options'))||!in_array($kind,array('contract','activation'),true))wp_die('Accès refusé.',403);
    check_admin_referer('nmcd_download_'.$uid.'_'.$kind);$doc=nmcd_doc($uid,$kind);if(!$doc)wp_die('Document indisponible.',404);
    nocache_headers();header('Content-Type: text/html; charset=UTF-8');header('Content-Disposition: attachment; filename="CAP-CHAUFFEUR-'.$kind.'.html"');header('X-Content-Type-Options: nosniff');header("Content-Security-Policy: sandbox; default-src 'none'; base-uri 'none'; form-action 'none'");echo $doc['html'];exit;
});
add_action('admin_post_nmcd_retry',function(){
    if(!current_user_can('manage_options'))wp_die('Accès refusé.',403);$uid=absint($_POST['member']??0);check_admin_referer('nmcd_retry_'.$uid);nmcd_after_verified($uid);
    wp_safe_redirect(add_query_arg(array('page'=>'neomoov-academy','nmsa_member'=>$uid),admin_url('admin.php')),303);exit;
});
function nmcd_member_documents($uid){
    if(get_current_user_id()!==(int)$uid&&!current_user_can('manage_options'))return;
    foreach(array('contract'=>'Télécharger mon contrat et les conditions acceptées','activation'=>'Télécharger ma confirmation d’activation')as$kind=>$label)if(nmcd_doc($uid,$kind))echo '<p><a href="'.esc_url(nmcd_download_url($uid,$kind)).'">'.esc_html($label).' (HTML imprimable)</a></p>';
}
function nmcd_admin_status($uid){
    if(!current_user_can('manage_options'))return;echo '<h3>Contrat et emails transactionnels</h3><p>« Accepté par le transport » ne prouve pas la réception. Contrôler la boîte de réception et les rejets ; maintenir une procédure manuelle sous 24 h. Les relances dépendent de WP-Cron.</p>';
    $issue=get_user_meta($uid,'nmcd_issue',true);if($issue)echo '<p><strong>Action manuelle requise : copie du contrat ou identité incomplète.</strong> '.esc_html($issue).'</p>';
    foreach(array('contract'=>'Contrat','activation'=>'Activation','review'=>'Alerte de revue')as$kind=>$label){$doc=nmcd_doc($uid,$kind);$job=$doc?get_option(nmcd_job_key($uid,$kind,$doc['reference']),array()):array();$status=$job['status']??'absent';$status=$status==='transport_accepted'?'Accepté par le transport — réception non confirmée':($status==='retry_required'?'Échec, relance nécessaire':$status);echo '<p>'.esc_html($label.' : '.$status.' · tentatives '.($job['attempts']??0).' · '.($job['accepted_at']??$job['last_attempt_at']??'')).'</p>';}
    nmcd_member_documents($uid);echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'"><input type="hidden" name="action" value="nmcd_retry"><input type="hidden" name="member" value="'.esc_attr($uid).'">';wp_nonce_field('nmcd_retry_'.$uid);echo '<button class="button">Préparer / réessayer les envois non acceptés</button></form>';
}

// Separate administrator tools: no Square call, member record, contract queue or access mutation.
add_action('admin_post_nmcd_preview',function(){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST')wp_die('Méthode refusée.',405);
    if(!current_user_can('manage_options'))wp_die('Accès refusé.',403);check_admin_referer('nmcd_preview');
    $o=(array)get_option('nma_settings',array());$version=is_string($o['square_api_terms_version']??null)&&$o['square_api_terms_version']!==''?$o['square_api_terms_version']:'TEST-APERÇU';
    $snapshot=nmcd_capture_terms(get_permalink(1909),$version);if(is_wp_error($snapshot))wp_die('Aperçu indisponible : vérifiez la page des conditions publiée.',400);
    $now=gmdate('c');$fixture=array('environment'=>'sandbox','reference'=>'TEST-APERÇU-AUCUN-ACHAT','order_id'=>'TEST-APERÇU-COMMANDE-FICTIVE','created_at'=>$now,'terms_accepted_at'=>$now,'terms_snapshot'=>$snapshot,'seller'=>nmcd_seller(),
        'buyer'=>array('name'=>'Camille Exemple — personne fictive','email'=>'acheteur.fictif@example.invalid','address_line_1'=>'123 rue Exemple — adresse fictive','address_line_2'=>'','city'=>'Montréal','postal_code'=>'H0H 0H0','country'=>'CA','province'=>'QC'),
        'confirmed_payment'=>array('id'=>'TEST-APERÇU-PAIEMENT-FICTIF','created_at'=>$now,'confirmed_observed_at'=>$now,'billing_address'=>array()));
    $html=nmcd_contract_html($fixture);
    $banner='<h1>TEST — AUCUN ACHAT — NI FACTURE</h1><p><strong>APERÇU FICTIF UNIQUEMENT. Aucun paiement, aucune acceptation réelle des conditions, aucun accès et aucun email n’ont été créés.</strong></p><p>Les personnes, adresses, références et dates de commande de cet exemple sont fictives. Les montants illustrent le modèle ; ils ne représentent aucune transaction. Les conditions ci-dessous sont une copie de la page publiée au moment de ce test.</p><hr>';
    $html=str_replace('<main>','<main>'.$banner,$html);$html=preg_replace('/<title>.*?<\/title>/s','<title>TEST — aperçu fictif sans achat</title>',$html,1);
    nocache_headers();header('Content-Type: text/html; charset=UTF-8');header('Content-Disposition: inline; filename="TEST-APERCU-SANS-ACHAT.html"');header('X-Content-Type-Options: nosniff');header("Content-Security-Policy: sandbox; default-src 'none'; base-uri 'none'; form-action 'none'");echo $html;exit;
});
function nmcd_email_test_result($uid,$status){
    set_transient('nmcd_email_test_result_'.$uid,array('status'=>$status,'at'=>gmdate('c')),300);
    wp_safe_redirect(add_query_arg('page','neomoov-academy',admin_url('admin.php')),303);exit;
}
add_action('admin_post_nmcd_test_email',function(){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST')wp_die('Méthode refusée.',405);
    if(!current_user_can('manage_options'))wp_die('Accès refusé.',403);check_admin_referer('nmcd_test_email');
    $admin=wp_get_current_user();$uid=(int)$admin->ID;
    if(($_POST['nmcd_test_email_confirm']??'')!=='1')nmcd_email_test_result($uid,'unconfirmed');
    if(!$uid||!is_email($admin->user_email))nmcd_email_test_result($uid,'invalid_recipient');
    $rate='nmcd_email_test_rate_'.$uid;if(get_transient($rate))nmcd_email_test_result($uid,'limited');
    if(!set_transient($rate,1,60))nmcd_email_test_result($uid,'unavailable');
    $body="Ceci est un test technique de la messagerie Neomoov Academy.\n\nAucun achat, paiement, reçu, facture ou accès formation n’a été créé par ce test. Il est envoyé uniquement au courriel de votre compte administrateur WordPress.\n\nSi vous lisez ce message, vous avez reçu cet email de test.\n\nContact : contact@neomoov.net";
    try{$accepted=wp_mail($admin->user_email,'[TEST SANS ACHAT] Neomoov Academy',$body,array('Content-Type: text/plain; charset=UTF-8','Reply-To: Neomoov <contact@neomoov.net>'))===true;}catch(Throwable $e){$accepted=false;}
    nmcd_email_test_result($uid,$accepted?'accepted':'failed');
});
function nmcd_admin_tools(){
    if(!current_user_can('manage_options'))return;$admin=wp_get_current_user();
    echo '<hr><h2>Outils de recette — administrateur uniquement</h2><p>L’aperçu est fictif et ne déclenche aucun envoi. Le test email est une opération distincte, limitée à votre propre courriel administrateur.</p>';
    $result=get_transient('nmcd_email_test_result_'.(int)$admin->ID);
    if(is_array($result)){
        delete_transient('nmcd_email_test_result_'.(int)$admin->ID);
        $labels=array('accepted'=>'Test accepté par le transport. Cela ne prouve pas la réception : vérifiez votre boîte de réception et les indésirables.','failed'=>'Le transport n’a pas accepté le test. Vérifiez la configuration de messagerie.','limited'=>'Un test a déjà été tenté dans les 60 dernières secondes. Aucun nouvel email envoyé.','unconfirmed'=>'Confirmation requise : aucun email envoyé.','invalid_recipient'=>'Courriel administrateur invalide : aucun email envoyé.','unavailable'=>'Test indisponible : aucun email envoyé.');
        echo '<div class="notice notice-info"><p>'.esc_html(($labels[$result['status']??'']??'Résultat de test indisponible.').' · '.($result['at']??'')).'</p></div>';
    }
    echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'" target="_blank" rel="noopener"><input type="hidden" name="action" value="nmcd_preview">';wp_nonce_field('nmcd_preview');echo '<button class="button">Ouvrir l’aperçu TEST du contrat — aucun achat ni envoi</button></form>';
    echo '<h3>Test email séparé — envoi réel à votre compte</h3><p>Destinataire fixe : <strong>'.esc_html($admin->user_email).'</strong>. Aucune adresse ne peut être saisie. Ce test ne modifie ni commande, ni membre, ni accès ; il fonctionne indépendamment de Square Sandbox et des files contractuelles.</p><form method="post" action="'.esc_url(admin_url('admin-post.php')).'"><input type="hidden" name="action" value="nmcd_test_email">';wp_nonce_field('nmcd_test_email');
    echo '<p><label><input type="checkbox" name="nmcd_test_email_confirm" value="1" required> Je confirme l’envoi d’un seul email technique de test à mon propre courriel administrateur.</label></p><button class="button">Envoyer l’email TEST à mon compte</button></form>';
}
