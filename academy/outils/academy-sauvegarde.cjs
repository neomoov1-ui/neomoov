// Sauvegarde exacte de l'extrait Code Snippets actif de Neomoov Academy (n° 6) et de la page des conditions (1909).
const fs = require('fs'); const crypto = require('crypto'); const wp = require('C:/Users/PC/OneDrive/Desktop/sauvegarde Octobre 2026/Téléchargement/jarvis-starter-kit/jarvis-starter-kit/livrables/sites-web/neomoov-site-wordpress/outils/wp.js');
const DEST = 'C:/Users/PC/code/neomoov-outils/academy/sauvegardes';
(async () => {
  const jour = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const s = (await wp.api('GET', '/code-snippets/v1/snippets/6')).json;
  fs.writeFileSync(`${DEST}/extrait-6-${jour}.json`, JSON.stringify(s, null, 1));
  fs.writeFileSync(`${DEST}/extrait-6-${jour}.php`, s.code);
  const p = (await wp.api('GET', '/wp/v2/pages/1909?context=edit')).json;
  fs.writeFileSync(`${DEST}/conditions-1909-${jour}.html`, p.content.raw);
  console.log(`extrait 6 sauvegardé (${s.code.length} caractères, sha256 ${crypto.createHash('sha256').update(s.code).digest('hex').slice(0, 16)}…) ; conditions sauvegardées (${p.content.raw.length} caractères)`);
  const motifs = [/EAAA[A-Za-z0-9_-]{20,}/, /sq0csp-[A-Za-z0-9_-]{10,}/, /xkeysib-[a-z0-9]{20,}/, /sk_live_[A-Za-z0-9]{10,}/, /pat-na[0-9]-[a-f0-9-]{20,}/];
  const trouves = motifs.filter((m) => m.test(s.code)).map((m) => m.source.slice(0, 10));
  console.log(trouves.length ? `ATTENTION : motifs de secret trouvés dans le code : ${trouves.join(', ')}` : 'aucun secret repéré dans le code de l\'extrait');
})().catch((e) => console.log('erreur :', e.message.slice(0, 300)));
