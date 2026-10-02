<?php
/** Neomoov Booster : portrait du chauffeur, rapport de performance, rapport de vérification sommaire (compte membre). */
if (!defined('ABSPATH')) { exit; }

/* ---------- Outils communs ---------- */
function nmb_meta($uid,$key){$v=get_user_meta($uid,$key,true);return is_array($v)?$v:array();}
function nmb_push($uid,$key,$entry,$max){$items=nmb_meta($uid,$key);array_unshift($items,$entry);update_user_meta($uid,$key,array_slice($items,0,$max));}
function nmb_num($raw,$min=0,$max=10000000){$s=str_replace(array(',',' '),array('.',''),trim((string)$raw));if($s===''||!is_numeric($s))return null;$v=(float)$s;return ($v<$min||$v>$max)?null:$v;}
function nmb_money($v){return number_format((float)$v,2,',',' ').' $';}
function nmb_select($name,$options,$current='',$attrs=''){$h='<select name="'.esc_attr($name).'" '.$attrs.'>';foreach($options as $v=>$l)$h.='<option value="'.esc_attr($v).'"'.((string)$v===(string)$current?' selected':'').'>'.nma_e($l).'</option>';return $h.'</select>';}
function nmb_date_fr($iso){$t=strtotime((string)$iso);return $t?wp_date('j M Y',$t):'';}
function nmb_require_login($page){if(is_user_logged_in())return true;echo '<section class="wrap section narrow"><p class="eyebrow">NEOMOOV BOOSTER</p><h1>Connectez-vous pour utiliser cet outil.</h1><p>Votre espace gratuit suffit : vos rapports et votre profil sont enregistrés dans votre compte, exportables en PDF ou en image.</p><a class="btn" href="'.esc_url(wp_login_url(nma_url($page))).'">Me connecter</a> <a class="text-link" href="'.esc_url(nma_url('inscription/')).'">Créer mon espace gratuit</a></section>';return false;}
function nmb_print_buttons($id){return '<div class="actions no-print"><button type="button" class="btn secondary" data-print="'.esc_attr($id).'">Imprimer / PDF</button><button type="button" class="btn secondary" data-png="'.esc_attr($id).'">Télécharger en image</button></div>';}

