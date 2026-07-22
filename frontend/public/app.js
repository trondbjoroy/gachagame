/* GachaArena frontend. Reads chain state via /node proxy; writes via the
   selected wallet adapter (demo proxy, MetaMask Snap, or WalletConnect). */

const NC = window.GAME.nc;
const MKT = window.GAME.market; // {nc, blueprint} or null
const GEMS = window.GAME.gems;
const HTR = '00';
const CARD_AMT = 100; // one card = 100 base units ('1.00')
const ECON = window.GAME.economy || { sessionFund: 100, fusionFees: [5, 5, 5, 5] };
const fuseFeeFor = tier => ECON.fusionFees[tier] ?? 5;

const TIERS = [
  { name: 'Footman', color: 'var(--common)', pct: '60%', fallback: '🪓' },
  { name: 'Knight', color: 'var(--rare)', pct: '30%', fallback: '🛡️' },
  { name: 'Highlord', color: 'var(--epic)', pct: '9%', fallback: '🏰' },
  { name: 'Sovereign', color: 'var(--legendary)', pct: '1%', fallback: '👑' },
];
const fmtHtr = c => (c / 100).toFixed(2) + ' HTR';
const fmtGems = c => (c / 100).toFixed(2) + ' GEMS';
const short = u => u.slice(0, 10) + '…';
// banner name if the address claimed one, else the shortened address
const who = a => (a && S.names[a]) || short(a || '?');
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_ ]{1,14}[A-Za-z0-9_]$/;
const myAddrs = () => new Set([S.addr, S.wallet?.mainAddr].filter(Boolean));
const isMine = a => !!a && myAddrs().has(a);
const $ = id => document.getElementById(id);

const S = {
  wallet: null, addr: null, htr: 0, gemsWallet: 0,
  pullPrice: null, totalPulls: 0,
  cards: new Map(),      // uid -> {name,tier,power,aspects,wins,pending,staker,mine,pendingGems}
  gemsLedger: 0, wins: 0,
  renown: 0, vigil: 0, favorOwed: 0, favorPool: 0,
  duels: [], selected: new Set(), busy: false, mainWallet: null,
  listings: [], swaps: [], marketFunds: 0, raffle: null,
  names: {},             // address -> banner name (on-chain claims, server-indexed)
};

/* ---------------- chain reads ---------------- */

async function node(path) { return (await fetch('/node' + path)).json(); }
const ncState = qs => node(`/nano_contract/state?id=${NC}&` + qs);
const callQs = cs => cs.map(c => 'calls[]=' + encodeURIComponent(c)).join('&');

async function batchCalls(cs) {
  const chunks = [];
  for (let i = 0; i < cs.length; i += 30) chunks.push(cs.slice(i, i + 30));
  // all batches in flight at once: a large host costs one round trip, not many
  const results = await Promise.all(chunks.map(c => ncState(callQs(c))));
  const out = {};
  for (const d of results) {
    for (const [k, v] of Object.entries(d.calls || {})) out[k] = v.value;
  }
  return out;
}

async function loadContract(touch) {
  const now = Math.floor(Date.now() / 1000);
  // the heavy per-card state comes pre-warmed from our server's cache (one
  // request); everything below reads only globals and per-player views
  const cardsP = fetch('/api/cards' + (touch && touch.length
    ? '?touch=' + touch.slice(0, 8).join(',') : '')).then(r => r.json());
  const base = await ncState('fields[]=total_pulls' + '&' +
    callQs(['get_pull_price()', 'get_duel_count()', 'get_writ_count()',
            `get_trial_today(${now})`, 'get_delve_seconds()']));
  // a rate-limited or hiccuping node answers without fields: name the real
  // problem instead of crashing on the first missing property
  if (!base || !base.fields) {
    throw new Error(base?.error === 'rate limited'
      ? 'too many requests; wait a moment and try again'
      : 'could not reach the network; try again in a moment');
  }
  S.totalPulls = base.fields.total_pulls.value;
  S.pullPrice = base.calls['get_pull_price()'].value;
  const duelCount = base.calls['get_duel_count()'].value;
  const writCount = base.calls['get_writ_count()']?.value || 0;
  S.trialToday = base.calls[`get_trial_today(${now})`]?.value ?? null;
  S.delveSeconds = base.calls['get_delve_seconds()']?.value || 28800;

  const writsP = (writCount && (!S.writs || S.writs.length !== writCount))
    ? batchCalls([...Array(writCount).keys()].map(i => `get_writ(${i})`))
    : null;

  const payload = await cardsP;
  for (const [u, d] of Object.entries(payload.cards || {})) {
    const c = S.cards.get(u) || { uid: u, mine: false, pendingGems: 0 };
    c.name = d.name; c.tier = d.tier; c.power = d.power;
    // [valor, bulwark, guile, tempers, hardened, xp, level, vet]
    c.aspects = d.aspects ? d.aspects.split('|').map(Number) : null;
    c.level = c.aspects?.[6] || 0;
    c.wins = d.wins; c.cosmetics = d.cosmetics;
    c.pending = d.pending; c.staker = d.staker;
    c.delveSince = d.delveSince; c.temperCost = d.temperCost;
    S.cards.set(u, c);
  }

  if (writsP) {
    const wq = await writsP;
    S.writs = [...Array(writCount).keys()].map(i => {
      const [name, v, b, g] = (wq[`get_writ(${i})`] || '|||').split('|');
      return { id: i, name, valor: +v, bulwark: +b, guile: +g };
    });
  }

  // per-player, time-sensitive card views: only the caller's staked cards
  const stakedMine = [...S.cards.values()]
    .filter(c => c.tier >= 0 && c.staker === S.addr).map(c => c.uid);
  if (stakedMine.length) {
    const pg = await batchCalls(stakedMine.flatMap(u =>
      [`get_pending_gems("${u}", ${now})`, `get_writ_attempts("${u}", ${now})`]));
    for (const u of stakedMine) {
      const c = S.cards.get(u);
      c.pendingGems = pg[`get_pending_gems("${u}", ${now})`] || 0;
      c.writFights = pg[`get_writ_attempts("${u}", ${now})`] || 0;
    }
  }

  if (S.addr) {
    // reputation is keyed per address on-chain, but the PLAYER spans their
    // current key, their main wallet, this device's retired sessions, and
    // every address their banner name has lived on (server-tracked, so it
    // works across devices): sum renown and wins across the whole lineage
    const lineage = new Set([S.addr, S.wallet?.mainAddr].filter(Boolean));
    try {
      for (const e of JSON.parse(localStorage.getItem(SESSION_LS + '_archive') || '[]')) {
        const a = e.addr || e.address;
        if (a) lineage.add(a);
      }
    } catch { /* archive is optional */ }
    try {
      const keys = [...new Set([S.addr, S.wallet?.mainAddr].filter(Boolean))];
      const chains = await Promise.all(keys.map(a =>
        fetch(`/api/lineage?addr=${a}`).then(r => r.json()).catch(() => ({}))));
      for (const li of chains) for (const a of li.addrs || []) lineage.add(a);
    } catch { /* lineage is a bonus, not a dependency */ }
    const others = [...lineage].filter(a => a !== S.addr).slice(0, 12);
    S.lineage = lineage;  // deeds and standing read the whole family too
    const me = await batchCalls([`get_gems_balance("${S.addr}")`, `get_wins("${S.addr}")`,
      `get_renown("${S.addr}")`, `get_vigil_streak("${S.addr}")`, `get_favor_owed("${S.addr}")`,
      'get_favor_pool()', `get_shards("${S.addr}")`, `get_gauntlet_cleared("${S.addr}")`,
      `get_trial_done("${S.addr}", ${now})`,
      ...others.flatMap(a => [`get_renown("${a}")`, `get_wins("${a}")`, `get_gems_balance("${a}")`])]);
    S.shards = me[`get_shards("${S.addr}")`] || 0;
    S.cleared = me[`get_gauntlet_cleared("${S.addr}")`] || 0;
    S.trialDoneChain = me[`get_trial_done("${S.addr}", ${now})`] === true;
    S.gemsLedger = me[`get_gems_balance("${S.addr}")`] || 0;
    const winsNow = (me[`get_wins("${S.addr}")`] || 0)
      + others.reduce((s, a) => s + (me[`get_wins("${a}")`] || 0), 0);
    // covers wins as challenger too (someone answered while we were away)
    if (S.prevWins !== undefined && winsNow > S.prevWins) window.trialEvent?.('duel_win');
    S.prevWins = winsNow;
    S.wins = winsNow;
    S.renown = (me[`get_renown("${S.addr}")`] || 0)
      + others.reduce((s, a) => s + (me[`get_renown("${a}")`] || 0), 0);
    // gems held on other addresses of the lineage: counted for deeds,
    // never spendable from here (the contract keys ledgers per address)
    S.gemsLineageExtra = others.reduce((s, a) => s + (me[`get_gems_balance("${a}")`] || 0), 0);
    S.vigil = me[`get_vigil_streak("${S.addr}")`] || 0;
    S.favorOwed = me[`get_favor_owed("${S.addr}")`] || 0;
    S.favorPool = me['get_favor_pool()'] || 0;
  }

  if (duelCount > 0) {
    const ids = [...Array(duelCount).keys()];
    const dd = await batchCalls(ids.flatMap(i => [`get_duel(${i})`, `get_duel_challenger(${i})`]));
    S.duels = ids.map(i => {
      const [status, card, wager] = (dd[`get_duel(${i})`] || '||').split('|');
      return { id: i, status, card, wager: Number(wager || 0), challenger: dd[`get_duel_challenger(${i})`] };
    }).reverse();
  } else S.duels = [];
}

async function loadMarket() {
  if (!MKT) return;
  const mkState = qs => node(`/nano_contract/state?id=${MKT.nc}&` + qs);
  const mCalls = async cs => {
    const chunks = [];
    for (let i = 0; i < cs.length; i += 30) chunks.push(cs.slice(i, i + 30));
    const results = await Promise.all(chunks.map(c => mkState(callQs(c))));
    const out = {};
    for (const d of results) {
      for (const [k, v] of Object.entries(d.calls || {})) out[k] = v.value;
    }
    return out;
  };
  const base = await mCalls(['get_listing_count()', 'get_swap_count()']
    .concat(S.addr ? [`get_funds("${S.addr}")`] : []));
  S.marketFunds = S.addr ? (base[`get_funds("${S.addr}")`] || 0) : 0;
  const ln = base['get_listing_count()'] || 0, sn = base['get_swap_count()'] || 0;
  const cs = [];
  for (let i = 0; i < ln; i++) cs.push(`get_listing(${i})`, `get_listing_seller(${i})`);
  for (let i = 0; i < sn; i++) cs.push(`get_swap(${i})`, `get_swap_maker(${i})`);
  for (const c of S.cards.values()) cs.push(`get_pending_owner("${c.uid}")`);
  const d = await mCalls(cs);
  S.listings = [...Array(ln).keys()].map(i => {
    const [status, card, price] = (d[`get_listing(${i})`] || '||').split('|');
    return { id: i, status, card, price: Number(price || 0), seller: d[`get_listing_seller(${i})`] };
  }).reverse();
  S.swaps = [...Array(sn).keys()].map(i => {
    const [status, give, want] = (d[`get_swap(${i})`] || '||').split('|');
    return { id: i, status, give, want, maker: d[`get_swap_maker(${i})`] };
  }).reverse();
  for (const c of S.cards.values()) c.marketPending = d[`get_pending_owner("${c.uid}")`] ?? null;
}

async function loadMine() {
  if (!S.wallet) return;
  S.htr = await S.wallet.htrBalance().catch(() => 0);
  S.gemsWallet = await S.wallet.tokenBalance(GEMS).catch(() => 0);
  for (const c of S.cards.values()) {
    if (c.tier < 0) { c.mine = false; continue; }
    if (c.pending || c.staker || c.marketPending) { c.mine = false; continue; } // in custody
    c.mine = (await S.wallet.tokenBalance(c.uid).catch(() => 0)) > 0;
  }
}

async function loadRaffle() {
  try {
    const r = await fetch('/raffle.json');
    if (r.ok) S.raffle = await r.json();
  } catch { /* raffle display is optional */ }
}

/* ---------------- realm activity feed ---------------- */

const WRIT_TIER_NAMES = ['Grim', 'Dire', 'Black'];

