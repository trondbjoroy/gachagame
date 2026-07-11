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
};

/* ---------------- chain reads ---------------- */

async function node(path) { return (await fetch('/node' + path)).json(); }
const ncState = qs => node(`/nano_contract/state?id=${NC}&` + qs);
const callQs = cs => cs.map(c => 'calls[]=' + encodeURIComponent(c)).join('&');

async function batchCalls(cs) {
  const out = {};
  for (let i = 0; i < cs.length; i += 30) {
    const d = await ncState(callQs(cs.slice(i, i + 30)));
    for (const [k, v] of Object.entries(d.calls || {})) out[k] = v.value;
  }
  return out;
}

async function loadContract() {
  const base = await ncState('balances[]=__all__&fields[]=total_pulls' + '&' +
    callQs(['get_pull_price()', 'get_duel_count()']));
  S.totalPulls = base.fields.total_pulls.value;
  S.pullPrice = base.calls['get_pull_price()'].value;
  const duelCount = base.calls['get_duel_count()'].value;
  const uids = Object.keys(base.balances).filter(u => u !== HTR && u !== GEMS);

  // static card info is immutable — fetch once
  const fresh = uids.filter(u => !S.cards.has(u));
  if (fresh.length) {
    const info = await batchCalls(fresh.flatMap(u =>
      [`get_card_name("${u}")`, `get_card_tier("${u}")`, `get_card_power("${u}")`]));
    for (const u of fresh) {
      S.cards.set(u, {
        uid: u, name: info[`get_card_name("${u}")`],
        tier: info[`get_card_tier("${u}")`], power: info[`get_card_power("${u}")`],
        pending: null, staker: null, mine: false, pendingGems: 0,
      });
    }
  }
  const live = uids.filter(u => (S.cards.get(u)?.tier ?? -1) >= 0);
  const dyn = await batchCalls(live.flatMap(u =>
    [`get_pending_owner("${u}")`, `get_staker("${u}")`,
     `get_card_aspects("${u}")`, `get_card_wins("${u}")`]));
  const now = Math.floor(Date.now() / 1000);
  for (const u of live) {
    const c = S.cards.get(u);
    c.pending = dyn[`get_pending_owner("${u}")`] ?? null;
    c.staker = dyn[`get_staker("${u}")`] ?? null;
    const asp = dyn[`get_card_aspects("${u}")`] || '';
    c.aspects = asp ? asp.split('|').map(Number) : null;  // [valor,bulwark,guile,tempers,hardened]
    c.wins = dyn[`get_card_wins("${u}")`] || 0;
  }
  const stakedMine = live.filter(u => S.cards.get(u).staker === S.addr);
  if (stakedMine.length) {
    const pg = await batchCalls(stakedMine.flatMap(u =>
      [`get_pending_gems("${u}", ${now})`, `get_temper_cost("${u}")`]));
    for (const u of stakedMine) {
      S.cards.get(u).pendingGems = pg[`get_pending_gems("${u}", ${now})`] || 0;
      S.cards.get(u).temperCost = pg[`get_temper_cost("${u}")`] || 0;
    }
  }

  if (S.addr) {
    const me = await batchCalls([`get_gems_balance("${S.addr}")`, `get_wins("${S.addr}")`,
      `get_renown("${S.addr}")`, `get_vigil_streak("${S.addr}")`, `get_favor_owed("${S.addr}")`,
      'get_favor_pool()']);
    S.gemsLedger = me[`get_gems_balance("${S.addr}")`] || 0;
    S.wins = me[`get_wins("${S.addr}")`] || 0;
    S.renown = me[`get_renown("${S.addr}")`] || 0;
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
    const out = {};
    for (let i = 0; i < cs.length; i += 30) {
      const d = await mkState(callQs(cs.slice(i, i + 30)));
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

async function refresh() {
  await loadContract();
  await loadMarket().catch(() => {});
  await loadMine();
  await loadRaffle();
  render();
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
  { id: 'delver', name: 'Delver of the Deep', desc: 'Have a champion toiling in the Mines', test: s => s.staked >= 1 },
  { id: 'knighted', name: 'Knight of the Realm', desc: 'Have a champion of Knight station or higher', test: s => s.owned.some(c => c.tier >= 1) },
  { id: 'first-blood', name: 'First Blood', desc: 'Win a trial in the Pit', test: s => s.wins >= 1 },
  { id: 'warband', name: 'Raise a Warband', desc: 'Have five champions at once', test: s => s.owned.length >= 5 },
  { id: 'gem-hoard', name: 'Gem-Hoarder', desc: 'Hold 2.00 gems or more', test: s => s.gems >= 200 },
  { id: 'high-court', name: 'Court of Highlords', desc: 'Have a Highlord in your host', test: s => s.owned.some(c => c.tier >= 2) },
  { id: 'muster-four', name: 'Muster of Four', desc: 'Hold all four stations at once', test: s => new Set(s.owned.map(c => c.tier)).size >= 4 },
  { id: 'host', name: 'Raise a Host', desc: 'Have twelve champions at once', test: s => s.owned.length >= 12 },
  { id: 'pit-fighter', name: 'Pit Fighter', desc: 'Win five trials in the Pit', test: s => s.wins >= 5 },
  { id: 'gathering-storm', name: 'The Gathering Storm', desc: 'Command 300 combined power', test: s => s.power >= 300 },
  { id: 'mine-master', name: 'Master of the Mines', desc: 'Have five champions toiling at once', test: s => s.staked >= 5 },
  { id: 'gem-baron', name: 'Gem-Baron', desc: 'Hold 10.00 gems or more', test: s => s.gems >= 1000 },
  { id: 'sovereign', name: "Sovereign's Own", desc: 'Have a Sovereign in your host', test: s => s.owned.some(c => c.tier >= 3) },
  { id: 'army', name: 'Raise an Army', desc: 'Have twenty-five champions at once', test: s => s.owned.length >= 25 },
  { id: 'pit-champion', name: 'Pit Champion', desc: 'Win fifteen trials in the Pit', test: s => s.wins >= 15 },
  { id: 'storm-banners', name: 'Storm of Banners', desc: 'Command 750 combined power', test: s => s.power >= 750 },
  { id: 'legion', name: 'The Legion of Emberfall', desc: 'Have forty champions at once', test: s => s.owned.length >= 40 },
];

function deedState() {
  const owned = [...S.cards.values()].filter(c => c.tier >= 0 &&
    (c.mine || (S.addr && (c.staker === S.addr || c.pending === S.addr || c.marketPending === S.addr))));
  return {
    owned,
    staked: owned.filter(c => c.staker === S.addr).length,
    gems: S.gemsLedger + S.gemsWallet,
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
      ribbon(`⚜ Deed witnessed: <b>${d ? d.name : id}</b>`);
    }
  }
  const lvl = levelFor(done.length);
  if (!first && prevLevel != null && lvl > prevLevel)
    ribbon(`You rise to <b>Level ${lvl} · ${TITLES[lvl - 1]}</b>`, 'level');
  localStorage.setItem(key, JSON.stringify({ deeds: done, level: lvl }));
}

/* ---------------- ribbons (deed / level announcements) ---------------- */

const ribbonQ = [];
let ribbonBusy = false;
function ribbon(html, cls) {
  ribbonQ.push([html, cls]);
  pumpRibbons();
}
function pumpRibbons() {
  if (ribbonBusy || !ribbonQ.length) return;
  ribbonBusy = true;
  const [html, cls] = ribbonQ.shift();
  const el = document.createElement('div');
  el.className = 'ribbon' + (cls ? ' ' + cls : '');
  el.innerHTML = html;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 30);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.remove(); ribbonBusy = false; pumpRibbons(); }, 500);
  }, 3600);
}

