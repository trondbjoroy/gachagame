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
const crypto = require('crypto');

const WALLET = process.env.WALLET_URL || 'http://localhost:8000';
const NODE = process.env.NODE_URL || 'https://node-partners.testnet.hathor.network/v1a';
const PUB = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';

const WALLET_ID = 'player';
const NC = '0082579ce4e9f6726650048ef90f02034f442d65b443b55d1f64b5de90e7a587';
const MKT_NC = process.env.MARKET_NC || '0033955d297d8460c9a839d242537e71d8fed7c92880305d0c8312055bf5c48b';
const GEMS = 'e05b7b0c7651fabf0424f229abede02fc7d63761a3c48ed2034c557678fd1ef3';
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
  // reads run in parallel bursts since b=56, and the node behind us is ours
  const limit = kind === 'tx' ? 6 : 240;
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
  fight_writ:    { actions: [],                args: [isHex64, isSmallInt, isSmallInt] },
  begin_delve:   { actions: [],                args: [isHex64] },
  claim_delve:   { actions: [],                args: [isHex64] },
  buy_cosmetic:  { actions: [],                args: [isHex64, isSmallInt, isSmallInt] },
};

// ---- realm activity feed: recent contract actions, told plainly ----
// Built from the contract's public history. Outcomes (fight results, delve
// hauls) live in emitted events the public node does not expose, so the feed
// reports deeds, not verdicts.
const FEED_MAX = 60;
let feed = [];            // newest first: {ts, kind, who, ...detail}
const feedSeen = new Set();
let writNames = null;     // writ id -> name, fetched once

function feedPush(ev) {
  feed.unshift(ev);
  if (feed.length > FEED_MAX) feed.length = FEED_MAX;
}

async function loadWritNames() {
  try {
    const qs = [...Array(10).keys()]
      .map(i => 'calls[]=' + encodeURIComponent(`get_writ(${i})`)).join('&');
    const d = await (await fetch(`${NODE}/nano_contract/state?id=${NC}&${qs}`)).json();
    writNames = {};
    for (let i = 0; i < 10; i++) {
      const v = d.calls && d.calls[`get_writ(${i})`] && d.calls[`get_writ(${i})`].value;
      if (v) writNames[i] = v.split('|')[0];
    }
  } catch { writNames = null; } // retried on the next poll
}

function feedEventFor(tx) {
  const who = tx.nc_address;
  const args = tx.nc_args_decoded || [];
  const ts = tx.timestamp;
  switch (tx.nc_method) {
    // contract-minted tokens never appear in the tx's own token list, so
    // pull/fuse card names are filled in afterwards from the balance diff
    case 'pull':
      return { ts, kind: 'pull', who, card: null };
    case 'fuse':
      return { ts, kind: 'fuse', who, card: null };
    case 'fight_writ': {
      const writ = Number(args[1]), tier = Number(args[2]);
      const name = (writNames && writNames[writ]) || `writ ${writ}`;
      return { ts, kind: 'writ', who, writ: name, tier: Number.isFinite(tier) ? tier : 0 };
    }
    case 'create_duel':
      return { ts, kind: 'challenge', who, wager: Number(args[0]) || 0 };
    case 'accept_duel':
      return { ts, kind: 'answer', who, id: Number(args[0]) || 0 };
    case 'begin_delve':
      return { ts, kind: 'delve', who };
    case 'claim_delve':
      return { ts, kind: 'delve_done', who };
    case 'temper':
      return { ts, kind: 'temper', who };
    default:
      return null;
  }
}

let knownUids = null; // contract token set, for spotting freshly minted cards
async function contractUids() {
  const d = await (await fetch(`${NODE}/nano_contract/state?id=${NC}&balances[]=__all__`)).json();
  return new Set(Object.keys(d.balances || {}));
}