/* ---------- Portrait du chauffeur ---------- */
function nmb_dims(){return array('conformite'=>'Conformité et cadre légal','organisation'=>'Organisation et suivi des chiffres','service'=>'Service client et fidélisation','securite'=>'Sécurité, santé et rythme','rentabilite'=>'Rentabilité et véhicule','outils'=>'Outils et numérique');}
function nmb_types(){return array('conformite'=>'Le chauffeur en règle','organisation'=>'Le gestionnaire','service'=>'L’hôte','securite'=>'Le prudent','rentabilite'=>'L’optimiseur','outils'=>'Le connecté');}
/* Chaque réponse ajoute ou retire des points à une ou plusieurs dimensions (base 50, bornes 0 à 100). */
function nmb_questions(){return array(
 array('id'=>'statut','section'=>'Votre situation','label'=>'Vous êtes…','type'=>'choice','options'=>array('taxi'=>'Chauffeur de taxi','vtc'=>'Chauffeur VTC (Uber, Lyft, Eva…)','deux'=>'Les deux','futur'=>'Futur chauffeur','exploitant'=>'Exploitant ou propriétaire de véhicules'),'scores'=>array('taxi'=>array('conformite'=>5),'deux'=>array('organisation'=>5),'futur'=>array('conformite'=>-10),'exploitant'=>array('organisation'=>10))),
 array('id'=>'experience','section'=>'Votre situation','label'=>'Votre expérience du transport de personnes','type'=>'choice','options'=>array('0'=>'Moins d’un an','1'=>'1 à 3 ans','3'=>'3 à 10 ans','10'=>'Plus de 10 ans'),'scores'=>array('0'=>array('securite'=>-5,'service'=>-5),'3'=>array('service'=>5,'securite'=>5),'10'=>array('service'=>10,'securite'=>5,'organisation'=>5))),
 array('id'=>'age','section'=>'Votre situation','label'=>'Votre tranche d’âge (facultatif)','type'=>'choice','options'=>array(''=>'Je préfère ne pas répondre','25'=>'Moins de 25 ans','34'=>'25 à 34 ans','44'=>'35 à 44 ans','54'=>'45 à 54 ans','64'=>'55 à 64 ans','65'=>'65 ans et plus')),
 array('id'=>'vehicule','section'=>'Votre véhicule','label'=>'Énergie de votre véhicule','type'=>'choice','options'=>array('electrique'=>'100 % électrique','hybride'=>'Hybride','essence'=>'Essence ou diesel','aucun'=>'Pas encore de véhicule'),'scores'=>array('electrique'=>array('rentabilite'=>15),'hybride'=>array('rentabilite'=>5),'essence'=>array('rentabilite'=>-10),'aucun'=>array('rentabilite'=>-5))),
 array('id'=>'vehicule_age','section'=>'Votre véhicule','label'=>'Âge du véhicule','type'=>'choice','options'=>array('3'=>'Moins de 3 ans','5'=>'3 à 5 ans','10'=>'6 à 10 ans','11'=>'Plus de 10 ans','na'=>'Sans objet'),'scores'=>array('3'=>array('rentabilite'=>5),'5'=>array('rentabilite'=>3),'10'=>array('rentabilite'=>-5),'11'=>array('rentabilite'=>-10,'securite'=>-5))),
 array('id'=>'propriete','section'=>'Votre véhicule','label'=>'Vous êtes…','type'=>'choice','options'=>array('proprietaire'=>'Propriétaire','location'=>'En location ou financement','exploitant'=>'Chauffeur d’un exploitant','na'=>'Sans objet'),'scores'=>array('proprietaire'=>array('rentabilite'=>5),'location'=>array('rentabilite'=>-5))),
 array('id'=>'autorisations','section'=>'Votre dossier','label'=>'Ce que vous avez déjà (cochez tout ce qui s’applique)','type'=>'multi','options'=>array('permis'=>'Permis de chauffeur autorisé (SAAQ)','tps'=>'Inscription à la TPS et à la TVQ','assurance'=>'Assurance adaptée au transport rémunéré','adm'=>'Permis d’Aéroports de Montréal','aucun'=>'Aucun pour l’instant'),'scores'=>array('permis'=>array('conformite'=>15),'tps'=>array('conformite'=>15),'assurance'=>array('conformite'=>10,'securite'=>5),'adm'=>array('conformite'=>5),'aucun'=>array('conformite'=>-20))),
 array('id'=>'heures','section'=>'Votre temps','label'=>'Heures de travail par semaine (approche et attente comprises)','type'=>'choice','options'=>array('15'=>'Moins de 20 h','27'=>'20 à 35 h','42'=>'35 à 50 h','55'=>'Plus de 50 h'),'scores'=>array('27'=>array('securite'=>5),'42'=>array('rentabilite'=>5),'55'=>array('rentabilite'=>5,'securite'=>-15))),
 array('id'=>'creneaux','section'=>'Votre temps','label'=>'Vos plages préférées','type'=>'multi','options'=>array('matin'=>'Tôt le matin (5 h à 9 h)','journee'=>'Journée','soiree'=>'Soirée (17 h à 22 h)','nuit'=>'Nuit (22 h à 5 h)'),'scores'=>array('matin'=>array('rentabilite'=>5),'soiree'=>array('rentabilite'=>3),'nuit'=>array('rentabilite'=>5,'securite'=>-10))),
 array('id'=>'jours','section'=>'Votre temps','label'=>'Vos jours de travail','type'=>'multi','options'=>array('semaine'=>'Lundi au vendredi','samedi'=>'Samedi','dimanche'=>'Dimanche')),
 array('id'=>'pauses','section'=>'Votre temps','label'=>'Vos pauses','type'=>'choice','options'=>array('regulieres'=>'Régulières, toutes les 2 ou 3 heures','rarement'=>'Rarement','jamais'=>'Presque jamais'),'scores'=>array('regulieres'=>array('securite'=>10),'rarement'=>array('securite'=>-5),'jamais'=>array('securite'=>-15))),
 array('id'=>'objectif','section'=>'Vos objectifs','label'=>'Revenu net visé par semaine (après coûts du véhicule, avant impôts)','type'=>'choice','options'=>array('600'=>'Moins de 800 $','1000'=>'800 à 1 200 $','1500'=>'1 200 à 1 800 $','2000'=>'Plus de 1 800 $')),
 array('id'=>'priorite','section'=>'Vos objectifs','label'=>'Votre priorité','type'=>'choice','options'=>array('revenu'=>'Le revenu','flexibilite'=>'Des horaires flexibles','service'=>'La qualité de service et une clientèle fidèle','securite'=>'La sécurité et la tranquillité'),'scores'=>array('revenu'=>array('rentabilite'=>5),'service'=>array('service'=>10),'securite'=>array('securite'=>10))),
 array('id'=>'horizon','section'=>'Vos objectifs','label'=>'Votre horizon','type'=>'choice','options'=>array('appoint'=>'Activité d’appoint','principale'=>'Activité principale pour 1 ou 2 ans','carriere'=>'Carrière à long terme','entreprise'=>'Développer une entreprise avec plusieurs véhicules'),'scores'=>array('principale'=>array('organisation'=>5),'carriere'=>array('organisation'=>10),'entreprise'=>array('organisation'=>10,'rentabilite'=>5))),
 array('id'=>'suivi','section'=>'Vos pratiques','label'=>'Vous suivez vos chiffres (heures, kilomètres, recettes, coûts)…','type'=>'choice','options'=>array('jour'=>'Chaque jour','semaine'=>'Chaque semaine','rarement'=>'Rarement','jamais'=>'Jamais'),'scores'=>array('jour'=>array('organisation'=>20),'semaine'=>array('organisation'=>12),'rarement'=>array('organisation'=>-10),'jamais'=>array('organisation'=>-20))),
 array('id'=>'verification','section'=>'Vos pratiques','label'=>'La vérification du véhicule avant la première utilisation de la journée','type'=>'choice','options'=>array('rapport'=>'Chaque jour, avec un rapport conservé','sans'=>'Souvent, sans rapport','rarement'=>'Rarement'),'scores'=>array('rapport'=>array('conformite'=>15,'securite'=>10),'sans'=>array('securite'=>5,'conformite'=>-5),'rarement'=>array('conformite'=>-15,'securite'=>-10))),
 array('id'=>'kit','section'=>'Vos pratiques','label'=>'Le kit du bon chauffeur à bord (eau, mouchoirs, chargeurs, organisateurs de siège…)','type'=>'choice','options'=>array('complet'=>'Oui, complet','partiel'=>'En partie','non'=>'Non'),'scores'=>array('complet'=>array('service'=>15),'partiel'=>array('service'=>5),'non'=>array('service'=>-10))),
 array('id'=>'sources','section'=>'Vos pratiques','label'=>'Vos sources de courses','type'=>'multi','options'=>array('uber'=>'Uber','lyft'=>'Lyft','eva'=>'Eva','taxi'=>'Répartiteur taxi','directe'=>'Clientèle directe','autre'=>'Autre'),'scores'=>array('directe'=>array('service'=>10))),
 array('id'=>'clientele','section'=>'Vos pratiques','label'=>'Des clients vous réservent directement ?','type'=>'choice','options'=>array('oui'=>'Oui, régulièrement','parfois'=>'Parfois','non'=>'Non'),'scores'=>array('oui'=>array('service'=>10,'rentabilite'=>5),'parfois'=>array('service'=>5),'non'=>array('service'=>-5))),
 array('id'=>'navigation','section'=>'Vos pratiques','label'=>'Votre téléphone en roulant','type'=>'choice','options'=>array('support'=>'Sur support fixe, commande vocale','parfois'=>'Parfois en main','main'=>'Souvent en main'),'scores'=>array('support'=>array('securite'=>15,'outils'=>10),'parfois'=>array('securite'=>-10,'outils'=>-5),'main'=>array('securite'=>-20,'outils'=>-10))),
 array('id'=>'appareils','section'=>'Vos outils','label'=>'Vos outils de travail','type'=>'multi','options'=>array('support'=>'Support de téléphone fixe','tablette'=>'Tablette','terminal'=>'Terminal de paiement','suivi'=>'Tableur ou application de suivi','numero'=>'Numéro de téléphone professionnel','aucun'=>'Aucun'),'scores'=>array('support'=>array('outils'=>10),'tablette'=>array('outils'=>5),'terminal'=>array('outils'=>5,'rentabilite'=>3),'suivi'=>array('outils'=>10,'organisation'=>5),'numero'=>array('service'=>5,'outils'=>5),'aucun'=>array('outils'=>-10))),
 array('id'=>'langues','section'=>'Service et sécurité','label'=>'Langues parlées avec les clients','type'=>'multi','options'=>array('fr'=>'Français','en'=>'Anglais','autre'=>'Autre'),'scores'=>array('en'=>array('service'=>10),'autre'=>array('service'=>3))),
 array('id'=>'conflits','section'=>'Service et sécurité','label'=>'Face à un client agressif…','type'=>'choice','options'=>array('calme'=>'Je garde mon calme et je documente','chaud'=>'Je réagis parfois à chaud','evite'=>'J’évite tout échange'),'scores'=>array('calme'=>array('service'=>15,'securite'=>5),'chaud'=>array('service'=>-10),'evite'=>array('service'=>-5))),
 array('id'=>'nuit','section'=>'Service et sécurité','label'=>'La nuit…','type'=>'choice','options'=>array('routine'=>'J’ai une routine (vérification du client, lieux éclairés, partage du trajet)','sans'=>'Pas de routine particulière','non'=>'Je ne travaille pas la nuit'),'scores'=>array('routine'=>array('securite'=>15),'sans'=>array('securite'=>-10))),
 array('id'=>'fatigue','section'=>'Service et sécurité','label'=>'Quand la fatigue arrive…','type'=>'choice','options'=>array('arrete'=>'Je m’arrête','continue'=>'Je continue souvent','ignore'=>'Je ne la remarque pas toujours'),'scores'=>array('arrete'=>array('securite'=>10),'continue'=>array('securite'=>-15),'ignore'=>array('securite'=>-5))),
 array('id'=>'contraintes','section'=>'Santé et contraintes (facultatif)','label'=>'Ce qui peut peser sur votre travail','type'=>'multi','options'=>array('dos'=>'Mal de dos','sommeil'=>'Sommeil difficile','vue'=>'Vue (lunettes, éblouissement)','stress'=>'Stress','aucune'=>'Aucune','pnr'=>'Je préfère ne pas répondre'),'scores'=>array('dos'=>array('securite'=>-5),'sommeil'=>array('securite'=>-10),'vue'=>array('securite'=>-3),'stress'=>array('securite'=>-5),'aucune'=>array('securite'=>5))),
 array('id'=>'commentaires','section'=>'Santé et contraintes (facultatif)','label'=>'Autre chose à nous dire (facultatif)','type'=>'text'),
);}
function nmb_answers_from_post(){
    $out=array();
    foreach(nmb_questions() as $q){
        $raw=$_POST['q_'.$q['id']]??null;
        if($q['type']==='multi'){$vals=is_array($raw)?array_map('sanitize_key',wp_unslash($raw)):array();$out[$q['id']]=array_values(array_intersect($vals,array_keys($q['options'])));}
        elseif($q['type']==='text'){$out[$q['id']]=mb_substr(sanitize_textarea_field(wp_unslash((string)$raw)),0,500);}
        else{$v=sanitize_key(wp_unslash((string)$raw));$out[$q['id']]=array_key_exists($v,$q['options'])?$v:'';}
    }
    return $out;
}
function nmb_profile_compute($a){
    $scores=array();foreach(nmb_dims() as $k=>$l)$scores[$k]=50;
    foreach(nmb_questions() as $q){
        if(empty($q['scores']))continue;
        $vals=$q['type']==='multi'?(array)($a[$q['id']]??array()):array((string)($a[$q['id']]??''));
        foreach($vals as $v)foreach(($q['scores'][$v]??array()) as $dim=>$delta)$scores[$dim]+=$delta;
    }
    $src=(array)($a['sources']??array());if(count($src)===1)$scores['rentabilite']-=5;elseif(count($src)>=2)$scores['rentabilite']+=5;
    foreach($scores as $k=>$v)$scores[$k]=max(0,min(100,(int)round($v)));
    arsort($scores);$ordered=$scores;$forts=array();$faibles=array();
    foreach($ordered as $k=>$v){if($v>=65&&count($forts)<3)$forts[]=$k;}
    asort($ordered);foreach($ordered as $k=>$v){if($v<=45&&count($faibles)<3)$faibles[]=$k;}
    arsort($scores);$type=nmb_types()[array_key_first($scores)]??'';
    /* Fourchette hebdomadaire : heures × (recette horaire − coûts horaires), repères Montréal 2026, indicatifs. */
    $hours=(int)($a['heures']??27)?:27;
    $gross=array('taxi'=>array(26,34),'vtc'=>array(24,32),'deux'=>array(25,33),'futur'=>array(22,30),'exploitant'=>array(24,32));
    list($g1,$g2)=$gross[$a['statut']??'vtc']??array(24,32);
    if(($a['clientele']??'')==='oui'){$g1+=3;$g2+=4;}elseif(($a['clientele']??'')==='parfois'){$g1+=1;$g2+=2;}
    if(in_array('nuit',(array)($a['creneaux']??array()),true)||in_array('soiree',(array)($a['creneaux']??array()),true)){$g1+=1;$g2+=1;}
    if(($a['kit']??'')==='complet'){$g1+=1;$g2+=1;}
    $cost=array('electrique'=>array(5,7),'hybride'=>array(7,9),'essence'=>array(9,12),'aucun'=>array(8,10));
    list($c1,$c2)=$cost[$a['vehicule']??'essence']??array(9,12);
    if(($a['propriete']??'')==='location'){$c1+=3;$c2+=4;}elseif(($a['propriete']??'')==='proprietaire'){$c1+=2;$c2+=3;}
    $revenu=array('bas'=>max(0,(int)round(($g1-$c2)*$hours/10)*10),'haut'=>max(0,(int)round(($g2-$c1)*$hours/10)*10),'heures'=>$hours,'recette'=>array($g1,$g2),'couts'=>array($c1,$c2));
    $r=array();$t=array();$aut=(array)($a['autorisations']??array());
    if(in_array('aucun',$aut,true)||!in_array('permis',$aut,true))$r[]='Obtenez votre permis de chauffeur autorisé avant toute course rémunérée (module 1).';
    if(!in_array('tps',$aut,true))$r[]='Inscrivez-vous à la TPS et à la TVQ avant votre première course payée, quel que soit votre chiffre d’affaires (module 1).';
    if(!in_array('assurance',$aut,true))$r[]='Confirmez auprès de votre assureur que votre contrat couvre le transport rémunéré (module 1).';
    if(($a['verification']??'')!=='rapport')$r[]='Faites la vérification sommaire chaque jour, avant la première utilisation, et consignez-la dans Neomoov Booster (module 1).';
    if(in_array($a['suivi']??'',array('rarement','jamais'),true))$r[]='Tenez votre rapport de performance à chaque session : c’est la seule façon de connaître votre vrai revenu horaire (module 3).';
    if(($a['vehicule']??'')==='essence')$r[]='Comparez le coût total sur trois ans d’un véhicule 100 % électrique : l’énergie est votre premier poste de coût (module 3).';
    if(($a['kit']??'')!=='complet')$r[]='Complétez le kit du bon chauffeur : organisateurs de siège, eau, mouchoirs, trois câbles de charge (module 4).';
    if(!in_array('en',(array)($a['langues']??array()),true))$r[]='Un anglais de base ouvre la clientèle d’affaires et l’aéroport (module 4).';
    if(($a['conflits']??'')!=='calme')$r[]='Apprenez la désescalade et le dossier factuel : votre meilleure protection face à une fausse plainte (module 5).';
    if(in_array('nuit',(array)($a['creneaux']??array()),true)&&($a['nuit']??'')!=='routine')$r[]='Adoptez une routine de sécurité la nuit : vérifier le client, lieux éclairés, partage du trajet (module 5).';
    if(($a['navigation']??'')!=='support')$r[]='Fixez votre téléphone et passez à la commande vocale : 300 à 600 $ d’amende et 5 points d’inaptitude dès la première infraction (module 6).';
    if(count($src)<=1)$r[]='Diversifiez vos sources de courses et construisez une clientèle directe dans les règles (module 7).';
    if($hours>=55||($a['pauses']??'')==='jamais')$r[]='Réduisez le risque de fatigue : pauses régulières et plages de travail réalistes (module 7).';
    if(($a['vehicule']??'')==='electrique'&&in_array($a['vehicule_age']??'',array('3','5'),true)&&in_array('permis',$aut,true)&&in_array('assurance',$aut,true))$r[]='Vous remplissez les conditions de base pour rouler avec Neomoov (véhicule 100 % électrique de 5 ans ou moins, dossier en règle) : préinscrivez-vous sur reserver.neomoov.net/chauffeurs.';
    if(count($src)===1&&!in_array('directe',$src,true))$t[]='Dépendance à une seule plateforme : tendance à subir ses ajustements et ses tarifs ; levier : une clientèle directe.';
    if(in_array('nuit',(array)($a['creneaux']??array()),true)&&$hours>=42)$t[]='Nuits et longues semaines : risque de fatigue et d’irritabilité, les clients le ressentent ; protégez le sommeil.';
    if(($a['priorite']??'')==='revenu'&&($a['vehicule']??'')==='essence')$t[]='Objectif de revenu avec un véhicule à essence : chaque plein rogne la marge ; l’énergie sera votre principal sujet de frustration.';
    $obj=(int)($a['objectif']??0);if($obj&&$obj>$revenu['haut'])$t[]='Votre objectif de revenu dépasse l’estimation : il faudra plus d’heures, un segment mieux payé ou des coûts plus bas.';
    if(in_array($a['age']??'',array('64','65'),true))$t[]='Avec l’âge, le dos et la vue demandent de l’attention : siège réglé, pauses, lunettes de soleil sobres le jour.';
    if(in_array('stress',(array)($a['contraintes']??array()),true))$t[]='Le stress est un frein fréquent : horaires réguliers, routine de désescalade et pauses planifiées.';
    if(in_array('sommeil',(array)($a['contraintes']??array()),true))$t[]='Sommeil difficile : évitez la nuit et les semaines de plus de 50 heures.';
    if(($a['clientele']??'')==='oui'&&($a['kit']??'')==='complet')$t[]='Profil fidélisant : vos clients reviennent ; un numéro professionnel et un registre simple consolident cet avantage.';
    return array('scores'=>$scores,'forts'=>$forts,'faibles'=>$faibles,'type'=>$type,'revenu'=>$revenu,'recommandations'=>array_slice($r,0,8),'tendances'=>$t);
}
function nmb_profile_form($uid){
    $saved=nmb_meta($uid,'nmb_profile');$a=(array)($saved['answers']??array());$section='';
    echo '<form method="post" class="panel" id="profil">';nma_nonce('profile');echo '<h2>Votre portrait de chauffeur.</h2><p>Une trentaine de questions, cinq minutes. Vos réponses servent uniquement à calculer votre profil et vos recommandations ; vous pouvez les modifier ou les effacer à tout moment.</p>';
    foreach(nmb_questions() as $q){
        if($q['section']!==$section){$section=$q['section'];echo '<h3>'.nma_e($section).'</h3>';}
        echo '<div class="field"><span class="q-label">'.nma_e($q['label']).'</span>';
        if($q['type']==='choice')echo nmb_select('q_'.$q['id'],array(''=>'Choisir…')+$q['options'],$a[$q['id']]??'');
        elseif($q['type']==='multi'){foreach($q['options'] as $v=>$l)echo '<label class="check-row"><input type="checkbox" name="q_'.esc_attr($q['id']).'[]" value="'.esc_attr($v).'"'.(in_array($v,(array)($a[$q['id']]??array()),true)?' checked':'').'> '.nma_e($l).'</label>';}
        else echo '<textarea name="q_'.esc_attr($q['id']).'" rows="3" maxlength="500">'.nma_e($a[$q['id']]??'').'</textarea>';
        echo '</div>';
    }
    echo '<label class="check-row"><input type="checkbox" name="consent" value="1" required'.($saved?' checked':'').'> J’accepte que mes réponses, y compris celles sur ma santé, soient conservées dans mon compte pour produire mon profil et mes recommandations. Je peux les effacer à tout moment.</label><div class="actions"><button class="btn">Calculer mon profil</button>'.($saved?'<button class="text-link" name="nma_action" value="profile_delete" formnovalidate>Effacer mes réponses</button>':'').'</div></form>';
}
function nmb_profile_result($uid){
    $saved=nmb_meta($uid,'nmb_profile');if(!$saved||empty($saved['result']))return;$r=$saved['result'];$dims=nmb_dims();
    echo '<section class="panel" id="portrait"><p class="eyebrow">VOTRE PORTRAIT · '.nma_e(nmb_date_fr($saved['at']??'')).'</p><h2>'.nma_e($r['type']).'</h2><div class="dims">';
    foreach($r['scores'] as $k=>$v)echo '<div class="dim"><span>'.nma_e($dims[$k]).'</span><div class="bar"><i style="width:'.(int)$v.'%"></i></div><b>'.(int)$v.'</b></div>';
    echo '</div><div class="two-col-tight"><div><h3>Points forts</h3><ul>';if($r['forts'])foreach($r['forts'] as $k)echo '<li>'.nma_e($dims[$k]).'</li>';else echo '<li>Aucune dimension au-dessus de 65 pour l’instant : votre marge de progression est votre force.</li>';
    echo '</ul></div><div><h3>Points à travailler</h3><ul>';if($r['faibles'])foreach($r['faibles'] as $k)echo '<li>'.nma_e($dims[$k]).'</li>';else echo '<li>Aucune dimension sous 45 : profil équilibré.</li>';echo '</ul></div></div>';
    $rv=$r['revenu'];echo '<h3>Fourchette de revenu hebdomadaire estimée</h3><p class="big">'.nma_e(number_format($rv['bas'],0,',',' ')).' $ à '.nma_e(number_format($rv['haut'],0,',',' ')).' $ net</p><p class="small">Pour environ '.(int)$rv['heures'].' h par semaine : recette estimée de '.(int)$rv['recette'][0].' à '.(int)$rv['recette'][1].' $ l’heure, coûts du véhicule de '.(int)$rv['couts'][0].' à '.(int)$rv['couts'][1].' $ l’heure, avant impôts et taxes à remettre. Estimation indicative fondée sur vos réponses et des repères montréalais de 2026 : votre rapport de performance la remplacera par vos vrais chiffres.</p>';
    if($r['tendances']){echo '<h3>Tendances à surveiller</h3><ul>';foreach($r['tendances'] as $t)echo '<li>'.nma_e($t).'</li>';echo '</ul>';}
    echo '<h3>Vos recommandations</h3><ol>';foreach($r['recommandations'] as $t)echo '<li>'.nma_e($t).'</li>';echo '</ol>'.nmb_print_buttons('portrait').'</section>';
}

