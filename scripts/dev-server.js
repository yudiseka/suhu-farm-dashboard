'use strict';

// Server lokal untuk tes: static file + /api/state tanpa Vercel.
// Jalankan: LOCAL_STATE=1 FARM_API_KEY=tes123 node scripts/dev-server.js 8787

const http = require('http');
const fs = require('fs');
const path = require('path');
const stateHandler = require('../api/state');
const bmkgHandler = require('../api/bmkg');

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      req.body = raw;
      stateHandler(req, res).catch((e) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      });
    });
    return;
  }
  if (url.pathname === '/api/bmkg') {
    bmkgHandler(req, res).catch((e) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    });
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`dev server http://localhost:${PORT}`));
