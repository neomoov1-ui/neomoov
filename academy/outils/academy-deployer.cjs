// Déploie le code assemblé de Neomoov Academy dans l'extrait Code Snippets n° 6, puis contrôle les routes ;
// au moindre écart (statut, erreur PHP, extrait désactivé), restaure le code sauvegardé. Aucun secret affiché.
// Usage : node academy-deployer.cjs <fichier assemblé .php> <sauvegarde .php à restaurer en cas d'échec>
const fs = require('fs');
const wp = require('C:/Users/PC/OneDrive/Desktop/sauvegarde Octobre 2026/Téléchargement/jarvis-starter-kit/jarvis-starter-kit/livrables/sites-web/neomoov-site-wordpress/outils/wp.js');
const [fichier, sauvegarde] = process.argv.slice(2);
const sansOuverture = (s) => s.replace(/^﻿/, '').replace(/^<\?php\s*/, '');
const ROUTES = ['', 'rentabilite/', 'service/', 'demarrer/', 'entreprise/', 'inscription/', 'membre/', 'formation/', 'booster/', 'attestation/', 'attestation/?code=NCP-AAAA-AAAA', 'ressources/', 'passagers/', 'confidentialite/'];

async function controler() {
  const s = (await wp.api('GET', '/code-snippets/v1/snippets/6')).json;
  if (!s.active) return ['extrait 6 désactivé'];
  const ecarts = [];
  for (const r of ROUTES) {
    const res = await fetch(`https://neomoov.net/academy/${r}${r.includes('?') ? '&' : '?'}verif=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    const html = await res.text();
    if (res.status !== 200) ecarts.push(`/academy/${r} : HTTP ${res.status}`);
    else if (/Fatal error|Parse error|Warning:|Notice:|erreur critique|critical error/i.test(html)) ecarts.push(`/academy/${r} : erreur PHP visible`);
    else if (!/<\/html>\s*$/i.test(html.trim())) ecarts.push(`/academy/${r} : page tronquée`);
  }
  return ecarts;
}
async function poser(code) {
  await wp.api('POST', '/code-snippets/v1/snippets/6', { code, active: true });
}
// Le cache du serveur LWS garde les pages publiques longtemps : on le vide (route réservée aux administrateurs),
// puis on vérifie que chaque page publique, demandée sans paramètre, est bien recalculée.
async function viderCache() {
  const r = await wp.api('POST', '/neomoov-academy/v1/cache/purge', {});
  const purge = r.json && r.json.purge;
  if (!purge) { console.log('vidage du cache : route indisponible (ancienne version ?)'); return; }
  const refus = Object.entries(purge).filter(([, code]) => code !== 200);
  console.log(`vidage du cache : ${Object.keys(purge).length} pages${refus.length ? `, réponses inattendues : ${refus.map(([p, c]) => `${p} ${c}`).join(', ')}` : ', toutes acceptées'}`);
  const fraiches = [];
  for (const p of Object.keys(purge)) {
    const res = await fetch(`https://neomoov.net${p}`);
    await res.text();
    fraiches.push(`${p} ${res.headers.get('x-cache-status') || '?'}`);
  }
  console.log(`après vidage : ${fraiches.join(' ; ')}`);
}
(async () => {
  const nouveau = sansOuverture(fs.readFileSync(fichier, 'utf8'));
  const ancien = sansOuverture(fs.readFileSync(sauvegarde, 'utf8'));
  await poser(nouveau);
  const enLigne = (await wp.api('GET', '/code-snippets/v1/snippets/6')).json;
  console.log(`déployé : ${enLigne.code.length} caractères, actif : ${enLigne.active}`);
  const ecarts = await controler();
  if (ecarts.length) {
    console.log(`ÉCARTS : ${ecarts.join(' ; ')} -> restauration de la sauvegarde`);
    await poser(ancien);
    const apres = await controler();
    console.log(apres.length ? `ATTENTION, après restauration : ${apres.join(' ; ')}` : 'sauvegarde restaurée, routes saines');
    process.exit(1);
  }
  console.log('routes saines (HTTP 200, aucune erreur PHP, pages complètes)');
  await viderCache();
})().catch((e) => { console.log('erreur :', e.message.slice(0, 300)); process.exit(1); });