function agoText(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function feedLine(ev) {
  const name = `<b>${who(ev.who)}</b>`;
  switch (ev.kind) {
    case 'pull': return ev.card
      ? `${name} summoned <b>${ev.card}</b>`
      : `${name} summoned a champion`;
    case 'fuse': return ev.card
      ? `${name} fused two champions into <b>${ev.card}</b>`
      : `${name} fused two champions`;
    case 'writ': return `${name} fought boss <b>${ev.writ}</b> (${WRIT_TIER_NAMES[ev.tier] || 'Grim'})`;
    case 'challenge': return ev.wager > 0
      ? `${name} posted a duel · ${fmtGems(ev.wager)} wager`
      : `${name} posted a free duel`;
    case 'answer': return `${name} answered duel #${ev.id}`;
    case 'delve': return `${name} started a delve`;
    case 'delve_done': return `${name} returned from a delve`;
    case 'temper': return `${name} tempered a champion`;
    case 'banner': return `<b>${ev.name}</b> joined the game`;
    default: return null;
  }
}

async function loadFeed() {
  try {
    const r = await fetch('/api/feed');
    if (!r.ok) return;
    const d = await r.json();
    const rows = (d.events || []).slice(0, 8)
      .map(ev => ({ ev, line: feedLine(ev) }))
      .filter(x => x.line)
      .map(x => `<div class="feed-row"><span class="feed-ago mono">${agoText(x.ev.ts)}</span>
        <span>${x.line}</span></div>`);
    $('feedPanel').hidden = rows.length === 0;
    $('feedList').innerHTML = rows.join('');
  } catch { /* the feed is decorative */ }
}

async function loadNames() {
  try {
    const r = await fetch('/api/names');
    if (r.ok) S.names = await r.json();
  } catch { /* names are cosmetic; addresses still show */ }
}

async function refresh(touch) {
  // independent reads run together; only loadMarket (flags cards) and
  // loadMine (needs the card set) wait for the contract
  await Promise.all([
    loadContract(touch),
    loadRaffle(),
    loadNames(),
    loadFeed(),
  ]);
  await loadMarket().catch(() => {});
  await loadMine();
  render();
  maybeAutoClaim();
}

/* in promptless sessions, claimable champions walk home by themselves */
const autoClaimed = new Set();
let autoClaimBusy = false;
async function maybeAutoClaim() {
  if (S.wallet?.mode !== 'session' || autoClaimBusy || !S.addr) return;
  // a claimed card can become pending again (e.g. returning from a duel):
  // clear the attempted-mark once a card is no longer pending for us
  for (const uid of [...autoClaimed]) {
    const c = S.cards.get(uid);
    if (!c || (c.pending !== S.addr && c.marketPending !== S.addr)) autoClaimed.delete(uid);
  }
  const next = [...S.cards.values()].find(c => c.tier >= 0
    && (c.pending === S.addr || c.marketPending === S.addr) && !autoClaimed.has(c.uid));
  if (!next) return;
  autoClaimBusy = true;
  autoClaimed.add(next.uid);
  const fromMarket = next.marketPending === S.addr && next.pending !== S.addr;
  const h = await doTx('Champion coming home', 'claim_card', [], [wdAct(next.uid, CARD_AMT)],
    fromMarket ? { target: MKT } : {});
  autoClaimBusy = false;
  if (h) crashLand(next.uid, next.tier);
  maybeAutoClaim();
}

/* ---------------- rendering ---------------- */

function slugOf(name) { return name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-'); }
function cardMeta(name) { return (window.CATALOG || {})[name]; }

/* ---------------- deeds & standing (read from what the Ledger already knows) ---------------- */

const TITLES = ['Wanderer', 'Footman', 'Man-at-Arms', 'Knight', 'Banneret', 'Highlord', "Sovereign's Hand"];
// deeds witnessed → level; gaps widen so the last titles demand real time and coin
const LEVEL_AT = [0, 2, 4, 7, 10, 14, 18];

const DEEDS = [
  { id: 'first-muster', name: 'First Muster', desc: 'Have a champion sworn to your banner', test: s => s.owned.length >= 1 },
  { id: 'delver', name: 'Delver of the Deep', desc: 'Have a champion mining', test: s => s.staked >= 1 },
  { id: 'knighted', name: 'Knight of the Realm', desc: 'Have a champion of Knight rarity or higher', test: s => s.owned.some(c => c.tier >= 1) },
  { id: 'first-blood', name: 'First Blood', desc: 'Win a duel', test: s => s.wins >= 1 },
  { id: 'warband', name: 'Raise a Warband', desc: 'Have five champions at once', test: s => s.owned.length >= 5 },
  { id: 'gem-hoard', name: 'Gem-Hoarder', desc: 'Hold 2.00 gems or more', test: s => s.gems >= 200 },
  { id: 'high-court', name: 'Court of Highlords', desc: 'Have a Highlord in your collection', test: s => s.owned.some(c => c.tier >= 2) },
  { id: 'muster-four', name: 'Muster of Four', desc: 'Hold all four stations at once', test: s => new Set(s.owned.map(c => c.tier)).size >= 4 },
  { id: 'host', name: 'Raise a Host', desc: 'Have twelve champions at once', test: s => s.owned.length >= 12 },
  { id: 'pit-fighter', name: 'Pit Fighter', desc: 'Win five duels', test: s => s.wins >= 5 },
  { id: 'gathering-storm', name: 'The Gathering Storm', desc: 'Command 300 combined power', test: s => s.power >= 300 },
  { id: 'mine-master', name: 'Master of the Mines', desc: 'Have five champions mining at once', test: s => s.staked >= 5 },
  { id: 'gem-baron', name: 'Gem-Baron', desc: 'Hold 10.00 gems or more', test: s => s.gems >= 1000 },
  { id: 'sovereign', name: "Sovereign's Own", desc: 'Have a Sovereign in your collection', test: s => s.owned.some(c => c.tier >= 3) },
  { id: 'army', name: 'Raise an Army', desc: 'Have twenty-five champions at once', test: s => s.owned.length >= 25 },
  { id: 'pit-champion', name: 'Pit Champion', desc: 'Win fifteen duels', test: s => s.wins >= 15 },
  { id: 'storm-banners', name: 'Storm of Banners', desc: 'Command 750 combined power', test: s => s.power >= 750 },
  { id: 'legion', name: 'The Legion of Emberfall', desc: 'Have forty champions at once', test: s => s.owned.length >= 40 },
];

function deedState() {
  // the standing follows the player, not the key: cards and gems held by
  // any address in the lineage (main wallet, past sessions) count too
  const fam = S.lineage && S.lineage.size ? S.lineage : new Set(S.addr ? [S.addr] : []);
  const owned = [...S.cards.values()].filter(c => c.tier >= 0 &&
    (c.mine || fam.has(c.staker) || fam.has(c.pending) || fam.has(c.marketPending)));
  return {
    owned,
    staked: owned.filter(c => fam.has(c.staker)).length,
    gems: S.gemsLedger + S.gemsWallet + (S.gemsLineageExtra || 0),
    wins: S.wins,
    power: owned.reduce((a, c) => a + (c.power || 0), 0),
  };
}

function computeDeeds() {
  const s = deedState();
  return DEEDS.map(d => ({ ...d, done: S.addr ? !!d.test(s) : false }));
}

function levelFor(doneCount) {
  let lvl = 1;
  for (let i = 0; i < LEVEL_AT.length; i++) if (doneCount >= LEVEL_AT[i]) lvl = i + 1;
  return lvl; // 1..7
}
function titleFor(doneCount) { return TITLES[levelFor(doneCount) - 1]; }
function standingLabel(doneCount) { return `Level ${levelFor(doneCount)} · ${titleFor(doneCount)}`; }

function announceNewDeeds(deeds) {
  if (!S.addr) return;
  const key = 'emberfall_deeds_' + S.addr;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key)); } catch { }
  const first = saved == null;  // first sync: record silently, no ribbon storm
  const seen = Array.isArray(saved) ? saved : (saved && saved.deeds) || [];
  const prevLevel = Array.isArray(saved) ? null : saved && saved.level;
  const done = deeds.filter(d => d.done).map(d => d.id);
  for (const id of done) if (!seen.includes(id)) {
    track('deed_complete', { deed: id });
    if (!first) {
      const d = DEEDS.find(x => x.id === id);
      ribbon(`⚜ Achievement: <b>${d ? d.name : id}</b>`, null, 'deed');
    }
  }
  const lvl = levelFor(done.length);
  if (!first && prevLevel != null && lvl > prevLevel)
    ribbon(`Level up: <b>${lvl} · ${TITLES[lvl - 1]}</b>`, 'level', 'deed');
  localStorage.setItem(key, JSON.stringify({ deeds: done, level: lvl }));
}

/* ---------------- ribbons (deed / level announcements) ---------------- */

const ribbonQ = [];
let ribbonBusy = false;
function ribbon(html, cls, sound) {
  ribbonQ.push([html, cls, sound]);
  pumpRibbons();
}
function pumpRibbons() {
  if (ribbonBusy || !ribbonQ.length) return;
  ribbonBusy = true;
  const [html, cls, sound] = ribbonQ.shift();
  const el = document.createElement('div');
  el.className = 'ribbon' + (cls ? ' ' + cls : '');
  el.innerHTML = html;
  document.body.appendChild(el);
  if (sound) window.sfx?.(sound);
  setTimeout(() => el.classList.add('show'), 30);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.remove(); ribbonBusy = false; pumpRibbons(); }, 500);
  }, 3600);
}

/* ---------------- stat count-ups ---------------- */

const COUNTED_STATS = ['Your gems', 'Your duels won', 'Your renown'];
const statPrev = {};
function animateStatEl(el, key) {
  const text = el.textContent;
  const prev = statPrev[key];
  statPrev[key] = text;
  if (REDUCED || prev == null || prev === text || !COUNTED_STATS.includes(key)) return;
  const m = text.match(/-?\d+(?:\.\d+)?/), pm = prev.match(/-?\d+(?:\.\d+)?/);
  if (!m || !pm) return;
  const to = parseFloat(m[0]), from = parseFloat(pm[0]);
  if (!(to > from)) return;  // only count upward — losses shouldn't linger
  const decimals = (m[0].split('.')[1] || '').length;
  const pre = text.slice(0, m.index), post = text.slice(m.index + m[0].length);
  const t0 = performance.now(), dur = 650;
  let done = false;
  function step(now) {
    if (done) return;
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = pre + (from + (to - from) * e).toFixed(decimals) + post;
    if (p < 1) requestAnimationFrame(step); else done = true;
  }
  requestAnimationFrame(step);
  // rAF is suspended in hidden tabs — always land on the true value
  setTimeout(() => { done = true; el.textContent = text; }, dur + 120);
}

const FRAMES = ['Ember', 'Silver', 'Gold', 'Void'];
const EPITHETS = ['the Unbowed', 'Thrice-Forged', 'of the Deep Seam', 'the Oathkeeper',
  'Writ-Feller', 'the Ember-Marked', 'of the Long Vigil', 'the Pale', 'Stonefast',
  'the Whisperblade', 'Crownless', 'the Last Banner'];
const WRIT_TIERS = ['Grim', 'Dire', 'Black'];

function cosmeticsOf(c) {
  const cos = c.cosmetics || 0;
  return { frame: cos & 0xFF, tint: (cos >> 8) & 0xFF, epithet: (cos >> 16) & 0xFF };
}

function aspectsRow(c) {
  if (!c.aspects) return '';
  const [v, b, g, t, h] = c.aspects;
  const marks = (t > 0 ? ` · tempered ×${t}` : '') + (h > 0 ? ` · hardened ×${h}` : '');
  return `<div class="ac-aspects" title="attack · defense · cunning${marks}">
    ⚔ ${v} &nbsp; 🛡 ${b} &nbsp; 🗡 ${g}</div>`;
}

function stationLine(c, t, meta) {
  return `${t.name}${meta ? ' · ' + meta.type : ''}`
    + `${c.level > 0 ? ` · Lv ${c.level}` : ''}${c.wins > 0 ? ` · ★ ${c.wins}` : ''}`;
}

function cardBox(c, buttonsHtml, selectable) {
  const t = TIERS[c.tier] || TIERS[0];
  const sel = S.selected.has(c.uid) ? ' selected' : '';
  const meta = cardMeta(c.name);
  const cos = cosmeticsOf(c);
  const cosCls = (cos.frame ? ` cframe-${cos.frame}` : '') + (cos.tint ? ` ctint-${cos.tint}` : '');
  const epLine = cos.epithet && EPITHETS[cos.epithet - 1]
    ? `<div class="ac-epithet">${EPITHETS[cos.epithet - 1]}</div>` : '';
  if (meta?.art) {
    return `<div class="card art-card${sel}${cosCls}" style="--rc:${t.color}" data-open="${c.uid}">
      <img class="ac-img" loading="lazy" src="cards/${slugOf(c.name)}.jpg" alt="">
      <div class="ac-scrim"></div>
      <div class="ac-top"><span class="ac-name">${c.name}</span><span class="ac-power">⚡${c.power}</span></div>
      <div class="ac-bottom">
        ${epLine}
        <div class="ac-station" style="color:${t.color}">${stationLine(c, t, meta)}</div>
        ${aspectsRow(c)}
        <div class="ac-flavor">${meta.flavor}</div>
        ${buttonsHtml || ''}
      </div>
    </div>`;
  }
  return `<div class="card${sel}${cosCls}" style="--rc:${t.color}" data-open="${c.uid}">
    <div class="emoji">${artSvg(c.name)}</div>
    <div class="name">${c.name}</div>
    ${epLine}
    <div class="tier">${stationLine(c, t, null)} · ⚡${c.power}</div>
    ${aspectsRow(c)}
    ${buttonsHtml || ''}
  </div>`;
}

function rowArt(c) {
  if (!c) return '?';
  const meta = cardMeta(c.name);
  return meta?.art ? `<img class="row-thumb" loading="lazy" src="cards/${slugOf(c.name)}.jpg" alt="">`
    : artSvg(c.name, 'card-art duel-art');
}

/* the delve is an appointment; the appointment should announce itself:
   a badge on The Mines tab and a counter in the browser tab title */
function updateCues() {
  const ready = [...S.cards.values()].filter(c =>
    S.addr && c.staker === S.addr && (c.delveSince || 0) > 0
    && Date.now() >= (c.delveSince + (S.delveSeconds || 28800)) * 1000).length;
  const tab = document.querySelector('.tab[data-tab="farm"]');
  let badge = tab.querySelector('.tab-badge');
  if (ready > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-badge';
      tab.appendChild(badge);
    }
    badge.textContent = ready;
  } else if (badge) {
    badge.remove();
  }
  document.title = ready > 0 ? `(${ready}) Emberfall` : 'Emberfall';
}
setInterval(updateCues, 30_000); // countdowns cross zero between refreshes