async function pollFeed() {
  try {
    if (!writNames) await loadWritNames();
    if (!knownUids) knownUids = await contractUids();
    const d = await (await fetch(`${NODE}/nano_contract/history?id=${NC}&count=30`)).json();
    const fresh = [];
    const touched = new Set();
    for (const tx of d.history || []) {
      if (feedSeen.has(tx.hash) || tx.is_voided) continue;
      feedSeen.add(tx.hash);
      for (const u of touchFromTx(tx)) touched.add(u);
      const ev = feedEventFor(tx);
      if (ev) fresh.push(ev);
    }
    if (touched.size) refreshCards([...touched]).catch(() => {});
    fresh.reverse(); // history is newest-first; process oldest first
    // name the cards minted since the last poll (summons and fusion children)
    const minted = fresh.filter(ev => ev.kind === 'pull' || ev.kind === 'fuse');
    if (minted.length) {
      const now = await contractUids();
      const newUids = [...now].filter(u => !knownUids.has(u));
      knownUids = now;
      if (newUids.length) refreshCards(newUids.filter(u => u !== GEMS)).catch(() => {});
      const qs = newUids.slice(0, 20)
        .map(u => 'calls[]=' + encodeURIComponent(`get_card_name("${u}")`)).join('&');
      let named = {};
      if (qs) {
        const st = await (await fetch(`${NODE}/nano_contract/state?id=${NC}&${qs}`)).json();
        named = st.calls || {};
      }
      const queue = newUids
        .map(u => named[`get_card_name("${u}")`] && named[`get_card_name("${u}")`].value)
        .filter(Boolean);
      for (const ev of minted) ev.card = queue.shift() || null;
    }
    for (const ev of fresh) feedPush(ev);
    if (feedSeen.size > 5000) feedSeen.clear(); // crude memory cap
  } catch { /* the feed is decorative; next poll retries */ }
}
pollFeed();
setInterval(pollFeed, 15_000); // our own node: no shared rate limit to respect

// ---- card-state cache: one request serves what cost clients ~500 view calls ----
// Nano view calls run ~125ms each on the node, so clients reading every card
// per refresh took 10-20s. The server keeps the card map warm instead,
// updating incrementally from the same tx stream the feed watches; clients
// pass ?touch=<uids> after their own tx for instant freshness on those cards.
const OLD_NC = '00599b4b1e879ee1437b828926b7d5a11ac5c5ca094e25e77094420c8b3c9258';
const cardCache = { cards: {}, legacy: [], updatedAt: 0 };
const CARD_VIEWS = ['get_card_name', 'get_card_tier', 'get_card_power',
  'get_card_aspects', 'get_card_wins', 'get_card_cosmetics',
  'get_pending_owner', 'get_staker', 'get_delve_since', 'get_temper_cost'];

async function ncCalls(ncId, calls, concurrency = 8) {
  const chunks = [];
  for (let i = 0; i < calls.length; i += 30) chunks.push(calls.slice(i, i + 30));
  const out = {};
  let idx = 0;
  await Promise.all([...Array(Math.min(concurrency, chunks.length))].map(async () => {
    for (;;) {
      const mine = idx++;
      if (mine >= chunks.length) return;
      const qs = chunks[mine].map(c => 'calls[]=' + encodeURIComponent(c)).join('&');
      const d = await (await fetch(`${NODE}/nano_contract/state?id=${ncId}&${qs}`)).json();
      for (const [k, v] of Object.entries(d.calls || {})) out[k] = v.value;
    }
  }));
  return out;
}

async function refreshCards(uids) {
  if (!uids.length) return;
  const v = await ncCalls(NC, uids.flatMap(u => CARD_VIEWS.map(f => `${f}("${u}")`)));
  const legacySet = new Set(cardCache.legacy);
  const legacyTouched = uids.filter(u => legacySet.has(u));
  const ov = legacyTouched.length
    ? await ncCalls(OLD_NC, legacyTouched.flatMap(u =>
        [`get_staker("${u}")`, `get_pending_owner("${u}")`]))
    : {};
  for (const u of uids) {
    const g = f => v[`${f}("${u}")`];
    if (g('get_card_tier') == null) continue; // unknown to the contract
    cardCache.cards[u] = {
      name: g('get_card_name'), tier: g('get_card_tier'), power: g('get_card_power'),
      aspects: g('get_card_aspects') || null, wins: g('get_card_wins') || 0,
      cosmetics: g('get_card_cosmetics') || 0,
      pending: g('get_pending_owner') ?? null, staker: g('get_staker') ?? null,
      delveSince: g('get_delve_since') || 0, temperCost: g('get_temper_cost') || 0,
      oldStaker: ov[`get_staker("${u}")`] ?? cardCache.cards[u]?.oldStaker ?? null,
      oldPending: ov[`get_pending_owner("${u}")`] ?? cardCache.cards[u]?.oldPending ?? null,
    };
  }
  cardCache.updatedAt = Math.floor(Date.now() / 1000);
}

async function sweepCards() {
  const [cur, old] = await Promise.all([
    (await fetch(`${NODE}/nano_contract/state?id=${NC}&balances[]=__all__`)).json(),
    (await fetch(`${NODE}/nano_contract/state?id=${OLD_NC}&balances[]=__all__`)).json(),
  ]);
  cardCache.legacy = Object.keys(old.balances || {}).filter(u => HEX64.test(u));
  const uids = [...new Set([...Object.keys(cur.balances || {}), ...cardCache.legacy])]
    .filter(u => HEX64.test(u) && u !== GEMS);
  await refreshCards(uids);
  console.log(`card cache: ${Object.keys(cardCache.cards).length} cards`);
}
sweepCards().catch(e => console.error('card sweep failed:', e.message));
setInterval(() => sweepCards().catch(() => {}), 10 * 60_000); // drift safety net

