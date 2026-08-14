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
// node1 primary (2026-08-05): the partner node flaps and every read paid
// the retry tax before falling through; the steady public node leads now
// the partner node is the primary: it serves nano view calls that the public
// node refuses under load (it 503s bulk `calls[]` reads while still answering
// balances). The public node stays as the fallback, and the doghouse below
// still steps aside from whichever one is sick.
const NODE = process.env.NODE_URL || 'https://node-partners.testnet.hathor.network/v1a';
const FALLBACK_NODE = process.env.FALLBACK_NODE_URL || 'https://node1.testnet.hathor.network/v1a';
// The partner node's balancer answers "no healthy upstream" in bursts. Every
// read here used to take that at face value: the card sweep died, the cache
// went stale, and players opened a collection missing the champions they own
// (it only healed when someone summoned and forced a discovery pass). Reads
// retry, then fall through to the public node.
/* the two testnet nodes take turns being sick (2026-08-06: node1 503s
   while the partner serves, the exact reverse of the day before). A fixed
   primary pays the flap every time, so a failed primary sits in a 30s
   doghouse and every read starts from whichever node answered last. */
let sickUntil = { [NODE]: 0, [FALLBACK_NODE]: 0 };
async function nodeGet(pathAndQuery, tries = 4, timeoutMs = 4000) {
  let last;
  for (let i = 0; i < tries; i++) {
    const now = Date.now();
    const order = [NODE, FALLBACK_NODE].sort((a, b) => (sickUntil[a] > now) - (sickUntil[b] > now));
    // always the healthiest: a failure marks it sick, so the next lap
    // naturally leads with the other node — never walk back into the sick
    // one while a healthy one stands
    const base = order[0];
    try {
      const r = await fetch(base + pathAndQuery, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`node ${r.status}`);
      const text = await r.text();
      try { return JSON.parse(text); }
      catch { throw new Error('node returned ' + text.slice(0, 40)); }
    } catch (e) {
      last = e;
      sickUntil[base] = Date.now() + 30_000;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw last;
}
const PUB = path.join(__dirname, 'public');
/* FICTIONAL testnet company (scripts/demo-fixtures.json): eight seeded
   banners and a few hours of feed lines, so a first tester is not alone in
   the realm. Held in memory only — names.json and feed-state.json stay
   truthful — so deleting the file removes every trace. These deeds are NOT
   on chain and must not outlive the playtest. */
let demo = { players: [], feed: [] };
try {
  demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'demo-fixtures.json'), 'utf8'));
  console.log(`demo fixtures: ${demo.players.length} players, ${demo.feed.length} feed lines`);
} catch { /* none seeded, or deliberately removed */ }
const demoNames = Object.fromEntries((demo.players || []).map(p => [p.addr, p.name]));
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';

const WALLET_ID = 'player';
// v5 ids on testnet-india (launched 2026-07-28; see scripts/v5_ids.json)
const NC = process.env.NC || '0061589e138059dcc670e392442c55bd6a55487adaa0b519ad41cf09bb0129b4';
const MKT_NC = process.env.MARKET_NC || '000000004c077094120091a3f333efcae1fc8cdc98f758bc07b519aeed788627';
// the v4 realms still hold a balance entry for every card they minted;
// adopted cards keep those uids, so legacy balances stay a discovery source
const LEGACY_NCS = ['00c7aaa25c90c5be834df9e99d731bb6024df68f5ef63dba0878cb7c0dfe4bdd',
                    '000000001bc502cf793a7343de99816f574b3b7839e4bd21d8d680afabc799fb'];
// staked in v4 when the realm retired and abandoned there by their owner:
// the tokens can never circulate again, so they do not exist to the game
const RETIRED_UIDS = new Set([
  '926c8555df55b82a9c4a2d255d17b50d7256b979603715292730cd5f5a9764f9', // Genesis Phoenix
  'c6dc1b2b5bd9e21e1f36df2e081cec6a702005d2140ece329b5f7a78a5ebba34', // The Great Ledger
  'f7fcb922e60ad28fd8607a07583c7c37ef8719e7854a92af04fe1dad0ccbe85a', // The Ember Tyrant
]);
// all three were Sovereigns; the landing counters still credit the realm
// with having bound them
const RETIRED_SOVEREIGNS = 3;
const CARD_AMT = Number(process.env.CARD_UNIT || 1); // base units per card (v4: 1)
const MAX_DEPOSIT = 100;    // HTR cents; the contract enforces the exact pull price
const MAX_EMBER = 100_000;  // Ember per single wager/fee arg
const MAX_HTR = 100_000;    // HTR cents the shared wallet may SPEND or withdraw
// an ask is not a spend: a seller names any price, so this only keeps the
// number sane (well past Hathor's whole supply) instead of capping the market
const MAX_PRICE = 100_000_000_000;
const HEX64 = /^[0-9a-f]{64}$/;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4',
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
  // reads run in parallel bursts since b=56; 240/min starved three delve
  // claims confirming at once (each polls every 1.5s plus refreshes)
  const limit = kind === 'tx' ? 6 : 480;
  const now = Date.now();
  const key = `${ip}:${kind}`;
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + 60_000 }; buckets.set(key, b); }
  b.count += 1;
  if (buckets.size > 10_000) buckets.clear(); // crude memory cap
  return b.count > limit;
}

// Real client IP. Behind our Caddy, X-Real-IP is stamped from the TCP peer and
// overwrites any client-supplied value, so it cannot be spoofed; the Node
// server binds to localhost, so nothing reaches it except through Caddy. Never
// trust X-Forwarded-For's leftmost hop (client-chosen) for rate limiting.
function clientIp(req) {
  return req.headers['x-real-ip'] || req.socket.remoteAddress || '?';
}

// ---- daily ceiling on shared-wallet signing (griefing / drain guard) ----
// /execute signs with one operator-funded wallet, so cap how much it will
// sign per UTC day, globally and per client. Trustworthy IPs make the per-IP
// cap meaningful. Legitimate players use their own wallet or a session key and
// never touch this path; it backs only the walletless demo.
const DAY_MS = 86_400_000;
const EXEC_CAP_GLOBAL = Number(process.env.EXEC_CAP_GLOBAL || 400);
const EXEC_CAP_IP = Number(process.env.EXEC_CAP_IP || 25);
let execDay = 0, execGlobal = 0;
const execByIp = new Map();
function execDayLimited(ip) {
  const day = Math.floor(Date.now() / DAY_MS);
  if (day !== execDay) { execDay = day; execGlobal = 0; execByIp.clear(); }
  const perIp = (execByIp.get(ip) || 0) + 1;
  execByIp.set(ip, perIp);
  execGlobal += 1;
  if (execByIp.size > 50_000) execByIp.clear();
  return execGlobal > EXEC_CAP_GLOBAL || perIp > EXEC_CAP_IP;
}

function deny(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: msg }));
}

// ---- execute-body validation ----
// per-method spec: expected actions and arg validators
const cardDep = a => a.type === 'deposit' && HEX64.test(a.token || '') && a.amount === CARD_AMT;
const cardWd = a => a.type === 'withdrawal' && HEX64.test(a.token || '') && a.amount === CARD_AMT && a.address === playerAddress;
const htrDep = a => a.type === 'deposit' && a.token === '00'
  && Number.isInteger(a.amount) && a.amount > 0 && a.amount <= MAX_DEPOSIT;