/* ---------- Rapport de performance Neomoov ---------- */
function nmb_perf_fields(){return array(
 'heure'=>array('Heure','time','both'),'autonomie'=>array('Autonomie ou niveau de carburant (%)','number','both'),'odometre'=>array('Odomètre (km)','number','both'),
 'temps_ligne'=>array('Temps en ligne ou de session (minutes)','number','end'),'temps_volant'=>array('Temps au volant, en course (minutes)','number','end'),'courses'=>array('Nombre de courses et livraisons','number','end'),
 'montant'=>array('Montant exact reçu pour les courses et livraisons ($)','number','end'),'pourboires'=>array('Pourboires reçus ($)','number','end'),'promotions'=>array('Promotions et primes ($)','number','end'),
 'energie'=>array('Dépense d’énergie : carburant ou recharge ($)','number','end'),'nettoyage'=>array('Nettoyage du véhicule ($)','number','end'),'points'=>array('Points reçus (programme de votre opérateur)','number','end'),'autres'=>array('Autres (notes)','text','end'));}
function nmb_perf_form($uid){
    echo '<form method="post" class="panel" id="performance-form">';nma_nonce('performance');echo '<h2>Rapport de performance Neomoov.</h2><p>Saisissez vos valeurs au départ puis à l’arrivée de la session : le tableau calcule les différences et leur interprétation. Une ligne par session de travail.</p><div class="form-grid"><label class="field">Date de la session<input type="date" name="date" required data-today></label><label class="field">Source principale<input type="text" name="source" maxlength="40" placeholder="Uber, taxi, clientèle directe…"></label></div><table class="perf"><thead><tr><th>Libellé</th><th>Au départ</th><th>À l’arrivée</th></tr></thead><tbody>';
    foreach(nmb_perf_fields() as $k=>$f){echo '<tr><th scope="row">'.nma_e($f[0]).'</th>';if($f[2]==='both')echo '<td><input type="'.$f[1].'" name="d_'.$k.'" step="any" min="0"></td><td><input type="'.$f[1].'" name="a_'.$k.'" step="any" min="0"></td>';else echo '<td class="muted">—</td><td><input type="'.$f[1].'" name="a_'.$k.'"'.($f[1]==='number'?' step="any" min="0"':' maxlength="200"').'></td>';echo '</tr>';}
    echo '</tbody></table><div class="actions"><button class="btn">Enregistrer la session</button></div></form>';
}
function nmb_perf_from_post(){
    $e=array('date'=>preg_match('/^\d{4}-\d{2}-\d{2}$/',(string)($_POST['date']??''))?$_POST['date']:gmdate('Y-m-d'),'source'=>sanitize_text_field(wp_unslash($_POST['source']??'')));
    foreach(nmb_perf_fields() as $k=>$f){
        foreach(array('d','a') as $p){if($p==='d'&&$f[2]!=='both')continue;$raw=wp_unslash($_POST[$p.'_'.$k]??'');
            if($f[1]==='text')$e[$p.'_'.$k]=sanitize_text_field($raw);elseif($f[1]==='time')$e[$p.'_'.$k]=preg_match('/^\d{2}:\d{2}$/',$raw)?$raw:'';else $e[$p.'_'.$k]=nmb_num($raw);}
    }
    $e['at']=gmdate('c');return $e;
}
function nmb_perf_rows($e){
    $n=function($k)use($e){return isset($e[$k])&&$e[$k]!==null&&$e[$k]!=='';};
    $rows=array();$i=0;$km=null;$h=null;
    if($n('d_heure')&&$n('a_heure')){$d=strtotime('2000-01-01 '.$e['d_heure']);$a=strtotime('2000-01-01 '.$e['a_heure']);if($a<$d)$a+=86400;$h=($a-$d)/3600;$rows[]=array(++$i,'Heures','Départ '.$e['d_heure'],'Arrivée '.$e['a_heure'],number_format($h,1,',',' ').' h','Durée totale de la session.');}
    if($n('d_odometre')&&$n('a_odometre')){$km=max(0,$e['a_odometre']-$e['d_odometre']);$rows[]=array(++$i,'Odomètre (km)',$e['d_odometre'],$e['a_odometre'],number_format($km,0,',',' ').' km','Kilomètres parcourus, à vide compris.');}
    if($n('d_autonomie')&&$n('a_autonomie')){$cons=$e['d_autonomie']-$e['a_autonomie'];$rows[]=array(++$i,'Autonomie / carburant (%)',$e['d_autonomie'].' %',$e['a_autonomie'].' %',number_format($cons,0).' points',$km?('Soit '.number_format($km>0&&$cons>0?$cons/$km*100:0,1,',',' ').' points pour 100 km.'):'Consommation de la session.');}
    $tl=$n('a_temps_ligne')?$e['a_temps_ligne']:null;$tv=$n('a_temps_volant')?$e['a_temps_volant']:null;
    if($tl!==null){$rows[]=array(++$i,'Temps en ligne','—',number_format($tl,0).' min',number_format($tl/60,1,',',' ').' h',$tv!==null&&$tl>0?('Au volant en course : '.number_format($tv/$tl*100,0).' % du temps en ligne.'):'Temps de session déclaré.');}
    $m=$n('a_montant')?$e['a_montant']:0;$p=$n('a_pourboires')?$e['a_pourboires']:0;$pr=$n('a_promotions')?$e['a_promotions']:0;$en=$n('a_energie')?$e['a_energie']:0;$ne=$n('a_nettoyage')?$e['a_nettoyage']:0;$c=$n('a_courses')?$e['a_courses']:null;
    if($c!==null)$rows[]=array(++$i,'Courses et livraisons','—',number_format($c,0),'',$m&&$c>0?('Recette moyenne : '.nmb_money($m/$c).' par course.'):'');
    if($n('a_montant')){$inter=array();if($tl)$inter[]=nmb_money($m/($tl/60)).' par heure en ligne';if($km)$inter[]=nmb_money($m/$km).' par km';$rows[]=array(++$i,'Montant des courses','—',nmb_money($m),'',implode(' · ',$inter)?:'Recette brute déclarée.');}
    if($n('a_pourboires'))$rows[]=array(++$i,'Pourboires','—',nmb_money($p),'',$m>0?('Soit '.number_format($p/$m*100,0).' % des courses.'):'');
    if($n('a_promotions'))$rows[]=array(++$i,'Promotions et primes','—',nmb_money($pr),'','');
    if($n('a_energie'))$rows[]=array(++$i,'Énergie','—',nmb_money($en),'',$km?('Soit '.nmb_money($en/$km).' par km.'):'');
    if($n('a_nettoyage'))$rows[]=array(++$i,'Nettoyage','—',nmb_money($ne),'','');
    if($n('a_points'))$rows[]=array(++$i,'Points reçus','—',number_format($e['a_points'],0),'','');
    $net=$m+$p+$pr-$en-$ne;$inter='Montant + pourboires + promotions − énergie − nettoyage, avant assurance, location, entretien, impôts et taxes à remettre.';
    if($tl)$inter.=' Soit '.nmb_money($net/($tl/60)).' net par heure en ligne.';elseif($h)$inter.=' Soit '.nmb_money($net/$h).' net par heure de session.';
    $rows[]=array(++$i,'Solde de la session','—',nmb_money($net),'',$inter);
    if(!empty($e['a_autres']))$rows[]=array(++$i,'Autres','—',nma_e($e['a_autres']),'','');
    return array('rows'=>$rows,'net'=>$net,'km'=>$km,'heures'=>$tl!==null?$tl/60:$h,'montant'=>$m,'pourboires'=>$p,'energie'=>$en+$ne,'courses'=>$c);
}
function nmb_perf_table($e,$id){
    $calc=nmb_perf_rows($e);
    echo '<section class="panel report" id="'.esc_attr($id).'"><p class="eyebrow">RAPPORT DE PERFORMANCE NEOMOOV</p><h2>Session du '.nma_e(nmb_date_fr($e['date'])).($e['source']?' · '.nma_e($e['source']):'').'</h2><table class="perf"><thead><tr><th>N°</th><th>Libellé</th><th>Au départ</th><th>À l’arrivée</th><th>Différence</th><th>Interprétation ou commentaires</th></tr></thead><tbody>';
    foreach($calc['rows'] as $r)echo '<tr><td>'.(int)$r[0].'</td><th scope="row">'.nma_e($r[1]).'</th><td>'.nma_e($r[2]).'</td><td>'.nma_e($r[3]).'</td><td>'.nma_e($r[4]).'</td><td>'.nma_e($r[5]).'</td></tr>';
    echo '</tbody></table>'.nmb_print_buttons($id).'</section>';
}
function nmb_perf_history($uid){
    $items=nmb_meta($uid,'nmb_performance');if(!$items){echo '<p>Aucune session enregistrée.</p>';return;}
    $weeks=array();foreach($items as $e){$w=wp_date('o-\WW',strtotime($e['date']));$c=nmb_perf_rows($e);$weeks[$w]=$weeks[$w]??array('sessions'=>0,'net'=>0,'montant'=>0,'pourboires'=>0,'energie'=>0,'km'=>0,'heures'=>0,'courses'=>0);$weeks[$w]['sessions']++;foreach(array('net','montant','pourboires','energie','km','heures','courses') as $k)$weeks[$w][$k]+=(float)($c[$k]??0);}
    echo '<section class="panel" id="hebdo"><h2>Récapitulatif hebdomadaire</h2><table class="perf"><thead><tr><th>Semaine</th><th>Sessions</th><th>Heures</th><th>Km</th><th>Courses</th><th>Montant</th><th>Pourboires</th><th>Énergie et nettoyage</th><th>Solde</th><th>Solde / h</th></tr></thead><tbody>';
    foreach(array_slice($weeks,0,12,true) as $w=>$s)echo '<tr><th scope="row">'.nma_e($w).'</th><td>'.(int)$s['sessions'].'</td><td>'.number_format($s['heures'],1,',',' ').'</td><td>'.number_format($s['km'],0,',',' ').'</td><td>'.number_format($s['courses'],0).'</td><td>'.nmb_money($s['montant']).'</td><td>'.nmb_money($s['pourboires']).'</td><td>'.nmb_money($s['energie']).'</td><td>'.nmb_money($s['net']).'</td><td>'.($s['heures']>0?nmb_money($s['net']/$s['heures']):'—').'</td></tr>';
    echo '</tbody></table>'.nmb_print_buttons('hebdo').'</section><h2>Vos sessions</h2>';
    foreach(array_slice($items,0,10) as $i=>$e)nmb_perf_table($e,'session-'.$i);
}

