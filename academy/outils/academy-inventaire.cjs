// Inventaire en lecture seule de Neomoov Academy dans WordPress : extraits Code Snippets et page des conditions.
// Aucun secret affiché. Usage : node academy-inventaire.cjs
const wp = require('C:/Users/PC/OneDrive/Desktop/sauvegarde Octobre 2026/Téléchargement/jarvis-starter-kit/jarvis-starter-kit/livrables/sites-web/neomoov-site-wordpress/outils/wp.js');
(async () => {
  const snippets = (await wp.api('GET', '/code-snippets/v1/snippets?per_page=100')).json;
  const liste = Array.isArray(snippets) ? snippets : snippets.data ?? [];
  for (const s of liste) console.log(`extrait ${s.id} : ${s.active ? 'ACTIF' : 'inactif'} | ${s.name} | ${String(s.code ?? '').length} caractères | modifié ${s.modified ?? ''} | portée ${s.scope ?? ''}`);
  const page = (await wp.api('GET', '/wp/v2/pages/1909?context=edit')).json;
  console.log(`page 1909 : « ${page.title?.raw ?? page.title?.rendered} » | ${page.status} | modifiée ${page.modified} | ${page.link} | ${String(page.content?.raw ?? '').length} caractères`);
  const reglages = (await wp.api('GET', '/wp/v2/settings')).json;
  console.log(`réglages : fuseau ${reglages.timezone ?? reglages.timezone_string ?? '?'} | langue ${reglages.language ?? '?'} | titre « ${reglages.title} »`);
})().catch((e) => console.log('erreur :', e.message.slice(0, 300)));
