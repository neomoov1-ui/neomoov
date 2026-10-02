<?php
/** Admin-only draft importer. No recipient, campaign, automation or email-send endpoint. */
if(!defined('ABSPATH'))exit;
function nmbt_request($method,$body=null){
    $c=nma_brevo_config();if(!is_string($c['key'])||strlen($c['key'])<20)return new WP_Error('key','Clé Brevo absente.');
    if(!in_array($method,array('GET','POST'),true))return new WP_Error('method','Action refusée.');
    if($method==='POST'&&(!is_array($body)||($body['isActive']??null)!==false||!preg_match('/^NCP_[RSDE]0[1-5]_J[0-9]+_VENTE_20261002$/D',$body['templateName']??'')))return new WP_Error('draft','Brouillon invalide.');
    $url='https://api.brevo.com/v3/smtp/templates'.($method==='GET'?'?limit=1000&offset=0':'');
    $args=array('method'=>$method,'timeout'=>8,'redirection'=>0,'limit_response_size'=>2097152,'headers'=>array('api-key'=>$c['key'],'Accept'=>'application/json','Content-Type'=>'application/json'));
    if($body!==null)$args['body']=wp_json_encode($body);
    $r=wp_remote_request($url,$args);if(is_wp_error($r))return new WP_Error('network','Import interrompu : vérifier les brouillons avant de reprendre.');
    $status=wp_remote_retrieve_response_code($r);if(($method==='GET'&&$status!==200)||($method==='POST'&&$status!==201))return new WP_Error('http','Brevo refuse cet import (HTTP '.(int)$status.'). Aucun envoi effectué.');
    $d=json_decode(wp_remote_retrieve_body($r),true);return is_array($d)?$d:new WP_Error('response','Réponse Brevo non reconnue.');
}
function nmbt_admin_import(){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!current_user_can('manage_options'))return 'Accès refusé.';
    check_admin_referer('nmbt_import');
    $lock='nmbt_import_lock';$held=get_option($lock);if($held&&(int)$held<time()-120)delete_option($lock);
    if(!add_option($lock,time(),'','no'))return 'Un import est déjà en cours. Rechargez dans un instant.';
    try{
        $pack=nma_brevo_template_data();if(!is_array($pack)||count($pack)!==20)return 'Le lot local doit contenir exactement 20 emails.';
        $remote=nmbt_request('GET');if(is_wp_error($remote))return $remote->get_error_message();
        if(!is_array($remote['templates']??null)||(int)($remote['count']??0)>1000)return 'Inventaire Brevo incomplet : import arrêté.';
        $by_name=array();foreach($remote['templates']as$t)if(is_array($t)&&is_string($t['name']??null))$by_name[$t['name']][]=$t;
        $done=(array)get_option('nmbt_template_ids',array());$created=0;
        foreach($pack as$item){
            $name=$item['templateName'];$matches=$by_name[$name]??array();
            if(count($matches)>1)return 'Plusieurs brouillons portent le nom '.esc_html($name).' : contrôle humain nécessaire.';
            if($matches){$t=$matches[0];if(($t['isActive']??null)!==false||($t['subject']??'')!==$item['subject'])return 'Le template '.esc_html($name).' existe avec un état ou objet différent. Aucun écrasement effectué.';$done[$name]=(int)$t['id'];continue;}
            unset($done[$name]);
            if($created>=2)continue;
            $r=nmbt_request('POST',$item);if(is_wp_error($r)){update_option('nmbt_template_ids',$done,false);return $r->get_error_message();}
            if(empty($r['id']))return 'Création non confirmée. Vérifiez la liste Brevo avant de reprendre.';
            $done[$name]=(int)$r['id'];$created++;update_option('nmbt_template_ids',$done,false);
        }
        update_option('nmbt_template_ids',$done,false);
        return count($done).' / 20 templates retrouvés ou créés dans Brevo. '.$created.' nouveau(x) brouillon(s) inactif(s). Aucun email envoyé.';
    }finally{delete_option($lock);}
}
function nmbt_sender_request($id=0){
    $c=nma_brevo_config();if(!is_string($c['key'])||strlen($c['key'])<20)return new WP_Error('key','Clé Brevo absente.');
    if(!is_int($id)||$id<0||$id>1000000)return new WP_Error('scope','Identifiant hors du lot autorisé.');
    $args=array('method'=>$id?'PUT':'GET','timeout'=>8,'redirection'=>0,'limit_response_size'=>2097152,'headers'=>array('api-key'=>$c['key'],'Accept'=>'application/json','Content-Type'=>'application/json'));
    // Only these three fields may change. Never send subject, content, recipients or activation=true.
    if($id)$args['body']=wp_json_encode(array('sender'=>array('name'=>'Neomoov Academy','email'=>'contact@neomoov.net'),'replyTo'=>'contact@neomoov.net','isActive'=>false));
    $r=wp_remote_request('https://api.brevo.com/v3/'.($id?'smtp/templates/'.$id:'senders'),$args);
    if(is_wp_error($r))return new WP_Error('network','Migration interrompue ; relisez l’inventaire avant de reprendre. Aucun envoi effectué.');
    $status=wp_remote_retrieve_response_code($r);if($status!==($id?204:200))return new WP_Error('http','Migration refusée par Brevo (HTTP '.(int)$status.'). Aucun envoi effectué.');
    if($id)return true;
    $data=json_decode(wp_remote_retrieve_body($r),true);return is_array($data)?$data:new WP_Error('response','Réponse Brevo non reconnue.');
}
function nmbt_sender_inventory($remote,$pack){
    if(!is_array($pack)||count($pack)!==20||!is_array($remote['templates']??null)||!isset($remote['count'])||(int)$remote['count']!==count($remote['templates'])||count($remote['templates'])>1000)return new WP_Error('inventory','Inventaire incomplet : migration arrêtée.');
    $names=array();foreach($remote['templates']as$t)if(is_array($t)&&is_string($t['name']??null))$names[$t['name']][]=$t;
    $result=array();$seen_ids=array();$days=array(0,1,3,5,7);$expected=array();foreach(array('R','S','D','E')as$track)foreach($days as$i=>$day)$expected['NCP_'.$track.'0'.($i+1).'_J'.$day.'_VENTE_20261002']=true;
    foreach($pack as$item){
        $name=$item['templateName']??'';if(!isset($expected[$name])||!is_string($item['subject']??null))return new WP_Error('pack','Lot local invalide.');unset($expected[$name]);
        $matches=$names[$name]??array();if(count($matches)!==1)return new WP_Error('duplicate','Un modèle est absent ou dupliqué : migration arrêtée avant modification.');
        $t=$matches[0];$id=$t['id']??null;
        if(!is_int($id)||$id<1||$id>1000000||isset($seen_ids[$id])||($t['isActive']??null)!==false||($t['subject']??null)!==$item['subject'])return new WP_Error('scope','Identifiant, objet ou état inattendu : les 20 modèles doivent être uniques et inactifs.');
        $seen_ids[$id]=true;$result[$id]=$t;
    }
    return $expected?new WP_Error('pack','Lot local incomplet.'):$result;
}
function nmbt_sender_correct($template){return ($template['sender']['email']??'')==='contact@neomoov.net'&&($template['sender']['name']??'')==='Neomoov Academy'&&($template['replyTo']??'')==='contact@neomoov.net';}
function nmbt_admin_migrate_sender(){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!current_user_can('manage_options'))return 'Accès refusé.';
    check_admin_referer('nmbt_migrate_sender');
    // Share the importer lock; fail closed instead of stealing a running request's lock.
    $lock='nmbt_import_lock';if(!add_option($lock,time(),'','no'))return 'Une opération sur les modèles est déjà en cours. Réessayez après sa fin.';
    try{
        $senders=nmbt_sender_request();if(is_wp_error($senders))return $senders->get_error_message();
        $matches=array();foreach(($senders['senders']??array())as$sender)if(is_array($sender)&&($sender['email']??'')==='contact@neomoov.net')$matches[]=$sender;
        if(count($matches)!==1||($matches[0]['active']??null)!==true)return 'contact@neomoov.net doit être un expéditeur unique et actif dans Brevo. Aucune modification effectuée.';
        $pack=nma_brevo_template_data();$remote=nmbt_request('GET');if(is_wp_error($remote))return $remote->get_error_message();
        $inventory=nmbt_sender_inventory($remote,$pack);if(is_wp_error($inventory))return $inventory->get_error_message();
        $updated=0;foreach($inventory as$id=>$template){if(nmbt_sender_correct($template))continue;if($updated>=2)break;
            $answer=nmbt_sender_request($id);if(is_wp_error($answer))return $answer->get_error_message();$updated++;
        }
        if($updated){$remote=nmbt_request('GET');if(is_wp_error($remote))return 'Mise à jour demandée ; confirmation indisponible. Recliquez pour relire sans recréer de modèle.';$inventory=nmbt_sender_inventory($remote,$pack);if(is_wp_error($inventory))return $inventory->get_error_message();}
        $correct=0;foreach($inventory as$t)if(nmbt_sender_correct($t))$correct++;
        return $correct.' / 20 modèles inactifs confirmés avec Neomoov Academy <contact@neomoov.net> et réponse contact@neomoov.net. '.$updated.' mise(s) à jour demandée(s) sur ce clic. Aucun email envoyé ; messages d’automatisation exclus.';
    }finally{delete_option($lock);}
}
function nmbt_admin_status(){
    if(!current_user_can('manage_options'))return;$done=(array)get_option('nmbt_template_ids',array());
    echo '<hr><h2>Brevo — 20 modèles Neomoov Chauffeur Pro (4 séquences de 5 courriels, version du 2 octobre 2026)</h2><p>'.count($done).' / 20 identifiants de templates enregistrés. Import par lots de deux, avec contrôle des noms existants. Les templates sont créés inactifs ; aucune campagne ni automatisation n’est créée ou envoyée.</p><p>Les modèles importés avec l’expéditeur provisoire peuvent être migrés vers Neomoov Academy &lt;contact@neomoov.net&gt;. La migration vérifie l’expéditeur actif et les 20 modèles inactifs avant chaque lot de deux ; leurs objets et contenus restent inchangés. Les anciens brouillons CAP_… du 30 septembre et les messages d’automatisation sont exclus.</p><form method="post"><input type="hidden" name="nma_admin_action" value="brevo_templates">';wp_nonce_field('nmbt_import');echo '<button class="button">Importer les prochains brouillons Brevo — aucun envoi</button></form><form method="post"><input type="hidden" name="nma_admin_action" value="brevo_sender_migration">';wp_nonce_field('nmbt_migrate_sender');echo '<button class="button">Migrer les deux prochains modèles vers contact@neomoov.net — aucun envoi</button></form>';
}