/* ---------- Rapport de vérification sommaire (articles 55 de la Loi, 65 et 66 du Règlement) ---------- */
function nmb_inspection_items(){return array('frein'=>'Niveau du liquide de frein','stationnement'=>'Frein de stationnement','feux'=>'Phares, feux et indicateurs de signalement','pneus'=>'Pneus','valves'=>'Valves des pneus','essuie'=>'Essuie-glaces','laveglace'=>'Lave-glace','retroviseurs'=>'Rétroviseurs','lanternon'=>'Lanternon (taxi) : fixation et fonctionnement','voyants'=>'Voyants du tableau de bord','batterie'=>'État de charge de la batterie (véhicule électrique)','rampe'=>'Rampe ou plateforme et ancrages (véhicule adapté)');}
function nmb_inspection_states(){return array('ok'=>'Conforme','mineure'=>'Défectuosité mineure','majeure'=>'Défectuosité majeure','na'=>'Sans objet');}
function nmb_zones(){return array('avg'=>'Avant gauche','avd'=>'Avant droit','ag'=>'Arrière gauche','ad'=>'Arrière droit','pb'=>'Pare-brise','lun'=>'Lunette arrière','toit'=>'Toit','cg'=>'Côté gauche','cd'=>'Côté droit');}
function nmb_inspection_form($uid){
    $items=nmb_inspection_items();$states=nmb_inspection_states();
    echo '<form method="post" class="panel check-sheet" id="verification" autocomplete="off">';nma_nonce('inspection');
    echo '<h2>Rapport de vérification sommaire avant départ.</h2><p>L’article 55 de la Loi concernant le transport rémunéré de personnes par automobile impose au chauffeur qualifié une vérification sommaire de son véhicule avant la première utilisation de la journée pour le transport rémunéré ; les articles 65 et 66 du Règlement fixent les éléments à vérifier et le contenu du rapport, à conserver dans le véhicule. Le rapport est enregistré dans votre compte, imprimable et exportable en image.</p><div class="form-grid">';
    $fields=array('date'=>array('1° Date et heure de la vérification','datetime-local'),'plaque'=>array('2° Numéro de la plaque d’immatriculation','text'),'accessoire'=>array('3° Numéro de l’accessoire apposé sur l’automobile','text'),'chauffeur'=>array('4° Nom du chauffeur qualifié','text'),'permis'=>array('4° Numéro de permis de chauffeur (le cas échéant)','text'),'odometre'=>array('7° Lecture de l’odomètre (km)','number'),'batterie'=>array('État de charge de la batterie (véhicule électrique, %)','number'),'vehicule'=>array('Véhicule (marque et modèle)','text'));
    foreach($fields as $k=>$f)echo '<label class="field">'.nma_e($f[0]).'<input type="'.$f[1].'" name="'.$k.'"'.($k==='date'?' data-now required':'').($k==='odometre'?' min="0" step="1"':'').($k==='batterie'?' min="0" max="100" step="1"':'').($f[1]==='text'?' maxlength="80"':'').'></label>';
    echo '</div><h3>8° Éléments vérifiés (article 65 du Règlement)</h3><div class="sheet-rows">';
    foreach($items as $k=>$label)echo '<div class="sheet-row"><span>'.nma_e($label).'</span>'.nmb_select('e_'.$k,$states,'ok','class="state"').'<input type="text" name="o_'.$k.'" maxlength="120" placeholder="Observation"></div>';
    echo '</div><label class="check-row"><input type="checkbox" name="tous" value="1" required> <b>Tous les éléments prévus à l’article 65 ont été vérifiés.</b></label>';
    echo '<h3>6° Voyants du tableau de bord</h3><label class="check-row"><input type="radio" name="voyant" value="none" checked> Aucun voyant allumé</label><label class="check-row"><input type="radio" name="voyant" value="on"> Un voyant est allumé, motif :</label><label class="field"><input type="text" name="voyant_motif" maxlength="160" placeholder="Motif pour lequel le voyant est allumé"></label>';
    echo '<h3>5° Défectuosités et carrosserie</h3><p>Touchez les zones du schéma qui présentent un défaut (rayure, bosse, bris), puis décrivez.</p><div class="car-wrap">'.nmb_car_svg(array()).'</div><div class="zones no-print">';
    foreach(nmb_zones() as $k=>$l)echo '<label class="check-row zone-check"><input type="checkbox" name="z_'.$k.'" value="1" data-zone="'.$k.'"> '.nma_e($l).'</label>';
    echo '</div><label class="check-row"><input type="radio" name="defauts" value="none" checked> Aucune défectuosité constatée</label><label class="check-row"><input type="radio" name="defauts" value="some"> Défectuosités constatées (description et mesures prises) :</label><label class="field"><textarea name="notes" rows="4" maxlength="1500"></textarea></label>';
    echo '<label class="field">Photos (facultatif, restent sur votre appareil pour cette version)<input type="file" accept="image/*" multiple id="nmb-photos"></label><div id="nmb-photo-preview" class="photo-grid"></div>';
    echo '<p class="small">Une défectuosité majeure impose de ne pas mettre le véhicule en service avant réparation. Cette fiche aide à consigner votre vérification ; elle ne remplace ni une inspection mécanique ni les exigences de votre opérateur.</p><div class="actions no-print"><button class="btn">Enregistrer le rapport</button><button type="button" class="btn secondary" data-print="verification">Imprimer / PDF</button></div></form>';
}
function nmb_car_svg($hits){
    $z=function($k)use($hits){return in_array($k,$hits,true)?' class="hit"':'';};
    return '<svg class="car" viewBox="0 0 320 560" aria-label="Schéma de la carrosserie, vue de dessus"><rect x="40" y="20" width="240" height="520" rx="70" fill="#f3f7f6" stroke="#0a2431" stroke-width="3"/><rect data-zone="avg" x="40" y="20" width="120" height="110" rx="40"'.$z('avg').'/><rect data-zone="avd" x="160" y="20" width="120" height="110" rx="40"'.$z('avd').'/><rect data-zone="pb" x="70" y="130" width="180" height="60" rx="14"'.$z('pb').'/><rect data-zone="cg" x="40" y="190" width="60" height="180"'.$z('cg').'/><rect data-zone="toit" x="100" y="190" width="120" height="180"'.$z('toit').'/><rect data-zone="cd" x="220" y="190" width="60" height="180"'.$z('cd').'/><rect data-zone="lun" x="70" y="370" width="180" height="60" rx="14"'.$z('lun').'/><rect data-zone="ag" x="40" y="430" width="120" height="110" rx="40"'.$z('ag').'/><rect data-zone="ad" x="160" y="430" width="120" height="110" rx="40"'.$z('ad').'/><text x="160" y="80" text-anchor="middle" font-size="16" fill="#0a2431">AVANT</text><text x="160" y="490" text-anchor="middle" font-size="16" fill="#0a2431">ARRIÈRE</text></svg>';
}
function nmb_inspection_from_post(){
    $r=array('at'=>gmdate('c'));
    foreach(array('date','plaque','accessoire','chauffeur','permis','vehicule','voyant_motif') as $k)$r[$k]=mb_substr(sanitize_text_field(wp_unslash($_POST[$k]??'')),0,160);
    $r['odometre']=nmb_num($_POST['odometre']??'');$r['batterie']=nmb_num($_POST['batterie']??'',0,100);
    $r['voyant']=($_POST['voyant']??'none')==='on'?'on':'none';$r['defauts']=($_POST['defauts']??'none')==='some'?'some':'none';
    $r['notes']=mb_substr(sanitize_textarea_field(wp_unslash($_POST['notes']??'')),0,1500);$r['tous']=!empty($_POST['tous']);
    $r['elements']=array();$states=nmb_inspection_states();
    foreach(nmb_inspection_items() as $k=>$l){$s=sanitize_key(wp_unslash($_POST['e_'.$k]??'ok'));$r['elements'][$k]=array('etat'=>isset($states[$s])?$s:'ok','obs'=>mb_substr(sanitize_text_field(wp_unslash($_POST['o_'.$k]??'')),0,120));}
    $r['zones']=array();foreach(nmb_zones() as $k=>$l)if(!empty($_POST['z_'.$k]))$r['zones'][]=$k;
    $r['gravite']='ok';foreach($r['elements'] as $e){if($e['etat']==='majeure'){$r['gravite']='majeure';break;}if($e['etat']==='mineure')$r['gravite']='mineure';}
    if($r['defauts']==='some'&&$r['gravite']==='ok')$r['gravite']='mineure';
    return $r;
}
function nmb_inspection_view($r,$id){
    $items=nmb_inspection_items();$states=nmb_inspection_states();$zones=nmb_zones();
    echo '<section class="panel report check-sheet" id="'.esc_attr($id).'"><p class="eyebrow">RAPPORT DE VÉRIFICATION SOMMAIRE</p><h2>'.nma_e($r['date']?str_replace('T',' ',$r['date']):nmb_date_fr($r['at'])).'</h2><div class="grid-info"><p><b>Plaque :</b> '.nma_e($r['plaque']).'</p><p><b>Accessoire :</b> '.nma_e($r['accessoire']).'</p><p><b>Chauffeur :</b> '.nma_e($r['chauffeur']).'</p><p><b>Permis :</b> '.nma_e($r['permis']).'</p><p><b>Odomètre :</b> '.($r['odometre']!==null?number_format($r['odometre'],0,',',' ').' km':'—').'</p><p><b>Batterie :</b> '.($r['batterie']!==null?(int)$r['batterie'].' %':'—').'</p><p><b>Véhicule :</b> '.nma_e($r['vehicule']).'</p></div>';
    $g=array('ok'=>'Aucune défectuosité constatée','mineure'=>'Défectuosité mineure : à corriger rapidement','majeure'=>'Défectuosité majeure : véhicule à ne pas mettre en service avant réparation');
    echo '<p class="gravite g-'.esc_attr($r['gravite']).'">'.nma_e($g[$r['gravite']]).'</p><table class="perf"><thead><tr><th>Élément</th><th>État</th><th>Observation</th></tr></thead><tbody>';
    foreach($items as $k=>$l){$e=$r['elements'][$k]??array('etat'=>'ok','obs'=>'');echo '<tr><th scope="row">'.nma_e($l).'</th><td class="s-'.esc_attr($e['etat']).'">'.nma_e($states[$e['etat']]??'').'</td><td>'.nma_e($e['obs']).'</td></tr>';}
    echo '</tbody></table><p><b>Voyants :</b> '.($r['voyant']==='on'?'allumé, motif : '.nma_e($r['voyant_motif']):'aucun voyant allumé').'</p><p><b>Éléments de l’article 65 :</b> '.($r['tous']?'tous vérifiés':'vérification incomplète').'</p>';
    if($r['zones']||$r['notes']){echo '<div class="car-wrap">'.nmb_car_svg($r['zones']).'</div><p><b>Zones :</b> '.nma_e(implode(', ',array_map(function($k)use($zones){return $zones[$k]??$k;},$r['zones']))?:'aucune').'</p><p><b>Défectuosités et mesures :</b> '.nma_e($r['notes']?:'—').'</p>';}
    echo '<p class="print-only">Signature du chauffeur qualifié : ______________________________</p>'.nmb_print_buttons($id).'</section>';
}
function nmb_inspection_history($uid){
    $items=nmb_meta($uid,'nmb_inspections');if(!$items){echo '<p>Aucun rapport enregistré.</p>';return;}
    $g=array('ok'=>'conforme','mineure'=>'défectuosité mineure','majeure'=>'défectuosité majeure');
    echo '<h2>Vos rapports</h2><div class="module-list">';foreach(array_slice($items,0,30) as $i=>$r)echo '<article><span class="index">'.($i+1).'</span><h3><a href="'.esc_url(nma_url('booster/verification/?r='.$i)).'">'.nma_e($r['date']?str_replace('T',' ',$r['date']):nmb_date_fr($r['at'])).'</a></h3><p>'.nma_e($r['plaque']).' · '.nma_e($g[$r['gravite']]??'').($r['odometre']!==null?' · '.number_format($r['odometre'],0,',',' ').' km':'').'</p></article>';echo '</div>';
}