// the feed poller calls this with uids seen in fresh transactions
function touchFromTx(tx) {
  const uids = new Set();
  for (const a of tx.nc_args_decoded || []) {
    if (typeof a === 'string' && HEX64.test(a)) uids.add(a);
  }
  for (const a of (tx.nc_context || {}).actions || []) {
    if (a.token_uid && HEX64.test(a.token_uid) && a.token_uid !== GEMS) uids.add(a.token_uid);
  }
  return [...uids];
}

// ---- banner names: claims live on-chain as data outputs; this is an index ----
// A claim tx's inputs are signed by the claimer, so a tx whose data output
// says "emberfall:name:X" and whose inputs spend from address A proves A
// chose the name X. The server never sees a key: it only reads the chain.
const NAMES_FILE = path.join(__dirname, 'names.json');
const NAME_MAGIC = 'emberfall:name:';
const BEQUEATH_MAGIC = 'emberfall:bequeath:'; // holder hands the name to another address
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_ ]{1,14}[A-Za-z0-9_]$/; // 3-16, no edge spaces
const ADDR_RE = /^[A-Za-z0-9]{30,40}$/;
let names = {};
try { names = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')); } catch { names = {}; }
function saveNames() {
  try { fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 1)); }
  catch (e) { console.error('names.json write failed:', e.message); }
}

// data output script: PUSHDATA <bytes> OP_CHECKSIG
function dataFromScript(b64) {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 3 || buf[buf.length - 1] !== 0xac) return null;
    let off = 1, len = buf[0];
    if (len === 0x4c) { len = buf[1]; off = 2; } // OP_PUSHDATA1
    if (off + len !== buf.length - 1) return null;
    return buf.slice(off, off + len).toString('utf8');
  } catch { return null; }
}

// an address with nothing left on it (a swept session key) is abandoned:
// its name is free for the taking. Active addresses always hold something.
async function addressAbandoned(addr) {
  try {
    const d = await (await fetch(`${NODE}/thin_wallet/address_balance?address=${addr}`)).json();
    for (const t of Object.values(d.tokens_data || {})) {
      if ((t.received || 0) - (t.spent || 0) > 0) return false;
    }
    return true;
  } catch { return false; } // when unsure, the held name stays held
}

// the earliest transaction that paid `addr`: nobody knows a fresh session
// address before its funding, so whoever signed this tx created the address
async function firstFundingTx(addr) {
  try {
    const d = await (await fetch(`${NODE}/thin_wallet/address_history?addresses[]=${addr}`)).json();
    const txs = (d.history || []).filter(tx =>
      (tx.outputs || []).some(o => o.decoded && o.decoded.address === addr));
    if (!txs.length) return null;
    txs.sort((a, b) => a.timestamp - b.timestamp);
    return txs[0];
  } catch { return null; }
}

