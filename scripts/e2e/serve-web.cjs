// Serveur statique minimal pour un export web d'Expo Router (démonstrations et parcours e2e en local). Résout les
// groupes de routes (`(tabs)/home.html` pour `/home`) et les segments dynamiques (`ride/[id].html` pour `/ride/abc`).
// Usage : node scripts/e2e/serve-web.cjs <dossier de l'export> [port, défaut 8081]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 8081);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

const isFile = (file) => file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile();

/** Fichier HTML d'une route : exact, dans un groupe `(nom)`, ou page dynamique `[param].html` du dossier parent. */
function routeFile(dir, segments) {
  if (!segments.length) return isFile(path.join(dir, 'index.html')) ? path.join(dir, 'index.html') : null;
  const [head, ...rest] = segments;
  if (!rest.length) {
    for (const candidate of [`${head}.html`, path.join(head, 'index.html')]) if (isFile(path.join(dir, candidate))) return path.join(dir, candidate);
  } else if (fs.existsSync(path.join(dir, head)) && fs.statSync(path.join(dir, head)).isDirectory()) {
    const found = routeFile(path.join(dir, head), rest);
    if (found) return found;
  }
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const group of entries.filter((e) => /^\(.+\)$/.test(e))) {
    const found = routeFile(path.join(dir, group), segments);
    if (found) return found;
  }
  const dynamicFile = entries.find((e) => /^\[.+\]\.html$/.test(e));
  if (!rest.length && dynamicFile) return path.join(dir, dynamicFile);
  const dynamicDir = entries.find((e) => /^\[.+\]$/.test(e) && fs.statSync(path.join(dir, e)).isDirectory());
  return dynamicDir ? routeFile(path.join(dir, dynamicDir), rest) : null;
}

function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\/+$/, '') || '/';
  const direct = path.join(root, clean);
  if (isFile(direct)) return direct;
  return routeFile(root, clean.split('/').filter(Boolean)) ?? path.join(root, 'index.html');
}

http.createServer((req, res) => {
  const file = resolve(req.url || '/');
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`web sur http://localhost:${port}`));