/* ---------- Actions POST (membre connecté) ---------- */
function nmb_post($act,$uid){
    if($act==='profile'){if(empty($_POST['consent']))return 'Cochez la case de consentement pour enregistrer votre profil.';$a=nmb_answers_from_post();$answered=0;foreach(nmb_questions() as $q){if($q['type']==='text')continue;if(!empty($a[$q['id']]))$answered++;}if($answered<10)return 'Répondez à au moins dix questions pour obtenir un profil utile.';$result=nmb_profile_compute($a);update_user_meta($uid,'nmb_profile',array('answers'=>$a,'result'=>$result,'at'=>gmdate('c'),'consent_at'=>gmdate('c')));return 'Votre portrait de chauffeur est prêt : '.$result['type'].'.';}
    if($act==='profile_delete'){delete_user_meta($uid,'nmb_profile');return 'Vos réponses et votre profil ont été effacés.';}
    if($act==='performance'){$e=nmb_perf_from_post();if($e['a_montant']===null&&$e['a_courses']===null&&$e['a_odometre']===null)return 'Indiquez au moins le montant des courses, le nombre de courses ou l’odomètre.';nmb_push($uid,'nmb_performance',$e,400);return 'Session enregistrée dans votre rapport de performance.';}
    if($act==='inspection'){$r=nmb_inspection_from_post();if($r['plaque']===''||$r['chauffeur']==='')return 'Indiquez au moins la plaque et le nom du chauffeur.';if(!$r['tous'])return 'Confirmez que tous les éléments de l’article 65 ont été vérifiés.';nmb_push($uid,'nmb_inspections',$r,120);return $r['gravite']==='majeure'?'Rapport enregistré. Défectuosité majeure : ne mettez pas le véhicule en service avant réparation.':'Rapport de vérification sommaire enregistré dans votre compte.';}
    return '';
}