function render() {
  updateCues();
  $('walletDot').className = 'dot' + (S.addr ? '' : ' off');
  $('walletBtn').classList.toggle('beckon', !S.addr && !S.restoring);
  // a banner name stands alone in the chip (the hint span names the wallet
  // kind already); otherwise wallet kind + shortened address
  $('walletAddr').textContent = S.addr
    ? (S.names[S.addr] || `${S.wallet.label.split(' ')[0]} · ${short(S.addr)}`)
    : (S.restoring ? 'Connecting…' : 'Connect wallet');
  $('walletHtr').textContent = S.addr ? fmtHtr(S.htr) : '';
  $('walletHtr').title = S.addr ? 'Balance on your main address only; your wallet shows the full total' : '';
  $('walletHint').textContent = S.addr ? (S.wallet?.mode === 'session' ? 'session' : 'this address') : '';
  const hsb = $('headerSessionBtn');
  hsb.hidden = !S.addr;
  const inSess = S.wallet?.mode === 'session';
  // long and short labels; CSS picks per width so the chip never gets cut
  hsb.innerHTML = inSess
    ? '\u26a1 <span class="hs-l">SESSION ACTIVE</span><span class="hs-s">SESSION</span>'
    : '\u26a1 <span class="hs-l">QUICK PLAY</span><span class="hs-s">PLAY</span>';
  hsb.classList.toggle('active', inSess);
  syncSessionBox();

  $('odds').innerHTML = TIERS.map(t =>
    `<div class="odd"><span class="swatch" style="background:${t.color}"></span>
     <b style="color:${t.color}">${t.name}</b><span class="pct">${t.pct}</span></div>`).join('');

  // wallets may hold funds on addresses we cannot see; the wallet itself gates affordability
  const canPull = S.addr && S.pullPrice != null;
  $('pullBtn').disabled = !canPull;
  $('pullCost').textContent = S.pullPrice != null ? fmtHtr(S.pullPrice) : '…';
  $('pullNote').innerHTML = !S.addr ? 'Connect a wallet to play.' :
    S.htr < (S.pullPrice ?? 0) ? `Not enough HTR: <a href="https://faucet.testnet.hathor.network" target="_blank">claim free coin</a> → <span class="mono">${S.addr}</span>` :
    'Speak, and the Weaver answers within moments.';

  const me = v => S.addr ? v : '—';
  const deeds = computeDeeds();
  const deedsDone = deeds.filter(d => d.done).length;
  announceNewDeeds(deeds);
  $('statsRow').innerHTML = [
    // one number for the player; the ledger/wallet split (real, but bridged
    // automatically on every deed) is managed in The Mines
    ['Your gems', me(fmtGems(S.gemsLedger + S.gemsWallet))],
    ['Your duels won', me(S.wins)],
    ['Your renown', me(S.renown + (S.vigil > 1 ? ` · ${S.vigil}d streak` : ''))],
    ['Your level', me(`${levelFor(deedsDone)} · ${titleFor(deedsDone)}`)],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  // the Weaver's favor: claimable winnings under the summon button
  const fn = $('favorNote');
  if (fn) {
    fn.hidden = !(S.addr && S.favorOwed > 0);
    if (!fn.hidden) fn.innerHTML =
      `You won a <b>${fmtHtr(S.favorOwed)}</b> refund <button class="mini-btn" id="favorClaimBtn">CLAIM</button>`;
    const fb = $('favorClaimBtn');
    if (fb) fb.onclick = async () => {
      const h = await doTx('Claiming your refund', 'claim_favor', [], [wdAct(HTR, S.favorOwed)]);
      if (h) window.sfx?.('coin');
    };
  }
  $('statsRow').querySelectorAll('.stat').forEach(s =>
    animateStatEl(s.querySelector('.v'), s.querySelector('.k').textContent));

  // deeds of renown (Codex)
  const lvl = levelFor(deedsDone);
  const toNext = lvl >= TITLES.length ? 0 : LEVEL_AT[lvl] - deedsDone;
  $('deedsSummary').innerHTML = !S.addr
    ? 'Connect a wallet to start earning achievements.'
    : `You are <b>${standingLabel(deedsDone)}</b> with ${deedsDone} of ${DEEDS.length} achievements earned.` +
      (toNext > 0 ? ` ${toNext} more and you reach <b>Level ${lvl + 1} · ${TITLES[lvl]}</b>.`
                  : ' No higher standing exists in the realm.');
  $('deedsGrid').innerHTML = deeds.map(d => `
    <div class="deed${d.done ? ' done' : ''}">
      <span class="deed-mark">${d.done ? '✦' : '·'}</span>
      <div><b>${d.name}</b><div class="deed-desc">${d.desc}</div></div>
    </div>`).join('');

  // the Weaver's weekly favor (drawn from renown earned this week)
  const rl = $('raffleLine');
  if (rl) {
    if (S.raffle) {
      const days = Math.max(0, Math.ceil((S.raffle.week_ends * 1000 - Date.now()) / 86400000));
      const last = (S.raffle.winners || []).slice(-1)[0];
      rl.hidden = false;
      rl.innerHTML = `<b>The Weaver's weekly favor:</b> every point of renown earned this week is a
        ticket in her weekly drawing. This week's pot holds <b>${fmtHtr(S.raffle.pool)}</b> from
        summon proceeds; the Weaver draws in ${days} day${days === 1 ? '' : 's'}.` +
        (last && last.winner ? ` Last week her favor fell on <span class="mono">${last.winner}</span> (${fmtHtr(last.prize)}).` : '');
    } else rl.hidden = true;
  }

  // collection, mightiest first
  const mine = [...S.cards.values()].filter(c => c.mine)
    .sort((a, b) => (b.power - a.power) || a.name.localeCompare(b.name));
  $('collectionCards').innerHTML = mine.map(c => cardBox(c, `
    <div class="row-btns">
      <button class="mini-btn alt" data-stake="${c.uid}">MINE</button>
      <button class="mini-btn alt" data-duel="${c.uid}">FIGHT</button>
      ${MKT ? `<button class="mini-btn alt" data-sell="${c.uid}">SELL</button>
      <button class="mini-btn alt" data-trade="${c.uid}">TRADE</button>` : ''}
    </div>`, true)).join('');
  $('collectionEmpty').hidden = mine.length > 0;

  const inSession = S.wallet?.mode === 'session';
  const pend = [...S.cards.values()].filter(c => S.addr && c.tier >= 0 && c.pending === S.addr);
  $('pendingCards').innerHTML = pend.map(c =>
    cardBox(c, inSession
      ? '<div class="pending-gems">coming home…</div>'
      : `<button class="claim-mini" data-claim="${c.uid}">CLAIM</button>`)).join('');
  $('pendingWrap').hidden = pend.length === 0;

  const selCount = S.selected.size;
  $('fuseBar').hidden = mine.length < 2;
  const fuseReady = selCount === 2 && sameTierSelected();
  const selTier = fuseReady ? S.cards.get([...S.selected][0]).tier : 0;
  const fuseFee = fuseFeeFor(selTier);
  const canPayFuse = S.gemsLedger + S.gemsWallet >= fuseFee;
  $('fuseHint').textContent = !fuseReady ? 'Press and hold two champions of the same rarity to select them.'
    : (S.gemsLedger >= fuseFee ? `Fuse into the next rarity for ${fmtGems(fuseFee)}:`
       : canPayFuse ? `Forge for ${fmtGems(fuseFee)} (gems move to your ledger first):`
       : `Fusion costs ${fmtGems(fuseFee)}; you have ${fmtGems(S.gemsLedger + S.gemsWallet)}. Earn more by mining.`);
  $('fuseBtn').disabled = !(fuseReady && canPayFuse);

  // farm
  const staked = [...S.cards.values()].filter(c => S.addr && c.tier >= 0 && c.staker === S.addr);
  $('farmSummary').innerHTML = `
    <div class="stat"><div class="k">Ledger balance</div><div class="v">${fmtGems(S.gemsLedger)}${
      S.gemsWallet >= 1 ? ` <small>· ${fmtGems(S.gemsWallet)} in hand</small>` : ''}</div>
      <div class="row-btns">
        <button class="mini-btn" id="wdGemsBtn" ${S.gemsLedger < 1 ? 'disabled' : ''}>WITHDRAW ALL</button>
        <button class="mini-btn alt" id="depGemsBtn" ${S.gemsWallet < 1 ? 'disabled' : ''}>DEPOSIT WALLET GEMS</button>
      </div></div>
    <div class="stat"><div class="k">Farm rates /min</div><div class="v"><small>C 0.01 · R 0.03 · E 0.10 · L 0.40</small></div></div>
    <div class="stat"><div class="k">Relic shards</div><div class="v">${S.shards || 0} <small>· from delves · dress your champions</small></div></div>`;
  $('stakedCards').innerHTML = staked.map(c => {
    const delving = (c.delveSince || 0) > 0;
    const doneAt = ((c.delveSince || 0) + (S.delveSeconds || 28800)) * 1000;
    const ready = delving && Date.now() >= doneAt;
    const mins = Math.max(0, Math.ceil((doneAt - Date.now()) / 60000));
    return cardBox(c, `
    <div class="pending-gems">${delving
      ? (ready ? '🕯️ the delve is done' : `🕯️ delving · ${Math.floor(mins / 60)}h ${mins % 60}m left`)
      : `⛏️ ${fmtGems(c.pendingGems)} pending`}</div>
    <div class="row-btns">
      ${delving
        ? (ready ? `<button class="mini-btn" data-claimdelve="${c.uid}">CLAIM DELVE</button>` : '')
        : `<button class="mini-btn" data-claimgems="${c.uid}" ${c.pendingGems < 1 ? 'disabled' : ''}>CLAIM</button>
      <button class="mini-btn alt" data-unstake="${c.uid}">UNSTAKE</button>
      ${c.temperCost > 0 ? `<button class="mini-btn alt" data-temper="${c.uid}">TEMPER</button>` : ''}
      <button class="mini-btn alt" data-delve="${c.uid}">DELVE</button>
      <button class="mini-btn alt" data-dress="${c.uid}">STYLE</button>`}
    </div>`);
  }).join('');
  $('stakedEmpty').hidden = staked.length > 0;

  // arena: spectators see only open challenges; settled history needs a sworn wallet
  $('newDuelBtn').disabled = !S.addr;
  $('newDuelBtn').title = S.addr ? '' : 'Connect a wallet to issue a challenge';
  const duelsShown = S.addr ? S.duels : S.duels.filter(d => d.status === 'open');
  $('duelList').innerHTML = duelsShown.map(d => {
    const c = S.cards.get(d.card);
    const t = TIERS[c?.tier ?? 0] || TIERS[0];
    const mineD = isMine(d.challenger);
    const cancellable = d.challenger === S.addr;
    return `<div class="duel ${d.status}">
      <span class="duel-emoji">${rowArt(c)}</span>
      <div class="duel-info">
        <b>${c?.name ?? '?'}</b> <span style="color:${t.color}">⚡${c?.power ?? '?'}</span>
        <div class="duel-meta">#${d.id} · wager ${fmtGems(d.wager)} · by ${mineD ? 'you' : who(d.challenger)}</div>
      </div>
      ${d.status === 'open'
        ? (mineD
          ? (cancellable
            ? `<button class="mini-btn alt" data-cancelduel="${d.id}">CANCEL</button>`
            : '<span class="duel-done">yours · main wallet</span>')
          : (S.addr
            ? `<button class="mini-btn" data-acceptduel="${d.id}">FIGHT</button>`
            : '<span class="duel-done">awaiting a challenger</span>'))
        : '<span class="duel-done">settled</span>'}
    </div>`;
  }).join('');
  $('duelEmpty').hidden = duelsShown.length > 0;

  // the Gauntlet: writs of the Sundering, fought from the Mines
  const cleared = S.cleared || 0;
  $('gauntletIntro').textContent = S.addr
    ? 'Ten bosses, each with a public stat spread. Champions fight while they mine: '
      + 'three fights per champion per day, a gems entry, '
      + 'bounty and renown for the victor. Beat a boss at Grim to face its Dire; '
      + 'beat the boss before it to reach the next.'
    : 'Connect a wallet to fight bosses.';
  $('writList').innerHTML = (S.writs || []).map(w => {
    const writOpen = w.id === 0 || !!(cleared & (1 << ((w.id - 1) * 3)));
    const gates = [true,
      !!(cleared & (1 << (w.id * 3))),
      !!(cleared & (1 << (w.id * 3 + 1)))];
    const btns = [0, 1, 2].map(t => {
      const done = !!(cleared & (1 << (w.id * 3 + t)));
      if (done) return `<span class="writ-done">${WRIT_TIERS[t]} ✓</span>`;
      return writOpen && gates[t] && S.addr
        ? `<button class="mini-btn alt" data-writ="${w.id}:${t}">${WRIT_TIERS[t]}</button>`
        : `<span class="writ-locked">${WRIT_TIERS[t]} 🔒</span>`;
    }).join('');
    return `<div class="duel writ-row">
      <div class="duel-info"><b>${w.name}</b>
        <div class="duel-meta">⚔ ${w.valor} · 🛡 ${w.bulwark} · 🗡 ${w.guile}
        <small>at Grim · Dire ×2 · Black ×4</small></div></div>
      <div class="writ-tiers">${btns}</div>
    </div>`;
  }).join('');

  if (MKT) {
    $('marketFunds').textContent = `Sale proceeds: ${fmtHtr(S.marketFunds)}`;
    $('wdFundsBtn').hidden = S.marketFunds < 1;
    const cardBit = uid => {
      const c = S.cards.get(uid);
      const t = TIERS[c?.tier ?? 0] || TIERS[0];
      return `<span class="duel-emoji">${rowArt(c)}</span>
        <div class="duel-info"><b>${c?.name ?? '?'}</b> <span style="color:${t.color}">\u26a1${c?.power ?? '?'}</span>`;
    };
    $('listingList').innerHTML = S.listings.map(l => `
      <div class="duel ${l.status}">${cardBit(l.card)}
        <div class="duel-meta">#${l.id} \u00b7 ${fmtHtr(l.price)} \u00b7 by ${isMine(l.seller) ? 'you' : who(l.seller)}</div></div>
        ${l.status === 'open' ? (isMine(l.seller)
          ? (l.seller === S.addr
            ? `<button class="mini-btn alt" data-cancellisting="${l.id}">CANCEL</button>`
            : '<span class="duel-done">yours · main wallet</span>')
          : `<button class="mini-btn" data-buy="${l.id}" data-price="${l.price}">BUY</button>`)
          : '<span class="duel-done">sold</span>'}
      </div>`).join('');
    $('listingEmpty').hidden = S.listings.length > 0;
    $('swapList').innerHTML = S.swaps.map(w => {
      const wantMine = S.cards.get(w.want)?.mine;
      return `<div class="duel ${w.status}">${cardBit(w.give)}
        <div class="duel-meta">#${w.id} \u00b7 wants ${S.cards.get(w.want)?.name ?? w.want.slice(0, 10)} \u00b7 by ${isMine(w.maker) ? 'you' : who(w.maker)}</div></div>
        ${w.status === 'open' ? (isMine(w.maker)
          ? (w.maker === S.addr
            ? `<button class="mini-btn alt" data-cancelswap="${w.id}">CANCEL</button>`
            : '<span class="duel-done">yours · main wallet</span>')
          : (wantMine ? `<button class="mini-btn" data-acceptswap="${w.id}" data-want="${w.want}">SWAP</button>` : '<span class="duel-done">need the wanted card</span>'))
          : '<span class="duel-done">done</span>'}
      </div>`;
    }).join('');
    $('swapEmpty').hidden = S.swaps.length > 0;
    const mpend = [...S.cards.values()].filter(c => S.addr && c.tier >= 0 && c.marketPending === S.addr);
    $('marketPendingCards').innerHTML = mpend.map(c =>
      cardBox(c, S.wallet?.mode === 'session'
        ? '<div class="pending-gems">coming home…</div>'
        : `<button class="claim-mini" data-mclaim="${c.uid}">CLAIM</button>`)).join('');
  }

  bindListActions();
}

function sameTierSelected() {
  const sel = [...S.selected].map(u => S.cards.get(u));
  return sel.length === 2 && sel[0].tier === sel[1].tier && sel[0].tier < 3;
}

function bindListActions() {
  // tap opens the detail view; press-and-hold selects for fusion
  document.querySelectorAll('[data-open]').forEach(el => {
    const uid = el.dataset.open;
    let timer = null, held = false;
    el.onpointerdown = e => {
      const c = S.cards.get(uid);
      if (e.target.closest('button') || !c?.mine) return;
      held = false;
      timer = setTimeout(() => {
        held = true;
        window.haptic?.([20, 30, 20]);
        // a hold on a champion that cannot fuse says WHY instead of nothing
        if (c.tier >= 3) {
          ribbon('Sovereigns are the top rarity; they cannot be fused');
          return;
        }
        if (S.selected.has(uid)) S.selected.delete(uid);
        else { if (S.selected.size >= 2) S.selected.clear(); S.selected.add(uid); }
        render();
      }, 450);
    };
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.onpointerup = cancel;
    el.onpointerleave = cancel;
    el.onpointercancel = cancel;
    el.oncontextmenu = e => { if (S.cards.get(uid)?.mine) e.preventDefault(); };
    el.onclick = e => {
      if (e.target.closest('button')) return;
      if (held) { held = false; return; } // the hold already did its work
      openCard(uid);
    };
  });
  const bind = (sel, fn) => document.querySelectorAll(sel).forEach(el =>
    el.onclick = () => fn(el.dataset[Object.keys(el.dataset)[0]]));
  bind('[data-claim]', async u => {
    const tier = S.cards.get(u)?.tier ?? 0;
    const h = await doTx('Claiming champion', 'claim_card', [], [wdAct(u, CARD_AMT)]);
    if (h) crashLand(u, tier);
  });
  bind('[data-stake]', u => doTx('Staking in the mines', 'stake', [], [depAct(u, CARD_AMT)]));
  bind('[data-unstake]', async u => {
    const c = S.cards.get(u);
    // hours of toil approximated from accrued gems and the station's rate
    const hours = c ? c.pendingGems / ([1, 3, 10, 40][c.tier] * 60) : 0;
    const h = await doTx('Recalling champion', 'unstake', [], [wdAct(u, CARD_AMT)]);
    if (h) window.trialEvent?.('recall8', { hours });
  });
  bind('[data-claimgems]', u => doTx('Claiming gems', 'claim_gems', [u], []));
  bind('[data-temper]', u => openTemper(u));
  bind('[data-delve]', u => doTx('Starting the delve', 'begin_delve', [u]));
  bind('[data-claimdelve]', claimDelve);
  bind('[data-dress]', openDress);
  document.querySelectorAll('[data-writ]').forEach(el => el.onclick = () => {
    const [w, t] = el.dataset.writ.split(':').map(Number);
    openPick('writ', { writ: w, tier: t });
  });
  bind('[data-duel]', u => openPick('create', u));
  bind('[data-acceptduel]', id => openPick('accept', Number(id)));
  bind('[data-cancelduel]', id => doTx('Cancelling duel', 'cancel_duel', [Number(id)], []));
  bind('[data-sell]', u => {
    const raw = prompt('Ask price in HTR cents (5 = 0.05 HTR, max 100000):', '5');
    if (raw === null) return;
    const p = Math.floor(Number(raw));
    if (!Number.isInteger(p) || p < 1 || p > 100000) { alert('Price must be a whole number of HTR cents between 1 and 100000.'); return; }
    doTx('Listing for sale', 'list_card', [p], [depAct(u, CARD_AMT)], { target: MKT });
  });
  bind('[data-trade]', u => openPick('want', u));
  bind('[data-cancellisting]', id => doTx('Cancelling listing', 'cancel_listing', [Number(id)], [], { target: MKT }));
  bind('[data-cancelswap]', id => doTx('Cancelling trade', 'cancel_swap', [Number(id)], [], { target: MKT }));
  bind('[data-mclaim]', async u => {
    const tier = S.cards.get(u)?.tier ?? 0;
    const h = await doTx('Claiming champion', 'claim_card', [], [wdAct(u, CARD_AMT)], { target: MKT });
    if (h) crashLand(u, tier);
  });
  document.querySelectorAll('[data-buy]').forEach(el => el.onclick = () =>
    doTx('Buying champion', 'buy', [Number(el.dataset.buy)], [depAct(HTR, Number(el.dataset.price))], { target: MKT }));
  document.querySelectorAll('[data-acceptswap]').forEach(el => el.onclick = () =>
    doTx('Accepting trade', 'accept_swap', [Number(el.dataset.acceptswap)], [depAct(el.dataset.want, CARD_AMT)], { target: MKT }));
}

const depAct = (token, amount) => ({ type: 'deposit', token, amount });
const wdAct = (token, amount) => ({ type: 'withdrawal', token, amount, address: S.addr });

/* ---------------- tx pipeline ---------------- */

async function ensureLedgerGems(amount) {
  if (S.gemsLedger >= amount) return true;
  const shortfall = amount - S.gemsLedger;
  if (S.gemsWallet < shortfall) return false;
  const hash = await doTx('Moving gems to your ledger', 'deposit_gems', [], [depAct(GEMS, shortfall)]);
  return !!hash && S.gemsLedger >= amount;
}

// confirmation wait for plain (non-nano) transactions: no execution logs exist
async function waitForConfirm(hash) {
  let wait = 1200; // check early, then settle into a steady cadence
  for (;;) {
    await new Promise(r => setTimeout(r, wait));
    wait = 2000;
    const tx = await node(`/transaction?id=${hash}`);
    const meta = tx.meta || {};
    if ((meta.voided_by || []).length) throw new Error('transaction failed; nothing was spent. Try again');
    if (meta.first_block) return;
  }
}

async function waitForExecution(hash, onTick) {
  const start = Date.now();
  let wait = 1200; // check early, then settle into a steady cadence
  for (;;) {
    await new Promise(r => setTimeout(r, wait));
    wait = 2000;
    onTick?.(Math.round((Date.now() - start) / 1000));
    const tx = await node(`/transaction?id=${hash}`);
    const meta = tx.meta || {};
    if ((meta.voided_by || []).length) throw new Error('transaction failed; nothing was spent. Try again');
    if (!meta.first_block) continue;
    const logs = await node(`/nano_contract/logs?id=${hash}`);
    if (logs.nc_execution === 'success') return;
    if (logs.nc_execution && logs.nc_execution !== 'pending') {
      let reason = '';
      for (const entries of Object.values(logs.logs || {})) {
        for (const e of entries) {
          const m = (e.error_traceback || '').match(/NCFail: (.+?)\s*$/m);
          if (m) reason = m[1];
        }
      }
      throw new Error(reason || 'the contract refused this action');
    }
  }
}

// wallet kind for analytics — never the address
function walletKindOf(w) {
  if (!w) return 'none';
  if (w.mode === 'session') return 'session';
  return (w.label || 'unknown').split(' ')[0].toLowerCase();
}
function walletKind() { return walletKindOf(S.wallet); }

let txSeq = 0;
async function doTx(label, method, args, actions, { target } = {}) {
  if (!S.wallet) return null;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="t-spin"></span><div class="t-body"><b>${label}</b>
    <span class="t-sub">signing\u2026</span></div><span class="t-time mono"></span>`;
  $('txToasts').appendChild(el);
  const sub = el.querySelector('.t-sub');
  const tim = el.querySelector('.t-time');
  try {
    const { hash } = await S.wallet.executeNano(method, args, actions, target);
    sub.textContent = 'confirming\u2026';
    await waitForExecution(hash, sec => { tim.textContent = sec + 's'; });
    el.classList.add('ok');
    sub.textContent = 'done';
    track(method, { ok: true, target: target || 'game', wallet: walletKind() });
    window.trialEvent?.(method);
    setTimeout(() => el.remove(), 6000);
    // the cards this tx touched are re-read server-side before answering
    const touched = [
      ...(args || []).filter(a => typeof a === 'string' && /^[0-9a-f]{64}$/.test(a)),
      ...(actions || []).map(a => a.token).filter(t =>
        t && t !== HTR && t !== GEMS && /^[0-9a-f]{64}$/.test(t)),
    ];
    await refresh(touched);
    return hash;
  } catch (e) {
    el.classList.add('fail');
    let msg = e.message || String(e);
    if (/invalid blueprint|blueprint not found|nano contract does not exist/i.test(msg)) {
      msg = 'Your wallet is on a different Hathor network. Switch it to testnet and try again.';
    } else if (/not enough utxos|insufficient (funds|amount)|no utxos/i.test(msg)) {
      msg = 'Not enough HTR. Just made a move? Wait a few seconds for your change to '
        + 'settle and try again. Empty? Get free testnet coin from the faucet linked '
        + 'in the Codex.';
    }
    sub.textContent = msg;
    track(method, { ok: false, reason: msg.slice(0, 120), target: target || 'game', wallet: walletKind() });
    el.insertAdjacentHTML('beforeend', '<button class="t-x">\u2715</button>');
    el.querySelector('.t-x').onclick = () => el.remove();
    setTimeout(() => el.remove(), 20000);
    refresh().catch(() => {});
    return null;
  }
}

/* ---------------- flows ---------------- */

async function pull() {
  const before = new Set([...S.cards.values()].filter(c => c.pending === S.addr).map(c => c.uid));
  const favorBefore = S.favorOwed;
  $('machine').classList.add('shaking');
  window.sfx?.('summon');
  spawnEmbers($('machine'), 6);
  const emberInt = REDUCED ? null : setInterval(() => spawnEmbers($('machine'), 6), 1500);
  const hash = await doTx('Summoning', 'pull', [], [depAct(HTR, S.pullPrice)]);
  $('machine').classList.remove('shaking');
  if (emberInt) clearInterval(emberInt);
  if (!hash) return;
  if (S.favorOwed > favorBefore)
    ribbon(`Lucky pull: <b>${fmtHtr(S.favorOwed - favorBefore)}</b> refunded`, 'level', 'favor');
  // with overlapping summons, exclude cards already claimed by another reveal
  const won = [...S.cards.values()].find(c =>
    c.pending === S.addr && !before.has(c.uid) && !revealSeen.has(c.uid));
  if (!won) return;
  revealCard(won, TIERS[won.tier].name);
}

/* ---------------- the Rite of Tempering ---------------- */

let temperUid = null;
function openTemper(uid) {
  const c = S.cards.get(uid);
  if (!c || !c.temperCost) return;
  temperUid = uid;
  const [v, b, g, t] = c.aspects || [0, 0, 0, 0];
  $('temperInfo').innerHTML = `<b>${c.name}</b> · ⚔ ${v} · 🛡 ${b} · 🗡 ${g}<br>
    Raise one aspect by 1–3 for <b>${fmtGems(c.temperCost)}</b> from your ledger.`;
  showStage('stageTemper');
}

async function doTemper(aspect) {
  const uid = temperUid;
  temperUid = null;
  $('overlay').hidden = true;
  const c = S.cards.get(uid);
  if (!c) return;
  const beforeAsp = c.aspects ? [...c.aspects] : null;
  if (!(await ensureLedgerGems(c.temperCost))) {
    $('errTitle').textContent = 'Not enough gems';
    $('errMsg').textContent = `Tempering costs ${fmtGems(c.temperCost)}. Earn more by mining.`;
    showStage('stageError');
    return;
  }
  const hash = await doTx('Tempering', 'temper', [uid, aspect], []);
  if (!hash || !beforeAsp) return;
  window.sfx?.('fuse', { rate: 1.15, volume: .8 });
  const after = S.cards.get(uid)?.aspects;
  if (after) {
    const gain = after[aspect] - beforeAsp[aspect];
    if (gain > 0) ribbon(`Tempered: <b>+${gain} ${['Attack', 'Defense', 'Cunning'][aspect]}</b> for ${c.name}`);
  }
}

/* ---------------- reveal theater ---------------- */

const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const REVEAL_MS = [700, 1100, 1700, 2600];  // anticipation, by station

function spawnEmbers(host, n, big) {
  if (REDUCED || !host) return;
  const box = document.createElement('div');
  box.className = 'embers';
  for (let i = 0; i < n; i++) {
    const e = document.createElement('span');
    e.className = 'ember-p' + (big && Math.random() < .3 ? ' big' : '');
    e.style.left = (5 + Math.random() * 90) + '%';
    e.style.setProperty('--dx', (Math.random() * 70 - 35) + 'px');
    e.style.animationDelay = (Math.random() * .8) + 's';
    e.style.animationDuration = (1.2 + Math.random() * 1.4) + 's';
    box.appendChild(e);
  }
  host.appendChild(box);
  setTimeout(() => box.remove(), 3800);
}

/* crash landing: a claimed champion slams into Your Host */

function spawnDust(rect, tier) {
  if (REDUCED) return;
  const box = document.createElement('div');
  box.className = 'dustbox';
  const n = [8, 14, 24, 40][tier] || 8;
  for (let i = 0; i < n; i++) {
    const puff = Math.random() < .35;
    const e = document.createElement('span');
    e.className = puff ? 'dust-puff' : 'grit';
    e.style.left = (rect.left + rect.width * (0.15 + Math.random() * 0.7)) + 'px';
    e.style.top = (rect.bottom - 6 - Math.random() * 10) + 'px';
    e.style.setProperty('--dx', (Math.random() * 160 - 80) * (1 + tier * .4) + 'px');
    e.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    e.style.animationDuration = (0.5 + Math.random() * 0.6) + 's';
    e.style.animationDelay = (Math.random() * 0.08) + 's';
    box.appendChild(e);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1400);
}

function crashLand(uid, tier) {
  tier = Math.max(0, Math.min(3, tier));
  const collTab = document.querySelector('.tab[data-tab="collection"]');
  if (collTab && !collTab.classList.contains('active')) collTab.click();
  // the card renders after the claim's refresh; give the DOM a moment
  let tries = 0;
  (function seek() {
    // don't play the landing behind an open overlay (reveal still up, etc.)
    if (!$('overlay').hidden) { if (++tries < 80) setTimeout(seek, 400); return; }
    const el = document.querySelector(`#collectionCards [data-select="${uid}"]`);
    if (!el) { if (++tries < 80) setTimeout(seek, 200); return; }
    if (REDUCED) { el.scrollIntoView({ block: 'center' }); return; }
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const dur = [500, 600, 750, 900][tier];
    el.style.animationDuration = dur + 'ms';
    el.classList.add('crash-landing');
    setTimeout(() => {  // impact moment (~55% of the drop)
      window.sfx?.('reveal-footman', {
        rate: [1, .88, .74, .6][tier], volume: [.8, .9, 1, 1][tier],
        // impact thump grows with the station
        haptic: [[30], [50], [30, 40, 70], [40, 50, 100, 50, 60]][tier],
      });
      const rect = el.getBoundingClientRect();
      spawnDust(rect, tier);
      document.body.style.setProperty('--quake-amp', [2, 4, 7, 12][tier] + 'px');
      document.body.classList.add('page-quake');
      setTimeout(() => document.body.classList.remove('page-quake'), 550);
      if (tier >= 2) {
        const ring = document.createElement('div');
        ring.className = 'impact-ring';
        ring.style.left = (rect.left + rect.width / 2) + 'px';
        ring.style.top = (rect.bottom - 8) + 'px';
        document.body.appendChild(ring);
        setTimeout(() => ring.remove(), 700);
      }
      if (tier >= 3) {
        $('overlay').classList.remove('goldflash');
        document.body.classList.add('land-flash');
        setTimeout(() => document.body.classList.remove('land-flash'), 800);
      }
      try { if (navigator.vibrate) navigator.vibrate([[15], [25], [15, 30, 50], [20, 30, 20, 30, 110]][tier]); } catch { }
    }, dur * 0.55);
    setTimeout(() => { el.classList.remove('crash-landing'); el.style.animationDuration = ''; }, dur + 100);
  })();
}

