// 2 octobre 2026 : branche Neomoov Booster (portrait de chauffeur, rapport de performance, rapport de vérification
// sommaire enregistré) dans le site Academy. Chaque ancre doit exister exactement une fois ; refuse de s'appliquer deux fois.
const fs = require('fs');
const path = require('path');
const wpDir = path.join(__dirname, '..', 'livraison', 'wordpress');
function patch(fileName, edits) {
  const file = path.join(wpDir, fileName);
  let t = fs.readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    const n = t.split(from).length - 1;
    if (n !== 1) throw Error(`${fileName} : ancre trouvée ${n} fois : ${from.slice(0, 90)}`);
    t = t.replace(from, () => to);
  }
  fs.writeFileSync(file, t);
  console.log(`${fileName} : ${edits.length} remplacements`);
}
const main = fs.readFileSync(path.join(wpDir, 'neomoov-academy.php'), 'utf8');
if (main.includes('nmb_page(')) throw Error('déjà appliqué');

patch('neomoov-academy.php', [
  // Routes et référencement
  ["'booster','attestation',", "'booster','booster/profil','booster/performance','booster/verification','attestation',"],
  ["'attestation'=>array('Vérifier une attestation Neomoov Chauffeur Pro'.$s,", "'booster/profil'=>array('Portrait de chauffeur · Neomoov Booster'.$s,'Questionnaire, profil sur six dimensions, points forts et points à travailler, fourchette de revenu et recommandations.',true),'booster/performance'=>array('Rapport de performance · Neomoov Booster'.$s,'Départ, arrivée, différences et interprétation de chaque session de travail ; récapitulatif hebdomadaire.',true),'booster/verification'=>array('Rapport de vérification sommaire · Neomoov Booster'.$s,'Le rapport exigé avant la première utilisation de la journée, enregistré dans votre compte et imprimable.',true),'attestation'=>array('Vérifier une attestation Neomoov Chauffeur Pro'.$s,"],
  ["if(in_array($page,array('membre','formation','inscription','attestation'),true))", "if(in_array($page,array('membre','formation','inscription','attestation','booster/profil','booster/performance','booster/verification'),true))"],
  ["elseif($page==='booster')nma_companion();", "elseif($page==='booster')nma_companion();elseif(strpos($page,'booster/')===0)nmb_page($page);"],
  // Actions des membres
  ["if($act==='quiz'||$act==='attestation')return nma_formation_post($act,$uid);", "if($act==='quiz'||$act==='attestation')return nma_formation_post($act,$uid);\n if(in_array($act,array('profile','profile_delete','performance','inspection'),true))return nmb_post($act,$uid);"],
  // Page Booster : cartes vers les trois outils, bilan et plan conservés
  ['<nav class="toc no-print" aria-label="Outils de Neomoov Booster"><a href="#bilan">Bilan de journée</a><a href="#verification">Vérification avant départ</a><a href="#habitacle">Plan d’amélioration du véhicule</a></nav>',
   "'.nmb_hub_cards().'<nav class=\"toc no-print\" aria-label=\"Outils de Neomoov Booster\"><a href=\"#bilan\">Bilan de journée</a><a href=\"#habitacle\">Plan d’amélioration du véhicule</a></nav>"],
  ["</form></section>';nma_check_sheet();echo '<section class=\"panel\" id=\"habitacle\">", "</form></section><section class=\"panel\" id=\"habitacle\">"],
  // Espace membre
  ['<h2>Neomoov Booster</h2><p>Bilan de journée, fiche de vérification avant départ et plan d’amélioration du véhicule.</p><a class="btn" href="\'.esc_url(nma_url(\'booster/\')).\'">Ouvrir Neomoov Booster</a>',
   '<h2>Neomoov Booster</h2><p>Rapport de vérification sommaire, rapport de performance, portrait de chauffeur, bilan de journée.</p><a class="btn" href="\'.esc_url(nma_url(\'booster/verification/\')).\'">Vérification du jour</a> <a class="text-link" href="\'.esc_url(nma_url(\'booster/performance/\')).\'">Performance</a> · <a class="text-link" href="\'.esc_url(nma_url(\'booster/profil/\')).\'">Portrait</a>'],
  // Script d'export en image sur les pages Booster
  ["<script>'.nma_script().'</script></body></html>'", "'.(strpos($page,'booster')===0?'<script src=\"https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js\" defer></script>':'').'<script>'.nma_script().'</script></body></html>'"],
  ['\nJS;\n', "\n(()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');document.querySelectorAll('input[data-today]').forEach(i=>{if(!i.value)i.value=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())});document.querySelectorAll('svg.car rect[data-zone]').forEach(r=>r.addEventListener('click',()=>{const c=document.querySelector('input[data-zone=\"'+r.dataset.zone+'\"]');if(!c)return;c.checked=!c.checked;r.classList.toggle('hit',c.checked)}));document.querySelectorAll('input[data-zone]').forEach(c=>c.addEventListener('change',()=>{const r=document.querySelector('svg.car rect[data-zone=\"'+c.dataset.zone+'\"]');if(r)r.classList.toggle('hit',c.checked)}));document.querySelectorAll('[data-png]').forEach(b=>b.addEventListener('click',async()=>{const t=document.getElementById(b.dataset.png);if(!t||!window.html2canvas)return;b.disabled=true;try{const c=await html2canvas(t,{backgroundColor:'#ffffff',scale:2,ignoreElements:e=>!!(e.classList&&e.classList.contains('no-print'))});const a=document.createElement('a');a.download=(b.dataset.png||'rapport')+'.png';a.href=c.toDataURL('image/png');a.click()}finally{b.disabled=false}}));const ph=document.getElementById('nmb-photos');if(ph)ph.addEventListener('change',()=>{const pv=document.getElementById('nmb-photo-preview');pv.replaceChildren();Array.from(ph.files||[]).slice(0,6).forEach((f,i)=>{if(!f.type.startsWith('image/'))return;const r=new FileReader();r.onload=()=>{const img=document.createElement('img');img.src=String(r.result);img.alt='Photo '+(i+1);pv.append(img)};r.readAsDataURL(f)})});})();\nJS;\n"],
]);

