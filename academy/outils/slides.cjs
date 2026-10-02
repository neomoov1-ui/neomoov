// Diapositives des vidéos narrées : une image 1280×720 par séquence (introduction, sections, exercice, conclusion),
// rendue par Edge sans interface, plus la liste de montage (durées lues dans durees.json) pour ffmpeg.
// Usage : node academy/outils/slides.cjs <durees.json>   (sortie : academy/livraison/formation/video/mN/NN.png + liste.txt)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', 'livraison', 'formation');
const out = path.join(root, 'video');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8').replace(/^\uFEFF/, ''));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'audio', 'manifest.json'), 'utf8'));
const durees = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SILENCE = 0.9;

/* Points clés : première phrase de chaque paragraphe ou élément de liste, au plus quatre, courts. */
function keyPoints(text, max = 4) {
  const blocks = String(text).split(/\n+/).map((b) => b.replace(/^-\s*/, '').trim()).filter(Boolean);
  const points = [];
  for (const b of blocks) {
    const first = b.split(/(?<=[.!?])\s+/)[0].trim();
    if (first.length >= 12) points.push(first.length > 150 ? first.slice(0, 147).replace(/\s+\S*$/, '') + '…' : first);
    if (points.length >= max) break;
  }
  return points;
}
function slideHtml({ module, moduleTitle, kind, title, points, index, total }) {
  const kicker = kind === 'intro' ? `Module ${module} sur 7` : kind === 'exercise' ? 'Exercice' : kind === 'outro' ? 'Quiz et attestation' : `Module ${module} · ${index} / ${total}`;
  const main = kind === 'intro' ? `<h1>${esc(moduleTitle)}</h1>` : `<p class="module">${esc(moduleTitle)}</p><h1>${esc(title)}</h1>`;
  const list = points.length ? `<ul>${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  return `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;overflow:hidden}body{font:28px/1.4 "Segoe UI",Arial,sans-serif;color:#fff;background:linear-gradient(135deg,#0a2431 0%,#10171f 60%,#163541 100%);position:relative}
.top{position:absolute;top:36px;left:60px;right:60px;display:flex;justify-content:space-between;align-items:center}.brand{font-size:34px;font-weight:800;letter-spacing:-1px}.brand span{font-size:13px;letter-spacing:5px;margin-left:10px;font-weight:700;color:#c4f45c}
.kicker{font-size:16px;letter-spacing:3px;text-transform:uppercase;color:#c4f45c;font-weight:700}.body{position:absolute;top:130px;left:60px;right:60px;bottom:70px}
.module{font-size:20px;color:#9fb3bd;margin:0 0 10px;letter-spacing:1px;text-transform:uppercase}h1{font-size:${kind === 'intro' ? 56 : 44}px;line-height:1.12;margin:0 0 28px;letter-spacing:-1px;max-width:1100px}
ul{list-style:none;padding:0;margin:0;max-width:1120px}li{position:relative;padding-left:42px;margin:0 0 18px;font-size:30px;line-height:1.35}li:before{content:"";position:absolute;left:0;top:14px;width:18px;height:18px;border-radius:50%;background:#c4f45c}
.foot{position:absolute;bottom:28px;left:60px;right:60px;display:flex;justify-content:space-between;font-size:16px;color:#9fb3bd}.bar{position:absolute;bottom:0;left:0;height:8px;background:#c4f45c;width:${Math.round((index / total) * 100)}%}
</style></head><body><div class="top"><div class="brand">neomoov<span>ACADEMY</span></div><div class="kicker">${esc(kicker)}</div></div><div class="body">${main}${list}</div><div class="foot"><span>Neomoov Chauffeur Pro · formation complémentaire</span><span>neomoov.net/academy</span></div><div class="bar"></div></body></html>`;
}
fs.mkdirSync(out, { recursive: true });
let made = 0;
for (const m of manifest) {
  const lesson = data.lessons[m.module - 1];
  const dir = path.join(out, `m${m.module}`);
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  m.parts.forEach((p, i) => {
    const n = p.file.replace('.txt', '');
    let points = [];
    if (p.kind === 'intro') points = keyPoints(lesson.intro, 3);
    else if (p.kind === 'section') points = keyPoints((lesson.sections.find((s) => s.title === p.title) || {}).text || '', 4);
    else if (p.kind === 'exercise') points = [...keyPoints(lesson.exercise, 2), 'Réfléchissez, puis écoutez le corrigé.'];
    else points = ['Répondez au quiz dans votre espace membre : 4 bonnes réponses sur 5.', 'Les 7 modules réussis donnent droit à votre attestation de suivi.', 'neomoov.net/academy'];
    const html = path.join(dir, `${n}.html`);
    fs.writeFileSync(html, slideHtml({ module: m.module, moduleTitle: m.title, kind: p.kind, title: p.title, points, index: i + 1, total: m.parts.length }));
    const png = path.join(dir, `${n}.png`);
    execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${path.join(require('os').tmpdir(), 'edge-slides')}`, '--window-size=1280,720', `--screenshot=${png}`, 'file:///' + html.replace(/\\/g, '/')], { stdio: 'ignore' });
    if (!fs.existsSync(png)) throw Error(`diapositive manquante : ${png}`);
    const d = durees[`m${m.module}/${n}`];
    if (typeof d !== 'number') throw Error(`durée manquante : m${m.module}/${n}`);
    list.push(`file '${n}.png'`, `duration ${(d + SILENCE).toFixed(3)}`);
    made++;
  });
  const last = m.parts[m.parts.length - 1].file.replace('.txt', '');
  list.push(`file '${last}.png'`); // dernière image répétée (exigence du démultiplexeur concat)
  fs.writeFileSync(path.join(dir, 'liste.txt'), list.join('\n') + '\n');
}
console.log(`${made} diapositives dans ${out}`);
