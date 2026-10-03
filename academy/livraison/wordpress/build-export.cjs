const fs=require('fs');
const root='livraison/wordpress/';
let code=fs.readFileSync(root+'neomoov-academy.php','utf8').replace(/^\uFEFF/,'');
let css=fs.readFileSync(root+'academy.css','utf8').replace(/^\uFEFF/,'');
if(!css.includes('*{box-sizing'))throw Error('CSS anchor absent');
code=code.replace('__ACADEMY_CSS__',css.slice(css.indexOf('*{box-sizing')));
for(const module of ['formation-attestation.php','booster.php','booster-plus.php','parcours.php','communaute.php','contract-delivery.php','square-checkout-api.php','brevo-sync.php','brevo-templates.php','sequences.php','confidentialite.php'])code+='\n'+fs.readFileSync(root+module,'utf8').replace(/^\uFEFF/,'').replace(/^<\?php\s*/,'')+'\n';
const emails=JSON.parse(fs.readFileSync('livraison/marketing/emails_source.json','utf8'));
const templates=emails.map(e=>({templateName:`NCP_${e.id}_${e.jour}_VENTE_20261002`,subject:e.sujet,htmlContent:fs.readFileSync(`livraison/marketing/emails_html/brevo-ready/${e.id}.html`,'utf8'),sender:{name:'Neomoov Academy',email:'contact@neomoov.net'},replyTo:'contact@neomoov.net',isActive:false,tag:'NCP_20261002'}));
if(templates.length!==20||templates.some(t=>!t.htmlContent.includes('{{ unsubscribe }}')))throw Error('Lot Brevo invalide');
fs.writeFileSync(root+'brevo-templates-data.json',JSON.stringify(templates));
code+="\nfunction nma_brevo_template_data(){return json_decode(<<<'NMA_BREVO_TEMPLATES'\n"+JSON.stringify(templates)+"\nNMA_BREVO_TEMPLATES\n,true);}\n";
const parsed=JSON.parse(fs.readFileSync('livraison/formation/data.json','utf8').replace(/^\uFEFF/,''));
// Adresses des m\u00E9dias (narration, vid\u00E9os, PDF) hors d\u00E9p\u00F4t : media.json, fusionn\u00E9 au moment de l'assemblage.
if(fs.existsSync('livraison/formation/media.json')){const media=JSON.parse(fs.readFileSync('livraison/formation/media.json','utf8'));if(media.guide)parsed.guide=media.guide;if(media.intro)parsed.intro=media.intro;if(media.ebook)parsed.ebook=media.ebook;for(const l of parsed.lessons)if(media.lessons&&media.lessons[l.id])l.media=media.lessons[l.id];}
parsed.exam=JSON.parse(fs.readFileSync('livraison/formation/examen.json','utf8').replace(/^\uFEFF/,''));
const data=JSON.stringify(parsed);
code+="\nfunction nma_data(){return json_decode(<<<'NMA_DATA'\n"+data+"\nNMA_DATA\n,true);}\n";
fs.writeFileSync(root+'neomoov-academy-ready.php',code);
const payload={generator:'Code Snippets v3.10.2',date_created:'2026-09-29 18:00',snippets:[{name:'Neomoov Academy — Neomoov Chauffeur Pro',desc:'Academy, Neomoov Booster, quiz, attestation et paiements configurables. Export inactif. Square API fermé tant que configuration et recette incomplètes.',code:code.replace(/^<\?php\s*/,''),tags:['neomoov','academy'],scope:'global',active:false,priority:10}]};
fs.writeFileSync(root+'neomoov-academy.code-snippets.json',JSON.stringify(payload,null,2));
console.log('Export local generated; inactive; characters:',code.length);