patch('build-export.cjs', [
  ["for(const module of ['formation-attestation.php',", "for(const module of ['formation-attestation.php','booster.php',"],
]);

const css = path.join(wpDir, 'academy.css');
let c = fs.readFileSync(css, 'utf8');
if (!c.includes('.booster-cards')) {
  c = c.replace(/\s*$/, '\n') + [
    '.q-label{font-weight:700;display:block;margin-bottom:6px}.field select,.field textarea{border:1px solid #9fb3bd;border-radius:4px;padding:12px;background:#fff;width:100%;font:inherit;font-size:17px}.dims .dim{display:grid;grid-template-columns:1fr 2fr 40px;gap:12px;align-items:center;margin:8px 0;font-size:15px}.bar{height:10px;background:#e3eaec;border-radius:5px;overflow:hidden}.bar i{display:block;height:100%;background:#5c8413}.two-col-tight{display:grid;grid-template-columns:1fr 1fr;gap:25px}.big{font-size:28px;font-weight:800;margin:6px 0}.perf{width:100%;border-collapse:collapse;font-size:15px}.perf th,.perf td{border-top:1px solid #dde5e7;padding:8px 6px;text-align:left;vertical-align:top}.perf thead th{border-top:0;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#506671}.perf input{width:100%;border:1px solid #9fb3bd;border-radius:4px;padding:8px;font:inherit}.muted{color:#8a9ba4}.sheet-row select{border:1px solid #9fb3bd;border-radius:4px;padding:8px;font:inherit;background:#fff}.car-wrap{max-width:240px;margin:12px auto}.car{width:100%;height:auto}.car rect[data-zone]{fill:transparent;cursor:pointer}.car rect.hit{fill:#e74c3c66;stroke:#c0392b;stroke-width:2}.zones{display:grid;grid-template-columns:repeat(3,1fr);gap:0 14px}.gravite{font-weight:700;padding:10px 14px;border-radius:5px;background:#edf5df}.g-mineure{background:#fff3cd}.g-majeure{background:#f8d7da}.s-mineure{color:#8a6d00;font-weight:700}.s-majeure{color:#9f2424;font-weight:700}.grid-info{display:grid;grid-template-columns:repeat(2,1fr);gap:0 20px}.grid-info p{margin:4px 0}.card-link{display:block}.card-link:hover{text-decoration:none;background:#f3f7f6}.card-link h2{font-size:24px}.booster-cards{grid-template-columns:repeat(3,1fr);margin-bottom:25px}.report{break-inside:avoid}',
    '@media(max-width:640px){.booster-cards,.two-col-tight,.grid-info,.zones{grid-template-columns:1fr}.sheet-row{grid-template-columns:1fr}.dims .dim{grid-template-columns:1fr 1fr 32px}.perf{font-size:13px}.perf th,.perf td{padding:6px 4px}}',
  ].join('\n') + '\n';
  fs.writeFileSync(css, c);
  console.log('academy.css : styles Booster ajoutés');
}
const dep = path.join(__dirname, 'academy-deployer.cjs');
let d = fs.readFileSync(dep, 'utf8');
if (!d.includes("'booster/profil/'")) { d = d.replace("'booster/', 'attestation/',", "'booster/', 'booster/profil/', 'booster/performance/', 'booster/verification/', 'attestation/',"); fs.writeFileSync(dep, d); console.log('academy-deployer.cjs : routes Booster contrôlées'); }