/* ---------------- stat count-ups ---------------- */

const COUNTED_STATS = ['Souls summoned · realm', 'Your gems in ledger', 'Your gems in hand', 'Your trials won', 'Your renown'];
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

function aspectsRow(c) {
  if (!c.aspects) return '';
  const [v, b, g, t, h] = c.aspects;
  const marks = (t > 0 ? ` · tempered ×${t}` : '') + (h > 0 ? ` · hardened ×${h}` : '');
  return `<div class="ac-aspects" title="valor · bulwark · guile${marks}">
    ⚔ ${v} &nbsp; 🛡 ${b} &nbsp; 🗡 ${g}</div>`;
}

function stationLine(c, t, meta) {
  return `${t.name}${meta ? ' · ' + meta.type : ''}${c.wins > 0 ? ` · ★ ${c.wins}` : ''}`;
}

function cardBox(c, buttonsHtml, selectable) {
  const t = TIERS[c.tier] || TIERS[0];
  const sel = S.selected.has(c.uid) ? ' selected' : '';
  const meta = cardMeta(c.name);
  if (meta?.art) {
    return `<div class="card art-card${sel}" style="--rc:${t.color}" ${selectable ? `data-select="${c.uid}"` : ''}>
      <img class="ac-img" loading="lazy" src="cards/${slugOf(c.name)}.jpg" alt="">
      <div class="ac-scrim"></div>
      <div class="ac-top"><span class="ac-name">${c.name}</span><span class="ac-power">⚡${c.power}</span></div>
      <div class="ac-bottom">
        <div class="ac-station" style="color:${t.color}">${stationLine(c, t, meta)}</div>
        ${aspectsRow(c)}
        <div class="ac-flavor">${meta.flavor}</div>
        ${buttonsHtml || ''}
      </div>
    </div>`;
  }
  return `<div class="card${sel}" style="--rc:${t.color}" ${selectable ? `data-select="${c.uid}"` : ''}>
    <div class="emoji">${artSvg(c.name)}</div>
    <div class="name">${c.name}</div>
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

function render() {
  $('walletDot').className = 'dot' + (S.addr ? '' : ' off');
  $('walletAddr').textContent = S.addr ? `${S.wallet.label.split(' ')[0]} · ${short(S.addr)}` : 'Connect wallet';
  $('walletHtr').textContent = S.addr ? fmtHtr(S.htr) : '';
  $('walletHtr').title = S.addr ? 'Balance on your main address only; your wallet shows the full total' : '';
  $('walletHint').textContent = S.addr ? (S.wallet?.mode === 'session' ? 'session' : 'this address') : '';
  const hsb = $('headerSessionBtn');
  hsb.hidden = !S.addr;
  const inSess = S.wallet?.mode === 'session';
  hsb.innerHTML = inSess ? '\u26a1 SESSION ACTIVE' : '\u26a1 PROMPTLESS PLAY';
  hsb.classList.toggle('active', inSess);
  syncSessionBox();

  $('odds').innerHTML = TIERS.map(t =>
    `<div class="odd"><span class="swatch" style="background:${t.color}"></span>
     <b style="color:${t.color}">${t.name}</b><span class="pct">${t.pct}</span></div>`).join('');

  // wallets may hold funds on addresses we cannot see; the wallet itself gates affordability
  const canPull = S.addr && S.pullPrice != null;
  $('pullBtn').disabled = !canPull;
  $('pullCost').textContent = S.pullPrice != null ? fmtHtr(S.pullPrice) : '…';
  $('pullNote').innerHTML = !S.addr ? 'Swear a wallet to your cause to play.' :
    S.htr < (S.pullPrice ?? 0) ? `Not enough HTR: <a href="https://faucet.testnet.hathor.network" target="_blank">claim free coin</a> → <span class="mono">${S.addr}</span>` :
    'Speak, and the Weaver answers within moments.';

  const me = v => S.addr ? v : '—';
  const deeds = computeDeeds();
  const deedsDone = deeds.filter(d => d.done).length;
  announceNewDeeds(deeds);
  $('statsRow').innerHTML = [
    ['Souls summoned · realm', S.totalPulls],
    ['Your gems in ledger', me(fmtGems(S.gemsLedger))],
    ['Your gems in hand', me(fmtGems(S.gemsWallet))],
    ['Your trials won', me(S.wins)],
    ['Your renown', me(S.renown + (S.vigil > 1 ? ` · vigil ${S.vigil}d` : ''))],
    ['Your standing', me(standingLabel(deedsDone))],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  // the Weaver's favor: claimable winnings under the summon button
  const fn = $('favorNote');
  if (fn) {
    fn.hidden = !(S.addr && S.favorOwed > 0);
    if (!fn.hidden) fn.innerHTML =
      `The Weaver owes you <b>${fmtHtr(S.favorOwed)}</b> <button class="mini-btn" id="favorClaimBtn">CLAIM</button>`;
    const fb = $('favorClaimBtn');
    if (fb) fb.onclick = () => doTx("Claiming the Weaver's favor", 'claim_favor', [], [wdAct(HTR, S.favorOwed)]);
  }
  $('statsRow').querySelectorAll('.stat').forEach(s =>
    animateStatEl(s.querySelector('.v'), s.querySelector('.k').textContent));

  // deeds of renown (Codex)
  const lvl = levelFor(deedsDone);
  const toNext = lvl >= TITLES.length ? 0 : LEVEL_AT[lvl] - deedsDone;
  $('deedsSummary').innerHTML = !S.addr
    ? 'Swear a wallet to your cause and your chronicle begins.'
    : `You stand at <b>${standingLabel(deedsDone)}</b> with ${deedsDone} of ${DEEDS.length} deeds witnessed.` +
      (toNext > 0 ? ` ${toNext} more deed${toNext > 1 ? 's' : ''} and you rise to <b>Level ${lvl + 1} · ${TITLES[lvl]}</b>.`
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

  // collection
  const mine = [...S.cards.values()].filter(c => c.mine);
  $('collectionCards').innerHTML = mine.map(c => cardBox(c, `
    <div class="row-btns">
      <button class="mini-btn alt" data-stake="${c.uid}">MINE</button>
      <button class="mini-btn alt" data-duel="${c.uid}">FIGHT</button>
      ${MKT ? `<button class="mini-btn alt" data-sell="${c.uid}">SELL</button>
      <button class="mini-btn alt" data-trade="${c.uid}">TRADE</button>` : ''}
    </div>`, true)).join('');
  $('collectionEmpty').hidden = mine.length > 0;

  const pend = [...S.cards.values()].filter(c => S.addr && c.tier >= 0 && c.pending === S.addr);
  $('pendingCards').innerHTML = pend.map(c =>
    cardBox(c, `<button class="claim-mini" data-claim="${c.uid}">CLAIM</button>`)).join('');
  $('pendingEmpty').hidden = pend.length > 0;

  const selCount = S.selected.size;
  $('fuseBar').hidden = mine.length < 2;
  const fuseReady = selCount === 2 && sameTierSelected();
  const selTier = fuseReady ? S.cards.get([...S.selected][0]).tier : 0;
  const fuseFee = fuseFeeFor(selTier);
  const canPayFuse = S.gemsLedger + S.gemsWallet >= fuseFee;
  $('fuseHint').textContent = !fuseReady ? 'Select two champions of the same station.'
    : (S.gemsLedger >= fuseFee ? `Forge into the next station for ${fmtGems(fuseFee)}:`
       : canPayFuse ? `Forge for ${fmtGems(fuseFee)} (gems move to your ledger first):`
       : `Fusion costs ${fmtGems(fuseFee)}; you have ${fmtGems(S.gemsLedger + S.gemsWallet)}. Earn more in the Mines.`);
  $('fuseBtn').disabled = !(fuseReady && canPayFuse);

  // farm
  const staked = [...S.cards.values()].filter(c => S.addr && c.tier >= 0 && c.staker === S.addr);
  $('farmSummary').innerHTML = `
    <div class="stat"><div class="k">Ledger balance</div><div class="v">${fmtGems(S.gemsLedger)}</div>
      <div class="row-btns">
        <button class="mini-btn" id="wdGemsBtn" ${S.gemsLedger < 1 ? 'disabled' : ''}>WITHDRAW ALL</button>
        <button class="mini-btn alt" id="depGemsBtn" ${S.gemsWallet < 1 ? 'disabled' : ''}>DEPOSIT WALLET GEMS</button>
      </div></div>
    <div class="stat"><div class="k">Farm rates /min</div><div class="v"><small>C 0.01 · R 0.03 · E 0.10 · L 0.40</small></div></div>`;
  $('stakedCards').innerHTML = staked.map(c => cardBox(c, `
    <div class="pending-gems">⛏️ ${fmtGems(c.pendingGems)} pending</div>
    <div class="row-btns">
      <button class="mini-btn" data-claimgems="${c.uid}" ${c.pendingGems < 1 ? 'disabled' : ''}>CLAIM</button>
      <button class="mini-btn alt" data-unstake="${c.uid}">UNSTAKE</button>
      ${c.temperCost > 0 ? `<button class="mini-btn alt" data-temper="${c.uid}">TEMPER</button>` : ''}
    </div>`)).join('');
  $('stakedEmpty').hidden = staked.length > 0;

  // arena: spectators see only open challenges; settled history needs a sworn wallet
  $('newDuelBtn').disabled = !S.addr;
  $('newDuelBtn').title = S.addr ? '' : 'Swear a wallet to your cause to issue a challenge';
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
        <div class="duel-meta">#${d.id} · wager ${fmtGems(d.wager)} · by ${mineD ? 'you' : short(d.challenger || '?')}</div>
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
        <div class="duel-meta">#${l.id} \u00b7 ${fmtHtr(l.price)} \u00b7 by ${isMine(l.seller) ? 'you' : short(l.seller || '?')}</div></div>
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
        <div class="duel-meta">#${w.id} \u00b7 wants ${S.cards.get(w.want)?.name ?? w.want.slice(0, 10)} \u00b7 by ${isMine(w.maker) ? 'you' : short(w.maker || '?')}</div></div>
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
      cardBox(c, `<button class="claim-mini" data-mclaim="${c.uid}">CLAIM</button>`)).join('');
  }

  bindListActions();
}

function sameTierSelected() {
  const sel = [...S.selected].map(u => S.cards.get(u));
  return sel.length === 2 && sel[0].tier === sel[1].tier && sel[0].tier < 3;
}

function bindListActions() {
  document.querySelectorAll('[data-select]').forEach(el => el.onclick = e => {
    if (e.target.closest('button')) return;
    const u = el.dataset.select;
    if (S.selected.has(u)) S.selected.delete(u);
    else { if (S.selected.size >= 2) S.selected.clear(); S.selected.add(u); }
    render();
  });
  const bind = (sel, fn) => document.querySelectorAll(sel).forEach(el =>
    el.onclick = () => fn(el.dataset[Object.keys(el.dataset)[0]]));
  bind('[data-claim]', async u => {
    const tier = S.cards.get(u)?.tier ?? 0;
    const h = await doTx('Claiming champion', 'claim_card', [], [wdAct(u, CARD_AMT)]);
    if (h) crashLand(u, tier);
  });
  bind('[data-stake]', u => doTx('Sending to the mines', 'stake', [], [depAct(u, CARD_AMT)]));
  bind('[data-unstake]', u => doTx('Recalling from the mines', 'unstake', [], [wdAct(u, CARD_AMT)]));
  bind('[data-claimgems]', u => doTx('Gathering gems', 'claim_gems', [u], []));
  bind('[data-temper]', u => openTemper(u));
  bind('[data-duel]', u => openPick('create', u));
  bind('[data-acceptduel]', id => openPick('accept', Number(id)));
  bind('[data-cancelduel]', id => doTx('Withdrawing challenge', 'cancel_duel', [Number(id)], []));
  bind('[data-sell]', u => {
    const raw = prompt('Ask price in HTR cents (5 = 0.05 HTR, max 100000):', '5');
    if (raw === null) return;
    const p = Math.floor(Number(raw));
    if (!Number.isInteger(p) || p < 1 || p > 100000) { alert('Price must be a whole number of HTR cents between 1 and 100000.'); return; }
    doTx('Crying your wares', 'list_card', [p], [depAct(u, CARD_AMT)], { target: MKT });
  });
  bind('[data-trade]', u => openPick('want', u));
  bind('[data-cancellisting]', id => doTx('Leaving the stall', 'cancel_listing', [Number(id)], [], { target: MKT }));
  bind('[data-cancelswap]', id => doTx('Recanting the trade', 'cancel_swap', [Number(id)], [], { target: MKT }));
  bind('[data-mclaim]', async u => {
    const tier = S.cards.get(u)?.tier ?? 0;
    const h = await doTx('Claiming champion', 'claim_card', [], [wdAct(u, CARD_AMT)], { target: MKT });
    if (h) crashLand(u, tier);
  });
  document.querySelectorAll('[data-buy]').forEach(el => el.onclick = () =>
    doTx('Buying champion', 'buy', [Number(el.dataset.buy)], [depAct(HTR, Number(el.dataset.price))], { target: MKT }));
  document.querySelectorAll('[data-acceptswap]').forEach(el => el.onclick = () =>
    doTx('Sealing the trade', 'accept_swap', [Number(el.dataset.acceptswap)], [depAct(el.dataset.want, CARD_AMT)], { target: MKT }));
}

const depAct = (token, amount) => ({ type: 'deposit', token, amount });
const wdAct = (token, amount) => ({ type: 'withdrawal', token, amount, address: S.addr });

/* ---------------- tx pipeline ---------------- */

async function ensureLedgerGems(amount) {
  if (S.gemsLedger >= amount) return true;
  const shortfall = amount - S.gemsLedger;
  if (S.gemsWallet < shortfall) return false;
  const hash = await doTx('Entrusting gems to the ledger', 'deposit_gems', [], [depAct(GEMS, shortfall)]);
  return !!hash && S.gemsLedger >= amount;
}

async function waitForExecution(hash, onTick) {
  const start = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 2500));
    onTick?.(Math.round((Date.now() - start) / 1000));
    const tx = await node(`/transaction?id=${hash}`);
    const meta = tx.meta || {};
    if ((meta.voided_by || []).length) throw new Error('the deed was undone by fate; try again');
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
      throw new Error(reason || 'the realm refused this deed');
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
    <span class="t-sub">sealing the deed\u2026</span></div><span class="t-time mono"></span>`;
  $('txToasts').appendChild(el);
  const sub = el.querySelector('.t-sub');
  const tim = el.querySelector('.t-time');
  try {
    const { hash } = await S.wallet.executeNano(method, args, actions, target);
    sub.textContent = 'the realm bears witness\u2026';
    await waitForExecution(hash, sec => { tim.textContent = sec + 's'; });
    el.classList.add('ok');
    sub.textContent = 'done';
    track(method, { ok: true, target: target || 'game', wallet: walletKind() });
    setTimeout(() => el.remove(), 6000);
    await refresh();
    return hash;
  } catch (e) {
    el.classList.add('fail');
    let msg = e.message || String(e);
    if (/invalid blueprint|blueprint not found|nano contract does not exist/i.test(msg)) {
      msg = 'Your wallet is on a different Hathor network. Switch it to testnet and try again.';
    } else if (/not enough utxos|insufficient (funds|amount)|no utxos/i.test(msg)) {
      msg = 'Your purse cannot cover this deed right now. If you just made another move, '
        + 'wait a few heartbeats for your coin to settle and try again; if the purse is '
        + 'truly empty, the faucet linked in the Codex pays free coin.';
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
  spawnEmbers($('machine'), 6);
  const emberInt = REDUCED ? null : setInterval(() => spawnEmbers($('machine'), 6), 1500);
  const hash = await doTx('Summoning', 'pull', [], [depAct(HTR, S.pullPrice)]);
  $('machine').classList.remove('shaking');
  if (emberInt) clearInterval(emberInt);
  if (!hash) return;
  if (S.favorOwed > favorBefore)
    ribbon(`The Weaver smiles: <b>${fmtHtr(S.favorOwed - favorBefore)}</b> returned to you`, 'level');
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
    $('errMsg').textContent = `Tempering costs ${fmtGems(c.temperCost)}. Earn more in the Mines.`;
    showStage('stageError');
    return;
  }
  const hash = await doTx('Tempering', 'temper', [uid, aspect], []);
  if (!hash || !beforeAsp) return;
  const after = S.cards.get(uid)?.aspects;
  if (after) {
    const gain = after[aspect] - beforeAsp[aspect];
    if (gain > 0) ribbon(`Tempered: <b>+${gain} ${['Valor', 'Bulwark', 'Guile'][aspect]}</b> for ${c.name}`);
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
    const el = document.querySelector(`#collectionCards [data-select="${uid}"]`);
    if (!el) { if (++tries < 10) setTimeout(seek, 200); return; }
    if (REDUCED) { el.scrollIntoView({ block: 'center' }); return; }
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const dur = [500, 600, 750, 900][tier];
    el.style.animationDuration = dur + 'ms';
    el.classList.add('crash-landing');
    setTimeout(() => {  // impact moment (~55% of the drop)
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
  $('revealClaimBtn').onclick = async () => {
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
    $('errMsg').textContent = `Fusion costs ${fmtGems(fee)}. Earn more in the Mines.`;
    showStage('stageError');
    return;
  }
  const before = new Set([...S.cards.values()].filter(c => c.pending === S.addr).map(c => c.uid));
  const hash = await doTx('Forging the Rite of Union', 'fuse', [], [depAct(a, CARD_AMT), depAct(b, CARD_AMT)]);
  if (!hash) return;
  const won = [...S.cards.values()].find(c => c.pending === S.addr && !before.has(c.uid));
  if (won) revealCard(won, `FUSED \u00b7 ${TIERS[won.tier].name}`);
}

let pickCtx = null;
function openPick(kind, ref) {
  pickCtx = { kind, ref };
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
  if (kind === 'want') {
    await doTx('Proposing trade', 'offer_swap', [uid], [depAct(ref, CARD_AMT)], { target: MKT });
    return;
  }
  if (kind === 'create') {
    const wager = Math.max(0, Number($('pickWager').value) || 0);
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
    $('duelResult').innerHTML = won
      ? '<div class="duel-banner win">⚔️ VICTORY</div><div class="wait-sub">The pot is yours. Your champion returns; claim them under Your Host.</div>'
      : '<div class="duel-banner lose">💀 DEFEAT</div><div class="wait-sub">The pot is lost, but your champion lives; claim them under Your Host.</div>';
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
      $('wcUri').value = uri;
      try {
        const QR = (await import('https://esm.sh/qrcode@1.5.4?bundle')).default;
        await QR.toCanvas($('wcQr'), uri, { width: 220, margin: 1 });
      } catch { $('wcQr').hidden = true; }
    };
    S.addr = await (kind === 'wc' ? w.connect(onUri) : w.connect());
    S.wallet = w;
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
  for (const s of ['stageWait', 'stageReveal', 'stageDuel', 'stageError', 'stageConnect', 'stagePick', 'stageTemper'])
    $(s).hidden = s !== id;
  $('overlay').hidden = false;
}

$('pullBtn').onclick = pull;
$('fuseBtn').onclick = fuse;
$('newDuelBtn').onclick = () => openPick('create', null);
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
  if (!S.sessionStarting) {
    $('sessionInfo').textContent = inSession
      ? 'Session active: every deed signs instantly. Sweep returns all champions and coin to ' + short(S.wallet.mainAddr) + '.'
      : 'Fund a session key held in this browser and play without approving every deed. Sweep everything back to your wallet whenever you like.';
  }
}

async function startSession() {
  if (!S.wallet || S.wallet.mode === 'session') return;
  const main = S.wallet;
  S.sessionStarting = true;
  try {
    $('sessionStartBtn').disabled = true;
    sessionNote('Forging a session key in this browser\u2026');
    const words = await window.WALLETS.SessionWallet.create();
    const sw = await window.WALLETS.SessionWallet.open(words, main.address);
    let waitRounds = 60; // 2 minutes on the automatic path
    // the mobile wallet's sendTransaction over WalletConnect fails post-approval
    // on custom networks, so WalletConnect goes straight to the manual transfer
    const autoFund = main.mode !== 'wc';
    try {
      if (!autoFund) throw new Error('manual funding for WalletConnect');
      sessionNote('Approve the ' + fmtHtr(ECON.sessionFund) + ' funding in your wallet\u2026');
      await main.sendHtr(sw.address, ECON.sessionFund);
      sessionNote('Waiting for the funding to arrive\u2026');
    } catch (e) {
      // wallet could not build the transfer (some wallets' sendTransaction
      // over WalletConnect is flaky) — fall back to a manual send
      waitRounds = 150; // 5 minutes for a human-driven transfer
      $('sessionInfo').innerHTML = (autoFund ? 'Automatic funding failed in your wallet. ' : '')
        + `Send <b>${fmtHtr(ECON.sessionFund)}</b> (or more) to the session address below from your `
        + 'wallet\u2019s normal send screen; the game will detect it.<br>'
        + `<span class="mono" style="word-break:break-all">${sw.address}</span> `
        + `<button class="mini-btn alt" style="margin-top:8px" onclick="navigator.clipboard.writeText('${sw.address}')">COPY ADDRESS</button>`;
      sessionNote('Waiting for the funding transfer\u2026');
    }
    for (let i = 0; i < waitRounds; i++) {
      if (await sw.htrBalance() >= ECON.sessionFund) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (await sw.htrBalance() < ECON.sessionFund) throw new Error('funding never arrived; try again');
    localStorage.setItem(SESSION_LS, JSON.stringify({ words, mainAddr: main.address }));
    S.mainWallet = main;
    S.wallet = sw;
    S.addr = sw.address;
    track('session_start', { funder: walletKindOf(main) });
    $('overlay').hidden = true;
    await refresh();
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
    await refresh();
    const blockers = [];
    const cs = [...S.cards.values()];
    const n1 = cs.filter(c => c.pending === S.addr).length;
    if (n1) blockers.push(`${n1} champion${n1 > 1 ? 's' : ''} awaiting claim under Your Host`);
    const n2 = cs.filter(c => c.staker === S.addr).length;
    if (n2) blockers.push(`${n2} champion${n2 > 1 ? 's' : ''} still toiling in The Mines (recall them)`);
    const n3 = cs.filter(c => c.marketPending === S.addr).length;
    if (n3) blockers.push(`${n3} champion${n3 > 1 ? 's' : ''} held for you in The Bazaar (claim under 'Held by the guild')`);
    if (S.gemsLedger > 0) blockers.push(`${fmtGems(S.gemsLedger)} in your ledger (withdraw in The Mines)`);
    if (S.marketFunds > 0) blockers.push(`${fmtHtr(S.marketFunds)} sale proceeds in The Bazaar (withdraw them)`);
    const n4 = S.duels.filter(d => d.status === 'open' && d.challenger === S.addr).length;
    if (n4) blockers.push(`${n4} open challenge${n4 > 1 ? 's' : ''} in The Pit (cancel or see them fought)`);
    const n5 = S.listings.filter(l => l.status === 'open' && l.seller === S.addr).length;
    if (n5) blockers.push(`${n5} open listing${n5 > 1 ? 's' : ''} in The Bazaar (cancel or sell)`);
    const n6 = S.swaps.filter(w => w.status === 'open' && w.maker === S.addr).length;
    if (n6) blockers.push(`${n6} open trade${n6 > 1 ? 's' : ''} in The Bazaar (cancel them)`);
    if (blockers.length) {
      sessionNote('Before the sweep can carry everything home, settle: '
        + blockers.join(' · ') + '.');
      return;
    }
    sessionNote('Sweeping your champions and coin home\u2026');
    const r = await S.wallet.sweep();
    track('session_end', { swept: r ? r.moved : 0 });
    sessionNote(r ? `Swept ${r.moved} holdings back to your wallet.` : 'Nothing to sweep.');
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
    if (main) { S.wallet = main; S.addr = main.address; }
    else { S.wallet = null; S.addr = null; }
    await refresh();
  } catch (e) {
    sessionNote(e.message || String(e));
  } finally {
    $('sessionEndBtn').disabled = false;
  }
}

async function resumeSession() {
  const raw = localStorage.getItem(SESSION_LS);
  if (!raw) return;
  try {
    const { words, mainAddr } = JSON.parse(raw);
    const sw = await window.WALLETS.SessionWallet.open(words, mainAddr);
    S.wallet = sw;
    S.addr = sw.address;
    await refresh();
  } catch (e) {
    console.warn('session resume failed:', e);
  }
}

async function disconnectWallet() {
  await S.wallet?.disconnect?.().catch(() => {});
  S.wallet = null; S.addr = null; S.htr = 0; S.gemsWallet = 0;
  S.gemsLedger = 0; S.wins = 0; S.selected.clear();
  for (const c of S.cards.values()) c.mine = false;
  localStorage.removeItem('gacha_wallet');
  $('overlay').hidden = true;
  render();
}

$('walletBtn').onclick = () => {
  $('connectMsg').textContent = S.addr ? `Sworn: ${S.wallet.label} · ${short(S.addr)}` : '';
  syncSessionBox();
  showStage('stageConnect');
};
$('disconnectBtn').onclick = disconnectWallet;
$('sessionStartBtn').onclick = startSession;
$('headerSessionBtn').onclick = () => {
  $('walletBtn').onclick();
  if (S.wallet?.mode !== 'session') startSession();
};
$('sessionTopupBtn').onclick = topUpSession;
$('sessionEndBtn').onclick = endSession;
document.querySelectorAll('.connect-opt').forEach(el => el.onclick = () => connectWallet(el.dataset.wallet));
for (const id of ['revealCloseBtn', 'errCloseBtn', 'duelCloseBtn', 'connectCloseBtn', 'pickCloseBtn', 'temperCancel'])
  $(id).onclick = () => { $('overlay').hidden = true; };
$('revealCloseBtn').onclick = () => { $('overlay').hidden = true; revealDismissed(); };
document.querySelectorAll('[data-aspectpick]').forEach(el =>
  el.onclick = () => doTemper(Number(el.dataset.aspectpick)));
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
document.addEventListener('click', e => {
  if (e.target.id === 'wdGemsBtn') doTx('Drawing gems from the ledger', 'withdraw_gems', [], [wdAct(GEMS, S.gemsLedger)]);
  if (e.target.id === 'depGemsBtn') doTx('Entrusting gems to the ledger', 'deposit_gems', [], [depAct(GEMS, S.gemsWallet)]);
  if (e.target.id === 'wdFundsBtn') doTx('Collecting your coin', 'withdraw_funds', [], [wdAct(HTR, S.marketFunds)], { target: MKT });
});

(async () => {
  await loadContract().catch(e => { $('pullNote').textContent = 'Failed to load: ' + e.message; });
  render();
  await resumeSession();
})();
setInterval(() => refresh().catch(() => {}), 45000);