async function handleNameClaim(res, body) {
  const txId = body && body.tx;
  const wanted = body && body.addr;
  if (typeof txId !== 'string' || !HEX64.test(txId)) return deny(res, 400, 'bad tx id');
  if (typeof wanted !== 'string' || !ADDR_RE.test(wanted)) return deny(res, 400, 'bad address');
  let d;
  try { d = await (await fetch(`${NODE}/transaction?id=${txId}`)).json(); }
  catch { return deny(res, 502, 'node unreachable, try again'); }
  const tx = d && d.tx, meta = d && d.meta;
  if (!tx || !meta) return deny(res, 404, 'transaction not found');
  if ((meta.voided_by || []).length) return deny(res, 400, 'transaction was voided');
  if (!meta.first_block) return deny(res, 425, 'not yet confirmed, try again shortly');
  // both forms may carry a trailing :<sha256> — the hash of a secret the
  // claiming browser keeps. It rides inside the SIGNED tx, so nobody can
  // attach their own hash to someone else's claim.
  const splitHash = s => {
    const i = s.lastIndexOf(':');
    if (i !== -1 && /^[0-9a-f]{64}$/.test(s.slice(i + 1))) {
      return [s.slice(0, i), s.slice(i + 1)];
    }
    return [s, null];
  };
  let name = null, heir = null, reclaimHash = null;
  for (const o of tx.outputs || []) {
    const s = dataFromScript(o.script || '');
    if (s && s.startsWith(NAME_MAGIC)) { [name, reclaimHash] = splitHash(s.slice(NAME_MAGIC.length)); break; }
    if (s && s.startsWith(BEQUEATH_MAGIC)) { [heir, reclaimHash] = splitHash(s.slice(BEQUEATH_MAGIC.length)); break; }
  }
  if (name === null && heir === null) return deny(res, 400, 'no name claim in that transaction');
  const signers = new Set((tx.inputs || []).map(i => i.decoded && i.decoded.address).filter(Boolean));
  if (!signers.has(wanted)) return deny(res, 403, 'claim was not signed by that address');

  if (heir !== null) {
    // the signer hands their own name to another address (session -> wallet)
    if (!ADDR_RE.test(heir)) return deny(res, 400, 'bad heir address');
    const entry = names[wanted];
    if (!entry) return deny(res, 400, 'that address holds no name to bequeath');
    if (heir === wanted) return deny(res, 400, 'the name already rests there');
    if (names[heir]) return deny(res, 409, 'the heir already bears a name');
    delete names[wanted];
    names[heir] = {
      name: entry.name, tx: txId, ts: Math.floor(Date.now() / 1000),
      ...(reclaimHash || entry.reclaimHash
        ? { reclaimHash: reclaimHash || entry.reclaimHash } : {}),
    };
    saveNames();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, address: heir, name: entry.name }));
  }

  if (!NAME_RE.test(name)) return deny(res, 400, 'names are 3-16 letters, numbers, spaces or _');
  const lower = name.toLowerCase();
  for (const [a, n] of Object.entries(names)) {
    if (a !== wanted && n.name.toLowerCase() === lower) {
      // the name moves to the claimant if its holder let go of it (a swept,
      // empty address), if the holder signed the tx that first funded the
      // claimant (a wallet spawning its next session key), or if the claimer
      // presents the secret whose hash a previous claim of this name sealed
      // on-chain (same browser, however the wallet shuffled its addresses)
      if (!(await addressAbandoned(a))) {
        const secretOk = n.reclaimHash && typeof body.secret === 'string'
          && crypto.createHash('sha256').update(body.secret).digest('hex') === n.reclaimHash;
        if (!secretOk) {
          const fund = await firstFundingTx(wanted);
          const funders = new Set((fund && fund.inputs || [])
            .map(i => i.decoded && i.decoded.address).filter(Boolean));
          if (!funders.has(a)) {
            return deny(res, 409, 'that name is already claimed by another');
          }
        }
      }
      delete names[a];
    }
  }
  names[wanted] = {
    name, tx: txId, ts: Math.floor(Date.now() / 1000),
    ...(reclaimHash ? { reclaimHash } : {}),
  };
  saveNames();
  feedPush({ ts: Math.floor(Date.now() / 1000), kind: 'banner', who: wanted, name });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, address: wanted, name }));
}

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

  if (req.method === 'GET' && url.pathname === '/feed') {
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ events: feed }));
  }

  if (req.method === 'GET' && url.pathname === '/cards') {
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    // ?touch=<uid,uid>: the caller just changed these cards; re-read them now
    const touch = (q.get('touch') || '').split(',')
      .filter(u => HEX64.test(u) && u !== GEMS).slice(0, 8);
    if (touch.length) await refreshCards(touch).catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(cardCache));
  }

  if (req.method === 'GET' && url.pathname === '/names') {
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    const flat = {};
    for (const [a, n] of Object.entries(names)) flat[a] = n.name;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(flat));
  }

  if (req.method === 'POST' && url.pathname === '/name') {
    if (rateLimited(ip, 'tx')) return deny(res, 429, 'rate limited');
    const chunks = [];
    for await (const c of req) { chunks.push(c); if (Buffer.concat(chunks).length > 1024) return deny(res, 413, 'too large'); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks)); } catch { return deny(res, 400, 'bad json'); }
    return handleNameClaim(res, body);
  }

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
    // code must never go stale on players' phones; heavy assets may cache briefly.
    // Last-Modified gives no-cache something to revalidate against (without a
    // validator some mobile browsers keep serving pinned copies).
    const heavy = { '.jpg': 1, '.jpeg': 1, '.png': 1, '.ico': 1, '.mp3': 1, '.svg': 1 };
    const cache = heavy[ext] ? 'public, max-age=3600' : 'no-cache';
    const mtime = fs.statSync(f).mtime;
    mtime.setMilliseconds(0); // HTTP dates have second precision
    const ims = req.headers['if-modified-since'];
    if (ims && new Date(ims) >= mtime) {
      res.writeHead(304, { 'Cache-Control': cache });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cache,
      'Last-Modified': mtime.toUTCString(),
    });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    deny(res, 502, String(e));
  }
}).listen(PORT, HOST, () => console.log(`hathor-gacha frontend on http://${HOST}:${PORT}`));