let revealTimer = null;
function finishReveal(tier) {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
  const stage = $('stageReveal');
  if (!stage.classList.contains('sequencing')) return;
  stage.classList.remove('sequencing');
  stage.classList.add('revealed');
  window.sfx?.(['reveal-footman', 'reveal-knight', 'reveal-highlord', 'reveal-sovereign'][tier]);
  if (tier >= 2) { $('overlay').classList.add('quake'); setTimeout(() => $('overlay').classList.remove('quake'), 600); }
  if (tier >= 3) { $('overlay').classList.add('goldflash'); setTimeout(() => $('overlay').classList.remove('goldflash'), 950); }
  spawnEmbers($('prizeCard'), [8, 14, 24, 44][tier] || 8, tier >= 2);
  try { if (navigator.vibrate) navigator.vibrate([[20], [35], [15, 40, 60], [20, 40, 20, 40, 140]][tier] || [20]); } catch { }
}

/* reveals queue up: a new one waits until the current card is dismissed */
const revealQueue = [];
const revealSeen = new Set();
let revealActive = false;

function revealCard(won, tierLabel) {
  revealSeen.add(won.uid);
  revealQueue.push([won, tierLabel]);
  pumpReveals();
}

function pumpReveals() {
  if (revealActive || !revealQueue.length) return;
  if (!$('overlay').hidden && $('stageReveal').hidden) {
    // another stage (error, picker, …) is open; try again shortly
    setTimeout(pumpReveals, 500);
    return;
  }
  revealActive = true;
  const [won, tierLabel] = revealQueue.shift();
  showRevealNow(won, tierLabel);
}

function revealDismissed() {
  revealActive = false;
  if (revealQueue.length) setTimeout(pumpReveals, 350);
}

