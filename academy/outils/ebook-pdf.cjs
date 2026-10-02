// Ebook gratuit « Le chauffeur qui compte » : Markdown -> HTML imprimable -> PDF par Edge sans interface.
// Source : academy/livraison/formation/ebook/le-chauffeur-qui-compte.md ; sortie : même dossier (.html et .pdf).
// Le PDF est librement partageable (package gratuit Neomoov) ; il est téléversé dans WordPress par medias-wp.cjs (clé ebook).
// Usage : node academy/outils/ebook-pdf.cjs [chemin du module marked]   (par défaut : cherche « marked » dans le scratchpad)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = path.join(__dirname, '..', 'livraison', 'formation', 'ebook');
const src = path.join(dir, 'le-chauffeur-qui-compte.md');
const markedDir = process.argv[2] || path.join(process.env.LOCALAPPDATA || '', 'Temp', 'claude', 'c--Users-PC-Downloads-jarvis-starter-kit-jarvis-starter-kit', '8213bf08-d4f9-4ecf-a84d-fa485fde4e20', 'scratchpad', 'ebook', 'node_modules', 'marked');
const { marked } = require(markedDir);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const md = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
const body = marked.parse(md, { gfm: true, breaks: false });
const css = `@page{size:A4;margin:18mm 17mm 20mm}*{box-sizing:border-box}body{margin:0;font:11pt/1.6 Georgia,'Times New Roman',serif;color:#0a2431}
h1{font:800 30pt/1.1 Arial,Helvetica,sans-serif;letter-spacing:-.8pt;margin:0 0 10pt;color:#0a2431}h2{font:800 17pt/1.2 Arial,Helvetica,sans-serif;letter-spacing:-.3pt;margin:24pt 0 8pt;break-after:avoid;color:#0a2431}
h3{font:700 12.5pt/1.3 Arial,Helvetica,sans-serif;margin:14pt 0 6pt;break-after:avoid}p{margin:0 0 8pt}ul,ol{margin:0 0 10pt;padding-left:18pt}li{margin:4pt 0}
a{color:#0a2431}hr{border:0;border-top:1px solid #ccd7dc;margin:18pt 0}blockquote{margin:12pt 0;padding:10pt 14pt;background:#edf5df;border-left:4pt solid #5c8413;break-inside:avoid}blockquote p{margin:0}
table{border-collapse:collapse;margin:8pt 0 12pt;font-size:10pt}th,td{border:1px solid #ccd7dc;padding:5pt 8pt;text-align:left}th{background:#edf3f1}
em{color:#405c68}body>p:first-child{font:9pt Arial,Helvetica,sans-serif;color:#506671;border-bottom:3px solid #c4f45c;padding-bottom:8pt;margin-bottom:28pt}
h2:nth-of-type(n+3){break-before:page}h2+h3{margin-top:0}
.cover{text-align:left;padding:40pt 0 30pt}.cover .brand{font:800 26pt/1 Arial,Helvetica,sans-serif;letter-spacing:-1pt}.cover .brand span{display:block;font-size:8pt;letter-spacing:4pt;margin-top:4pt}
footer{position:fixed;bottom:-12mm;left:0;right:0;font:8pt Arial,Helvetica,sans-serif;color:#506671;text-align:center}`;
const html = `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><title>Le chauffeur qui compte · Neomoov Academy</title><style>${css}</style></head><body>${body}
<footer>Le chauffeur qui compte · Neomoov Academy · neomoov.net/academy · Neomoov Chauffeur Pro · Neomoov Booster · reserver.neomoov.net</footer></body></html>`;
const htmlFile = path.join(dir, 'le-chauffeur-qui-compte.html');
const pdfFile = path.join(dir, 'Neomoov-Le-chauffeur-qui-compte.pdf');
fs.writeFileSync(htmlFile, html);
if (fs.existsSync(pdfFile)) fs.unlinkSync(pdfFile);
const profile = path.join(require('os').tmpdir(), 'edge-ebook-' + Date.now());
execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${profile}`, '--no-pdf-header-footer', `--print-to-pdf=${pdfFile}`, 'file:///' + htmlFile.replace(/\\/g, '/')], { timeout: 120000, stdio: 'ignore' });
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(`${path.basename(pdfFile)} : ${(fs.statSync(pdfFile).size / 1024).toFixed(0)} Ko ; ${md.split(/\s+/).length} mots`);