/* ---------- Pages ---------- */
function nmb_page($sub){
    $uid=get_current_user_id();
    if($sub==='booster/profil'){echo '<div class="wrap section"><p class="eyebrow">NEOMOOV BOOSTER</p><h1>Votre portrait de chauffeur.</h1><p>Un questionnaire, un profil chiffré sur six dimensions, vos points forts et vos points à travailler, une fourchette de revenu et des recommandations reliées aux modules de la formation.</p>';if(nmb_require_login('booster/profil/')){nmb_profile_result($uid);nmb_profile_form($uid);}echo '</div>';}
    elseif($sub==='booster/performance'){echo '<div class="wrap section"><p class="eyebrow">NEOMOOV BOOSTER</p><h1>Rapport de performance Neomoov.</h1><p>Une session de travail, un tableau : départ, arrivée, différence, interprétation. Les semaines se calculent toutes seules.</p>';if(nmb_require_login('booster/performance/')){nmb_perf_form($uid);nmb_perf_history($uid);}echo '</div>';}
    elseif($sub==='booster/verification'){echo '<div class="wrap section"><p class="eyebrow">NEOMOOV BOOSTER</p><h1>Rapport de vérification sommaire.</h1><p>Le rapport exigé par la loi, enregistré dans votre compte chaque jour de travail, imprimable et exportable en image.</p>';if(nmb_require_login('booster/verification/')){$items=nmb_meta($uid,'nmb_inspections');$i=isset($_GET['r'])?absint($_GET['r']):-1;if($i>=0&&isset($items[$i])){nmb_inspection_view($items[$i],'rapport-'.$i);echo '<p><a class="text-link" href="'.esc_url(nma_url('booster/verification/')).'">Nouveau rapport</a></p>';}else nmb_inspection_form($uid);nmb_inspection_history($uid);}echo '</div>';}
}
function nmb_hub_cards(){
    return '<div class="resource-grid booster-cards"><a class="panel card-link" href="'.esc_url(nma_url('booster/verification/')).'"><p class="eyebrow">CHAQUE JOUR</p><h2>Rapport de vérification sommaire</h2><p>Le rapport exigé avant la première utilisation de la journée, enregistré et imprimable.</p></a><a class="panel card-link" href="'.esc_url(nma_url('booster/performance/')).'"><p class="eyebrow">CHAQUE SESSION</p><h2>Rapport de performance</h2><p>Départ, arrivée, différences, interprétation ; récapitulatif hebdomadaire.</p></a><a class="panel card-link" href="'.esc_url(nma_url('booster/profil/')).'"><p class="eyebrow">UNE FOIS, PUIS À VOLONTÉ</p><h2>Portrait de chauffeur</h2><p>Vos points forts, vos points à travailler, votre fourchette de revenu et vos recommandations.</p></a></div>';
}