function showRevealNow(won, tierLabel) {
  const t = TIERS[won.tier] || TIERS[0];
  const tier = Math.max(0, Math.min(3, won.tier));
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
  const pc = $('prizeCard');
  pc.style.setProperty('--rc', t.color);
  const meta = cardMeta(won.name);
  pc.classList.toggle('art-reveal', !!meta?.art);
  const face = meta?.art ? `
    <img class="ac-img" src="cards/${slugOf(won.name)}.jpg" alt="">
    <div class="ac-scrim"></div>
    <div class="ac-top"><span class="ac-name">${won.name}</span><span class="ac-power">\u26a1${won.power}</span></div>
    <div class="ac-bottom">
      <div class="ac-station" style="color:${t.color}">${tierLabel} \u00b7 ${meta.type}</div>
      ${aspectsRow(won)}
      <div class="ac-flavor">${meta.flavor}</div>
    </div>` : `
    <div class="prize-emoji">${artSvg(won.name, 'card-art prize-art')}</div>
    <div class="prize-tier">${tierLabel}</div>
    <div class="prize-name">${won.name}</div>
    <div class="prize-power">\u26a1 POWER ${won.power}</div>
    ${aspectsRow(won)}`;
  pc.innerHTML = `
    <div class="flip-inner">
      <div class="reveal-back"><img src="logo.png" alt=""></div>
      <div class="reveal-face${meta?.art ? '' : ' plain'}">${face}</div>
    </div>`;
  const sessionMode = S.wallet?.mode === 'session';
  $('revealClaimBtn').textContent = sessionMode ? 'ONWARD' : 'CLAIM TO WALLET';
  $('revealCloseBtn').hidden = sessionMode;  // auto-claim brings it home anyway
  $('revealClaimBtn').onclick = sessionMode
    ? () => { $('overlay').hidden = true; revealDismissed(); }
    : async () => {
      $('overlay').hidden = true;
      revealDismissed();
      const h = await doTx('Claiming champion', 'claim_card', [], [wdAct(won.uid, CARD_AMT)]);
      if (h) crashLand(won.uid, won.tier);
    };
  const stage = $('stageReveal');
  stage.classList.remove('revealed', 'tier-0', 'tier-1', 'tier-2', 'tier-3');
  stage.classList.add('sequencing', 'tier-' + tier);
  S.revealTier = tier;
  showStage('stageReveal');
  if (REDUCED) finishReveal(tier);
  else revealTimer = setTimeout(() => finishReveal(tier), REVEAL_MS[tier]);
}

async function fuse() {
  const [a, b] = [...S.selected];
  S.selected.clear();
  const fee = fuseFeeFor(S.cards.get(a)?.tier ?? 0);
  if (!(await ensureLedgerGems(fee))) {
    $('errTitle').textContent = 'Not enough gems';
    $('errMsg').textContent = `Fusion costs ${fmtGems(fee)}. Earn more by mining.`;
    showStage('stageError');
    return;
  }
  const before = new Set([...S.cards.values()].filter(c => c.pending === S.addr).map(c => c.uid));
  const hash = await doTx('Fusing champions', 'fuse', [], [depAct(a, CARD_AMT), depAct(b, CARD_AMT)]);
  if (!hash) return;
  window.sfx?.('fuse');
  const won = [...S.cards.values()].find(c => c.pending === S.addr && !before.has(c.uid));
  if (won) revealCard(won, `FUSED \u00b7 ${TIERS[won.tier].name}`);
}

async function fightWrit(uid, writ, tier) {
  const c = S.cards.get(uid);
  const entry = Math.max(1, Math.floor(fuseFeeFor(c?.tier ?? 0) / 5));
  if (!(await ensureLedgerGems(entry))) {
    $('errTitle').textContent = 'Boss entry fee';
    $('errMsg').textContent = `Boss entry costs ${fmtGems(entry)}. Earn more by mining.`;
    showStage('stageError');
    $('overlay').hidden = false;
    return;
  }
  const before = S.gemsLedger;
  const h = await doTx('Fighting the boss', 'fight_writ', [uid, writ, tier]);
  if (!h) return;
  const won = S.gemsLedger > before;  // victory pays 4x the entry
  const w = S.writs[writ] || { name: 'the writ' };
  const mult = [1, 2, 4][tier] || 1;
  const mu = matchupHtml(S.cards.get(uid)?.aspects,
    [w.valor * mult, w.bulwark * mult, w.guile * mult]);
  $('duelResult').innerHTML = (won
    ? `<div class="duel-banner win">⚔️ THE WRIT IS FELLED</div>
       <div class="wait-sub">${w.name} (${WRIT_TIERS[tier]}) falls. The bounty and the renown are yours.</div>`
    : `<div class="duel-banner lose">💀 THE WRIT STANDS</div>
       <div class="wait-sub">${w.name} holds the field. The entry is spent; your champion learned from it.</div>`) + mu;
  window.sfx?.('clash');
  setTimeout(() => window.sfx?.(won ? 'win' : 'lose'), 450);
  showStage('stageDuel');
  $('overlay').hidden = false;
}

/* a fight is three rounds, one per aspect: show the matchup so the result
   reads as a story, not a coin flip */
function matchupHtml(mine, theirs) {
  const icons = ['⚔', '🛡', '🗡'];
  const names = ['Attack', 'Defense', 'Cunning'];
  if (!mine || !theirs) return '';
  const rows = [0, 1, 2].map(i => {
    const a = mine[i] || 0, b = theirs[i] || 0;
    const pct = a + b > 0 ? Math.round(100 * a / (a + b)) : 50;
    return `<div class="mu-row"><span class="mu-k">${icons[i]} ${names[i]}</span>
      <span class="mono mu-a">${a}</span><span class="mu-vs">vs</span><span class="mono mu-b">${b}</span>
      <span class="mu-pct mono">${pct}% yours</span></div>`;
  }).join('');
  return `<div class="matchup">${rows}
    <div class="mu-note">three rounds, one per aspect · win two to take the fight</div></div>`;
}

async function claimDelve(uid) {
  const g0 = S.gemsLedger;
  const s0 = S.shards || 0;
  const h = await doTx('Claiming the delve', 'claim_delve', [uid]);
  if (!h) return;
  const dg = S.gemsLedger - g0;
  const ds = (S.shards || 0) - s0;
  if (ds > 0 && dg > 0) ribbon(`An ancient relic! +${ds} shards and ${fmtGems(dg)}`, 'level', 'favor');
  else if (ds > 0) ribbon(`The delve found relic shards: +${ds}`, 'level', 'favor');
  else if (dg > 0) ribbon(`The delve struck a seam: +${fmtGems(dg)}`, 'level', 'coin');
  else ribbon('The delve found only dust', '', 'lose');
}

function openDress(uid) {
  const c = S.cards.get(uid);
  if (!c) return;
  const price = 25 * (c.tier + 1);
  const cur = cosmeticsOf(c);
  const t = TIERS[c.tier] || TIERS[0];
  const meta = cardMeta(c.name);
  $('dressTitle').textContent = `Dress ${c.name}`;
  const art = meta?.art
    ? `<img class="ac-img" src="cards/${slugOf(c.name)}.jpg" alt="">`
    : `<div class="dress-svg">${artSvg(c.name)}</div>`;
  const previewCls = (cur.frame ? ` cframe-${cur.frame}` : '') + (cur.tint ? ` ctint-${cur.tint}` : '');
  $('dressBody').innerHTML = `
  <div class="dress-wrap">
    <div class="dress-preview card${previewCls}" id="dressPreview" style="--rc:${t.color}">
      ${art}
      <div class="ac-scrim"></div>
      <div class="dress-cap">
        <div class="ac-name">${c.name}</div>
        <div class="ac-epithet" id="dressEp">${cur.epithet ? EPITHETS[cur.epithet - 1] : ''}</div>
      </div>
    </div>
    <div class="dress-controls">
      <div class="wait-sub">Frames and tints cost <b>${fmtGems(price)}</b> each
      (you hold ${fmtGems(S.gemsLedger)}). Epithets cost <b>3 relic shards</b>
      (you hold ${S.shards || 0}; delve for more). Adornments are written on the
      card and travel with it, forever.</div>
      <div class="dress-row"><b>Frame</b>
        ${FRAMES.map((f, i) => `<button class="mini-btn alt dress-btn cframe-${i + 1}${cur.frame === i + 1 ? ' active' : ''}"
          data-cos="0:${i + 1}" data-prev="frame:${i + 1}">${f}</button>`).join('')}
        ${cur.frame ? '<button class="ghost-btn" data-cos="0:0">clear</button>' : ''}
      </div>
      <div class="dress-row"><b>Tint</b>
        ${[...Array(6)].map((_, i) => `<button class="mini-btn alt dress-btn tint-btn${cur.tint === i + 1 ? ' active' : ''}"
          data-cos="1:${i + 1}" data-prev="tint:${i + 1}">${meta?.art
            ? `<span class="ctint-${i + 1}"><img class="ac-img tint-thumb" src="cards/${slugOf(c.name)}.jpg" alt="Tint ${i + 1}"></span>`
            : `Tint ${i + 1}`}</button>`).join('')}
        ${cur.tint ? '<button class="ghost-btn" data-cos="1:0">clear</button>' : ''}
      </div>
      <div class="dress-row"><b>Epithet</b>
        ${EPITHETS.map((e, i) => `<button class="mini-btn alt dress-btn${cur.epithet === i + 1 ? ' active' : ''}"
          data-cos="2:${i + 1}" data-prev="ep:${i + 1}">${e}</button>`).join('')}
        ${cur.epithet ? '<button class="ghost-btn" data-cos="2:0">clear</button>' : ''}
      </div>
    </div>
  </div>`;
  // live preview on hover; the click buys
  const preview = $('dressPreview');
  const setPreview = (kind, v) => {
    if (kind === 'frame') {
      preview.className = preview.className.replace(/ ?cframe-\d/g, '');
      if (v) preview.classList.add(`cframe-${v}`);
    } else if (kind === 'tint') {
      preview.className = preview.className.replace(/ ?ctint-\d/g, '');
      if (v) preview.classList.add(`ctint-${v}`);
    } else {
      $('dressEp').textContent = v ? EPITHETS[v - 1] : (cur.epithet ? EPITHETS[cur.epithet - 1] : '');
    }
  };
  document.querySelectorAll('[data-prev]').forEach(el => {
    const [kind, v] = el.dataset.prev.split(':');
    el.onmouseenter = () => setPreview(kind, Number(v));
    el.onmouseleave = () => setPreview(kind,
      kind === 'frame' ? cur.frame : kind === 'tint' ? cur.tint : 0);
  });
  document.querySelectorAll('[data-cos]').forEach(el => el.onclick = async () => {
    const [slot, value] = el.dataset.cos.split(':').map(Number);
    $('overlay').hidden = true;
    if (slot < 2 && value > 0 && !(await ensureLedgerGems(price))) {
      $('errTitle').textContent = 'Not enough gems';
      $('errMsg').textContent = `This adornment costs ${fmtGems(price)}.`;
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    if (slot === 2 && value > 0 && (S.shards || 0) < 3) {
      $('errTitle').textContent = 'Not enough relic shards';
      $('errMsg').textContent = 'Epithets cost 3 relic shards. Send a champion '
        + 'on a delve and claim the haul to earn them.';
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    await doTx('Styling the champion', 'buy_cosmetic', [uid, slot, value]);
  });
  showStage('stageDress');
  $('overlay').hidden = false;
}

/* ---------------- banner names ---------------- */
/* A name claim is a real transaction carrying the data output
   "emberfall:name:<name>" (0.01 HTR, burned). The signed inputs prove the
   claimer owns the address; the server only indexes what the Ledger says. */

const NAME_LS = 'emberfall_name';
const NAME_SECRET_LS = 'emberfall_name_secret';

/* Wallets shuffle addresses, so address kinship cannot always be proven on
   chain. Each claim therefore seals sha256(device secret) inside the signed
   tx; presenting the secret later proves "same player" to the name server
   no matter which address the wallet signed with. */
function nameSecret() {
  let sec = localStorage.getItem(NAME_SECRET_LS);
  if (!sec) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    sec = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(NAME_SECRET_LS, sec);
  }
  return sec;
}
async function nameSecretHash() {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nameSecret()));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function openName() {
  if (!S.addr) return;
  // prefill only what this address actually holds; a remembered name from an
  // old address may be unavailable and only misleads here
  $('nameInput').value = S.names[S.addr] || '';
  $('nameMsg').textContent = '';
  $('nameClaimBtn').disabled = false;
  showStage('stageName');
}

/* A swept session leaves its address empty, which frees its name (the server
   lets anyone claim a name whose holding purse is bare). So when a new
   session begins, quietly claim the player's remembered name again: the name
   follows the player, not the throwaway key. */
let reclaimTried = false;
async function reclaimBanner() {
  if (reclaimTried || S.wallet?.mode !== 'session' || !S.addr) return;
  // the name resting on the main wallet is the source of truth: it follows
  // across devices, unlike this browser's remembered name
  const last = (S.wallet.mainAddr && S.names[S.wallet.mainAddr])
    || localStorage.getItem(NAME_LS);
  if (!last || S.names[S.addr]) return;
  reclaimTried = true;
  try {
    const { hash } = await S.wallet.sendData(
      `emberfall:name:${last}:${await nameSecretHash()}`);
    await waitForConfirm(hash);
    // the player may have sealed a name by hand while this tx confirmed:
    // their explicit choice wins, the reclaim stands down
    const still = (S.wallet?.mainAddr && S.names[S.wallet.mainAddr])
      || localStorage.getItem(NAME_LS);
    if (S.names[S.addr] || still !== last) return;
    const r = await fetch('/api/name', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx: hash, addr: S.addr, secret: nameSecret() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'claim rejected');
    await loadNames();
    render();
    ribbon(`You are playing as <b>${last}</b>`, 'level', 'deed');
    track('set_name', { ok: true, auto: true, wallet: walletKind() });
  } catch (e) {
    // someone else truly holds it, or the tx failed: the player can SET NAME
    track('set_name', {
      ok: false, auto: true, wallet: walletKind(),
      reason: String((e && e.message) || e).slice(0, 120),
    });
  }
}

async function claimName() {
  const name = $('nameInput').value.trim().replace(/\s+/g, ' ');
  const msg = $('nameMsg');
  if (!NAME_RE.test(name)) {
    msg.textContent = 'Names are 3-16 characters: letters, numbers, spaces or _.';
    return;
  }
  if (name === S.names[S.addr]) { $('overlay').hidden = true; return; }
  // no client-side taken check: only the server knows whether the current
  // holder is an abandoned (swept-empty) address whose name is up for grabs
  $('nameClaimBtn').disabled = true;
  try {
    // through a wallet the seal is a transaction the wallet must approve;
    // in a session it signs silently
    msg.textContent = S.wallet.mode === 'session'
      ? 'Saving your name on-chain…'
      : 'Approve the transaction in your Hathor wallet, then return here…';
    const { hash } = await S.wallet.sendData(
      `emberfall:name:${name}:${await nameSecretHash()}`);
    track('set_name_submitted', { wallet: walletKind() });
    msg.textContent = 'Confirming…';
    await waitForConfirm(hash);
    const r = await fetch('/api/name', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx: hash, addr: S.addr, secret: nameSecret() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'the name server rejected the claim');
    localStorage.setItem(NAME_LS, name);
    await loadNames();
    render();
    $('overlay').hidden = true;
    ribbon(`You are now known as <b>${name}</b>`, 'level', 'deed');
    track('set_name', { ok: true, wallet: walletKind() });
  } catch (e) {
    const m = (e && e.message) || String(e);
    msg.textContent = /not enough|insufficient|no utxos/i.test(m)
      ? 'You need 0.01 HTR to claim a name. Get free testnet coin from the faucet linked in the Codex.'
      : /not signed by that address/i.test(m)
      ? 'Your wallet signed with a different address than the one playing. '
        + 'Start a promptless session and claim the name there; it signs with the right key.'
      : m;
    $('nameClaimBtn').disabled = false;
    track('set_name', { ok: false, reason: m.slice(0, 120), wallet: walletKind() });
  }
}

