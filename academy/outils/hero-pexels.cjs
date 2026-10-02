// 2 octobre 2026 : photo d'en-tête réelle (règle D46) à la place du visuel généré par IA.
// Photo : Pavel Danilyuk, Pexels (licence Pexels, usage libre), recadrée et convertie en WebP par cwebp.
// 1) renomme l'ancien média « academy-hero-webp » (visuel IA) pour qu'il ne soit plus retrouvé par nma_hero_img() ;
// 2) téléverse la nouvelle photo sous un nom de fichier unique, avec titre « academy-hero-webp », texte alternatif et crédit ;
// 3) ajoute l'affichage du crédit (légende du média) dans neomoov-academy.php et son style dans academy.css.
// Usage : node academy/outils/hero-pexels.cjs <fichier .webp>
const fs = require('fs');
const path = require('path');
const wp = require('C:/Users/PC/OneDrive/Desktop/sauvegarde Octobre 2026/Téléchargement/jarvis-starter-kit/jarvis-starter-kit/livrables/sites-web/neomoov-site-wordpress/outils/wp.js');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('usage : node hero-pexels.cjs <fichier .webp>'); process.exit(2); }
const CREDIT = 'Photo : Pavel Danilyuk, Pexels';
const ALT = 'Chauffeur en costume ouvrant la portière d’une berline noire pour une cliente';
const A = path.join(__dirname, '..');

(async () => {
  const medias = (await wp.api('GET', '/wp/v2/media?search=academy-hero&per_page=20&_fields=id,title,source_url')).json;
  for (const m of medias) {
    if (m.title.rendered === 'academy-hero-webp' && !/pexels/.test(m.source_url)) {
      await wp.api('POST', `/wp/v2/media/${m.id}`, { title: 'academy-hero-webp-ia' });
      console.log(`ancien visuel IA renommé : média ${m.id}`);
    }
  }
  let nouveau = medias.find((m) => /academy-hero-chauffeur-pexels/.test(m.source_url));
  if (!nouveau) {
    const up = await wp.televerser(file, { titre: 'academy-hero-webp', alt: ALT });
    const id = up.id || (up.json && up.json.id);
    await wp.api('POST', `/wp/v2/media/${id}`, { title: 'academy-hero-webp', alt_text: ALT, caption: CREDIT, description: 'Photo réelle (Pexels), page d’accueil de Neomoov Academy.' });
    nouveau = (await wp.api('GET', `/wp/v2/media/${id}?_fields=id,title,source_url,media_details`)).json;
    console.log(`nouvelle photo : média ${nouveau.id}, ${nouveau.media_details.width}x${nouveau.media_details.height}, ${nouveau.source_url}`);
  } else console.log(`photo déjà en ligne : média ${nouveau.id}`);

  const php = path.join(A, 'livraison/wordpress/neomoov-academy.php');
  let t = fs.readFileSync(php, 'utf8');
  if (!t.includes('class="credit"')) {
    const a = "'fetchpriority'=>'high','loading'=>'eager','decoding'=>'async'));if($img)return $img;}";
    if (t.split(a).length !== 2) throw Error('ancre nma_hero_img');
    t = t.replace(a, () => "'fetchpriority'=>'high','loading'=>'eager','decoding'=>'async'));$credit=trim((string)$p->post_excerpt);if($img)return $img.($credit!==''?'<span class=\"credit\">'.nma_e($credit).'</span>':'');}");
    fs.writeFileSync(php, t);
    console.log('neomoov-academy.php : crédit photo affiché');
  }
  const css = path.join(A, 'livraison/wordpress/academy.css');
  let c = fs.readFileSync(css, 'utf8');
  if (!c.includes('.hero-visual .credit')) {
    c = c.replace(/\s*$/, '\n') + '.hero-visual .credit{position:absolute;top:10px;right:12px;z-index:2;font-size:11px;color:#fff;background:#0a243199;padding:2px 7px;border-radius:3px}\n';
    fs.writeFileSync(css, c);
    console.log('academy.css : style du crédit');
  }
})().catch((e) => { console.log('erreur :', e.message.slice(0, 300)); process.exit(1); });
