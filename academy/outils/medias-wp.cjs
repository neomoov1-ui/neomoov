// Téléverse les médias des modules (narration MP3, vidéo MP4 si présente, PDF) dans la médiathèque WordPress sous des
// noms non devinables, puis inscrit leurs adresses dans data.json (`media` de chaque module, `guide` global).
// Rejouable : un média déjà présent (même titre) est réutilisé. Les fichiers restent hors du dépôt (contenu payant).
// Usage : node academy/outils/medias-wp.cjs <dossier des MP3> [dossier des MP4]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wp = require('C:/Users/PC/OneDrive/Desktop/sauvegarde Octobre 2026/Téléchargement/jarvis-starter-kit/jarvis-starter-kit/livrables/sites-web/neomoov-site-wordpress/outils/wp.js');
const [audioDir, videoDir] = process.argv.slice(2);
if (!audioDir) { console.log('usage : node medias-wp.cjs <dossier MP3> [dossier MP4]'); process.exit(2); }
const root = path.join(__dirname, '..', 'livraison', 'formation');
const dataFile = path.join(root, 'media.json'); // hors d\u00E9p\u00F4t (contenu payant) ; fusionn\u00E9 par build-export.cjs
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8').replace(/^\uFEFF/, ''));
const stored = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : { guide: '', lessons: {} };
for (const l of data.lessons) l.media = (stored.lessons && stored.lessons[l.id]) || {};
data.guide = stored.guide || '';
const tmp = path.join(require('os').tmpdir(), 'ncp-medias');
fs.mkdirSync(tmp, { recursive: true });
const suffix = (seed) => crypto.createHash('sha256').update('neomoov-chauffeur-pro:' + seed).digest('hex').slice(0, 6);

async function ensure(title, source) {
  const found = (await wp.api('GET', `/wp/v2/media?search=${encodeURIComponent(title)}&per_page=5&_fields=id,title,source_url`)).json.find((m) => m.title.rendered === title);
  if (found) return found.source_url;
  const name = `${title}-${suffix(title)}${path.extname(source)}`;
  const copy = path.join(tmp, name);
  fs.copyFileSync(source, copy);
  const up = await wp.televerser(copy, { titre: title });
  const id = up.id || (up.json && up.json.id);
  await wp.api('POST', `/wp/v2/media/${id}`, { title });
  const m = (await wp.api('GET', `/wp/v2/media/${id}?_fields=id,source_url,media_details`)).json;
  console.log(`${title} : média ${m.id}, ${(m.media_details.filesize / 1048576).toFixed(1)} Mo`);
  return m.source_url;
}
(async () => {
  for (let n = 1; n <= data.lessons.length; n++) {
    const lesson = data.lessons[n - 1];
    lesson.media = lesson.media || {};
    const mp3 = path.join(audioDir, `m${n}.mp3`);
    if (fs.existsSync(mp3)) lesson.media.audio = await ensure(`ncp-module-${n}-audio`, mp3);
    const pdf = fs.readdirSync(path.join(root, 'pdf')).find((f) => f.startsWith(`Neomoov-Chauffeur-Pro-module-${n}-`) && f.endsWith('.pdf'));
    if (pdf) lesson.media.pdf = await ensure(`ncp-module-${n}-pdf`, path.join(root, 'pdf', pdf));
    const mp4 = videoDir ? path.join(videoDir, `m${n}.mp4`) : '';
    if (mp4 && fs.existsSync(mp4)) lesson.media.video = await ensure(`ncp-module-${n}-video`, mp4);
  }
  const guide = path.join(root, 'pdf', 'Neomoov-Chauffeur-Pro-guide-complet.pdf');
  if (fs.existsSync(guide)) data.guide = await ensure('ncp-guide-complet-pdf', guide);
  fs.writeFileSync(dataFile, JSON.stringify({ guide: data.guide, lessons: Object.fromEntries(data.lessons.map((l) => [l.id, l.media])) }, null, 2) + '\n');
  console.log('media.json : médias inscrits (' + data.lessons.map((l) => Object.keys(l.media || {}).join('+')).join(' | ') + ')');
})().catch((e) => { console.log('erreur :', e.message.slice(0, 300)); process.exit(1); });
