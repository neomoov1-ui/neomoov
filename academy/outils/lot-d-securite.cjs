// 2 octobre 2026, lot D de la revue (Academy) : verrous avec expiration (constat 14), en-têtes de sécurité (5), limite de
// débit sur la vérification d'attestation (16), compteur Brevo limité au lot courant. Rejouable une seule fois.
const fs = require('fs');
const path = require('path');
const wpDir = path.join(__dirname, '..', 'livraison', 'wordpress');
function patch(fileName, edits) {
  const file = path.join(wpDir, fileName);
  let t = fs.readFileSync(file, 'utf8');
  for (const [from, to, all] of edits) {
    const n = t.split(from).length - 1;
    if (all ? n < 1 : n !== 1) throw Error(`${fileName} : ancre trouvée ${n} fois : ${from.slice(0, 90)}`);
    t = all ? t.split(from).join(to) : t.replace(from, () => to);
  }
  fs.writeFileSync(file, t);
  console.log(`${fileName} : ${edits.length} remplacements`);
}
if (fs.readFileSync(path.join(wpDir, 'neomoov-academy.php'), 'utf8').includes('function nma_lock(')) throw Error('déjà appliqué');

patch('neomoov-academy.php', [
  // Verrous : un verrou abandonné (requête interrompue) expire après 10 minutes au lieu de bloquer le compte pour toujours.
  ["function nma_opts(){return (array)get_option('nma_settings',array());}", "function nma_opts(){return (array)get_option('nma_settings',array());}\n/* Verrou d'option avec expiration : un verrou abandonné par une requête interrompue est repris après $ttl secondes. */\nfunction nma_lock($key,$ttl=600){$held=get_option($key);if($held&&(int)$held<time()-$ttl)delete_option($key);return add_option($key,time(),'','no');}\n/* Limite de débit par adresse : $max actions par heure. */\nfunction nma_rate($what,$max){$k='nma_'.$what.'_'.hash_hmac('sha256',($_SERVER['REMOTE_ADDR']??''),wp_salt());$n=(int)get_transient($k);if($n>=$max)return false;set_transient($k,$n+1,HOUR_IN_SECONDS);return true;}"],
  ["add_option($lock,time(),'','no')", "nma_lock($lock)", true],
  ["add_option($access_lock,time(),'','no')", "nma_lock($access_lock)", true],
  ["add_option($manual_lock,time(),'','no')", "nma_lock($manual_lock)", true],
  // En-têtes de sécurité sur toutes les pages Academy.
  ["status_header(200);header('Content-Type: text/html; charset=UTF-8');", "status_header(200);header('Content-Type: text/html; charset=UTF-8');header('X-Content-Type-Options: nosniff');header('Referrer-Policy: strict-origin-when-cross-origin');header('X-Frame-Options: SAMEORIGIN');"],
]);
patch('square-checkout-api.php', [["add_option($lock,time(),'','no')", "nma_lock($lock)", true]]);
patch('brevo-sync.php', [["add_option($lock,time(),'','no')", "nma_lock($lock)", true]]);
patch('brevo-templates.php', [
  ["add_option($lock,time(),'','no')", "nma_lock($lock)", true],
  ["return count($done).' / 20 templates retrouvés ou créés dans Brevo. '", "return count(preg_grep('/^NCP_/',array_keys($done))).' / 20 templates retrouvés ou créés dans Brevo. '"],
  ["<p>'.count($done).' / 20 identifiants de templates enregistrés.", "<p>'.count(preg_grep('/^NCP_/',array_keys($done))).' / 20 identifiants de templates enregistrés."],
]);
patch('formation-attestation.php', [
  ["$lock='nma_attestation_lock_'.$uid;$held=get_option($lock);if($held&&(int)$held<time()-120)delete_option($lock);\n    if(!add_option($lock,time(),'','no'))return null;", "$lock='nma_attestation_lock_'.$uid;if(!nma_lock($lock,120))return null;"],
  // Vérification publique : 60 consultations par heure et par adresse sur la page, 120 sur l'API.
  ["    if($code!==''){\n        $a=nma_attestation_find($code);", "    if($code!==''){\n        if(!nma_rate('attestation',60)){echo '<p class=\"eyebrow\">VÉRIFICATION D’UNE ATTESTATION</p><h1>Trop de vérifications depuis votre connexion.</h1><p>Réessayez dans une heure, ou écrivez à contact@neomoov.net.</p></section>';return;}\n        $a=nma_attestation_find($code);"],
  ["'permission_callback'=>'__return_true','callback'=>function($r){\n    $a=nma_attestation_find($r['code']);", "'permission_callback'=>'__return_true','callback'=>function($r){\n    if(!nma_rate('attestation_api',120))return new WP_REST_Response(array('valid'=>false,'error'=>'rate_limited'),429);\n    $a=nma_attestation_find($r['code']);"],
]);
console.log('terminé : relancer node livraison/wordpress/build-export.cjs');
