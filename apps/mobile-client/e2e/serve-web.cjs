// Serveur statique minimal pour l'export web d'Expo Router (démonstration et parcours e2e en local).
// Usage : node e2e/serve-web.cjs <dossier de l'export> [port, défaut 8081]
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 8081);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\/+$/, '') || '/';
  const candidates = [clean, `${clean}.html`, path.join(clean, 'index.html')];
  if (/^\/ride\/[^/]+$/.test(clean)) candidates.push('/ride/[id].html');
  if (/^\/book$/.test(clean)) candidates.unshift('/(tabs)/book.html');
  for (const c of candidates) {
    const file = path.join(root, c);
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return path.join(root, 'index.html');
}
http.createServer((req, res) => {
  const file = resolve(req.url || '/');
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`web sur http://localhost:${port}`));
