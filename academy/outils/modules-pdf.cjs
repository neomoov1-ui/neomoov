// Retranscription texte des 7 modules CAP CHAUFFEUR : une page HTML imprimable par module et un guide complet,
// convertis en PDF par Edge sans interface. Source : livraison/formation/data.json (comme le site).
// Les PDF sont réservés aux acheteurs (licence individuelle) : ne pas les publier sur une adresse publique.
// Usage : node academy/outils/modules-pdf.cjs   (sortie : academy/livraison/formation/pdf/)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', 'livraison', 'formation');
const out = path.join(root, 'pdf');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8').replace(/^\uFEFF/, ''));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const titre = (l) => l.title.replace(/^\d+\.\s*/, '');

// Même règle que le site : paragraphes séparés par une ligne vide, listes en lignes « - ».
function rich(text) {
  let html = '';
  for (const block of String(text).trim().split(/\n{2,}/)) {
    let list = '';
    let para = [];
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('- ')) {
        if (para.length) { html += `<p>${esc(para.join(' '))}</p>`; para = []; }
        list += `<li>${esc(line.slice(2))}</li>`;
      } else {
        if (list) { html += `<ul>${list}</ul>`; list = ''; }
        para.push(line);
      }
    }
    if (para.length) html += `<p>${esc(para.join(' '))}</p>`;
    if (list) html += `<ul>${list}</ul>`;
  }
  return html;
}

const css = `@page{size:A4;margin:16mm 16mm 18mm}*{box-sizing:border-box}body{margin:0;font:10.6pt/1.55 Arial,Helvetica,sans-serif;color:#0a2431}
header{border-bottom:3px solid #c4f45c;padding-bottom:10pt;margin-bottom:14pt}.brand{font-size:20pt;font-weight:800;letter-spacing:-.6pt}.brand span{display:block;font-size:7pt;letter-spacing:3pt;margin-top:2pt}
.eyebrow{font-size:8pt;font-weight:800;letter-spacing:1.5pt;text-transform:uppercase;color:#506671;margin:12pt 0 4pt}h1{font-size:22pt;line-height:1.12;margin:0 0 10pt;letter-spacing:-.5pt}
h2{font-size:13.5pt;margin:16pt 0 6pt;break-after:avoid}.lead{font-size:11.5pt;color:#2d4652}ul{padding-left:16pt;margin:0 0 8pt}li{margin:3pt 0}p{margin:0 0 7pt}
.box{background:#edf3f1;border-left:3pt solid #5c8413;padding:9pt 12pt;margin:12pt 0;break-inside:avoid}.box h2{margin-top:0}.quiz ol{padding-left:16pt}.quiz li{margin-bottom:6pt}.quiz ul{list-style:none;padding-left:10pt}.quiz ul li::before{content:'○  '}
.sources{font-size:9pt}.sources a{color:#0a2431}.small{font-size:8.5pt;color:#506671}.module{break-before:page}.module:first-of-type{break-before:auto}
footer{margin-top:16pt;border-top:1px solid #ccd7dc;padding-top:6pt;font-size:8pt;color:#506671}.toc li{margin:4pt 0}`;

const licence = 'Document réservé à l’acheteur de CAP CHAUFFEUR (licence individuelle) : usage personnel, pas de revente, de publication ni de diffusion à une équipe. Formation complémentaire : aucun permis, aucune certification, aucun revenu garanti.';

function moduleHtml(l, n) {
  return `<section class="module"><p class="eyebrow">Module ${n} sur ${data.lessons.length}</p><h1>${esc(titre(l))}</h1><p class="lead">${esc(l.intro)}</p>
${l.sections.map((s) => `<h2>${esc(s.title)}</h2>${rich(s.text)}`).join('\n')}
<div class="box"><h2>Exercice</h2>${rich(l.exercise)}<p><b>Corrigé.</b></p>${rich(l.answer)}</div>
<div class="box quiz"><h2>Quiz du module (à valider en ligne)</h2><ol>${l.quiz.map((q) => `<li>${esc(q.q)}<ul>${q.choices.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></li>`).join('')}</ol>
<p class="small">Répondez dans votre espace membre (neomoov.net/academy/formation/) : 4 bonnes réponses sur 5 valident le module et comptent pour l’attestation de suivi.</p></div>
<h2>Sources officielles</h2><ul class="sources">${l.sources.map((s) => `<li>${esc(s.label)} : <a href="${esc(s.url)}">${esc(s.url)}</a></li>`).join('')}</ul></section>`;
}

function page(title, body) {
  return `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>
<header><div class="brand">neomoov<span>ACADEMY</span></div><p class="small">CAP CHAUFFEUR · Édition écrite du 1er octobre 2026</p></header>
${body}<footer>${esc(licence)} © 2026 Neomoov Academy, marque de GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC., Montréal.</footer></body></html>`;
}

function toPdf(htmlFile, pdfFile) {
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(require('os').tmpdir(), 'edge-pdf-nma')}`, '--no-pdf-header-footer', `--print-to-pdf=${pdfFile}`, 'file:///' + htmlFile.replace(/\\/g, '/')], { stdio: 'ignore' });
}

fs.mkdirSync(path.join(out, 'html'), { recursive: true });
const made = [];
data.lessons.forEach((l, i) => {
  const base = `CAP-CHAUFFEUR-module-${i + 1}-${l.id}`;
  const html = path.join(out, 'html', base + '.html');
  fs.writeFileSync(html, page(`Module ${i + 1} — ${titre(l)} | CAP CHAUFFEUR`, moduleHtml(l, i + 1)));
  const pdf = path.join(out, base + '.pdf');
  toPdf(html, pdf);
  made.push(pdf);
});
const toc = `<p class="eyebrow">Guide complet</p><h1>CAP CHAUFFEUR : les 7 modules</h1><p class="lead">Retranscription texte de la formation : chaque module, son exercice corrigé, ses questions de quiz et ses sources officielles.</p><ol class="toc">${data.lessons.map((l) => `<li>${esc(titre(l))}</li>`).join('')}</ol>`;
const guideHtml = path.join(out, 'html', 'CAP-CHAUFFEUR-guide-complet.html');
fs.writeFileSync(guideHtml, page('CAP CHAUFFEUR — guide complet', toc + data.lessons.map((l, i) => moduleHtml(l, i + 1)).join('\n')));
const guide = path.join(out, 'CAP-CHAUFFEUR-guide-complet.pdf');
toPdf(guideHtml, guide);
made.push(guide);
for (const f of made) {
  const size = fs.existsSync(f) ? fs.statSync(f).size : 0;
  console.log(`${path.basename(f)} : ${size ? Math.round(size / 1024) + ' Ko' : 'ABSENT'}`);
}
