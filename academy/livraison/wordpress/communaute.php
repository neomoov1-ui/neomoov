<?php
/** Espace communautaire Neomoov Academy : sujets et réponses entre membres (espace gratuit suffisant), pseudonyme choisi,
 *  « utile », signalement, modération, notification de réponse. Contenu en texte brut (liens rendus cliquables, nofollow). */
if(!defined('ABSPATH'))exit;
function nmc_categories(){return array('questions'=>'Questions','terrain'=>'Astuces de terrain','vehicule'=>'Véhicule et électrique','neomoov'=>'Devenir chauffeur Neomoov','annonces'=>'Annonces Neomoov');}
add_action('init',function(){foreach(array('nma_topic','nma_reply') as $t)register_post_type($t,array('public'=>false,'show_ui'=>false,'show_in_rest'=>false,'exclude_from_search'=>true,'supports'=>array('title','editor','author')));},5);
function nmc_name($uid){$p=get_user_meta($uid,'nmc_pseudo',true);if(is_string($p)&&$p!=='')return $p;$u=get_user_by('id',$uid);if(!$u)return 'Membre';$f=trim((string)$u->first_name);return $f!==''?$f:(string)$u->display_name;}
function nmc_render($text){$h=nma_e($text);$h=preg_replace_callback('#https?://[^\s<]+#u',function($m){$u=rtrim($m[0],'.,;:)');return '<a href="'.esc_url($u).'" rel="nofollow noopener" target="_blank">'.$u.'</a>';},$h);return nl2br($h);}
function nmc_meta($id,$k,$d=array()){$v=get_post_meta($id,$k,true);return is_array($v)?$v:$d;}
function nmc_rate_ok($uid){$h=gmdate('YmdH');$r=get_user_meta($uid,'nmc_rate',true);$r=is_array($r)&&($r['h']??'')===$h?$r:array('h'=>$h,'n'=>0);if($r['n']>=10)return false;$r['n']++;update_user_meta($uid,'nmc_rate',$r);return true;}
function nmc_topics($args=array()){$q=array('post_type'=>'nma_topic','post_status'=>'publish','numberposts'=>(int)($args['n']??20),'offset'=>(int)($args['offset']??0),'orderby'=>'date','order'=>'DESC');if(!empty($args['cat']))$q['meta_query']=array(array('key'=>'nmc_cat','value'=>$args['cat']));if(!empty($args['s']))$q['s']=$args['s'];return (array)get_posts($q);}
function nmc_count_topics(){return count((array)get_posts(array('post_type'=>'nma_topic','post_status'=>'publish','numberposts'=>500,'fields'=>'ids')));}
function nmc_replies($topic){return (array)get_posts(array('post_type'=>'nma_reply','post_status'=>'publish','post_parent'=>(int)$topic,'numberposts'=>200,'orderby'=>'date','order'=>'ASC'));}
function nmc_topic($id){$p=get_post((int)$id);return $p&&$p->post_type==='nma_topic'?$p:null;}
function nmc_report($post,$uid){
    $reports=nmc_meta($post->ID,'nmc_reports');if(in_array($uid,$reports,true))return 'Vous avez déjà signalé ce message.';$reports[]=$uid;update_post_meta($post->ID,'nmc_reports',$reports);
    if(count($reports)>=3){wp_update_post(array('ID'=>$post->ID,'post_status'=>'pending'));}
    $admin=get_option('admin_email');if(is_email($admin))wp_mail($admin,'[Communauté Academy] Message signalé',"Message #".$post->ID." signalé par le membre #".$uid." (".count($reports)." signalement(s)).\nTitre ou début : ".mb_substr(($post->post_title?:$post->post_content),0,120)."\nModération : réglages Neomoov Academy, section Communauté.",array('Reply-To: contact@neomoov.net'));
    return count($reports)>=3?'Message signalé et masqué en attendant la modération.':'Message signalé : un administrateur le relira.';
}
function nmc_post($act,$uid){
    if($act==='community_pseudo'){$p=mb_substr(sanitize_text_field(wp_unslash($_POST['pseudo']??'')),0,30);if($p===''||preg_match('/@|https?:/i',$p))return 'Choisissez un pseudonyme sans adresse ni lien (30 caractères au plus).';update_user_meta($uid,'nmc_pseudo',$p);update_user_meta($uid,'nmc_notify',empty($_POST['notify'])?'no':'yes');return 'Pseudonyme enregistré : '.$p.'.';}
    if($act==='community_topic'){
        if(!nma_rate('community',30)||!nmc_rate_ok($uid))return 'Vous publiez trop vite : attendez un peu avant un nouveau message.';
        $cat=sanitize_key($_POST['cat']??'questions');if(!isset(nmc_categories()[$cat]))$cat='questions';if($cat==='annonces'&&!current_user_can('manage_options'))return 'Les annonces sont réservées à l’équipe Neomoov.';
        $title=mb_substr(sanitize_text_field(wp_unslash($_POST['title']??'')),0,120);$body=mb_substr(sanitize_textarea_field(wp_unslash($_POST['body']??'')),0,3000);
        if(mb_strlen($title)<5||mb_strlen($body)<10)return 'Un titre (5 caractères au moins) et un message (10 caractères au moins) sont nécessaires.';
        if(!get_user_meta($uid,'nmc_pseudo',true))update_user_meta($uid,'nmc_pseudo',nmc_name($uid));
        $id=wp_insert_post(array('post_type'=>'nma_topic','post_status'=>'publish','post_author'=>$uid,'post_title'=>$title,'post_content'=>$body),true);
        if(is_wp_error($id)||!$id)return 'Publication impossible pour le moment.';update_post_meta($id,'nmc_cat',$cat);update_post_meta($id,'nmc_replies',0);update_post_meta($id,'nmc_last',time());
        return 'Sujet publié. Les autres membres peuvent maintenant répondre.';
    }
    if($act==='community_reply'){
        $t=nmc_topic(absint($_POST['topic']??0));if(!$t)return 'Sujet introuvable.';if(!nma_rate('community',30)||!nmc_rate_ok($uid))return 'Vous publiez trop vite : attendez un peu avant un nouveau message.';
        $body=mb_substr(sanitize_textarea_field(wp_unslash($_POST['body']??'')),0,3000);if(mb_strlen($body)<2)return 'Écrivez votre réponse.';
        if(!get_user_meta($uid,'nmc_pseudo',true))update_user_meta($uid,'nmc_pseudo',nmc_name($uid));
        $id=wp_insert_post(array('post_type'=>'nma_reply','post_status'=>'publish','post_author'=>$uid,'post_parent'=>$t->ID,'post_title'=>'Re: '.$t->post_title,'post_content'=>$body),true);
        if(is_wp_error($id)||!$id)return 'Réponse impossible pour le moment.';
        update_post_meta($t->ID,'nmc_replies',(int)get_post_meta($t->ID,'nmc_replies',true)+1);update_post_meta($t->ID,'nmc_last',time());
        $author=(int)$t->post_author;if($author&&$author!==$uid&&get_user_meta($author,'nmc_notify',true)!=='no'){$u=get_user_by('id',$author);if($u&&is_email($u->user_email))wp_mail($u->user_email,'Nouvelle réponse à votre sujet « '.$t->post_title.' »',"Bonjour,\n\n".nmc_name($uid)." a répondu à votre sujet dans la communauté Neomoov Academy :\n".nma_url('communaute/?t='.$t->ID)."\n\nPour ne plus recevoir ces avis : votre pseudonyme et vos préférences, sur la même page.\n\nNeomoov Academy · contact@neomoov.net",array('From: Neomoov Academy <contact@neomoov.net>','Reply-To: contact@neomoov.net'));}
        return 'Réponse publiée.';
    }
    if($act==='community_like'){$id=absint($_POST['post']??0);$p=get_post($id);if(!$p||!in_array($p->post_type,array('nma_topic','nma_reply'),true))return 'Message introuvable.';$likes=nmc_meta($id,'nmc_likes');$k=array_search($uid,$likes,true);if($k===false)$likes[]=$uid;else unset($likes[$k]);update_post_meta($id,'nmc_likes',array_values($likes));return $k===false?'Merci, ce message est marqué « utile ».':'Marque « utile » retirée.';}
    if($act==='community_report'){$id=absint($_POST['post']??0);$p=get_post($id);if(!$p||!in_array($p->post_type,array('nma_topic','nma_reply'),true))return 'Message introuvable.';return nmc_report($p,$uid);}
    if($act==='community_delete'){$id=absint($_POST['post']??0);$p=get_post($id);if(!$p||!in_array($p->post_type,array('nma_topic','nma_reply'),true))return 'Message introuvable.';if((int)$p->post_author!==$uid&&!current_user_can('manage_options'))return 'Vous ne pouvez supprimer que vos propres messages.';
        if($p->post_type==='nma_topic'){foreach(nmc_replies($p->ID) as $r)wp_delete_post($r->ID,true);}else{$parent=(int)$p->post_parent;if($parent)update_post_meta($parent,'nmc_replies',max(0,(int)get_post_meta($parent,'nmc_replies',true)-1));}
        wp_delete_post($p->ID,true);return 'Message supprimé.';}
    return '';
}
function nmc_card($p,$detail=false){
    $cats=nmc_categories();$cat=(string)get_post_meta($p->ID,'nmc_cat',true);$likes=count(nmc_meta($p->ID,'nmc_likes'));$n=(int)get_post_meta($p->ID,'nmc_replies',true);$when=nmb_date_fr($p->post_date_gmt?:$p->post_date);
    $h='<article class="topic'.($detail?' detail':'').'"><p class="topic-meta"><span class="pill">'.nma_e($cats[$cat]??'Discussion').'</span> '.nma_e(nmc_name((int)$p->post_author)).' · '.nma_e($when).($detail?'':' · '.$n.' réponse'.($n>1?'s':'')).($likes?' · '.$likes.' utile'.($likes>1?'s':''):'').'</p>';
    $h.=$detail?'<h1>'.nma_e($p->post_title).'</h1><div class="topic-body">'.nmc_render($p->post_content).'</div>':'<h2><a href="'.esc_url(nma_url('communaute/?t='.$p->ID)).'">'.nma_e($p->post_title).'</a></h2><p class="topic-excerpt">'.nma_e(mb_substr($p->post_content,0,180)).(mb_strlen($p->post_content)>180?'…':'').'</p>';
    return $h.'</article>';
}
function nmc_actions($p,$uid){
    $likes=nmc_meta($p->ID,'nmc_likes');$h='<div class="topic-actions no-print"><form method="post" class="inline">';ob_start();nma_nonce('community_like');$h.=ob_get_clean().'<input type="hidden" name="post" value="'.(int)$p->ID.'"><button class="text-link">'.(in_array($uid,$likes,true)?'Retirer « utile »':'Utile').' ('.count($likes).')</button></form><form method="post" class="inline">';ob_start();nma_nonce('community_report');$h.=ob_get_clean().'<input type="hidden" name="post" value="'.(int)$p->ID.'"><button class="text-link">Signaler</button></form>';
    if((int)$p->post_author===$uid||current_user_can('manage_options')){$h.='<form method="post" class="inline" onsubmit="return confirm(\'Supprimer ce message ?\')">';ob_start();nma_nonce('community_delete');$h.=ob_get_clean().'<input type="hidden" name="post" value="'.(int)$p->ID.'"><button class="text-link">Supprimer</button></form>';}
    return $h.'</div>';
}
function nmc_page(){
    echo '<section class="wrap section community"><p class="eyebrow">NEOMOOV ACADEMY · COMMUNAUTÉ</p>';
    if(!is_user_logged_in()){echo '<h1>Échangez avec d’autres chauffeurs.</h1><p class="lead">Questions, astuces de terrain, véhicule électrique, parcours « Devenir chauffeur Neomoov » : la communauté est ouverte à tous les membres, espace gratuit compris.</p><div class="panel"><a class="btn" href="'.esc_url(wp_login_url(nma_url('communaute/'))).'">Me connecter</a> <a class="text-link" href="'.esc_url(nma_url('inscription/')).'">Créer mon espace gratuit</a></div>';
        $last=nmc_topics(array('n'=>5));if($last){echo '<h2>Derniers sujets</h2><ul class="topic-titles">';foreach($last as $p)echo '<li>'.nma_e($p->post_title).' <span class="small">('.nma_e(nmc_categories()[(string)get_post_meta($p->ID,'nmc_cat',true)]??'Discussion').')</span></li>';echo '</ul>';}
        echo '</section>';return;}
    $uid=get_current_user_id();$cats=nmc_categories();$tid=absint($_GET['t']??0);
    if($tid){$t=nmc_topic($tid);if(!$t||($t->post_status!=='publish'&&!current_user_can('manage_options'))){echo '<h1>Sujet introuvable.</h1><a class="btn" href="'.esc_url(nma_url('communaute/')).'">Retour à la communauté</a></section>';return;}
        echo '<p><a class="text-link" href="'.esc_url(nma_url('communaute/')).'">← Tous les sujets</a></p>'.nmc_card($t,true).nmc_actions($t,$uid);
        $replies=nmc_replies($t->ID);echo '<h2>'.count($replies).' réponse'.(count($replies)>1?'s':'').'</h2>';
        foreach($replies as $r)echo '<article class="reply"><p class="topic-meta">'.nma_e(nmc_name((int)$r->post_author)).' · '.nma_e(nmb_date_fr($r->post_date_gmt?:$r->post_date)).'</p><div class="topic-body">'.nmc_render($r->post_content).'</div>'.nmc_actions($r,$uid).'</article>';
        echo '<form method="post" class="panel" action="'.esc_url(nma_url('communaute/?t='.$t->ID)).'">';nma_nonce('community_reply');echo '<input type="hidden" name="topic" value="'.(int)$t->ID.'"><h3>Votre réponse</h3><textarea name="body" rows="5" maxlength="3000" required placeholder="Restez factuel et respectueux ; aucune donnée personnelle (plaque, numéro, adresse)."></textarea><div class="actions"><button class="btn">Répondre</button></div></form></section>';return;}
    $cat=sanitize_key($_GET['cat']??'');if(!isset($cats[$cat]))$cat='';$s=mb_substr(sanitize_text_field(wp_unslash($_GET['q']??'')),0,60);$page=max(1,absint($_GET['pg']??1));
    echo '<h1>La communauté Neomoov Academy.</h1><p class="lead">Questions, astuces de terrain, entraide : entre chauffeurs, futurs chauffeurs et exploitants. Vos messages sont publiés sous votre pseudonyme.</p>';
    echo '<details class="panel"><summary>Pseudonyme et avis par courriel</summary><form method="post">';nma_nonce('community_pseudo');echo '<div class="form-grid"><label class="field">Pseudonyme affiché<input name="pseudo" maxlength="30" value="'.esc_attr(nmc_name($uid)).'" required></label><label class="check-row"><input type="checkbox" name="notify" value="1"'.(get_user_meta($uid,'nmc_notify',true)!=='no'?' checked':'').'> M’avertir par courriel quand on répond à mes sujets</label></div><button class="btn secondary">Enregistrer</button></form></details>';
    echo '<form method="post" class="panel" id="nouveau-sujet">';nma_nonce('community_topic');echo '<h2>Lancer un sujet</h2><div class="form-grid"><label class="field">Catégorie '.nmb_select('cat',array_filter($cats,function($k){return $k!=='annonces'||current_user_can('manage_options');},ARRAY_FILTER_USE_KEY),'questions').'</label><label class="field">Titre<input name="title" maxlength="120" required minlength="5"></label></div><label class="field">Votre message<textarea name="body" rows="5" maxlength="3000" required placeholder="Décrivez votre question ou votre astuce. Aucune donnée personnelle : ni plaque, ni numéro de téléphone, ni adresse de client."></textarea></label><p class="small">Règles : respect, faits, pas de publicité ni de démarchage, aucune donnée personnelle d’un client ou d’un tiers. Les messages signalés trois fois sont masqués en attendant la modération.</p><div class="actions"><button class="btn">Publier</button></div></form>';
    echo '<form method="get" class="topic-filters" action="'.esc_url(nma_url('communaute/')).'"><label>Catégorie '.nmb_select('cat',array(''=>'Toutes')+$cats,$cat).'</label><label>Recherche <input name="q" value="'.esc_attr($s).'" maxlength="60"></label><button class="btn secondary">Filtrer</button></form>';
    $topics=nmc_topics(array('n'=>21,'offset'=>($page-1)*20,'cat'=>$cat,'s'=>$s));$more=count($topics)>20;$topics=array_slice($topics,0,20);
    if(!$topics)echo '<p class="panel">Aucun sujet pour l’instant : lancez le premier.</p>';else{echo '<div class="topic-list">';foreach($topics as $p)echo nmc_card($p);echo '</div>';}
    if($page>1||$more){echo '<p class="topic-pages">'.($page>1?'<a class="text-link" href="'.esc_url(nma_url('communaute/?pg='.($page-1).($cat?'&cat='.$cat:''))).'">← Plus récents</a> ':'').($more?'<a class="text-link" href="'.esc_url(nma_url('communaute/?pg='.($page+1).($cat?'&cat='.$cat:''))).'">Plus anciens →</a>':'').'</p>';}
    echo '</section>';
}
function nmc_admin_action(){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!current_user_can('manage_options'))return 'Accès refusé.';check_admin_referer('nmc_admin');
    $id=absint($_POST['nmc_post']??0);$p=get_post($id);if(!$p||!in_array($p->post_type,array('nma_topic','nma_reply'),true))return 'Message introuvable.';$what=sanitize_key($_POST['nmc_what']??'');
    if($what==='publish'){wp_update_post(array('ID'=>$id,'post_status'=>'publish'));delete_post_meta($id,'nmc_reports');return 'Message republié, signalements effacés.';}
    if($what==='hide'){wp_update_post(array('ID'=>$id,'post_status'=>'pending'));return 'Message masqué.';}
    if($what==='delete'){wp_delete_post($id,true);return 'Message supprimé.';}
    return '';
}
function nmc_admin_status(){
    if(!current_user_can('manage_options'))return;
    $pending=(array)get_posts(array('post_type'=>array('nma_topic','nma_reply'),'post_status'=>'pending','numberposts'=>50));$reported=(array)get_posts(array('post_type'=>array('nma_topic','nma_reply'),'post_status'=>'publish','numberposts'=>50,'meta_key'=>'nmc_reports'));
    echo '<hr><h2>Communauté</h2><p>'.nmc_count_topics().' sujet(s) publié(s) · '.count($pending).' masqué(s) · '.count($reported).' signalé(s) visible(s).</p>';
    foreach(array_merge($pending,$reported) as $p){echo '<p><b>#'.(int)$p->ID.'</b> '.esc_html($p->post_type==='nma_topic'?'sujet':'réponse').' · '.esc_html(nmc_name((int)$p->post_author)).' · '.esc_html($p->post_status).' · '.count(nmc_meta($p->ID,'nmc_reports')).' signalement(s) : '.esc_html(mb_substr($p->post_title?:$p->post_content,0,100)).'</p><form method="post" style="display:inline-block"><input type="hidden" name="nma_admin_action" value="community_moderate"><input type="hidden" name="nmc_post" value="'.(int)$p->ID.'">';wp_nonce_field('nmc_admin');echo '<button class="button" name="nmc_what" value="publish">Publier</button> <button class="button" name="nmc_what" value="hide">Masquer</button> <button class="button" name="nmc_what" value="delete">Supprimer</button></form>';}
}
function nmc_hub_block(){$n=nmc_count_topics();return nma_hub_block('15','Communauté','Questions, astuces de terrain et entraide entre chauffeurs, sous pseudonyme. '.$n.' sujet'.($n>1?'s':'').' publié'.($n>1?'s':'').'.','done','Ouvert',array(array(nma_url('communaute/'),'Entrer dans la communauté')));}
