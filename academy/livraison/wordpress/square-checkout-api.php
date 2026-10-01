<?php
/** Neomoov Square API local integration, NOT DEPLOYED. Read SQUARE-API-RECETTE.md. */
if (!defined('ABSPATH')) { exit; }

function nmsa_config($o=null) {
    $o=$o===null?(array)get_option('nma_settings',array()):$o;
    return array(
        'token' => defined('NMA_SQUARE_ACCESS_TOKEN') ? NMA_SQUARE_ACCESS_TOKEN : ($o['square_api_token']??''),
        'location' => defined('NMA_SQUARE_LOCATION_ID') ? NMA_SQUARE_LOCATION_ID : ($o['square_api_location']??''),
        'environment' => defined('NMA_SQUARE_ENVIRONMENT') ? NMA_SQUARE_ENVIRONMENT : ($o['square_api_environment']??'sandbox'),
        'signature' => defined('NMA_SQUARE_WEBHOOK_SIGNATURE_KEY') ? NMA_SQUARE_WEBHOOK_SIGNATURE_KEY : ($o['square_api_signature']??''),
        'webhook_url' => rest_url('neomoov-academy/v1/square-api'),
        'terms' => $o['terms']??'', 'terms_version'=>$o['square_api_terms_version']??'',
        'duration_months'=>12,'review_delay'=>'Activation sous 24 h après confirmation du paiement. Une éventuelle revue de facturation est traitée dans ce délai. Support : réponse sous 2 jours ouvrés.',
        'reviewed'=>!empty($o['square_api_reviewed']),
    );
}
function nmsa_error($code = 'verification') { return new WP_Error('nmsa_'.$code, 'Paiement en attente de vérification. Ne payez pas à nouveau ; contactez Neomoov.'); }
function nmsa_api($method, $path, $body = null) {
    $c = nmsa_config();
    if (!$c['token'] || !$c['location'] || !in_array($c['environment'], array('sandbox','production'), true)) return nmsa_error('configuration');
    $base = $c['environment'] === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
    $args = array('method'=>$method, 'timeout'=>25, 'redirection'=>0, 'headers'=>array('Authorization'=>'Bearer '.$c['token'], 'Square-Version'=>'2026-09-16', 'Content-Type'=>'application/json'));
    if ($body !== null) $args['body'] = wp_json_encode($body);
    $r = wp_remote_request($base.'/v2/'.$path, $args);
    if (is_wp_error($r) || wp_remote_retrieve_response_code($r)<200 || wp_remote_retrieve_response_code($r)>=300) return nmsa_error('api');
    $data = json_decode(wp_remote_retrieve_body($r), true);
    return is_array($data) && empty($data['errors']) ? $data : nmsa_error('response');
}
function nmsa_config_ready($o) {
    $c=nmsa_config($o);
    return $c['reviewed'] && in_array($c['environment'],array('sandbox','production'),true)
        && $c['duration_months']===12 && $c['terms_version']!=='' && trim($c['review_delay'])!==''
        && $c['token'] && $c['location'] && $c['signature']
        && wp_parse_url($c['webhook_url'], PHP_URL_SCHEME)==='https'
        && wp_parse_url($c['terms'], PHP_URL_SCHEME)==='https' && function_exists('nmcd_capture_terms');
}
function nmsa_enabled(){return function_exists('nma_ready')&&nma_provider()==='square_api'&&nma_ready();}
function nmsa_mutations_ready(){return nmsa_config_ready((array)get_option('nma_settings',array()));}
function nmsa_store($uid,$r){update_user_meta($uid,'nmsa_checkout',$r);wp_cache_delete($uid,'user_meta');return get_user_meta($uid,'nmsa_checkout',true)===$r;}
function nmsa_audit($uid,$status){add_user_meta($uid,'nmsa_audit',array('at'=>gmdate('c'),'status'=>$status,'actor'=>get_current_user_id()),false);}
function nmsa_money_is($m, $amount) { return is_array($m) && ($m['currency']??'')==='CAD' && isset($m['amount']) && (int)$m['amount']===$amount; }
function nmsa_payment_source_ok($payment,$environment){
    if(!in_array($environment,array('sandbox','production'),true))return false;
    $source=$payment['source_type']??'';
    if(in_array($source,array('CARD','WALLET'),true))return true;
    $external=$payment['external_details']??array();
    // The Square Developer Control Panel simulates CARD as EXTERNAL. Never allow this exception in production.
    return $environment==='sandbox'&&$source==='EXTERNAL'&&is_array($external)
        &&($external['type']??'')==='CARD'&&($external['source']??'')==='Developer Control Panel';
}
function nmsa_legacy_conflict($uid) {
    $provider=get_user_meta($uid,'nma_payment_provider',true);
    return ($provider && $provider!=='square_api') || get_user_meta($uid,'nma_payment_intent',true)
        || get_user_meta($uid,'nma_session',true) || get_user_meta($uid,'nma_checkout',true) || get_user_meta($uid,'nma_stripe_attempt',true)
        || get_user_meta($uid,'nma_square_payment_id',true) || get_user_meta($uid,'nma_square_checkout_notice',true)
        || ($provider!=='square_api' && get_user_meta($uid,'nma_paid',true)==='yes');
}
function nmsa_order_ok($o, $record) {
    $lines=$o['line_items']??array(); $line=$lines[0]??array();
    if (($o['reference_id']??'')!==$record['reference'] || ($o['location_id']??'')!==$record['location']
        || count($lines)!==1 || ($line['name']??'')!=='CAP CHAUFFEUR' || (string)($line['quantity']??'')!=='1'
        || !empty($line['catalog_object_id']) || !nmsa_money_is($line['base_price_money']??null,9900)
        || !nmsa_money_is($o['total_money']??null,11383) || !nmsa_money_is($o['total_tax_money']??null,1483)
        || (int)($o['total_discount_money']['amount']??0)!==0 || (int)($o['total_tip_money']['amount']??0)!==0
        || (int)($o['total_service_charge_money']['amount']??0)!==0) return false;
    $taxes=$o['taxes']??array(); if(count($taxes)!==2)return false;
    $expected=array('nma-tps'=>array('5',495),'nma-tvq'=>array('9.975',988));
    foreach($taxes as $tax){$id=$tax['uid']??'';if(!isset($expected[$id])||($tax['type']??'')!=='ADDITIVE'||($tax['scope']??'')!=='ORDER'
        || (float)($tax['percentage']??-1)!==(float)$expected[$id][0] || !nmsa_money_is($tax['applied_money']??null,$expected[$id][1]))return false;unset($expected[$id]);}
    return !$expected;
}
function nmsa_payload($reference, $key, $location) {
    return array('idempotency_key'=>$key,'order'=>array(
        'location_id'=>$location,'reference_id'=>$reference,
        'line_items'=>array(array('uid'=>'nma-course','name'=>'CAP CHAUFFEUR','quantity'=>'1','base_price_money'=>array('amount'=>9900,'currency'=>'CAD'))),
        'taxes'=>array(
            array('uid'=>'nma-tps','name'=>'TPS','percentage'=>'5','type'=>'ADDITIVE','scope'=>'ORDER'),
            array('uid'=>'nma-tvq','name'=>'TVQ','percentage'=>'9.975','type'=>'ADDITIVE','scope'=>'ORDER')),
        'pricing_options'=>array('auto_apply_taxes'=>false,'auto_apply_discounts'=>false)),
        'checkout_options'=>array('allow_tipping'=>false,'enable_coupon'=>false,'enable_loyalty'=>false,
            'redirect_url'=>home_url('/academy/membre/?squareapi=retour')));
}
function nmsa_create($uid,$buyer=array(),$accepted_hash='') {
    if(!nmsa_enabled())return nmsa_error('closed');
    $lock='nma_access_lock_'.$uid;if(!add_option($lock,time(),'','no'))return nmsa_error('busy');
    try {
        wp_cache_delete($uid,'user_meta');
        if(get_user_meta($uid,'nma_paid',true)==='yes')return nmsa_error('already_paid');
        if(nmsa_legacy_conflict($uid))return nmsa_error('provider_conflict');
        $c=nmsa_config();$r=get_user_meta($uid,'nmsa_checkout',true);
        $snapshot=nmcd_capture_terms($c['terms'],$c['terms_version']);
        if(is_wp_error($snapshot)||!is_string($accepted_hash)||!hash_equals($snapshot['sha256'],$accepted_hash))return nmsa_error('terms_changed');
        if(!is_array($buyer)||empty($buyer['name'])||empty($buyer['email'])||empty($buyer['address_line_1'])||empty($buyer['city'])||empty($buyer['postal_code']))return nmsa_error('buyer');
        if(!$r){
            $ref=wp_generate_uuid4();$r=array('uid'=>$uid,'reference'=>$ref,'location'=>$c['location'],'environment'=>$c['environment'],
                'created_at'=>gmdate('c'),'country'=>'CA','province'=>'QC','terms'=>$c['terms'],'terms_version'=>$c['terms_version'],'duration_months'=>$c['duration_months'],'status'=>'creating');
            $r['terms_snapshot']=$snapshot;$r['terms_accepted_at']=gmdate('c');$r['buyer']=$buyer;$r['seller']=nmcd_seller();
            $r['payload']=nmsa_payload($ref,wp_generate_uuid4(),$c['location']);
            // Persist before the request: retries, including timeouts, reuse the exact request and key.
            if(!update_user_meta($uid,'nmsa_checkout',$r))return nmsa_error('storage');
        }
        if(($r['location']??'')!==$c['location']||($r['environment']??'')!==$c['environment']||($r['status']??'')==='refunded')return nmsa_error('review');
        if(($r['terms']??'')!==$c['terms']||($r['terms_version']??'')!==$c['terms_version']||(int)($r['duration_months']??0)!==$c['duration_months'])return nmsa_error('terms_changed');
        if(!nmcd_terms_valid($r['terms_snapshot']??null)||!hash_equals($r['terms_snapshot']['sha256'],$accepted_hash))return nmsa_error('terms_changed');
        if(($r['buyer']??array())!==$buyer)return nmsa_error('buyer_changed');
        if(empty($r['order_id'])){
            $answer=nmsa_api('POST','online-checkout/payment-links',$r['payload']);if(is_wp_error($answer))return $answer;
            $link=$answer['payment_link']??array();if(empty($link['id'])||empty($link['order_id'])||empty($link['url']))return nmsa_error();
            $r['link_id']=$link['id'];$r['order_id']=$link['order_id'];$r['url']=$link['url'];$r['status']='pending';
            $map='nmsa_order_'.hash('sha256',$r['order_id']);
            if(!add_option($map,$uid,'','no') && (int)get_option($map)!==$uid)return nmsa_error('association');
            if(!update_user_meta($uid,'nmsa_checkout',$r))return nmsa_error('storage');
        }
        $order=nmsa_api('GET','orders/'.rawurlencode($r['order_id']));if(is_wp_error($order))return $order;
        if(!nmsa_order_ok($order['order']??array(),$r)||!empty($order['order']['tenders'])||!in_array($order['order']['state']??'',array('DRAFT','OPEN'),true))return nmsa_error('order');
        $host=wp_parse_url($r['url'],PHP_URL_HOST);$hosts=$c['environment']==='production'?array('square.link','checkout.square.site'):array('sandbox.square.link','sandbox.checkout.square.site');
        if(wp_parse_url($r['url'],PHP_URL_SCHEME)!=='https'||!in_array($host,$hosts,true)||wp_parse_url($r['url'],PHP_URL_USER)||wp_parse_url($r['url'],PHP_URL_PASS))return nmsa_error('url');
        return $r['url'];
    } finally { delete_option($lock); }
}
function nmsa_sync($uid) {
    if(!nmsa_mutations_ready())return nmsa_error('configuration');
    $lock='nma_access_lock_'.$uid;if(!add_option($lock,time(),'','no'))return nmsa_error('busy');
    try {
        wp_cache_delete($uid,'user_meta');$r=get_user_meta($uid,'nmsa_checkout',true);$c=nmsa_config();
        if(!is_array($r)||(int)($r['uid']??0)!==$uid||empty($r['order_id'])||($r['environment']??'')!==$c['environment']||($r['location']??'')!==$c['location']
            || (int)get_option('nmsa_order_'.hash('sha256',$r['order_id']),0)!==$uid)return nmsa_error('association');
        $provider=get_user_meta($uid,'nma_payment_provider',true);if(nmsa_legacy_conflict($uid))return nmsa_error('provider_conflict');
        $answer=nmsa_api('GET','orders/'.rawurlencode($r['order_id']));if(is_wp_error($answer))return $answer;
        $o=$answer['order']??array();$tenders=$o['tenders']??array();
        if(count($tenders)!==1)return nmsa_error('pending');
        $pid=$tenders[0]['payment_id']??($tenders[0]['id']??'');if(!$pid)return nmsa_error('pending');
        $answer=nmsa_api('GET','payments/'.rawurlencode($pid));if(is_wp_error($answer))return $answer;$p=$answer['payment']??array();
        if(($p['id']??'')!==$pid||($p['order_id']??'')!==$r['order_id']||($p['location_id']??'')!==$r['location'])return nmsa_error('payment');
        if(nmsa_money_is($p['refunded_money']??null,11383)||($r['status']??'')==='refunded'){
            $r['status']='refunded';if(!nmsa_store($uid,$r))return nmsa_error('storage');
            if($provider==='square_api')update_user_meta($uid,'nma_paid','refunded');
            if($provider==='square_api'&&get_user_meta($uid,'nma_paid',true)!=='refunded')return nmsa_error('storage');
            nmsa_audit($uid,'refunded');
            return 'refunded';
        }
        $refunded=(int)($p['refunded_money']['amount']??0);$total=(int)($p['total_money']['amount']??0);
        $money_ok=($p['total_money']['currency']??'')==='CAD'&&($total===11383||($refunded>0&&$total+$refunded===11383));
        if(!nmsa_order_ok($o,$r)||!$money_ok||($p['status']??'')!=='COMPLETED'||!nmsa_payment_source_ok($p,$c['environment']))return nmsa_error('pending');
        $claim='nmsa_payment_'.hash('sha256',$pid);
        if(!add_option($claim,$uid,'','no')&&(int)get_option($claim)!==$uid)return nmsa_error('association');
        if(empty($r['confirmed_payment']))$r['confirmed_payment']=nmcd_payment_details($p);
        if(($r['confirmed_payment']['id']??'')!==$pid)return nmsa_error('association');
        // Hosted Checkout cannot force billing province. Fail closed if Square omits it or contradicts the declaration.
        $address=$p['billing_address']??array();
        $billing_override=($r['billing_verified']['payment_id']??'')===$pid&&!empty($r['billing_verified']['administrator']);
        if(!$billing_override&&(($address['country']??'')!=='CA'||strtoupper($address['administrative_district_level_1']??'')!=='QC')){
            $r['status']='billing_review';$r['payment_id']=$pid;if(!nmsa_store($uid,$r))return nmsa_error('storage');nmsa_audit($uid,'billing_review');nmcd_after_verified($uid);return nmsa_error('billing_review');
        }
        $r['status']=$c['environment']==='production'?'paid':'sandbox_paid';$r['payment_id']=$pid;$r['verified_at']=gmdate('c');
        if(empty($r['access_started']))$r['access_started']=time();
        if(empty($r['access_until']))$r['access_until']=nma_calendar_access_end($r['access_started']);
        if(!nmsa_store($uid,$r))return nmsa_error('storage');
        if($c['environment']!=='production')return 'sandbox_paid';
        // The durable contract is queued as soon as payment is confirmed, independently of email success.
        nmcd_after_verified($uid);
        update_user_meta($uid,'nma_payment_provider','square_api');update_user_meta($uid,'nma_square_api_payment_id',$pid);update_user_meta($uid,'nma_access_started',$r['access_started']);update_user_meta($uid,'nma_access_until',$r['access_until']);
        if(get_user_meta($uid,'nma_payment_provider',true)!=='square_api'||get_user_meta($uid,'nma_square_api_payment_id',true)!==$pid||(int)get_user_meta($uid,'nma_access_until',true)!==(int)$r['access_until'])return nmsa_error('storage');
        update_user_meta($uid,'nma_paid','yes');if(get_user_meta($uid,'nma_paid',true)!=='yes')return nmsa_error('storage');nmsa_audit($uid,'paid');nmcd_after_verified($uid);
        return 'paid';
    } finally { delete_option($lock); }
}
function nmsa_return($result) {
    $code=is_wp_error($result)?$result->get_error_code():$result;
    wp_safe_redirect(add_query_arg('squareapi',sanitize_key($code),home_url('/academy/membre/')),303);exit;
}
add_action('admin_post_nmsa_create',function(){
    if(!is_user_logged_in())wp_die('Connexion requise.',403);check_admin_referer('nmsa_create');
    if(($_POST['billing_country']??'')!=='CA'||($_POST['billing_province']??'')!=='QC'||empty($_POST['accept_terms']))wp_die('Cette offre est réservée à une adresse de facturation au Québec et nécessite l’acceptation des conditions.',400);
    if(($_POST['terms_version']??'')!==nmsa_config()['terms_version'])wp_die('Les conditions ont changé. Actualisez le formulaire avant de poursuivre.',400);
    $buyer=nmcd_buyer_from_request(get_current_user_id());if(is_wp_error($buyer))nmsa_return(nmsa_error('buyer'));
    $hash=isset($_POST['terms_hash'])&&is_string($_POST['terms_hash'])?sanitize_text_field(wp_unslash($_POST['terms_hash'])):'';
    $r=nmsa_create(get_current_user_id(),$buyer,$hash);if(is_wp_error($r))nmsa_return($r);wp_redirect($r,303);exit;
});
add_action('admin_post_nmsa_verify',function(){
    if(!is_user_logged_in())wp_die('Connexion requise.',403);check_admin_referer('nmsa_verify');
    $uid=get_current_user_id();$key='nmsa_poll_'.$uid;if(get_transient($key))nmsa_return(nmsa_error('wait'));set_transient($key,1,15);
    nmsa_return(nmsa_sync($uid));
});
add_shortcode('nma_square_api_checkout',function(){
    if(!is_user_logged_in())return '<p>Connectez-vous pour accéder au paiement.</p>';
    ob_start();
    $result=isset($_GET['squareapi'])&&is_string($_GET['squareapi'])?sanitize_key($_GET['squareapi']):'';if($result&&$result!=='retour')echo '<p role="status">'.esc_html(nmsa_status_label($result)).'</p>';
    if(nmsa_enabled()&&get_user_meta(get_current_user_id(),'nma_paid',true)!=='yes'){
        $config=nmsa_config();$snapshot=nmcd_capture_terms($config['terms'],$config['terms_version']);
        if(is_wp_error($snapshot)){echo '<p>Le contrat est en préparation ; aucun nouveau paiement n’est proposé. Contact : contact@neomoov.net.</p>';return ob_get_clean();}
        echo '<form class="nmsa-checkout" method="post" action="'.esc_url(admin_url('admin-post.php')).'"><input type="hidden" name="action" value="nmsa_create"><input type="hidden" name="terms_hash" value="'.esc_attr($snapshot['sha256']).'">';wp_nonce_field('nmsa_create');
        $config=nmsa_config();echo '<input type="hidden" name="terms_version" value="'.esc_attr($config['terms_version']).'"><p>Durée d’accès : '.esc_html($config['duration_months']).' mois calendaires à compter de l’activation. Remboursement possible dans les 14 jours selon les conditions. '.esc_html($config['review_delay']).'</p>';if($config['environment']==='sandbox')echo '<p class="message"><strong>Recette Sandbox : aucun paiement réel, aucun accès réel et aucun email envoyé.</strong></p>';
        $existing=get_user_meta(get_current_user_id(),'nmsa_checkout',true);$buyer=is_array($existing)?($existing['buyer']??array()):array();
        echo '<p>CAP CHAUFFEUR : 99,00 $ CA + TPS 4,95 $ + TVQ 9,88 $ = <strong>113,83 $ CA</strong>. Paiement unique.</p><p>'.($config['environment']==='sandbox'?'Courriel du compte utilisé pour ce test, sans envoi de contrat : ':'Votre contrat sera envoyé au courriel de ce compte : ').'<strong>'.esc_html($buyer['email']??wp_get_current_user()->user_email).'</strong>. Vérifiez vos informations avant de payer ; une commande déjà créée nécessite une correction par le support.</p>';
        foreach(array('name'=>'Nom complet de l’acheteur','address_line_1'=>'Adresse de facturation','address_line_2'=>'Appartement / bureau (facultatif)','city'=>'Ville','postal_code'=>'Code postal')as$key=>$label)echo '<label class="field">'.esc_html($label).'<input type="text" name="buyer_'.esc_attr($key).'" value="'.esc_attr($buyer[$key]??'').'" maxlength="'.($key==='postal_code'?'10':($key==='city'?'100':($key==='name'?'160':'180'))).'" '.($key==='address_line_2'?'':'required').'></label>';
        echo '<label class="field">Pays de facturation <select name="billing_country" required><option value="">Choisir</option><option value="CA">Canada</option><option value="OTHER">Autre</option></select></label><label class="field">Province de facturation <select name="billing_province" required><option value="">Choisir</option><option value="QC">Québec</option><option value="OTHER">Autre</option></select></label><label class="check-row"><input type="checkbox" name="accept_terms" required><span>Je confirme mon adresse de facturation au Québec et accepte les <a href="'.esc_url(nmsa_config()['terms']).'">conditions de vente</a>.</span></label><p>L’accès est activé sous 24 h après confirmation du paiement, y compris si une vérification de facturation est nécessaire. Si vous avez déjà payé, utilisez la vérification ci-dessous.</p><button class="btn">Payer 113,83 $ CA sur Square</button></form>';
    }else echo '<p>Nouvelles ventes Square API fermées ou accès déjà actif.</p>';
    if(get_user_meta(get_current_user_id(),'nmsa_checkout',true)){
        echo '<form class="nmsa-verify" method="post" action="'.esc_url(admin_url('admin-post.php')).'"><input type="hidden" name="action" value="nmsa_verify">';wp_nonce_field('nmsa_verify');echo '<button class="btn secondary">Vérifier mon paiement auprès de Square</button></form>';
    }
    return ob_get_clean();
});
add_action('rest_api_init',function(){register_rest_route('neomoov-academy/v1','/square-api',array('methods'=>'POST','permission_callback'=>'__return_true','callback'=>function($request){
    $c=nmsa_config();$raw=$request->get_body();$signature=$request->get_header('x-square-hmacsha256-signature');
    if(!$c['signature']||!$c['webhook_url']||strlen($raw)>1048576)return new WP_REST_Response(null,400);
    $expected=base64_encode(hash_hmac('sha256',$c['webhook_url'].$raw,$c['signature'],true));
    if(!hash_equals($expected,(string)$signature))return new WP_REST_Response(null,403);
    $e=json_decode($raw,true);$object=$e['data']['object']??array();$type=$e['type']??'';
    if(!in_array($type,array('payment.created','payment.updated','refund.created','refund.updated'),true))return new WP_REST_Response(array('received'=>true),200);
    $pid=$object['payment']['id']??($object['refund']['payment_id']??'');if(!is_string($pid)||$pid==='')return new WP_REST_Response(null,400);
    $job='nmsa_job_'.hash('sha256',$pid);if(!get_option($job)&&!add_option($job,array('payment_id'=>$pid,'at'=>gmdate('c')),'','no'))return new WP_REST_Response(null,503);
    if(!wp_next_scheduled('nmsa_reconcile_payment',array($pid))){$scheduled=wp_schedule_single_event(time()+1,'nmsa_reconcile_payment',array($pid),true);if(is_wp_error($scheduled)||!$scheduled)return new WP_REST_Response(null,503);}
    return new WP_REST_Response(array('received'=>true),200);
}));});
add_action('nmsa_reconcile_payment',function($pid){
    $job='nmsa_job_'.hash('sha256',$pid);$answer=nmsa_api('GET','payments/'.rawurlencode($pid));$r=$answer;
    if(!is_wp_error($answer)){$oid=$answer['payment']['order_id']??'';$uid=$oid?(int)get_option('nmsa_order_'.hash('sha256',$oid),0):0;$r=$uid?nmsa_sync($uid):'unrelated';}
    if(is_wp_error($r)&&in_array($r->get_error_code(),array('nmsa_api','nmsa_busy','nmsa_response','nmsa_pending','nmsa_storage','nmsa_configuration'),true)){
        wp_schedule_single_event(time()+300,'nmsa_reconcile_payment',array($pid));return;
    }
    delete_option($job);
});