const htrWd = a => a.type === 'withdrawal' && a.token === '00'
  && Number.isInteger(a.amount) && a.amount > 0 && a.amount <= MAX_HTR && a.address === playerAddress;
const isHex64 = v => typeof v === 'string' && HEX64.test(v);
const isSmallInt = v => Number.isInteger(v) && v >= 0 && v <= MAX_EMBER;
// v4 duel stances: -1 classic accept, 0..2 sealed/open stances
const isStance = v => Number.isInteger(v) && v >= -1 && v <= 2;
const isCommit = v => v === '' || (typeof v === 'string' && HEX64.test(v));
const isSalt = v => typeof v === 'string' && v.length <= 64;
// v5 squads: a lane order is a permutation of the digits 012
const isPerm = v => typeof v === 'string' && v.length === 3
  && v.includes('0') && v.includes('1') && v.includes('2');
// v5 ranked: wager tiers 0 (free) / 1 (25 Ember) / 2 (100 Ember)
const isTier = v => v === 0 || v === 1 || v === 2;
// v5 guilds: 3-16 chars, same shape the banner-name registry allows
const isGuildName = v => typeof v === 'string' && /^[A-Za-z0-9_ ]{3,16}$/.test(v)
  && v.trim() === v;
const isSide = v => v === 0 || v === 1;

const marketHtrDep = a => a.type === 'deposit' && a.token === '00'
  && Number.isInteger(a.amount) && a.amount > 0 && a.amount <= MAX_HTR;