/* ---------------- card detail & sharing ---------------- */

let cardDetailUid = null;

function openCard(uid) {
  const c = S.cards.get(uid);
  if (!c || c.tier < 0) return;
  cardDetailUid = uid;
  const t = TIERS[c.tier] || TIERS[0];
  const meta = cardMeta(c.name);
  const cos = cosmeticsOf(c);
  const cosCls = (cos.frame ? ` cframe-${cos.frame}` : '') + (cos.tint ? ` ctint-${cos.tint}` : '');
  const epLine = cos.epithet && EPITHETS[cos.epithet - 1]
    ? `<div class="ac-epithet">${EPITHETS[cos.epithet - 1]}</div>` : '';
  $('cardDetail').innerHTML = meta?.art
    ? `<div class="card art-card detail-card${cosCls}" style="--rc:${t.color}">
        <img class="ac-img" src="cards/${slugOf(c.name)}.jpg" alt="">
        <div class="ac-scrim"></div>
        <div class="ac-top"><span class="ac-name">${c.name}</span><span class="ac-power">⚡${c.power}</span></div>
        <div class="ac-bottom">
          ${epLine}
          <div class="ac-station" style="color:${t.color}">${stationLine(c, t, meta)}</div>
          ${aspectsRow(c)}
          <div class="ac-flavor">${meta.flavor}</div>
        </div>
      </div>`
    : `<div class="card detail-card${cosCls}" style="--rc:${t.color}">
        <div class="emoji">${artSvg(c.name)}</div>
        <div class="name">${c.name}</div>
        ${epLine}
        <div class="tier">${stationLine(c, t, null)} · ⚡${c.power}</div>
        ${aspectsRow(c)}
      </div>`;
  $('cardShareMsg').textContent = '';
  showStage('stageCard');
  $('overlay').hidden = false;
}

/* Render a clean card image (art + stats, no buttons) for sharing. */
async function cardShareImage(c) {
  const meta = cardMeta(c.name);
  const t = TIERS[c.tier] || TIERS[0];
  const W = 760, H = 1000;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  await document.fonts.ready.catch(() => {});
  g.fillStyle = '#0c0a08';
  g.fillRect(0, 0, W, H);
  if (meta?.art) {
    const img = new Image();
    img.src = `cards/${slugOf(c.name)}.jpg`;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    // cover-fit into the art area
    const AH = H - 180;
    const scale = Math.max(W / img.width, AH / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    g.drawImage(img, (W - dw) / 2, (AH - dh) / 2, dw, dh);
    const grad = g.createLinearGradient(0, AH - 320, 0, AH);
    grad.addColorStop(0, 'rgba(12,10,8,0)');
    grad.addColorStop(1, 'rgba(12,10,8,.96)');
    g.fillStyle = grad;
    g.fillRect(0, AH - 320, W, 320);
    g.fillStyle = '#0c0a08';
    g.fillRect(0, AH, W, H - AH);
  }
  const cos = cosmeticsOf(c);
  let y = H - 180 - 96;
  g.textBaseline = 'alphabetic';
  if (cos.epithet && EPITHETS[cos.epithet - 1]) {
    g.font = 'italic 24px Outfit, sans-serif';
    g.fillStyle = '#b9a97f';
    g.fillText(EPITHETS[cos.epithet - 1], 40, y - 56);
  }
  g.font = '700 52px Cinzel, serif';
  g.fillStyle = '#f2ead9';
  g.fillText(c.name, 40, y);
  g.font = '700 40px "Fragment Mono", monospace';
  g.fillStyle = '#d4a843';
  const pw = `⚡${c.power}`;
  g.fillText(pw, W - 40 - g.measureText(pw).width, y);
  y += 44;
  g.font = '700 24px Outfit, sans-serif';
  g.fillStyle = t.color.startsWith('var') ? '#d4a843' : t.color;
  g.fillText(stationLine(c, t, meta).toUpperCase(), 40, y);
  y += 52;
  const [v, b, gu] = c.aspects || [0, 0, 0];
  g.font = '32px "Fragment Mono", monospace';
  g.fillStyle = '#e8dfc9';
  g.fillText(`⚔ ${v}   🛡 ${b}   🗡 ${gu}`, 40, y);
  // footer
  g.fillStyle = 'rgba(212,168,67,.25)';
  g.fillRect(0, H - 92, W, 1);
  g.font = '700 30px Cinzel, serif';
  g.fillStyle = '#d4a843';
  g.fillText('EMBERFALL', 40, H - 36);
  g.font = '24px "Fragment Mono", monospace';
  g.fillStyle = '#8d8574';
  const site = 'emberfall.fun';
  g.fillText(site, W - 40 - g.measureText(site).width, H - 36);
  return new Promise(res => cv.toBlob(res, 'image/png'));
}

async function shareCard(uid) {
  const c = S.cards.get(uid);
  if (!c) return;
  const msg = $('cardShareMsg');
  const t = TIERS[c.tier] || TIERS[0];
  const text = `${c.name} · ${t.name} ⚡${c.power}, bound to my banner in Emberfall, `
    + `the fully onchain TCG on @hathornetwork. Free on testnet. Play with $HTR, `
    + `earn $GEMS at emberfall.fun`;
  try {
    // the native sheet is only useful where X lives as an app (touch devices)
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch) {
      msg.textContent = 'Forging the card image…';
      const blob = await cardShareImage(c);
      const file = new File([blob], `${slugOf(c.name)}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text });
        msg.textContent = '';
        track('share_card', { method: 'native' });
        return;
      }
    }
    // desktop: the champion travels with a link — X reads /c/<uid> and shows
    // the art under the post by itself (the composer cannot take attachments)
    const cardUrl = `${location.origin}/c/${uid}`;
    window.open('https://x.com/intent/tweet?text=' + encodeURIComponent(text)
      + '&url=' + encodeURIComponent(cardUrl), '_blank');
    msg.textContent = 'The champion travels with the link and shows under the post. Edit the words as you like.';
    track('share_card', { method: 'link' });
  } catch (e) {
    if ((e && e.name) === 'AbortError') { msg.textContent = ''; return; }
    msg.textContent = 'Could not build the card image: ' + ((e && e.message) || e);
    track('share_card', { method: 'failed' });
  }
}

let pickCtx = null;
function openPick(kind, ref) {
  pickCtx = { kind, ref };
  if (kind === 'writ') {
    const marchers = [...S.cards.values()].filter(c =>
      c.staker === S.addr && !(c.delveSince > 0) && (c.writFights || 0) < 3);
    if (!marchers.length) {
      $('errTitle').textContent = 'No champion available';
      $('errMsg').textContent = 'Writs are fought by staked champions. Stake one in '
        + 'The Mines (not delving, fewer than 3 writ fights today) and try again.';
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    const w = S.writs[ref.writ];
    $('pickTitle').textContent = `Fight ${w.name} (${WRIT_TIERS[ref.tier]}): choose a mining champion`;
    $('pickWagerRow').hidden = true;
    $('pickCards').innerHTML = marchers.map(c => cardBox(c,
      `<div class="duel-meta">${3 - (c.writFights || 0)} fight${3 - (c.writFights || 0) === 1 ? '' : 's'} left today</div>
       <button class="mini-btn" data-pick="${c.uid}">MARCH</button>`)).join('');
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => submitPick(el.dataset.pick));
    showStage('stagePick');
    $('overlay').hidden = false;
    return;
  }
  if (kind === 'want') {
    const others = [...S.cards.values()].filter(c => c.tier >= 0 && !c.mine);
    if (!others.length) {
      $('errTitle').textContent = 'No champions to trade for';
      $('errMsg').textContent = 'No other champion is known to the realm yet.';
      showStage('stageError'); return;
    }
    $('pickTitle').textContent = 'Choose the champion you want in return';
    $('pickWagerRow').hidden = true;
    $('pickCards').innerHTML = others.map(c => cardBox(c, `<button class="mini-btn" data-pick="${c.uid}">SELECT</button>`)).join('');
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => submitPick(el.dataset.pick));
    showStage('stagePick');
    return;
  }
  const mine = [...S.cards.values()].filter(c => c.mine);
  if (!mine.length) { $('errTitle').textContent = 'No cards'; $('errMsg').textContent = 'You hold no champion. Summon or claim one first.'; showStage('stageError'); $('overlay').hidden = false; return; }
  $('pickTitle').textContent = kind === 'create' ? 'Issue a challenge: choose your champion & wager' : `Answer challenge #${ref}: choose your champion`;
  $('pickWagerRow').hidden = kind !== 'create';
  if (kind === 'create') $('pickWager').value = ''; // the stake must be named, not defaulted
  if (kind === 'accept') {
    const d = S.duels.find(x => x.id === ref);
    $('pickTitle').textContent += ` (wager ${fmtGems(d.wager)})`;
  }
  $('pickCards').innerHTML = mine.map(c => cardBox(c, `<button class="mini-btn" data-pick="${c.uid}">SELECT</button>`)).join('');
  document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => submitPick(el.dataset.pick));
  if (kind === 'create' && typeof ref === 'string') {
    // preselect via direct card button
  }
  showStage('stagePick');
  $('overlay').hidden = false;
}

async function submitPick(uid) {
  const { kind, ref } = pickCtx;
  $('overlay').hidden = true;
  if (kind === 'writ') {
    await fightWrit(uid, ref.writ, ref.tier);
    return;
  }
  if (kind === 'want') {
    await doTx('Proposing trade', 'offer_swap', [uid], [depAct(ref, CARD_AMT)], { target: MKT });
    return;
  }
  if (kind === 'create') {
    const raw = $('pickWager').value.trim();
    if (raw === '') {
      $('errTitle').textContent = 'Name your wager';
      $('errMsg').textContent = 'Enter a wager in GEMS-cents, or 0 for a free duel '
        + 'where no gems change hands.';
      showStage('stageError');
      return;
    }
    const wager = Math.max(0, Number(raw) || 0);
    if (wager > S.gemsLedger + S.gemsWallet) { $('errTitle').textContent = 'Wager too high'; $('errMsg').textContent = `You have ${fmtGems(S.gemsLedger + S.gemsWallet)} in total.`; showStage('stageError'); return; }
    if (!(await ensureLedgerGems(wager))) { $('errTitle').textContent = 'Wager too high'; $('errMsg').textContent = 'Could not move enough gems to the ledger.'; showStage('stageError'); return; }
    await doTx('Issuing challenge', 'create_duel', [wager], [depAct(uid, CARD_AMT)]);
  } else {
    const duel = S.duels.find(x => x.id === ref);
    if (duel && duel.wager > 0 && !(await ensureLedgerGems(duel.wager))) {
      $('errTitle').textContent = 'Not enough gems for the wager';
      $('errMsg').textContent = `This trial wagers ${fmtGems(duel.wager)}.`;
      showStage('stageError');
      return;
    }
    const winsBefore = S.wins;
    const hash = await doTx('Trial by combat', 'accept_duel', [ref], [depAct(uid, CARD_AMT)]);
    if (!hash) return;
    const won = S.wins > winsBefore;
    const home = S.wallet?.mode === 'session'
      ? 'Your champion is already on the way home.'
      : 'Your champion returns; claim them under Collection.';
    const d = S.duels.find(x => x.id === ref);
    const mu = matchupHtml(S.cards.get(uid)?.aspects,
      d ? S.cards.get(d.card)?.aspects : null);
    $('duelResult').innerHTML = (won
      ? `<div class="duel-banner win">⚔️ VICTORY</div><div class="wait-sub">The pot is yours. ${home}</div>`
      : `<div class="duel-banner lose">💀 DEFEAT</div><div class="wait-sub">The pot is lost, but your champion lives. ${home}</div>`) + mu;
    window.sfx?.('clash');
    setTimeout(() => window.sfx?.(won ? 'win' : 'lose'), 450);
    showStage('stageDuel');
    $('overlay').hidden = false;
  }
}

/* ---------------- wallet connect ---------------- */

async function connectWallet(kind) {
  $('connectMsg').textContent = 'connecting…';
  try {
    const w = kind === 'snap' ? new window.WALLETS.SnapWallet() : new window.WALLETS.WcWallet();
    const onUri = async uri => {
      $('wcPair').hidden = false;
      $('wcCopyBtn').dataset.uri = uri;
      try {
        const QR = (await import('https://esm.sh/qrcode@1.5.4?bundle')).default;
        await QR.toCanvas($('wcQr'), uri, { width: 220, margin: 1 });
      } catch { $('wcQr').hidden = true; }
    };
    S.addr = await (kind === 'wc' ? w.connect(onUri) : w.connect());
    S.wallet = w;
    localStorage.setItem('gacha_wallet', kind); // silent restores know what to try
    window.WALLETS.prefetchSession();  // warm the session bundle for ⚡
    track('wallet_connect', { wallet: kind });
    $('overlay').hidden = true;
    $('wcPair').hidden = true;
    await refresh();
    // first time in the realm: walk them through it
    if (!localStorage.getItem('emberfall_tutorial_seen')) startTutorial();
  } catch (e) {
    $('connectMsg').textContent = e.message || String(e);
  }
}

/* ---------------- misc / boot ---------------- */

function showStage(id) {
  for (const s of ['stageWait', 'stageReveal', 'stageDuel', 'stageError', 'stageConnect', 'stagePick', 'stageTemper', 'stageDress', 'stageName', 'stageCard'])
    $(s).hidden = s !== id;
  $('overlay').hidden = false;
}

$('pullBtn').onclick = pull;
$('fuseBtn').onclick = fuse;
$('newDuelBtn').onclick = () => openPick('create', null);

/* the realm feed folds away; closed until the player opens it */
const FEED_LS = 'emberfall_feed_open';
function applyFeedFold() {
  const open = localStorage.getItem(FEED_LS) === '1';
  $('feedPanel').classList.toggle('collapsed', !open);
  $('feedList').hidden = !open;
  $('feedToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
}
$('feedToggle').onclick = () => {
  const open = localStorage.getItem(FEED_LS) === '1';
  localStorage.setItem(FEED_LS, open ? '0' : '1');
  applyFeedFold();
  window.track && track('feed_toggle', { open: !open });
};
applyFeedFold();
/* ---------------- promptless session ---------------- */

const SESSION_LS = 'emberfall_session';

function sessionNote(msg) { $('connectMsg').textContent = msg; }

function syncSessionBox() {
  const inSession = S.wallet?.mode === 'session';
  $('sessionBox').hidden = !S.addr;
  $('sessionStartBtn').hidden = inSession;
  $('sessionStartBtn').innerHTML = 'START SESSION \u00b7 ' + fmtHtr(ECON.sessionFund);
  $('sessionTopupBtn').innerHTML = 'TOP UP \u00b7 ' + fmtHtr(ECON.sessionFund);
  $('sessionEndBtn').hidden = !inSession;
  $('sessionTopupBtn').hidden = !(inSession && S.mainWallet);
  $('disconnectBtn').hidden = !S.addr || inSession;
  $('setNameBtn').hidden = !S.addr;
  $('setNameBtn').textContent = S.addr && S.names[S.addr] ? 'CHANGE NAME' : 'SET NAME';
  if (!S.sessionStarting) {
    $('sessionInfo').textContent = inSession
      ? 'Session active: every action signs instantly, no popups. Ending the session returns all champions and coin to ' + short(S.wallet.mainAddr) + '.'
      : 'Fund a session key held in this browser and play without approval popups. End the session anytime to return everything to your wallet.';
  }
}

async function startSession() {
  if (!S.wallet || S.wallet.mode === 'session') return;
  const main = S.wallet;
  S.sessionStarting = true;
  try {
    $('sessionStartBtn').disabled = true;
    sessionNote('Forging a session key in this browser\u2026');
    // reuse an unfinished session key if one is saved: coin may already be on
    // its way (or sitting) at that address, and a fresh key would orphan it
    let prior = null;
    try { prior = JSON.parse(localStorage.getItem(SESSION_LS)); } catch { }
    const reusing = !!(prior && prior.funding && prior.words);
    const words = reusing ? prior.words : await window.WALLETS.SessionWallet.create();
    // address 0 is derived offline (no sync, nothing to fail); the full
    // wallet only has to wake AFTER the coin is safely at this address
    const addr = await window.WALLETS.SessionWallet.addressFor(words);
    // persist the key BEFORE any coin can move: if the tab reloads while the
    // player is off in their wallet app (common on iOS), funds must never be
    // stranded at an address whose key only lived in memory
    localStorage.setItem(SESSION_LS, JSON.stringify(
      { words, mainAddr: main.address, addr, funding: ECON.sessionFund }));
    let waitRounds = 100; // 5 minutes on the automatic path
    // coin already waiting at a reused key: skip funding entirely
    const alreadyFunded = reusing
      && (await window.WALLETS.addrHtr(addr).catch(() => 0)) >= ECON.sessionFund;
    if (alreadyFunded) {
      sessionNote('Your earlier transfer is already here; finishing the setup\u2026');
    } else {
      try {
        // sendTransaction over WalletConnect used to fail post-approval
        // (upstream bug, no longer reproducing as of 2026-07-15): every
        // wallet now gets the automatic attempt, manual flow as fallback
        sessionNote('Funding request sent: now open your Hathor wallet and approve the '
          + fmtHtr(ECON.sessionFund) + ' transfer\u2026');
        await Promise.race([
          main.sendHtr(addr, ECON.sessionFund),
          new Promise((_, rej) => setTimeout(
            () => rej(new Error('wallet approval timed out')), 120_000)),
        ]);
        track('session_autofund', { ok: true, wallet: walletKindOf(main) });
        sessionNote('Waiting for the funding to arrive\u2026');
      } catch (e) {
        // wallet could not build the transfer: fall back to a manual send
        track('session_autofund', {
          ok: false, wallet: walletKindOf(main),
          reason: String((e && e.message) || e).slice(0, 200),
        });
        waitRounds = 600; // half an hour for a human-driven transfer
        showFundingUI(addr, ECON.sessionFund,
          'Automatic funding failed in your wallet. '
          + (reusing ? 'Reusing your earlier session key. ' : ''));
        sessionNote('Waiting for the transfer\u2026 safe to switch apps or even reload this page.');
      }
    }
    const funded = alreadyFunded || await awaitFunding(addr, waitRounds, ECON.sessionFund);
    if (!funded) {
      if (fundingCancelled) return;
      throw new Error('No coin seen yet. Your session key is saved in this browser: '
        + 'the moment the transfer lands, reopening the game finishes the setup.');
    }
    // only now wake the full wallet: the coin is already safe at the address,
    // so even a failed sync loses nothing (reopening the game retries)
    sessionNote('Coin secured; waking the session key\u2026');
    let sw;
    try { sw = await openSessionWallet(words, main.address); }
    catch {
      throw new Error('Your coin is safe at the session address, but the key '
        + 'could not sync yet. Reload the game to finish the setup.');
    }
    localStorage.setItem(SESSION_LS, JSON.stringify({ words, mainAddr: main.address, addr }));
    S.mainWallet = main;
    S.wallet = sw;
    S.addr = sw.address;
    track('session_start', { funder: walletKindOf(main) });
    $('overlay').hidden = true;
    await refresh();
    reclaimBanner();
  } catch (e) {
    sessionNote(e.message || String(e));
  } finally {
    S.sessionStarting = false;
    $('sessionStartBtn').disabled = false;
  }
}

async function topUpSession() {
  if (!S.mainWallet || S.wallet?.mode !== 'session') return;
  try {
    $('sessionTopupBtn').disabled = true;
    sessionNote('Approve the ' + fmtHtr(ECON.sessionFund) + ' top-up in your wallet\u2026');
    await S.mainWallet.sendHtr(S.wallet.address, ECON.sessionFund);
    sessionNote('Top-up sent; it lands within seconds.');
    setTimeout(() => refresh().catch(() => {}), 4000);
  } catch (e) {
    sessionNote(e.message || String(e));
  } finally {
    $('sessionTopupBtn').disabled = false;
  }
}

async function endSession() {
  if (S.wallet?.mode !== 'session') return;
  try {
    $('sessionEndBtn').disabled = true;
    sessionNote('Checking for anything still in play\u2026');
    try { await refresh(); }
    catch (e) {
      sessionNote((e && e.message) || 'the Ledger could not be read just now; try again in a moment');
      return;
    }
    const blockers = [];
    const cs = [...S.cards.values()];
    const n1 = cs.filter(c => c.pending === S.addr).length;
    if (n1) blockers.push(`${n1} champion${n1 > 1 ? 's' : ''} awaiting claim under Collection`);
    const delvers = cs.filter(c => c.staker === S.addr && (c.delveSince || 0) > 0);
    const n2 = cs.filter(c => c.staker === S.addr).length - delvers.length;
    if (n2) blockers.push(`${n2} champion${n2 > 1 ? 's' : ''} still toiling in The Mines (recall them)`);
    if (delvers.length) {
      // a delve locks the champion until it ends and the haul is claimed
      const doneAt = Math.max(...delvers.map(c =>
        ((c.delveSince || 0) + (S.delveSeconds || 28800)) * 1000));
      const mins = Math.ceil((doneAt - Date.now()) / 60000);
      blockers.push(delvers.length + ' champion' + (delvers.length > 1 ? 's' : '')
        + ' mid-delve in The Mines: '
        + (mins > 0
          ? `the delve ends in ${Math.floor(mins / 60)}h ${mins % 60}m; claim it, then recall`
          : 'the delve is done; CLAIM DELVE, then recall'));
    }
    const n3 = cs.filter(c => c.marketPending === S.addr).length;
    if (n3) blockers.push(`${n3} champion${n3 > 1 ? 's' : ''} held for you in The Bazaar (claim under 'Held by the guild')`);
    if (S.gemsLedger > 0) blockers.push(`${fmtGems(S.gemsLedger)} in your ledger (withdraw in The Mines)`);
    if (S.favorOwed > 0) blockers.push(`a ${fmtHtr(S.favorOwed)} refund from the Weaver (claim it under SUMMON)`);
    if (S.marketFunds > 0) blockers.push(`${fmtHtr(S.marketFunds)} sale proceeds in The Bazaar (withdraw them)`);
    const n4 = S.duels.filter(d => d.status === 'open' && d.challenger === S.addr).length;
    if (n4) blockers.push(`${n4} open challenge${n4 > 1 ? 's' : ''} in The Pit (cancel or see them fought)`);
    const n5 = S.listings.filter(l => l.status === 'open' && l.seller === S.addr).length;
    if (n5) blockers.push(`${n5} open listing${n5 > 1 ? 's' : ''} in The Bazaar (cancel or sell)`);
    const n6 = S.swaps.filter(w => w.status === 'open' && w.maker === S.addr).length;
    if (n6) blockers.push(`${n6} open trade${n6 > 1 ? 's' : ''} in The Bazaar (cancel them)`);
    if (blockers.length) {
      sessionNote('Before the session can end, settle: '
        + blockers.join(' · ') + '.');
      return;
    }
    // the name goes home first: a bequest signed by the session key (the
    // holder) moves it to the main wallet before the sweep empties the purse
    if (S.names[S.addr] && S.wallet.mainAddr) {
      sessionNote('Sending your name home\u2026');
      try {
        const { hash } = await S.wallet.sendData(
          `emberfall:bequeath:${S.wallet.mainAddr}:${await nameSecretHash()}`);
        await waitForConfirm(hash);
        const br = await fetch('/api/name', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tx: hash, addr: S.addr }),
        });
        const bd = await br.json();
        track('name_bequeath', { ok: !!bd.success, reason: (bd.error || '').slice(0, 80) });
      } catch (e) {
        // best effort: the sweep must never be hostage to the name
        track('name_bequeath', {
          ok: false, reason: String((e && e.message) || e).slice(0, 80),
        });
      }
    }
    sessionNote('Returning all champions and coin to your wallet\u2026');
    const r = await S.wallet.sweep();
    track('session_end', { swept: r ? r.moved : 0 });
    sessionNote(r ? `Returned ${r.moved} holdings to your wallet.` : 'Nothing to return.');
    await S.wallet.disconnect();
    try {
      const arch = JSON.parse(localStorage.getItem(SESSION_LS + '_archive') || '[]');
      const cur = JSON.parse(localStorage.getItem(SESSION_LS) || 'null');
      if (cur) arch.push({ ...cur, endedAt: Date.now(), address: S.wallet.address });
      localStorage.setItem(SESSION_LS + '_archive', JSON.stringify(arch.slice(-10)));
    } catch { /* best effort */ }
    localStorage.removeItem(SESSION_LS);
    const main = S.mainWallet;
    S.mainWallet = null;
    if (main) {
      S.wallet = main;
      S.addr = main.address;
    } else {
      // the session outlived the page load that started it, so no live main
      // wallet object exists: quietly re-adopt the wallet pairing instead of
      // dropping the player to "Connect wallet"
      S.wallet = null;
      S.addr = null;
      sessionNote('Session ended; reconnecting your wallet…');
      if (await restoreWcPairing() || await restoreSnap()) {
        sessionNote('Session ended; your wallet is connected again.');
        track('wallet_connect', { wallet: `${walletKind()}-restored-after-session` });
      }
    }
    await refresh();
  } catch (e) {
    sessionNote(e.message || String(e));
  } finally {
    $('sessionEndBtn').disabled = false;
  }
}