function nmsa_save_settings($o){
    foreach(array('square_api_token','square_api_signature')as$k){
        if(!empty($_POST[$k.'_replace'])&&isset($_POST[$k])&&is_string($_POST[$k])){
            $v=trim(wp_unslash($_POST[$k]));if(strlen($v)>=16&&strlen($v)<=512&&!preg_match('/\s/',$v))$o[$k]=$v;
        }
    }
    foreach(array('square_api_location','square_api_terms_version','square_api_review_delay')as$k)if(isset($_POST[$k])&&is_string($_POST[$k]))$o[$k]=sanitize_text_field(wp_unslash($_POST[$k]));
    if(isset($_POST['square_api_environment']))$o['square_api_environment']=in_array($_POST['square_api_environment'],array('sandbox','production'),true)?$_POST['square_api_environment']:'sandbox';
    if(isset($_POST['square_api_duration_months']))$o['square_api_duration_months']=absint($_POST['square_api_duration_months']);
    $o['square_api_reviewed']=!empty($_POST['square_api_reviewed']);return $o;
}
function nmsa_admin_fields($o){
    echo '<tr><th>Square API · environnement</th><td><select name="square_api_environment"><option value="sandbox" '.selected($o['square_api_environment']??'sandbox','sandbox',false).'>Sandbox — aucun accès réel attribué</option><option value="production" '.selected($o['square_api_environment']??'sandbox','production',false).'>Production</option></select></td></tr>';
    foreach(array('square_api_token'=>'Token serveur Square','square_api_signature'=>'Clé de signature webhook','square_api_location'=>'Identifiant établissement Square','square_api_terms_version'=>'Version des conditions (ex. identifiant daté)','square_api_review_delay'=>'Note interne de revue (ne remplace pas le délai contractuel)')as$k=>$label){
        $secret=in_array($k,array('square_api_token','square_api_signature'),true);$value=$secret?'':($o[$k]??'');
        echo '<tr><th><label for="'.esc_attr($k).'">'.esc_html($label).'</label></th><td><input id="'.esc_attr($k).'" name="'.esc_attr($k).'" class="regular-text" type="'.($secret?'password':'text').'" autocomplete="'.($secret?'new-password':'off').'" value="'.esc_attr($value).'">';
        if($secret)echo '<label><input type="checkbox" name="'.esc_attr($k).'_replace" value="1"> Enregistrer explicitement cette nouvelle valeur</label><p>'.(!empty($o[$k])?'Déjà configuré ; valeur jamais affichée.':'Non configuré.').'</p>';
        echo '</td></tr>';
    }
    echo '<tr><th>Validation avant recette/ouverture</th><td><label><input type="checkbox" name="square_api_reviewed" value="1" '.checked(!empty($o['square_api_reviewed']),true,false).'> Configuration, conditions, fiscalité, durée et procédure de revue vérifiées.</label><p>Durée : 12 mois calendaires. Activation sous 24 h. Remboursement 14 jours selon conditions. Support 2 jours ouvrés. Prix fixe 99,00 CAD + TPS 4,95 + TVQ 9,88 = 113,83 CAD. Aucune taxe globale Square modifiée.</p><p>Webhook exact : <code>'.esc_html(rest_url('neomoov-academy/v1/square-api')).'</code> · payment.created, payment.updated, refund.created, refund.updated.</p><p>WP-Cron traite les notifications en arrière-plan. La réconciliation manuelle reste disponible ci-dessous.</p></td></tr>';
}
function nmsa_admin_reconcile(){
    if(!current_user_can('manage_options'))return 'Accès refusé.';check_admin_referer('nmsa_admin_reconcile');$uid=absint($_POST['nmsa_member_id']??0);
    if(!$uid||!get_user_by('id',$uid))return 'Membre inconnu.';
    if(!empty($_POST['billing_verified'])){
        $lock='nma_access_lock_'.$uid;if(!add_option($lock,time(),'','no'))return 'Une vérification est déjà en cours.';
        try{wp_cache_delete($uid,'user_meta');$r=get_user_meta($uid,'nmsa_checkout',true);$note=sanitize_textarea_field(wp_unslash($_POST['billing_note']??''));
            if(!is_array($r)||($r['status']??'')!=='billing_review'||empty($r['payment_id'])||strlen($note)<10)return 'Une revue de facturation existante et une note précise sont nécessaires.';
            $r['billing_verified']=array('payment_id'=>$r['payment_id'],'administrator'=>get_current_user_id(),'at'=>gmdate('c'),'note'=>$note);
            if(!nmsa_store($uid,$r))return 'Enregistrement impossible.';nmsa_audit($uid,'billing_verified_by_administrator');
        }finally{delete_option($lock);}
    }
    $result=nmsa_sync($uid);return 'Réconciliation : '.nmsa_status_label(is_wp_error($result)?$result->get_error_code():$result);
}
function nmsa_location_ready($location,$expected){
    return is_array($location)&&is_string($expected)&&$expected!==''&&($location['id']??'')===$expected
        &&($location['status']??'')==='ACTIVE'&&($location['currency']??'')==='CAD'&&($location['country']??'')==='CA'
        &&is_array($location['capabilities']??null)&&in_array('CREDIT_CARD_PROCESSING',$location['capabilities'],true);
}
function nmsa_admin_connection(){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!current_user_can('manage_options'))return 'Accès refusé.';
    check_admin_referer('nmsa_admin_connection');
    $failure='Connexion Square non validée. Vérifiez la configuration puis réessayez. Aucun paiement créé ; ouverture des ventes inchangée.';
    if(nma_provider()!=='square_api')return $failure;$c=nmsa_config();
    if(!is_string($c['location'])||$c['location']==='')return $failure;
    try{$answer=nmsa_api('GET','locations/'.rawurlencode($c['location']));}catch(Throwable $e){return $failure;}
    if(is_wp_error($answer)||!nmsa_location_ready($answer['location']??null,$c['location']))return $failure;
    return 'Connexion Square '.($c['environment']==='production'?'Production':'Sandbox').' vérifiée : établissement configuré actif, Canada, CAD et traitement carte disponible. Aucun paiement créé ; ouverture des ventes inchangée.';
}
function nmsa_status_label($status){
    $labels=array('creating'=>'Création en attente : ne payez pas à nouveau.','pending'=>'Paiement en attente de confirmation.','nmsa_pending'=>'Confirmation encore en attente ; une nouvelle vérification sera nécessaire.',
        'paid'=>'Paiement vérifié ; accès activé pour la durée convenue.','sandbox_paid'=>'Paiement Sandbox vérifié ; aucun accès réel attribué.',
        'billing_review'=>'Paiement reçu ; vérification humaine de facturation nécessaire.','nmsa_billing_review'=>'Paiement reçu ; vérification humaine de facturation nécessaire.',
        'refunded'=>'Paiement entièrement remboursé ; accès retiré.','nmsa_closed'=>'Les nouvelles ventes sont fermées.',
        'nmsa_provider_conflict'=>'Historique de paiement différent : contactez le support avant tout nouvel achat.',
        'nmsa_terms_changed'=>'Les conditions ont changé : contactez le support avant de reprendre ce lien.',
        'nmsa_buyer'=>'Vérifiez votre nom complet, votre adresse et votre code postal avant le paiement.',
        'nmsa_buyer_changed'=>'Les informations diffèrent de la commande existante. Contactez le support pour les corriger avant de payer.',
        'nmsa_wait'=>'Veuillez patienter 15 secondes avant une autre vérification.');
    return $labels[$status]??'Vérification non terminée. Ne payez pas à nouveau ; contactez le support avec votre compte membre.';
}
function nmsa_member_status($uid){
    $r=get_user_meta($uid,'nmsa_checkout',true);if(!is_array($r))return;
    echo '<section class="panel"><h2>Mon paiement Square API</h2><p>'.esc_html(nmsa_status_label($r['status']??'')).'</p>';
    $q=isset($_GET['squareapi'])&&is_string($_GET['squareapi'])?sanitize_key($_GET['squareapi']):'';if($q&&$q!=='retour')echo '<p role="status">'.esc_html(nmsa_status_label($q)).'</p>';
    if(!empty($r['access_until']))echo '<p>'.(($r['environment']??'')==='sandbox'?'Échéance simulée (aucun accès réel) : ':'Échéance de l’accès : ').esc_html(wp_date('d/m/Y H:i',(int)$r['access_until'])).'.</p>';
    if(($r['status']??'')==='billing_review')echo '<p>'.esc_html(nmsa_config()['review_delay']).' Contact : contact@neomoov.net.</p>';
    if(function_exists('nmcd_member_documents'))nmcd_member_documents($uid);
    echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'"><input type="hidden" name="action" value="nmsa_verify">';wp_nonce_field('nmsa_verify');echo '<button class="btn">Vérifier mon paiement</button></form></section>';
}
function nmsa_admin_status(){
    if(!current_user_can('manage_options'))return;
    if(nma_provider()==='square_api'){
        echo '<hr><h2>Connexion Square — lecture seule</h2><p>Vérifie l’établissement configuré et sa capacité à traiter les cartes. Ne crée aucun paiement et n’ouvre pas les ventes.</p><form method="post"><input type="hidden" name="nma_admin_action" value="square_api_connection">';wp_nonce_field('nmsa_admin_connection');echo '<button class="button">Contrôler la connexion Square</button></form>';
    }
    if(function_exists('nmcd_admin_tools'))nmcd_admin_tools();
    echo '<hr><h2>Square API — état et réconciliation</h2><form method="get"><input type="hidden" name="page" value="neomoov-academy"><label>ID membre <input name="nmsa_member" type="number" min="1" required></label><button class="button">Consulter</button></form>';
    $uid=absint($_GET['nmsa_member']??($_POST['nmsa_member_id']??0));$r=$uid?get_user_meta($uid,'nmsa_checkout',true):false;if(!is_array($r))return;
    echo '<p>Membre #'.esc_html($uid).' · '.esc_html(nmsa_status_label($r['status']??'')).'</p><p>Commande : '.esc_html($r['order_id']??'en création').' · paiement : '.esc_html($r['payment_id']??'non confirmé').' · environnement : '.esc_html($r['environment']??'').'</p>';
    echo '<form method="post">';wp_nonce_field('nmsa_admin_reconcile');echo '<input type="hidden" name="nma_admin_action" value="square_api_reconcile"><input type="hidden" name="nmsa_member_id" value="'.esc_attr($uid).'">';
    if(($r['status']??'')==='billing_review')echo '<label><input name="billing_verified" type="checkbox" value="1"> J’ai vérifié la facturation Canada/Québec de ce paiement auprès du membre et des informations Square.</label><p><textarea name="billing_note" rows="3" placeholder="Note de vérification, sans numéro de carte ni pièce sensible"></textarea></p>';
    echo '<button class="button button-primary">Relire Square et réconcilier</button></form><h3>Journal API</h3><ul>';
    foreach(array_slice(array_reverse(get_user_meta($uid,'nmsa_audit',false)),0,30)as$a)echo '<li>'.esc_html(($a['at']??'').' · '.($a['status']??'').' · acteur '.($a['actor']??0)).'</li>';echo '</ul>';if(function_exists('nmcd_admin_status'))nmcd_admin_status($uid);
}
