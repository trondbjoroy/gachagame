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
const NODE = process.env.NODE_URL || 'https://node1.testnet.hathor.network/v1a';
const PUB = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';

const WALLET_ID = 'player';
const NC = '00599b4b1e879ee1437b828926b7d5a11ac5c5ca094e25e77094420c8b3c9258';
const MKT_NC = process.env.MARKET_NC || '0033955d297d8460c9a839d242537e71d8fed7c92880305d0c8312055bf5c48b';
const GEMS = 'd99c0aae27eae400cd7eac85eed44064dfedafb47800a481ce90c3c01b0dbd15';
const MAX_DEPOSIT = 100;    // HTR cents; the contract enforces the exact pull price
const MAX_GEMS = 100_000;   // gems-cents per single ledger move
const MAX_HTR = 100_000;    // HTR cents cap for market prices/withdrawals
const HEX64 = /^[0-9a-f]{64}$/;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg',
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
// per-method spec: expected actions and arg validators
const cardDep = a => a.type === 'deposit' && HEX64.test(a.token || '') && a.token !== GEMS && a.amount === 100;
const cardWd = a => a.type === 'withdrawal' && HEX64.test(a.token || '') && a.token !== GEMS && a.amount === 100 && a.address === playerAddress;
const htrDep = a => a.type === 'deposit' && a.token === '00'
  && Number.isInteger(a.amount) && a.amount > 0 && a.amount <= MAX_DEPOSIT;
const gemsAmt = a => Number.isInteger(a.amount) && a.amount > 0 && a.amount <= MAX_GEMS;
const gemsDep = a => a.type === 'deposit' && a.token === GEMS && gemsAmt(a);
const gemsWd = a => a.type === 'withdrawal' && a.token === GEMS && gemsAmt(a) && a.address === playerAddress;
const htrWd = a => a.type === 'withdrawal' && a.token === '00'
  && Number.isInteger(a.amount) && a.amount > 0 && a.amount <= MAX_HTR && a.address === playerAddress;
const isHex64 = v => typeof v === 'string' && HEX64.test(v);
const isSmallInt = v => Number.isInteger(v) && v >= 0 && v <= MAX_GEMS;

const marketHtrDep = a => a.type === 'deposit' && a.token === '00'
  && Number.isInteger(a.amount) && a.amount > 0 && a.amount <= MAX_HTR;
const MKT_METHODS = {
  list_card:      { actions: [cardDep],      args: [v => Number.isInteger(v) && v > 0 && v <= MAX_HTR] },
  buy:            { actions: [marketHtrDep], args: [isSmallInt] },
  cancel_listing: { actions: [],         args: [isSmallInt] },
  offer_swap:     { actions: [cardDep],  args: [isHex64] },
  accept_swap:    { actions: [cardDep],  args: [isSmallInt] },
  cancel_swap:    { actions: [],         args: [isSmallInt] },
  claim_card:     { actions: [cardWd],   args: [] },
  withdraw_funds: { actions: [a => a.type === 'withdrawal' && a.token === '00' && Number.isInteger(a.amount) && a.amount > 0 && a.amount <= MAX_HTR && a.address === playerAddress], args: [] },
};

const METHODS = {
  pull:          { actions: [htrDep],          args: [] },
  claim_card:    { actions: [cardWd],          args: [] },
  stake:         { actions: [cardDep],         args: [] },
  unstake:       { actions: [cardWd],          args: [] },
  claim_gems:    { actions: [],                args: [isHex64] },
  withdraw_gems: { actions: [gemsWd],          args: [] },
  deposit_gems:  { actions: [gemsDep],         args: [] },
  fuse:          { actions: [cardDep, cardDep], args: [] },
  create_duel:   { actions: [cardDep],         args: [isSmallInt] },
  accept_duel:   { actions: [cardDep],         args: [isSmallInt] },
  cancel_duel:   { actions: [],                args: [isSmallInt] },
  temper:        { actions: [],                args: [isHex64, isSmallInt] },
  claim_favor:   { actions: [htrWd],           args: [] },
};

function validExecute(body) {
  if (!body || typeof body !== 'object') return 'bad body';
  const table = body.nc_id === NC ? METHODS : (body.nc_id === MKT_NC ? MKT_METHODS : null);
  if (!table) return 'unknown contract';
  if (!playerAddress) return 'wallet not ready, try again shortly';
  if (body.address !== playerAddress) return 'caller address not allowed';
  const spec = table[body.method];
  if (!spec) return 'method not allowed';
  const data = body.data || {};
  const args = data.args || [];
  const actions = data.actions || [];
  if (args.length !== spec.args.length) return 'bad args';
  for (let i = 0; i < args.length; i++) {
    if (!spec.args[i](args[i])) return 'bad args';
  }
  if (actions.length !== spec.actions.length) return 'bad actions';
  for (let i = 0; i < actions.length; i++) {
    if (typeof actions[i] !== 'object' || !spec.actions[i](actions[i])) return 'bad actions';
  }
  return null;
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

const NODE_PREFIXES = ['/nano_contract/state', '/nano_contract/logs', '/transaction', '/thin_wallet/address_balance'];
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
    const ext = path.extname(f);
    // code must never go stale on players' phones; heavy assets may cache briefly
    const heavy = { '.jpg': 1, '.jpeg': 1, '.png': 1, '.ico': 1, '.mp3': 1, '.svg': 1 };
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': heavy[ext] ? 'public, max-age=3600' : 'no-cache',
    });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    deny(res, 502, String(e));
  }
}).listen(PORT, HOST, () => console.log(`hathor-gacha frontend on http://${HOST}:${PORT}`));