const MKT_METHODS = {
  list_card:      { actions: [cardDep],      args: [v => Number.isInteger(v) && v > 0 && v <= MAX_PRICE] },
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
  claim_ember:   { actions: [],                args: [isHex64] },
  fuse:          { actions: [cardDep, cardDep], args: [] },
  create_duel:   { actions: [cardDep],         args: [isSmallInt, isCommit] },
  accept_duel:   { actions: [cardDep],         args: [isSmallInt, isStance] },
  reveal_duel:   { actions: [],                args: [isSmallInt, isStance, isSalt] },
  create_squad_duel: { actions: [cardDep, cardDep, cardDep], args: [isSmallInt, isHex64] },
  accept_squad_duel: { actions: [cardDep, cardDep, cardDep], args: [isSmallInt] },
  reveal_squad:  { actions: [],                args: [isSmallInt, isPerm, isSalt] },
  join_ranked:   { actions: [cardDep],         args: [isTier] },
  leave_ranked:  { actions: [],                args: [isTier] },
  create_guild:  { actions: [],                args: [isGuildName] },
  join_guild:    { actions: [],                args: [isSmallInt] },
  leave_guild:   { actions: [],                args: [] },
  fight_world_boss:   { actions: [],           args: [isHex64] },
  claim_world_bounty: { actions: [],           args: [isSmallInt] },
  enter_tournament:   { actions: [cardDep],    args: [isSmallInt] },
  leave_tournament:   { actions: [],           args: [isSmallInt] },
  advance_tournament: { actions: [],           args: [isSmallInt] },
  claim_forfeit: { actions: [],                args: [isSmallInt] },
  place_bet:     { actions: [],                args: [isSmallInt, isSide, isSmallInt] },
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
let feedSeen = new Set();
let writNames = null;     // writ id -> name, fetched once

// the feed persists across restarts (next to names.json): card names and
// verdicts are inferred from state the server WATCHES change, so a restart
// that re-ingests history cold can never reconstruct them ("summoned a
// champion" instead of the champion's name). Persisting keeps them.
const FEED_FILE = path.join(__dirname, 'feed-state.json');
try {
  const saved = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8'));
  feed = saved.events || [];
  feedSeen = new Set(saved.seen || []);
} catch { /* first boot */ }
function saveFeed() {
  try {
    fs.writeFileSync(FEED_FILE, JSON.stringify(
      { events: feed, seen: [...feedSeen].slice(-2000) }));
  } catch (e) { console.error('feed-state write failed:', e.message); }
}

function feedPush(ev) {
  feed.unshift(ev);
  if (feed.length > FEED_MAX) feed.length = FEED_MAX;
}

// v4 delegation: txs are signed by session keys, but the player IS the main
// address the contract resolves them to — attribute feed events (and name
// claims) accordingly. Cached: delegation is permanent once bound.
const delegateCache = new Map(); // address -> main address | null (not a session)
async function delegateOf(addr) {
  if (delegateCache.has(addr)) return delegateCache.get(addr);
  let main = null;
  try {
    const call = `get_delegate("${addr}")`;
    const d = await (await fetch(
      `${NODE}/nano_contract/state?id=${NC}&calls[]=${encodeURIComponent(call)}`)).json();
    main = (d.calls && d.calls[call] && d.calls[call].value) || null;
  } catch { return null; } // transient: do not cache a failed lookup
  if (delegateCache.size > 20_000) delegateCache.clear();
  delegateCache.set(addr, main);
  return main;
}

// ---- outcome inference: verdicts told from state diffs ----
// Every nano method execution is its own tx (confirmed by the Hathor team),
// but return values and emit_event payloads are not exposed by any node API,
// so the feed infers verdicts by reading views around each settle-class tx:
// a wins diff names the duel winner, Ember+shard deltas classify a delve
// haul. Baselines are seeded on first sight (a first sighting stays silent);
// only round-by-round rolls remain unknowable without the event queue.
const winsCache = new Map();    // identity -> wins
const wbHpCache = new Map();    // week -> world-boss hp last seen

// contract views return raw addresses as hex (25 version-prefixed bytes);
// the feed speaks base58check like everything else
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function addrFromHex(hex) {
  if (!/^[0-9a-f]{50}$/.test(hex || '')) return null;
  const payload = Buffer.from(hex, 'hex');
  const chk = crypto.createHash('sha256')
    .update(crypto.createHash('sha256').update(payload).digest())
    .digest().subarray(0, 4);
  const buf = Buffer.concat([payload, chk]);
  let n = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}
const emberCache = new Map();   // identity -> Ember ledger
const shardsCache = new Map();  // identity -> shards

async function feedViews(calls) {
  const qs = calls.map(c => 'calls[]=' + encodeURIComponent(c)).join('&');
  const d = await nodeGet(`/nano_contract/state?id=${NC}&${qs}`);
  const out = {};
  for (const [k, v] of Object.entries(d.calls || {})) out[k] = v.value;
  return out;
}

// who took the settled duel: whichever party's win count moved since the
// last poll. Sequential per-event so one poll with several settles still
// attributes each; ambiguity (no baseline, both moved) stays silent.
/* The Ledger's own account of a fight.
   Every settling method logs its outcome (duel_settled carries winner_side
   and the three rounds; squad_settled, ranked_settled, delve_claimed and
   world_boss_hit carry theirs), and the node serves those entries when the
   logs endpoint is asked for the TRANSACTION — asking for the contract
   returns only its instantiation, which is why this looked unavailable
   before. Read the truth where we can; the state-diff inference below stays
   as the fallback for txs whose logs the node has not kept. */
const logCache = new Map();      // txHash -> {name -> {key: value}}
async function txLogs(hash) {
  if (!hash || !HEX64.test(hash)) return null;
  if (logCache.has(hash)) return logCache.get(hash);
  let out = null;
  try {
    const d = await nodeGet(`/nano_contract/logs?id=${hash}`);
    if (d && d.nc_execution === 'success') {
      out = {};
      for (const entries of Object.values(d.logs || {})) {
        for (const e of entries) {
          for (const L of e.logs || []) {
            if (L.type === 'LOG' && L.message) out[L.message] = L.key_values || {};
          }
        }
      }
    }
  } catch { /* the fallback still speaks */ }
  if (logCache.size > 2_000) logCache.clear();
  logCache.set(hash, out);
  return out;
}

// the verdict as the contract recorded it: which side won, and the rounds
async function loggedVerdict(id, hash) {
  const logs = await txLogs(hash);
  const kv = logs && (logs.duel_settled || logs.squad_settled);
  if (!kv || kv.duel_id === undefined ? false : Number(kv.duel_id) !== id) return null;
  const side = Number(kv.winner_side);
  if (side !== 0 && side !== 1) return null;
  const pc = `get_duel_challenger(${id})`, pa = `get_duel_acceptor(${id})`;
  const p = await feedViews([pc, pa]);
  if (!p[pc] || !p[pa]) return null;
  const winner = side === 0 ? p[pc] : p[pa];
  const loser = side === 0 ? p[pa] : p[pc];
  const rounds = [kv.r0, kv.r1, kv.r2].map(Number).filter(n => Number.isFinite(n));
  return { winner, loser, ...(rounds.length === 3 ? { rounds } : {}),
           ...(kv.hardened ? { hardened: Number(kv.hardened) } : {}), logged: true };
}

// the world boss reports what it took: exact damage, and whether it fell
async function loggedWbHit(hash) {
  const logs = await txLogs(hash);
  if (!logs || !logs.world_boss_hit) return null;
  const dmg = Number(logs.world_boss_hit.damage);
  return { ...(Number.isFinite(dmg) ? { damage: dmg } : {}),
           ...(logs.world_boss_slain ? { slain: true } : {}) };
}

async function duelVerdict(id) {
  const pc = `get_duel_challenger(${id})`, pa = `get_duel_acceptor(${id})`;
  const p = await feedViews([pc, pa]);
  const ch = p[pc], ac = p[pa];
  if (!ch || !ac) return null;
  const wc = `get_wins("${ch}")`, wa = `get_wins("${ac}")`;
  const w = await feedViews([wc, wa]);
  const nowC = w[wc] || 0, nowA = w[wa] || 0;
  const hadC = winsCache.has(ch), hadA = winsCache.has(ac);
  const dC = nowC - (winsCache.get(ch) ?? nowC);
  const dA = nowA - (winsCache.get(ac) ?? nowA);
  winsCache.set(ch, nowC);
  winsCache.set(ac, nowA);
  // exactly one of the two won, so a single baseline decides by elimination
  if (!hadC && !hadA) return null;
  if (dC > 0 && (!hadA || dA <= 0)) return { winner: ch, loser: ac };
  if (dA > 0 && (!hadC || dC <= 0)) return { winner: ac, loser: ch };
  if (hadC && dC === 0 && !hadA) return { winner: ac, loser: ch };
  if (hadA && dA === 0 && !hadC) return { winner: ch, loser: ac };
  return null;
}

// a pre-settlement sighting is a free baseline: challenges and sealed
// answers both happen before any wins move
async function seedWins(addr) {
  if (!addr || winsCache.has(addr)) return;
  const c = `get_wins("${addr}")`;
  try { winsCache.set(addr, (await feedViews([c]))[c] || 0); } catch { /* next time */ }
}

// enrichment races the settle tx's own confirmation: a feed poll can see the
// tx in history before its effect shows in state. Events that are not yet
// decidable go on a small retry queue and are re-tried on later polls (the
// feed serves the same object, so a late verdict still lights up the line).
const BOOT_TS = Math.floor(Date.now() / 1000);
const enrichQueue = []; // {ev, tries}

async function enrichEvent(ev, tries) {
  if (ev.kind === 'challenge') { await seedWins(ev.who); return true; }
  if (ev.kind === 'answer') {
    const c = `get_duel(${ev.id})`;
    const status = ((await feedViews([c]))[c] || '').split('|')[0];
    if (status === 'open') return tries >= 6;      // settle not visible yet
    if (status === 'reveal') {
      ev.sealed = true;
      const cc = `get_duel_challenger(${ev.id})`;
      await seedWins(ev.who);
      await seedWins((await feedViews([cc]))[cc]);
      return true;
    }
    ev.verdict = (await loggedVerdict(ev.id, ev.tx)) || await duelVerdict(ev.id);
    return true;
  }
  if (ev.kind === 'reveal') {
    const c = `get_duel(${ev.id})`;
    const status = ((await feedViews([c]))[c] || '').split('|')[0];
    if (status === 'reveal') return tries >= 6;    // reveal tx not confirmed yet
    ev.verdict = (await loggedVerdict(ev.id, ev.tx)) || await duelVerdict(ev.id);
    return true;
  }
  if (ev.kind === 'forfeit') {
    const c = `get_duel_acceptor(${ev.id})`;
    ev.winner = (await feedViews([c]))[c] || null;
    return true;
  }
  if (ev.kind === 'delve_done') {
    if (tries === 0) return false;                 // let the claim tx confirm first
    ev.result = await delveVerdict(ev.who, ev.lone === true);
    return true;
  }
  if (ev.kind === 'tour_enter' || ev.kind === 'tour_leave' || ev.kind === 'tour_round') {
    const c = `get_tournament(${ev.id})`;
    const parts = ((await feedViews([c]))[c] || '').split('|');
    ev.name = parts[0] || null;
    if (ev.kind === 'tour_round') {
      if (parts[1] === '2') {
        ev.done = true;
        ev.champion = addrFromHex(parts[10] || '');
        ev.pool = Number(parts[9]) || 0;
      } else if (parts[1] === '3') {
        ev.cancelled = true;
      }
    }
    return true;
  }
  if (ev.kind === 'guild_join') {
    const c = `get_guild(${ev.id})`;
    ev.name = ((await feedViews([c]))[c] || '').split('|')[0] || null;
    return true;
  }
  if (ev.kind === 'wb_fight') {
    // boss name always; damage from the HP drawdown, only trusted when this
    // was the identity's lone tx in the window (several fighters merge)
    const cw = 'get_wb_week()';
    const week = (await feedViews([cw]))[cw] || 0;
    const cb = `get_world_boss(${week})`;
    const boss = ((await feedViews([cb]))[cb] || '').split('|');
    const hp = Number(boss[1] || 0);
    const had = wbHpCache.has(week);
    const dHp = (wbHpCache.get(week) ?? hp) - hp;
    wbHpCache.set(week, hp);
    ev.boss = boss[0] || null;
    // the contract's own entry beats the drawdown guess, and needs no
    // "was this their only blow in the window" caveat
    const logged = await loggedWbHit(ev.tx);
    if (logged && logged.damage != null) {
      ev.damage = logged.damage;
      if (logged.slain) ev.slain = true;
    } else {
      if (had && dHp > 0 && ev.lone === true) ev.damage = dHp;
      if (boss[0] && hp === 0) ev.slain = true;
    }
    return true;
  }
  if (ev.kind === 'ranked') {
    // still in the queue -> the join just queued; gone -> it settled (or was
    // left, which arrives as its own event) and the wins diff names the result
    const cq = `is_ranked_queued(${ev.tier}, "${ev.who}")`;
    const cw = `get_wins("${ev.who}")`;
    const v = await feedViews([cq, cw]);
    if (v[cq] === true) {
      ev.result = 'queued';
      winsCache.set(ev.who, v[cw] || 0);
      return true;
    }
    const had = winsCache.has(ev.who);
    const now = v[cw] || 0;
    const dW = now - (winsCache.get(ev.who) ?? now);
    winsCache.set(ev.who, now);
    ev.result = !had ? null : dW > 0 ? 'won' : 'lost';
    return true;
  }
  return true;
}

// delve haul from the claimer's Ember + shard deltas. `lone` marks whether
// this was the identity's only tx in the poll window: amounts are only
// trusted then (other txs also move the ledger).
async function delveVerdict(identity, lone) {
  const ce = `get_ember_balance("${identity}")`, cs = `get_shards("${identity}")`;
  const v = await feedViews([ce, cs]);
  const e = v[ce] || 0, s = v[cs] || 0;
  const hadE = emberCache.has(identity), hadS = shardsCache.has(identity);
  const dE = e - (emberCache.get(identity) ?? e);
  const dS = s - (shardsCache.get(identity) ?? s);
  emberCache.set(identity, e);
  shardsCache.set(identity, s);
  if (!hadE || !hadS) return null;
  if (dS > 0 && dE > 0) return { haul: 'relic', shards: dS, ...(lone ? { ember: dE } : {}) };
  if (dS > 0) return { haul: 'shards', shards: dS };
  if (dE > 0) return { haul: 'ember', ...(lone ? { ember: dE } : {}) };
  return { haul: 'dust' };
}

async function loadWritNames() {
  try {
    const qs = [...Array(10).keys()]
      .map(i => 'calls[]=' + encodeURIComponent(`get_writ(${i})`)).join('&');
    const d = await nodeGet(`/nano_contract/state?id=${NC}&${qs}`);
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
    case 'reveal_duel':
      return { ts, kind: 'reveal', who, id: Number(args[0]) || 0 };
    case 'create_squad_duel':
      return { ts, kind: 'challenge', who, squad: true, wager: Number(args[0]) || 0 };
    case 'accept_squad_duel':
      return { ts, kind: 'answer', who, squad: true, id: Number(args[0]) || 0 };
    case 'reveal_squad':
      return { ts, kind: 'reveal', who, squad: true, id: Number(args[0]) || 0 };
    case 'join_ranked':
      return { ts, kind: 'ranked', who, tier: Number(args[0]) || 0 };
    case 'leave_ranked':
      return { ts, kind: 'ranked_leave', who, tier: Number(args[0]) || 0 };
    case 'create_guild':
      return { ts, kind: 'guild_new', who, name: String(args[0] || '') };
    case 'join_guild':
      return { ts, kind: 'guild_join', who, id: Number(args[0]) || 0 };
    case 'leave_guild':
      return { ts, kind: 'guild_leave', who };
    case 'fight_world_boss':
      return { ts, kind: 'wb_fight', who };
    case 'claim_world_bounty':
      return { ts, kind: 'wb_claim', who, week: Number(args[0]) || 0 };
    case 'create_tournament':
      return { ts, kind: 'tour_new', who, name: String(args[0] || ''),
               fee: Number(args[1]) || 0 };
    case 'enter_tournament':
      return { ts, kind: 'tour_enter', who, id: Number(args[0]) || 0 };
    case 'leave_tournament':
      return { ts, kind: 'tour_leave', who, id: Number(args[0]) || 0 };
    case 'advance_tournament':
      return { ts, kind: 'tour_round', who, id: Number(args[0]) || 0 };
    case 'claim_forfeit':
      return { ts, kind: 'forfeit', who, id: Number(args[0]) || 0 };
    case 'cancel_duel':
      return { ts, kind: 'duel_cancel', who, id: Number(args[0]) || 0 };
    case 'place_bet':
      return { ts, kind: 'bet', who, id: Number(args[0]) || 0,
               side: Number(args[1]) || 0, amount: Number(args[2]) || 0 };
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

/* The Market is a second contract, so its history is a second pass. The
   card uid rides in the tx's token list for anything that deposits one; a
   buy or an accepted swap carries only an id, which the views resolve. */
function marketEventFor(tx) {
  const who = tx.nc_address;
  const args = tx.nc_args_decoded || [];
  const ts = tx.timestamp;
  const card = (tx.tokens || [])[0] || null;
  switch (tx.nc_method) {
    case 'list_card':
      return { ts, kind: 'listed', who, uid: card, price: Number(args[0]) || 0 };
    case 'buy':
      return { ts, kind: 'bought', who, id: Number(args[0]) || 0 };
    case 'offer_swap':
      return { ts, kind: 'swap_offer', who, uid: card, wantUid: String(args[0] || '') };
    case 'accept_swap':
      return { ts, kind: 'swap_done', who, id: Number(args[0]) || 0 };
    default:
      return null;      // claims and cancels are housekeeping, not news
  }
}

// a card's name for the feed: the warm cache first, the chain if unseen
async function cardName(uid) {
  if (!uid || !HEX64.test(uid)) return null;
  const hit = cardCache.cards[uid];
  if (hit && hit.name) return hit.name;
  try {
    const c = `get_card_name("${uid}")`;
    const v = await ncCalls(NC, [c]);
    return v[c] || null;
  } catch { return null; }
}

/* Live nano seqnums, fed by the pollers: the address_history endpoint the
   /seqnum route used to walk paginates per token and buried the newest
   nonces for busy sessions (a player signed 16 behind the chain). The
   contract history is newest-first and the pollers read every tx anyway,
   so the truth costs one map write. Voided txs count: their seqnum is
   consumed regardless of the verdict. */
const seqnums = new Map();
function recordSeqnum(tx) {
  if (tx && tx.nc_address && Number.isInteger(tx.nc_seqnum)) {
    const next = tx.nc_seqnum + 1;
    if (next > (seqnums.get(tx.nc_address) || 0)) seqnums.set(tx.nc_address, next);
  }
}
// boot seed: recent pages of both realms' history, so a restart does not
// forget the active players' nonces
(async () => {
  for (const nc of [NC, MKT_NC].filter(Boolean)) {
    let after = '';
    for (let page = 0; page < 5; page++) {
      try {
        const d = await nodeGet(`/nano_contract/history?id=${nc}&count=100` + (after ? `&after=${after}` : ''));
        const h = d.history || [];
        h.forEach(recordSeqnum);
        if (!d.has_more || !h.length) break;
        after = h[h.length - 1].hash;
      } catch { break; } // best-effort: the pollers keep feeding the map
    }
  }
})();

async function pollMarketFeed() {
  if (!MKT_NC) return;
  const d = await nodeGet(`/nano_contract/history?id=${MKT_NC}&count=20`);
  const fresh = [];
  for (const tx of d.history || []) {
    recordSeqnum(tx);
    if (feedSeen.has(tx.hash) || tx.is_voided) continue;
    if (!tx.first_block) continue;      // unconfirmed or failed: not news yet
    feedSeen.add(tx.hash);
    const ev = marketEventFor(tx);
    if (ev) fresh.push(ev);
  }
  if (!fresh.length) return;
  fresh.reverse();
  for (const ev of fresh) {
    try {
      if (ev.who) ev.who = (await delegateOf(ev.who)) || ev.who;
      if (ev.kind === 'bought') {
        const c = `get_listing(${ev.id})`, cs = `get_listing_seller(${ev.id})`;
        const v = await ncCalls(MKT_NC, [c, cs]);
        const [, uid, price] = (v[c] || '||').split('|');
        ev.uid = uid || null;
        ev.price = Number(price) || 0;
        ev.seller = (await delegateOf(v[cs])) || v[cs] || null;
      } else if (ev.kind === 'swap_done') {
        const c = `get_swap(${ev.id})`, cm = `get_swap_maker(${ev.id})`;
        const v = await ncCalls(MKT_NC, [c, cm]);
        const [, give, want] = (v[c] || '||').split('|');
        ev.uid = give || null;
        ev.wantUid = want || null;
        ev.maker = (await delegateOf(v[cm])) || v[cm] || null;
      }
      ev.card = await cardName(ev.uid);
      if (ev.wantUid) ev.want = await cardName(ev.wantUid);
    } catch { /* a nameless line still reads */ }
    feedPush(ev);
  }
  saveFeed();
}

let knownUids = null; // contract token set, for spotting freshly minted cards
async function contractUids() {
  const d = await nodeGet(`/nano_contract/state?id=${NC}&balances[]=__all__`);
  return new Set(Object.keys(d.balances || {}));
}

async function pollFeed() {
  try {
    if (!writNames) await loadWritNames();
    if (!knownUids) knownUids = await contractUids();
    // events waiting on their settle tx to confirm: retry, then give up
    let lateEnriched = false;
    for (let i = enrichQueue.length - 1; i >= 0; i--) {
      const q = enrichQueue[i];
      try {
        if (await enrichEvent(q.ev, q.tries) || ++q.tries > 8) {
          enrichQueue.splice(i, 1);
          lateEnriched = true;
        }
      } catch { if (++q.tries > 8) enrichQueue.splice(i, 1); }
    }
    if (lateEnriched) saveFeed();
    const d = await nodeGet(`/nano_contract/history?id=${NC}&count=30`);
    const fresh = [];
    const touched = new Set();
    for (const tx of d.history || []) {
      recordSeqnum(tx); // voided txs consume their seqnum too: count them all
      if (feedSeen.has(tx.hash) || tx.is_voided) continue;
      // a tx appears in history before consensus settles it; ingesting then
      // lets soon-to-be-voided txs into the feed (a failed summon still read
      // "summoned a champion"). Wait for confirmation: unseen + unconfirmed
      // txs simply return on a later poll.
      if (!tx.first_block) continue;
      feedSeen.add(tx.hash);
      for (const u of touchFromTx(tx)) touched.add(u);
      const ev = feedEventFor(tx);
      // carry the tx hash: the contract's own log for that tx is the
      // authority on how a fight ended
      if (ev) fresh.push(Object.assign(ev, { tx: tx.hash }));
      if (CUSTODY_METHODS.has(tx.nc_method)) {
        custodyCards(tx).then(us => us.length && refreshCards(us)).catch(() => {});
      }
    }
    if (touched.size) refreshCards([...touched]).catch(() => {});
    fresh.reverse(); // history is newest-first; process oldest first
    // name the cards minted since the last poll (summons and fusion children)
    const minted = fresh.filter(ev => ev.kind === 'pull' || ev.kind === 'fuse');
    if (minted.length) {
      const now = await contractUids();
      const newUids = [...now].filter(u => !knownUids.has(u));
      knownUids = now;
      if (newUids.length) refreshCards(newUids).catch(() => {});
      const qs = newUids.slice(0, 20)
        .map(u => 'calls[]=' + encodeURIComponent(`get_card_name("${u}")`)).join('&');
      let named = {};
      if (qs) {
        const st = await nodeGet(`/nano_contract/state?id=${NC}&${qs}`);
        named = st.calls || {};
      }
      const queue = newUids
        .map(u => named[`get_card_name("${u}")`] && named[`get_card_name("${u}")`].value)
        .filter(Boolean);
      for (const ev of minted) ev.card = queue.shift() || null;
    }
    // settle-class events get a verdict read from state (best-effort)
    const perIdentity = new Map(); // identity -> tx count this window
    for (const ev of fresh) {
      if (ev.who) {
        ev.who = (await delegateOf(ev.who)) || ev.who;
        perIdentity.set(ev.who, (perIdentity.get(ev.who) || 0) + 1);
      }
    }
    for (const ev of fresh) {
      try {
        if (ev.kind === 'delve_done' || ev.kind === 'wb_fight')
          ev.lone = perIdentity.get(ev.who) === 1;
        // pre-boot events are history replay: their baselines were seeded
        // AFTER the settles they describe, so inference would misattribute —
        // they keep plain lines (challenges still seed future baselines)
        if (ev.ts >= BOOT_TS - 60) {
          if (!(await enrichEvent(ev, 0))) enrichQueue.push({ ev, tries: 1 });
        } else if (ev.kind === 'challenge') await seedWins(ev.who);
      } catch { /* enrichment is decoration on decoration */ }
      feedPush(ev);
    }
    // keep the Ember baseline honest for identities that acted this window
    // (temper, wagers, bounties all move the ledger between delves)
    try {
      const idns = [...perIdentity.keys()].slice(0, 20);
      if (idns.length) {
        const calls = idns.map(a => `get_ember_balance("${a}")`);
        const v = await feedViews(calls);
        idns.forEach((a, i) => emberCache.set(a, v[calls[i]] || 0));
      }
    } catch { /* next poll reseeds */ }
    if (fresh.length) saveFeed();
    if (feedSeen.size > 5000) feedSeen.clear(); // crude memory cap
  } catch { /* the feed is decorative; next poll retries */ }
  // the counters clients watch: one state call per contract, per poll,
  // shared by every player instead of each of them asking
  try {
    const a = await ncCalls(NC, ['get_duel_count()']);
    pulse.duels = a['get_duel_count()'] ?? pulse.duels;
    if (MKT_NC) {
      const m = await ncCalls(MKT_NC, ['get_listing_count()', 'get_swap_count()']);
      pulse.listings = m['get_listing_count()'] ?? pulse.listings;
      pulse.swaps = m['get_swap_count()'] ?? pulse.swaps;
    }
    pulse.cards = Object.keys(cardCache.cards).length;
    pulse.feed = feed.length ? feed[0].ts : 0;
    pulse.at = Math.floor(Date.now() / 1000);
  } catch { /* the client falls back to its own slower timer */ }
}
async function pollAll() {
  await pollFeed();
  try { await pollMarketFeed(); } catch { /* the arena feed still stands */ }
}
pollAll();
setInterval(pollAll, 15_000); // our own node: no shared rate limit to respect

// ---- card-state cache: one request serves what cost clients ~500 view calls ----
// Nano view calls run ~125ms each on the node, so clients reading every card
// per refresh took 10-20s. The server keeps the card map warm instead,
// updating incrementally from the same tx stream the feed watches; clients
// pass ?touch=<uids> after their own tx for instant freshness on those cards.
const cardCache = { cards: {}, updatedAt: 0 };
// the cache survives restarts: a deploy must not blank every player's
// collection for the minute the first sweep takes
const CACHE_FILE = path.join(__dirname, 'card-cache.json');
try { Object.assign(cardCache, JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))); }
catch { /* first boot: the sweep fills it */ }
const realmCache = { at: 0, data: null };   // landing-page counters
const tokenMeta = new Map();                // uid -> token info (immutable)
/* What "something changed" looks like, refreshed by the feed poll. Clients
   watch these counters instead of refetching the world on a timer. */
const pulse = { at: 0, feed: 0, duels: 0, listings: 0, swaps: 0, cards: 0 };
const CARD_VIEWS = ['get_card_name', 'get_card_tier', 'get_card_power',
  'get_card_aspects', 'get_card_wins', 'get_card_cosmetics', 'get_card_ability',
  'get_pending_owner', 'get_staker', 'get_delve_since', 'get_temper_cost'];

// concurrency 3: at 8 the full sweep's ~190 chunk requests plus retries
// trip the nodes' rate limits (429/503) and one exhausted chunk fails it all
async function ncCalls(ncId, calls, concurrency = 3, tolerant = false) {
  const chunks = [];
  for (let i = 0; i < calls.length; i += 30) chunks.push(calls.slice(i, i + 30));
  const out = {};
  let idx = 0, failed = 0;
  await Promise.all([...Array(Math.min(concurrency, chunks.length))].map(async () => {
    for (;;) {
      const mine = idx++;
      if (mine >= chunks.length) return;
      const qs = chunks[mine].map(c => 'calls[]=' + encodeURIComponent(c)).join('&');
      try {
        // 15s, not the interactive 4s: a 30-view chunk takes ~4s on a healthy
        // node, so the tight cap starved every sweep during the node troubles
        const d = await nodeGet(`/nano_contract/state?id=${ncId}&${qs}`, 4, 15_000);
        for (const [k, v] of Object.entries(d.calls || {})) {
          // a per-call error has errmsg and no value; zero-filling it would
          // overwrite good cache entries with wrong defaults — fail instead
          if (!v || !('value' in v)) throw new Error('view call failed: ' + k.slice(0, 48));
          out[k] = v.value;
        }
      } catch (e) {
        // tolerant: a sick node fails a chunk, the sweep keeps the rest.
        // Cards in the failed chunk keep their old cache values and the
        // next sweep tries them again — progress instead of all-or-nothing
        if (!tolerant) throw e;
        failed++;
      }
      // ease off the shared rate limit on long tolerant runs
      if (tolerant) await new Promise(r => setTimeout(r, 120));
    }
  }));
  if (tolerant && failed) console.error(`card views: ${failed}/${chunks.length} chunks failed, kept old values`);
  return out;
}

async function refreshCards(uids, tolerant = false) {
  if (!uids.length) return;
  const v = await ncCalls(NC, uids.flatMap(u => CARD_VIEWS.map(f => `${f}("${u}")`)), 3, tolerant);
  for (const u of uids) {
    const g = f => v[`${f}("${u}")`];
    // a card's views can straddle two chunks: write it only when every view
    // arrived, or a half-read card zero-fills the missing fields
    if (CARD_VIEWS.some(f => !(`${f}("${u}")` in v))) continue;
    if (g('get_card_tier') == null) continue; // unknown to the contract
    cardCache.cards[u] = {
      name: g('get_card_name'), tier: g('get_card_tier'), power: g('get_card_power'),
      aspects: g('get_card_aspects') || null, wins: g('get_card_wins') || 0,
      cosmetics: g('get_card_cosmetics') || 0, ability: g('get_card_ability') || 0,
      pending: g('get_pending_owner') ?? null, staker: g('get_staker') ?? null,
      delveSince: g('get_delve_since') || 0, temperCost: g('get_temper_cost') || 0,
    };
  }
  cardCache.updatedAt = Math.floor(Date.now() / 1000);
}

async function sweepCards() {
  // union the gacha and market balances: a card escrowed in the market must
  // still resolve its metadata, and refreshCards only caches uids the gacha
  // actually minted (get_card_tier != null), so counterfeit tokens deposited
  // into the market never enter the cache and the client can drop their listings
  const sources = await Promise.all([NC, MKT_NC, ...LEGACY_NCS].map(nc =>
    nodeGet(`/nano_contract/state?id=${nc}&balances[]=__all__`, 4, 15_000).catch(() => ({}))));
  const uids = [...new Set(sources.flatMap(s => Object.keys(s.balances || {})))]
    .filter(u => HEX64.test(u) && !RETIRED_UIDS.has(u));
  for (const u of RETIRED_UIDS) delete cardCache.cards[u];
  await refreshCards(uids, true);
  console.log(`card cache: ${Object.keys(cardCache.cards).length} cards`);
  fs.writeFile(CACHE_FILE, JSON.stringify(cardCache), () => {});
}
// a failed sweep must not leave the cache stale for a full interval: come
// back in 45s until one lands, then settle into the 10-minute cadence
function sweepSoon(delay = 45_000) {
  setTimeout(() => sweepCards().catch(e => {
    console.error('card sweep failed:', e.message);
    sweepSoon();
  }), delay);
}
sweepCards().catch(e => { console.error('card sweep failed:', e.message); sweepSoon(); });
// the interval must not fail silently: it once hid two days of dead sweeps
setInterval(() => sweepCards().catch(e => console.error('card sweep failed:', e.message)), 10 * 60_000);

// the feed poller calls this with uids seen in fresh transactions
/* Methods that move a champion between custodies without ever naming it.
   cancel_duel takes a duel id, not the three cards it hands back, and its
   actions list is empty — so the poller learned nothing and the cache went
   on insisting those champions were still in the fight until the next full
   sweep. A player who cancelled a 3v3 watched three champions sit in limbo
   for as long as that took. These get their cards read out of the contract
   instead of guessed from the transaction. */
const CUSTODY_METHODS = new Set([
  'cancel_duel', 'accept_duel', 'reveal_duel', 'claim_forfeit',
  'accept_squad_duel', 'reveal_squad',
  'leave_tournament', 'advance_tournament', 'leave_ranked',
]);

async function custodyCards(tx) {
  const id = Number((tx.nc_args_decoded || [])[0]);
  if (!Number.isInteger(id)) return [];
  const uids = new Set();
  try {
    if (tx.nc_method === 'leave_tournament' || tx.nc_method === 'advance_tournament'
        || tx.nc_method === 'leave_ranked') {
      // no per-id card view to read: a short sweep catches these
      sweepSoon(6_000);
      return [];
    }
    const kindCall = `get_duel_kind(${id})`;
    const kind = (await ncCalls(NC, [kindCall]))[kindCall];
    const calls = kind === 1
      ? [`get_squad_cards(${id}, 0)`, `get_squad_cards(${id}, 1)`]
      : [`get_duel(${id})`, `get_duel_acceptor_card(${id})`];
    const v = await ncCalls(NC, calls);
    for (const raw of Object.values(v)) {
      if (typeof raw !== 'string') continue;
      for (const part of raw.split('|')) if (HEX64.test(part)) uids.add(part);
    }
  } catch { /* the periodic sweep remains the backstop */ }
  return [...uids];
}

function touchFromTx(tx) {
  const uids = new Set();
  for (const a of tx.nc_args_decoded || []) {
    if (typeof a === 'string' && HEX64.test(a)) uids.add(a);
  }
  for (const a of (tx.nc_context || {}).actions || []) {
    if (a.token_uid && HEX64.test(a.token_uid)) uids.add(a.token_uid);
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
const MAX_NAMES = Number(process.env.MAX_NAMES || 20000);
// names the operator manages by editing names.json directly; never claimable
// through the public endpoint, so nobody can impersonate the game or its staff
const RESERVED = new Set(['the crown', 'crown', 'emberfall', 'admin',
  'administrator', 'operator', 'official', 'support', 'team', 'mod', 'moderator']);
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
    const d = await nodeGet(`/thin_wallet/address_balance?address=${addr}`);
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
    const d = await nodeGet(`/thin_wallet/address_history?addresses[]=${addr}`);
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
  try { d = await nodeGet(`/transaction?id=${txId}`); }
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
  if (!signers.has(wanted)) {
    // v4 delegation: a session key may claim FOR its main identity — the
    // on-chain delegate binding is the proof the two are the same hand
    let delegated = false;
    for (const s of signers) {
      if ((await delegateOf(s)) === wanted) { delegated = true; break; }
    }
    if (!delegated) return deny(res, 403, 'claim was not signed by that address');
  }

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
      // every address the name has lived on: the player's on-chain lineage
      past: [...new Set([wanted, ...(entry.past || [])])]
        .filter(a => a !== heir).slice(0, 20),
      ...(reclaimHash || entry.reclaimHash
        ? { reclaimHash: reclaimHash || entry.reclaimHash } : {}),
    };
    saveNames();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, address: heir, name: entry.name }));
  }

  if (!NAME_RE.test(name)) return deny(res, 400, 'names are 3-16 letters, numbers, spaces or _');
  const lower = name.toLowerCase();
  if (RESERVED.has(lower)) return deny(res, 403, 'that name is reserved');
  let inheritedPast = null;
  for (const [a, n] of Object.entries(names)) {
    if (a !== wanted && n.name.toLowerCase() === lower) {
      // the name moves to the claimant only with proof of continuity: the
      // secret whose hash a previous claim sealed on-chain (same browser), or
      // the holder having signed the tx that first funded the claimant (a
      // wallet spawning its next session key). A name that ever sealed a
      // secret or carries a lineage is NOT surrendered by an empty balance
      // alone — that let anyone hijack a swept player's identity. Only a bare
      // legacy name (no secret, no lineage) still yields to an empty address.
      const secretOk = n.reclaimHash && typeof body.secret === 'string'
        && crypto.createHash('sha256').update(body.secret).digest('hex') === n.reclaimHash;
      let funderOk = false;
      if (!secretOk) {
        const fund = await firstFundingTx(wanted);
        const funders = new Set((fund && fund.inputs || [])
          .map(i => i.decoded && i.decoded.address).filter(Boolean));
        funderOk = funders.has(a);
      }
      const hasContinuity = !!n.reclaimHash || !!(n.past && n.past.length);
      const abandonedOk = !hasContinuity && await addressAbandoned(a);
      if (!(secretOk || funderOk || abandonedOk)) {
        return deny(res, 409, 'that name is already claimed by another');
      }
      inheritedPast = [a, ...(n.past || [])];
      delete names[a];
    }
  }
  if (!names[wanted] && !inheritedPast && Object.keys(names).length >= MAX_NAMES) {
    return deny(res, 507, 'name registry full, try later');
  }
  const ownPast = names[wanted]?.past; // renames keep their chain
  const prevName = names[wanted]?.name;
  names[wanted] = {
    name, tx: txId, ts: Math.floor(Date.now() / 1000),
    ...(inheritedPast || ownPast
      ? { past: [...new Set([...(inheritedPast || []), ...(ownPast || [])])].slice(0, 20) }
      : {}),
    ...(reclaimHash ? { reclaimHash } : {}),
  };
  saveNames();
  feedPush({ ts: Math.floor(Date.now() / 1000), kind: 'banner', who: wanted, name,
    ...(prevName && prevName !== name ? { prev: prevName } : {}) });
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
    // real deeds sit above the seeded ones, both in time order
    const merged = [...feed, ...(demo.feed || [])]
      .sort((a, b) => b.ts - a.ts).slice(0, 60);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ events: merged }));
  }

  /* Token metadata in ONE call. wallet-lib asks the node for each token it
     holds, one request apiece, so a 60-card collection meant 60 round trips
     that grew with the collection. Name and symbol are struck at creation and
     never change, so they are cached here for good and answered in bulk. */
  // a few bytes that say whether anything moved
  if (req.method === 'GET' && url.pathname === '/pulse') {
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(pulse));
  }

  if (req.method === 'GET' && url.pathname === '/tokens') {
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    const ids = (q.get('ids') || '').split(',').filter(u => HEX64.test(u)).slice(0, 60);
    const out = {};
    const missing = ids.filter(u => {
      const hit = tokenMeta.get(u);
      if (hit) { out[u] = hit; return false; }
      return true;
    });
    // the node is asked only for what we have never seen
    await Promise.all(missing.map(async u => {
      try {
        const r = await fetch(`${NODE}/thin_wallet/token?id=${u}`);
        const d = await r.json();
        if (d && d.success) {
          tokenMeta.set(u, d);
          if (tokenMeta.size > 5_000) tokenMeta.clear();
          out[u] = d;
        } else {
          out[u] = d || { success: false };
        }
      } catch { /* the client falls back to its own per-token call */ }
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
    return res.end(JSON.stringify(out));
  }

  // the realm's public numbers for the landing page. Cross-origin because
  // emberfall.fun is a separate static site; read-only and cached 60s.
  if (req.method === 'GET' && url.pathname === '/realm') {
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    const now = Date.now();
    if (!realmCache.at || now - realmCache.at > 60_000) {
      try {
        // The realm's deeds outlive a contract: v5 is a fresh instance, so
        // reading duels from it alone dropped the count from 8 to 0 the
        // moment we cut over. Every realm the game has run counts.
        const [v, legacy] = await Promise.all([
          ncCalls(NC, ['get_total_pulls()', 'get_duel_count()']),
          ncCalls(LEGACY_NCS[0], ['get_duel_count()']).catch(() => ({})),
        ]);
        const cards = Object.values(cardCache.cards);
        const duels = (v['get_duel_count()'] ?? 0) + (legacy['get_duel_count()'] ?? 0);
        realmCache.data = {
          summons: v['get_total_pulls()'] ?? null,
          duels: duels || null,
          // Sovereigns ever bound, retired ones included: they were summoned,
          // they are on the Ledger forever, and they are the rarest thing the
          // realm has done. Only their playability was retired.
          sovereigns: cards.length
            ? cards.filter(c => c.tier === 3).length + RETIRED_SOVEREIGNS
            : null,
          champions: cards.length ? cards.length + RETIRED_UIDS.size : null,
        };
        realmCache.at = now;
      } catch { /* serve whatever we last had; the page shows dashes if empty */ }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': 'https://emberfall.fun',
      'Vary': 'Origin',
    });
    return res.end(JSON.stringify(realmCache.data || {}));
  }

  if (req.method === 'GET' && url.pathname === '/cards') {
    // discover=1: a client just minted (pull/fuse) and the 15s feed poll may
    // not have seen it yet — diff the contract's balances and pull in any
    // token the cache does not know, so the reveal never races the poller
    if (url.searchParams.get('discover')) {
      try {
        const cur = await nodeGet(`/nano_contract/state?id=${NC}&balances[]=__all__`);
        const fresh = Object.keys(cur.balances || {})
          .filter(u => HEX64.test(u) && !cardCache.cards[u]);
        if (fresh.length) await refreshCards(fresh);
      } catch { /* discovery is best-effort; the poller remains the backstop */ }
    }
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    // ?touch=<uid,uid>: the caller just changed these cards; re-read them now
    const touch = (q.get('touch') || '').split(',')
      .filter(u => HEX64.test(u)).slice(0, 8);
    if (touch.length) await refreshCards(touch).catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(cardCache));
  }

  /* The authoritative nano seqnum for a caller. wallet-lib takes it from the
     wallet's own storage (addressInfo.seqnum + 1), so a session wallet whose
     history sync has fallen behind signs every nano tx with a stale nonce and
     the chain voids it: "invalid seqnum (diff=-28)". The chain knows the
     truth — every nano tx carries nc_seqnum — so serve the max seen for the
     address and let the client sign with max+1. */
  if (req.method === 'GET' && url.pathname === '/seqnum') {
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    const a = q.get('addr') || '';
    if (!/^[A-HJ-NP-Za-km-z1-9]{25,45}$/.test(a)) return deny(res, 400, 'bad address');
    // the poller-fed map is the primary truth (address_history paginates
    // per token and hid the newest nonces for busy sessions); the direct
    // read remains as a supplement for addresses the pollers never saw
    let next = seqnums.get(a) || 0;
    try {
      const d = await nodeGet(`/thin_wallet/address_history?addresses[]=${a}`);
      for (const tx of d.history || []) {
        if (tx.nc_address === a && Number.isInteger(tx.nc_seqnum)) {
          next = Math.max(next, tx.nc_seqnum + 1);
        }
      }
    } catch { /* unknown: the map and the client's own count stand */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ next }));
  }

  if (req.method === 'GET' && url.pathname === '/lineage') {
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    // every address the caller's banner name has lived on, newest first
    const a = q.get('addr') || '';
    let chain = [];
    for (const [holder, n] of Object.entries(names)) {
      if (holder === a || (n.past || []).includes(a)) {
        chain = [...new Set([holder, ...(n.past || [])])];
        break;
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ addrs: chain }));
  }

  if (req.method === 'GET' && url.pathname === '/names') {
    if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
    const flat = { ...demoNames };   // fixtures first: a real claim wins
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
    if (execDayLimited(ip)) return deny(res, 429, 'daily demo limit reached; connect your own wallet to keep playing');
    // forward ONLY the validated fields, never the raw body: any extra field
    // wallet-headless might honour would otherwise bypass validation
    const data = body.data || {};
    const clean = { nc_id: body.nc_id, method: body.method, address: body.address, data: {} };
    if (Array.isArray(data.args)) clean.data.args = data.args;
    if (Array.isArray(data.actions)) clean.data.actions = data.actions;
    return forward(res, `${WALLET}/wallet/nano-contracts/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wallet-id': WALLET_ID },
      body: JSON.stringify(clean),
    });
  }

  return deny(res, 403, 'forbidden');
}

const NODE_PREFIXES = ['/nano_contract/state', '/nano_contract/logs', '/transaction', '/thin_wallet/address_balance'];
/* The client's own reads go through here, and they were the last path still
   bound to a single node: when the partner node's balancer answered "no
   healthy upstream", that text reached the browser and surfaced as
   'Unexpected token o ... is not valid JSON' in the middle of a fusion. The
   same retry-then-fallback the server uses internally now covers them. */
async function handleNode(req, res, ip) {
  if (req.method !== 'GET') return deny(res, 403, 'forbidden');
  const rest = req.url.slice(5);
  if (!NODE_PREFIXES.some(p => rest.startsWith(p))) return deny(res, 403, 'forbidden');
  if (rateLimited(ip, 'read')) return deny(res, 429, 'rate limited');
  let last = null;
  for (let i = 0; i < 4; i++) {
    const now = Date.now();
    const base = [NODE, FALLBACK_NODE]
      .sort((a, b) => (sickUntil[a] > now) - (sickUntil[b] > now))[0];
    try {
      const r = await fetch(base + rest, { signal: AbortSignal.timeout(6000) });
      const buf = Buffer.from(await r.arrayBuffer());
      const text = buf.toString('utf8', 0, 64);
      // a 5xx, or a body that is plainly not JSON, is the balancer talking:
      // never hand that to a wallet that is about to JSON.parse it
      const bad = !r.ok || !/^\s*[[{]/.test(text);
      if (!bad) {
        res.writeHead(r.status, {
          'content-type': r.headers.get('content-type') || 'application/json',
        });
        return res.end(buf);
      }
      last = `${r.status} ${text.trim().slice(0, 40)}`;
      sickUntil[base] = Date.now() + 30_000;
    } catch (e) {
      last = e.message;
      sickUntil[base] = Date.now() + 30_000;
    }
    if (i < 3) await new Promise(r2 => setTimeout(r2, 300 * (i + 1)));
  }
  console.error('node read failed:', rest.slice(0, 60), last);
  return deny(res, 503, 'the node is not answering just now; try again in a moment');
}

// champion share pages: /c/<uid> serves the crawler meta X needs to show the
// art under a post (the web intent cannot attach images), then sends humans
// into the game with the card open
const STATIONS = ['Footman', 'Knight', 'Highlord', 'Sovereign'];
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function cardSharePage(req, res, uid) {
  const c0 = cardCache.cards[uid];
  const c = c0 && c0.name ? c0 : null;  // half-warmed entries read as unknown
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const origin = `${proto}://${req.headers.host}`;
  const slug = c ? c.name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-') : '';
  const art = slug && fs.existsSync(path.join(PUB, 'cards', `${slug}.jpg`))
    ? `${origin}/cards/${slug}.jpg` : `${origin}/logo.png`;
  const title = c ? `${c.name} · ${STATIONS[c.tier] || 'Footman'} ⚡${c.power}` : 'A champion of Emberfall';
  const asp = c && c.aspects ? c.aspects.split('|') : null;
  const desc = (asp ? `Attack ${asp[0]} · Defense ${asp[1]} · Cunning ${asp[2]} · ` : '')
    + 'a champion bound in soulstone in Emberfall, the fully onchain TCG on Hathor. Free on testnet.';
  // crawlers get a pure meta page: the instant meta-refresh let X's bot walk
  // into the SPA (which carries no card image) and cache an imageless card.
  // ?v=2 on the art dodges any imageless version X already cached.
  const bot = /Twitterbot|facebookexternalhit|Slackbot|Discordbot|TelegramBot|LinkedInBot|WhatsApp/i
    .test(req.headers['user-agent'] || '');
  const artV = `${art}?v=2`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escHtml(title)} · Emberfall</title>
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(desc)}">
<meta name="twitter:image" content="${escHtml(artV)}">
<meta name="twitter:image:alt" content="${escHtml(title)}">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:image" content="${escHtml(artV)}">
<meta property="og:image:secure_url" content="${escHtml(artV)}">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="1280">
<meta property="og:type" content="website">
<meta property="og:url" content="${escHtml(`${origin}/c/${uid}`)}">
${bot ? '' : `<meta http-equiv="refresh" content="0;url=/?card=${uid}">`}
<link rel="canonical" href="${escHtml(`${origin}/c/${uid}`)}">
</head><body>${bot ? '' : ''}<a href="/?card=${uid}">Open in Emberfall</a></body></html>`);
}

http.createServer(async (req, res) => {
  const ip = clientIp(req);
  try {
    if (req.url.startsWith('/api/')) return await handleApi(req, res, ip);
    if (req.url.startsWith('/node/')) return await handleNode(req, res, ip);
    const p0 = req.url.split('?')[0];
    if (req.method === 'GET' && p0.startsWith('/c/') && HEX64.test(p0.slice(3)))
      return cardSharePage(req, res, p0.slice(3));
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
