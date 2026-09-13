/* server.js — running journal.jack as an ordinary Node process.
 *
 * Serves the client out of public/ and hands every /api/* request to router.js,
 * the same router the serverless build uses. Storage comes from store.js, which
 * uses SQLite and the local disk unless DATABASE_URL says otherwise.
 *
 * Run:  node server.js   ->  http://localhost:5173
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { api, json } = require('./router');

const PORT = process.env.PORT || 5173;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => json(res, 500, { error: e.message }));
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);

  // everything servable now lives in public/, so nothing outside it can leak
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`journal.jack  ->  http://localhost:${PORT}`);
  console.log(process.env.DATABASE_URL
    ? 'storage: Postgres + blob store'
    : 'storage: ./data (SQLite and files on this machine)');
});
