// Zero-dependency dev server: serves ./public and proxies
//   /api/*  -> local hathor-wallet-headless (:8000)
//   /node/* -> public playground fullnode API
const http = require('http');
const fs = require('fs');
const path = require('path');

const WALLET = 'http://localhost:8000';
const NODE = 'https://node1.playground.testnet.hathor.network/v1a';
const PUB = path.join(__dirname, 'public');
const PORT = 8090;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

async function proxy(req, res, target) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const headers = {};
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['x-wallet-id']) headers['x-wallet-id'] = req.headers['x-wallet-id'];
  const r = await fetch(target, {
    method: req.method,
    headers,
    body: body.length ? body : undefined,
  });
  const buf = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
  res.end(buf);
}

http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) return await proxy(req, res, WALLET + req.url.slice(4));
    if (req.url.startsWith('/node/')) return await proxy(req, res, NODE + req.url.slice(5));
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.normalize(path.join(PUB, p));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e) }));
  }
}).listen(PORT, () => console.log(`hathor-gacha frontend on http://localhost:${PORT}`));
