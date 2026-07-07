// Hardened dev/prod server: serves ./public and proxies a strict
// allowlist of endpoints to wallet-headless and the playground fullnode.
//
// The wallet-headless instance holds a shared custodial demo wallet, so
// the proxy only permits:
//   GET  /api/wallet/address?index=0
//   GET  /api/wallet/balance[?token=<64-hex>]
//   POST /api/wallet/nano-contracts/execute   (pull/claim on OUR contract,
//        caller and withdrawal addresses forced to the shared wallet)
//   GET  /node/nano_contract/state|logs, /node/transaction
// Everything else is rejected. Per-IP rate limits apply.
const http = require('http');
const fs = require('fs');
const path = require('path');

const WALLET = process.env.WALLET_URL || 'http://localhost:8000';
const NODE = process.env.NODE_URL || 'https://node1.playground.testnet.hathor.network/v1a';
const PUB = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';

const WALLET_ID = 'player';
const NC = '00afd03115df73ad6aee7c168284144702a70e5d8e2acd820591d36fb76e05fb';
const MAX_DEPOSIT = 100; // cents; the contract enforces the exact pull price
const HEX64 = /^[0-9a-f]{64}$/;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

// ---- shared wallet address (callers/claims are pinned to it) ----
let playerAddress = null;
async function refreshPlayerAddress() {
  try {
    const r = await fetch(`${WALLET}/wallet/address?index=0`, { headers: { 'x-wallet-id': WALLET_ID } });
    const d = await r.json();
    if (d.address) playerAddress = d.address;
  } catch { /* wallet not up yet; retried below */ }
}
refreshPlayerAddress();
setInterval(refreshPlayerAddress, 30_000);

// ---- naive per-IP rate limiting (fixed 60s window) ----
const buckets = new Map();
function rateLimited(ip, kind) {
  const limit = kind === 'tx' ? 6 : 90;
  const now = Date.now();
  const key = `${ip}:${kind}`;
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + 60_000 }; buckets.set(key, b); }
  b.count += 1;
  if (buckets.size > 10_000) buckets.clear(); // crude memory cap
  return b.count > limit;
}

function deny(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: msg }));
}

// ---- execute-body validation ----
function validExecute(body) {
  if (!body || typeof body !== 'object') return 'bad body';
  if (body.nc_id !== NC) return 'unknown contract';
  if (!playerAddress) return 'wallet not ready, try again shortly';
  if (body.address !== playerAddress) return 'caller address not allowed';
  const data = body.data || {};
  const args = data.args || [];
  const actions = data.actions || [];
  if (args.length !== 0) return 'args not allowed';
  if (actions.length !== 1) return 'exactly one action required';
  const a = actions[0];
  if (body.method === 'pull') {
    if (a.type !== 'deposit' || a.token !== '00') return 'pull needs an HTR deposit';
    if (!Number.isInteger(a.amount) || a.amount <= 0 || a.amount > MAX_DEPOSIT) return 'bad amount';
    return null;
  }
  if (body.method === 'claim') {
    if (a.type !== 'withdrawal' || !HEX64.test(a.token || '')) return 'claim needs a token withdrawal';
    if (a.amount !== 1) return 'bad amount';
    if (a.address !== playerAddress) return 'withdrawal address not allowed';
    return null;
  }
  return 'method not allowed';
}

async function forward(res, target, opts) {
  const r = await fetch(target, opts);
  const buf = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
  res.end(buf);
}

async function handleApi(req, res, ip) {
  const url = new URL(req.url.slice(4), 'http://x');
  const q = url.searchParams;

  if (req.method === 'GET' && url.pathname === '/wallet/address') {
    if (q.get('index') !== '0' || [...q.keys()].length !== 1) return deny(res, 403, 'forbidden');
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    return forward(res, `${WALLET}${url.pathname}${url.search}`, { headers: { 'x-wallet-id': WALLET_ID } });
  }

  if (req.method === 'GET' && url.pathname === '/wallet/balance') {
    const keys = [...q.keys()];
    const ok = keys.length === 0 || (keys.length === 1 && HEX64.test(q.get('token') || ''));
    if (!ok) return deny(res, 403, 'forbidden');
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    return forward(res, `${WALLET}${url.pathname}${url.search}`, { headers: { 'x-wallet-id': WALLET_ID } });
  }

  if (req.method === 'POST' && url.pathname === '/wallet/nano-contracts/execute') {
    if (rateLimited(ip, 'tx')) return deny(res, 429, 'rate limited');
    const chunks = [];
    for await (const c of req) { chunks.push(c); if (Buffer.concat(chunks).length > 8192) return deny(res, 413, 'too large'); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks)); } catch { return deny(res, 400, 'bad json'); }
    const err = validExecute(body);
    if (err) return deny(res, 403, err);
    return forward(res, `${WALLET}/wallet/nano-contracts/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wallet-id': WALLET_ID },
      body: JSON.stringify(body),
    });
  }

  return deny(res, 403, 'forbidden');
}

const NODE_PREFIXES = ['/nano_contract/state', '/nano_contract/logs', '/transaction'];
async function handleNode(req, res, ip) {
  if (req.method !== 'GET') return deny(res, 403, 'forbidden');
  const rest = req.url.slice(5);
  if (!NODE_PREFIXES.some(p => rest.startsWith(p))) return deny(res, 403, 'forbidden');
  if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
  return forward(res, NODE + rest);
}

http.createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  try {
    if (req.url.startsWith('/api/')) return await handleApi(req, res, ip);
    if (req.url.startsWith('/node/')) return await handleNode(req, res, ip);
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.normalize(path.join(PUB, p));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    deny(res, 502, String(e));
  }
}).listen(PORT, HOST, () => console.log(`hathor-gacha frontend on http://${HOST}:${PORT}`));