/* funding helpers: the wait survives app switches, reloads, and patience */
let fundingCancelled = false;

function showFundingUI(addr, need, lead) {
  $('sessionInfo').innerHTML = (lead || '')
    + `Send <b>${fmtHtr(need)}</b> (or more) to the session address below from your `
    + 'wallet\u2019s normal send screen; the game will detect it, even if you switch '
    + 'apps or reload this page.<br>'
    + '<canvas id="fundQr" hidden></canvas>'
    + `<span class="mono" style="word-break:break-all">${addr}</span> `
    + `<button class="mini-btn alt" style="margin-top:8px" onclick="navigator.clipboard.writeText('${addr}')">COPY ADDRESS</button> `
    + `<button class="mini-btn alt" style="margin-top:8px" id="fundCancelBtn">CANCEL</button>`;
  // on desktop the wallet is usually a phone: offer the address as a QR for
  // its send screen scanner (on phones the wallet is on this same device)
  if (!matchMedia('(pointer: coarse)').matches) {
    import('https://esm.sh/qrcode@1.5.4?bundle').then(m => {
      const cv = $('fundQr');
      if (!cv) return;  // the funding UI may already be gone
      cv.hidden = false;
      return m.default.toCanvas(cv, addr, { width: 172, margin: 2 });
    }).catch(() => { const cv = $('fundQr'); if (cv) cv.hidden = true; });
  }
  $('fundCancelBtn').onclick = async () => {
    const bal = await window.WALLETS.addrHtr(addr).catch(() => 0);
    if (bal > 0) {
      sessionNote('Coin already arrived at this key; finishing the setup\u2026');
      return;
    }
    localStorage.removeItem(SESSION_LS);
    fundingCancelled = true;
    sessionNote('Session key discarded. Nothing was sent.');
  };
}

async function awaitFunding(addr, rounds, need) {
  fundingCancelled = false;
  for (let i = 0; i < rounds; i++) {
    if (fundingCancelled) return false;
    if (await window.WALLETS.addrHtr(addr).catch(() => 0) >= need) return true;
    await new Promise(r => setTimeout(r, 3000));
  }
  return (await window.WALLETS.addrHtr(addr).catch(() => 0)) >= need;
}

async function resumeSession() {
  const raw = localStorage.getItem(SESSION_LS);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved.funding) {
      resumeFundingWait(saved);  // background: never blocks boot or wallet restore
      return;
    }
    const sw = await openSessionWallet(saved.words, saved.mainAddr);
    S.wallet = sw;
    S.addr = sw.address;
    await refresh();
    reclaimBanner();
  } catch (e) {
    console.warn('session resume failed:', e);
  }
}

async function resumeFundingWait(saved) {
  try {
    const need = saved.funding;
    const addr = saved.addr
      || await window.WALLETS.SessionWallet.addressFor(saved.words);
    if ((await window.WALLETS.addrHtr(addr).catch(() => 0)) < need) {
      ribbon('An unfinished session key awaits funding: open \u26a1 Promptless Play to finish or discard it');
      const ok = await awaitFunding(addr, 600, need);
      if (!ok) return;  // the key stays saved; the next visit tries again
    }
    if (S.sessionStarting || (S.wallet && S.wallet.mode === 'session')) return;
    ribbon('Coin found; finishing your promptless session…');
    const sw = await openSessionWallet(saved.words, saved.mainAddr);
    localStorage.setItem(SESSION_LS, JSON.stringify(
      { words: saved.words, mainAddr: saved.mainAddr, addr }));
    if (S.wallet) S.mainWallet = S.wallet;  // e.g. a silently restored pairing
    S.wallet = sw;
    S.addr = sw.address;
    track('session_start', { funder: 'resumed-funding' });
    ribbon('The funding arrived: your session is ready', 'level', 'coin');
    $('overlay').hidden = true;
    await refresh();
    reclaimBanner();
  } catch (e) {
    // the record stays saved; syncing is retried on the next visit
    ribbon('Your funded session key is safe; reload the game to finish the setup');
    console.warn('resume funding failed:', e);
  }
}

// waking a session wallet does a full network sync, which can fail on flaky
// mobile connections: try a few times before giving up (the key stays saved)
async function openSessionWallet(words, mainAddr) {
  let last = null;
  for (let i = 0; i < 3; i++) {
    try { return await window.WALLETS.SessionWallet.open(words, mainAddr); }
    catch (e) {
      last = e;
      track('session_sync_failed', {
        attempt: i + 1,
        reason: String((e && e.message) || e).slice(0, 300),
      });
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  throw last;
}

// silently reconnect MetaMask Snap: an installed, already-approved snap
// resolves without prompts, so this only runs when Snap was the last wallet
async function restoreSnap() {
  if (localStorage.getItem('gacha_wallet') !== 'snap') return null;
  try {
    const w = new window.WALLETS.SnapWallet();
    const addr = await w.connect();
    if (!addr) return null;
    S.wallet = w;
    S.addr = addr;
    return w;
  } catch { return null; } // locked or removed: the player connects manually
}

// silently re-adopt a prior WalletConnect pairing, if a live one exists
// (pairings persist for days and survive page reloads)
async function restoreWcPairing() {
  if (!window.GAME.wcProjectId
      || !Object.keys(localStorage).some(k => k.startsWith('wc@2'))) return null;
  try {
    const w = new window.WALLETS.WcWallet();
    const addr = await w.restore();
    if (!addr) return null;
    S.wallet = w;
    S.addr = addr;
    return w;
  } catch { return null; }
}

async function disconnectWallet() {
  await S.wallet?.disconnect?.().catch(() => {});
  S.wallet = null; S.addr = null; S.htr = 0; S.gemsWallet = 0;
  S.gemsLedger = 0; S.wins = 0; S.prevWins = undefined; S.selected.clear();
  S.lineage = null; S.gemsLineageExtra = 0;
  for (const c of S.cards.values()) c.mine = false;
  localStorage.removeItem('gacha_wallet');
  $('overlay').hidden = true;
  render();
}

$('walletBtn').onclick = () => {
  $('connectMsg').textContent = S.addr ? `Connected: ${S.wallet.label} · ${who(S.addr)}` : '';
  syncSessionBox();
  // warm the WalletConnect bundle while the player reads the options
  if (!S.addr) window.WALLETS.prefetchWc();
  showStage('stageConnect');
};
$('disconnectBtn').onclick = disconnectWallet;
$('setNameBtn').onclick = openName;
$('sessionStartBtn').onclick = startSession;
$('headerSessionBtn').onclick = () => {
  $('walletBtn').onclick();
  if (S.wallet?.mode !== 'session') startSession();
};
$('sessionTopupBtn').onclick = topUpSession;
$('sessionEndBtn').onclick = endSession;
document.querySelectorAll('.connect-opt').forEach(el => el.onclick = () => connectWallet(el.dataset.wallet));
for (const id of ['revealCloseBtn', 'errCloseBtn', 'duelCloseBtn', 'connectCloseBtn', 'pickCloseBtn', 'temperCancel', 'dressCloseBtn', 'nameCancel', 'cardCloseBtn'])
  $(id).onclick = () => { $('overlay').hidden = true; };
$('nameClaimBtn').onclick = claimName;
$('cardShareBtn').onclick = () => cardDetailUid && shareCard(cardDetailUid);
// desktop lands in the X composer, mobile in the app-agnostic share sheet
$('cardShareBtn').textContent = matchMedia('(pointer: coarse)').matches ? 'SHARE' : 'SHARE ON X';
// the card and wallet views close like any lightbox: Escape or a click outside
const dismissible = () => !$('stageCard').hidden || !$('stageConnect').hidden;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('overlay').hidden && dismissible()) $('overlay').hidden = true;
});
$('overlay').addEventListener('click', e => {
  if (dismissible() && !e.target.closest('.stage')) $('overlay').hidden = true;
});
$('revealCloseBtn').onclick = () => { $('overlay').hidden = true; revealDismissed(); };
document.querySelectorAll('[data-aspectpick]').forEach(el =>
  el.onclick = () => doTemper(Number(el.dataset.aspectpick)));
// no wallet yet? point at the right store for this device
(function initGetWallet() {
  const el = $('getWallet');
  if (!el) return;
  const ua = navigator.userAgent;
  const PLAY = 'https://play.google.com/store/apps/details?id=network.hathor.wallet';
  const APPSTORE = 'https://apps.apple.com/app/hathor-crypto-wallet/id1465041963';
  let links;
  if (/android/i.test(ua)) {
    links = `<a href="${PLAY}" target="_blank" rel="noopener">Get the Hathor wallet on Google Play</a>`;
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    links = `<a href="${APPSTORE}" target="_blank" rel="noopener">Get the Hathor wallet on the App Store</a>`;
  } else {
    links = `<a href="https://metamask.io/download" target="_blank" rel="noopener">Get MetaMask</a>
      <span class="gw-note">(the Hathor Snap installs on first connect)</span>
      · Hathor wallet for your phone:
      <a href="${PLAY}" target="_blank" rel="noopener">Google Play</a> ·
      <a href="${APPSTORE}" target="_blank" rel="noopener">App Store</a>`;
  }
  el.innerHTML = `<span class="gw-lead">New to the realm and walletless?</span> ${links}`;
  el.addEventListener('click', e => {
    if (e.target.tagName === 'A') track('get_wallet_click', { href: e.target.href });
  });
})();

// the button hands the WalletConnect pairing code to the clipboard
$('wcCopyBtn').addEventListener('click', async () => {
  const uri = $('wcCopyBtn').dataset.uri;
  if (!uri) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(uri);
    ok = true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = uri;
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, uri.length);  // iOS needs an explicit range
      ok = document.execCommand('copy');
      ta.remove();
    } catch { }
  }
  if (ok) {
    const note = $('wcCopied');
    note.classList.add('show');
    clearTimeout(note._t);
    note._t = setTimeout(() => note.classList.remove('show'), 2200);
    window.sfx?.('coin', { volume: .5 });
  }
});

// a click during the reveal build-up skips straight to the card
$('overlay').addEventListener('click', () => {
  const stage = $('stageReveal');
  if (!stage.hidden && stage.classList.contains('sequencing')) {
    track('reveal_skip', { tier: S.revealTier });
    finishReveal(S.revealTier);
  }
});

// codex sections: collapsed by default, open/closed state remembered
const CODEX_LS = 'emberfall_codex';
document.querySelectorAll('.codex-sec').forEach(d => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CODEX_LS) || '{}'); } catch { }
  if (saved[d.dataset.sec]) d.open = true;
  d.addEventListener('toggle', () => {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(CODEX_LS) || '{}'); } catch { }
    s[d.dataset.sec] = d.open;
    localStorage.setItem(CODEX_LS, JSON.stringify(s));
    if (d.open) track('codex_open', { section: d.dataset.sec });
  });
});

document.querySelectorAll('.tab').forEach(el => el.onclick = () => {
  track('tab_view', { tab: el.dataset.tab });
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === el));
  for (const p of ['collection', 'farm', 'arena', 'market', 'learn']) $('pane-' + p).hidden = p !== el.dataset.tab;
});
$('wdGemsBtn')?.addEventListener('click', () => {});
document.addEventListener('click', async e => {
  if (e.target.id === 'wdGemsBtn') {
    if (await doTx('Withdrawing gems', 'withdraw_gems', [], [wdAct(GEMS, S.gemsLedger)])) window.sfx?.('coin');
  }
  if (e.target.id === 'depGemsBtn') doTx('Moving gems to your ledger', 'deposit_gems', [], [depAct(GEMS, S.gemsWallet)]);
  if (e.target.id === 'wdFundsBtn') {
    if (await doTx('Withdrawing HTR', 'withdraw_funds', [], [wdAct(HTR, S.marketFunds)], { target: MKT })) window.sfx?.('coin');
  }
});

/* the unbound: champions cycling through the summoning stone */
const STATION_TIER = { Footman: 0, Knight: 1, Highlord: 2, Sovereign: 3 };
(function initShowcase() {
  if (!$('showA') || !window.CATALOG) return;
  const names = Object.keys(CATALOG);
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  let idx = 0, front = false;
  function next() {
    const name = names[idx % names.length];
    idx++;
    const meta = CATALOG[name];
    const t = TIERS[STATION_TIER[meta.station] ?? 0];
    const incoming = $(front ? 'showA' : 'showB');
    incoming.src = 'cards/' + slugOf(name) + '.jpg';
    incoming.onload = () => {
      $('showA').classList.toggle('on', front);
      $('showB').classList.toggle('on', !front);
      $('showName').textContent = name;
      const st = $('showStation');
      st.textContent = `${meta.station} · ${meta.type}`;
      st.style.color = t.color;
      $('machine').style.setProperty('--rc', t.color);
      front = !front;
    };
  }
  next();
  if (!REDUCED) setInterval(next, 6000);
})();

/* whispers of the realm: live, mildly envy-inducing facts */
(function initWhispers() {
  const el = $('whisperText');
  if (!el) return;
  let lastPulls = null, realmStirred = false, wi = 0;
  function messages() {
    const m = [];
    if (realmStirred) m.push('fresh souls were summoned only moments ago…');
    if (S.totalPulls > 0) m.push(`${S.totalPulls} souls summoned across the realm, and the Weaver never sleeps`);
    if (S.favorPool > 0) m.push(`the Weaver's favor pool holds ${fmtHtr(S.favorPool)}: one summoning in twenty-five wins it back`);
    if (S.raffle && S.raffle.pool > 0) {
      const days = Math.max(0, Math.ceil((S.raffle.week_ends * 1000 - Date.now()) / 86400000));
      m.push(`this week's favor pot holds ${fmtHtr(S.raffle.pool)}, drawn in ${days} day${days === 1 ? '' : 's'}`);
    }
    m.push('a Sovereign answers one summons in a hundred');
    m.push('every champion is one of a kind; the one you skip belongs to someone else tomorrow');
    return m;
  }
  function tick() {
    if (lastPulls != null && S.totalPulls > lastPulls) realmStirred = true;
    lastPulls = S.totalPulls;
    const m = messages();
    el.classList.remove('in');
    setTimeout(() => {
      el.textContent = m[wi % m.length];
      wi++;
      el.classList.add('in');
    }, 400);
  }
  setTimeout(tick, 800);
  setInterval(tick, 6500);
})();

(async () => {
  // a saved session or prior pairing will be restored below: say so in the
  // header right away so the player doesn't start a second connection
  const savedSession = !!localStorage.getItem(SESSION_LS);
  const savedPairing = window.GAME.wcProjectId
    && Object.keys(localStorage).some(k => k.startsWith('wc@2'));
  const savedSnap = localStorage.getItem('gacha_wallet') === 'snap';
  S.restoring = !!(savedSession || savedPairing || savedSnap);
  if (S.restoring) {
    $('walletAddr').textContent = 'Connecting…';
    $('walletBtn').classList.remove('beckon');
    // start the heavy wallet bundle downloads before anything else
    if (savedSession) window.WALLETS.prefetchSession();
    else if (savedPairing) window.WALLETS.prefetchWc();
  }
  // the session wallet syncs while the first realm read runs, not after it
  const sessionP = resumeSession();
  await loadContract().catch(e => { $('pullNote').textContent = 'Failed to load: ' + e.message; });
  // the feed greets visitors before any wallet is connected
  loadNames().then(loadFeed).catch(() => {});
  render();
  // a shared champion link (/c/<uid>) lands here with ?card=: open the card
  const sharedCard = new URLSearchParams(location.search).get('card');
  if (sharedCard && S.cards.has(sharedCard)) openCard(sharedCard);
  await sessionP;
  // silently resume a prior pairing: WalletConnect first (persists for
  // days), else MetaMask Snap when it was the last wallet used here
  if (!S.wallet && (await restoreWcPairing() || await restoreSnap())) {
    window.WALLETS.prefetchSession();  // warm the session bundle for ⚡
    track('wallet_connect', { wallet: `${walletKind()}-restored` });
    await refresh();
  }
  S.restoring = false;
  render();
})();
setInterval(() => refresh().catch(() => {}), 45000);

/* WalletConnect sendTransaction probe matrix (?wctest=1): three variants of
   htr_sendTransaction isolating amount and recipient. "OPER" sends to the
   game operator's address, recoverable if approved. Debug only. */
if (new URLSearchParams(location.search).has('wctest')) {
  const OPER = 'Wer2yUudABEUzKbM8Q2qQFvLgW2s5kFkzG';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;bottom:14px;left:14px;z-index:60;'
    + 'display:flex;flex-direction:column;gap:6px';
  const show = (title, msg) => {
    $('errTitle').textContent = title;
    $('errMsg').textContent = msg;
    showStage('stageError');
    $('overlay').hidden = false;
  };
  const probe = (label, amount, toKind) => {
    const b = document.createElement('button');
    b.className = 'mini-btn';
    b.textContent = label;
    b.onclick = async () => {
      if (S.wallet?.mode !== 'wc') {
        show('Connect first', 'Pair via WalletConnect, then tap the test again.');
        return;
      }
      b.disabled = true;
      const was = b.textContent;
      b.textContent = 'AWAITING WALLET…';
      try {
        const r = await Promise.race([
          S.wallet.sendHtr(toKind === 'self' ? S.addr : OPER, amount),
          new Promise((_, rej) => setTimeout(() => rej(new Error(
            'The wallet never responded (3 min). If the request could not '
            + 'even be opened there, that is the finding.')), 180_000)),
        ]);
        track('wctest_send', { ok: true, amount, to: toKind });
        show('Send succeeded ✓', `${label}: the wallet built and pushed the `
          + 'transfer. Hash: ' + ((r && r.hash) || 'unknown'));
      } catch (e) {
        const msg = (e && e.message) || String(e);
        track('wctest_send', { ok: false, amount, to: toKind, reason: msg.slice(0, 300) });
        show('Send failed', `${label}: ${msg}`);
      }
      b.disabled = false;
      b.textContent = was;
    };
    wrap.appendChild(b);
  };
  probe('TEST 0.01 → SELF', 1, 'self');
  probe('TEST 10 → SELF', 1000, 'self');
  probe('TEST 10 → OPER', 1000, 'oper');

  // the decisive variant: a recipient address that has NEVER appeared on
  // chain, exactly like a fresh session key. Prefers the pending session's
  // own address (approval then simply completes that session); otherwise
  // derives a throwaway whose words are kept in localStorage (recoverable).
  const bf = document.createElement('button');
  bf.className = 'mini-btn';
  bf.textContent = 'TEST 10 → FRESH ADDR';
  bf.onclick = async () => {
    if (S.wallet?.mode !== 'wc') {
      show('Connect first', 'Pair via WalletConnect, then tap the test again.');
      return;
    }
    bf.disabled = true;
    const was = bf.textContent;
    bf.textContent = 'PREPARING…';
    try {
      let target = null;
      let rec = null;
      try { rec = JSON.parse(localStorage.getItem('emberfall_session')); } catch { }
      if (rec && rec.funding && rec.addr) {
        target = rec.addr;  // approval funds and completes the pending session
      } else {
        const words = await window.WALLETS.SessionWallet.create();
        target = await window.WALLETS.SessionWallet.addressFor(words);
        localStorage.setItem('wctest_fresh', JSON.stringify({ words, addr: target }));
      }
      bf.textContent = 'AWAITING WALLET…';
      const r = await Promise.race([
        S.wallet.sendHtr(target, 1000),
        new Promise((_, rej) => setTimeout(() => rej(new Error(
          'The wallet never responded (3 min).')), 180_000)),
      ]);
      track('wctest_send', { ok: true, amount: 1000, to: 'fresh' });
      show('Send succeeded ✓', 'FRESH ADDR: the wallet built and pushed the '
        + 'transfer. Hash: ' + ((r && r.hash) || 'unknown'));
    } catch (e) {
      const msg = (e && e.message) || String(e);
      track('wctest_send', { ok: false, amount: 1000, to: 'fresh', reason: msg.slice(0, 300) });
      show('Send failed', 'FRESH ADDR: ' + msg);
    }
    bf.disabled = false;
    bf.textContent = was;
  };
  wrap.appendChild(bf);
  document.body.appendChild(wrap);
}
