/* GachaArena frontend. Reads chain state via /node proxy; writes via the
   selected wallet adapter (demo proxy, MetaMask Snap, or WalletConnect). */

const NC = window.GAME.nc;
const MKT = window.GAME.market; // {nc, blueprint} or null
const HTR = '00';
const CARD_AMT = window.GAME.cardUnit ?? 1; // base units per card (1 on v4 realms; 100 legacy)
const ECON = window.GAME.economy || { sessionFund: 100, fusionFees: [5, 5, 5, 5] };
const fuseFeeFor = tier => ECON.fusionFees[tier] ?? 5;

const TIERS = [
  { name: 'Footman', color: 'var(--common)', pct: '60%' },
  { name: 'Knight', color: 'var(--rare)', pct: '30%' },
  { name: 'Highlord', color: 'var(--epic)', pct: '9%' },
  { name: 'Sovereign', color: 'var(--legendary)', pct: '1%' },
];
const EXPLORER = 'https://explorer.testnet.hathor.network';
const fmtHtr = c => (c / 100).toFixed(2) + ' HTR';
const fmtEmber = n => n + ' Ember';
const short = u => u.slice(0, 10) + '…';
// banner name if the address claimed one, else the shortened address
const who = a => (a && S.names[a]) || short(a || '?');
// on-chain text the contract only length-checks (champion and guild names)
// is escaped before it reaches innerHTML
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_ ]{1,14}[A-Za-z0-9_]$/;
// v4 delegation: contract state (renown, Ember, wins, cards' staker/pending)
// is keyed by the MAIN identity; a session acts as the wallet that offered it.
// A LEGACY session (pre-v4, no on-chain binding) acts as its own address only:
// its saved mainAddr means nothing to the contract, and trusting it offers
// buttons on state the current key cannot touch (voided txs).
const myAddrs = () => new Set(
  [S.addr, S.wallet?.unbound ? null : S.wallet?.mainAddr].filter(Boolean));
const isMine = a => !!a && myAddrs().has(a);
const identity = () => (S.wallet?.unbound ? S.addr : S.wallet?.mainAddr) || S.addr;
const $ = id => document.getElementById(id);

const S = {
  wallet: null, addr: null, htr: 0,
  pullPrice: null, totalPulls: 0,
  cards: new Map(),      // uid -> {name,tier,power,aspects,wins,pending,staker,mine,pendingEmber}
  ember: 0, wins: 0,
  renown: 0, vigil: 0, favorOwed: 0, favorPool: 0,
  duels: [], selected: new Set(), busy: false, mainWallet: null,
  listings: [], swaps: [], marketFunds: 0, raffle: null,
  names: {},             // address -> banner name (on-chain claims, server-indexed)
};

/* ---------------- chain reads ---------------- */

async function node(path) {
  // a hung request must not wedge the single-flight guard in refresh()
  return (await fetch('/node' + path, { signal: AbortSignal.timeout(20_000) })).json();
}
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

function mergeCards(payload) {
  for (const [u, d] of Object.entries(payload.cards || {})) {
    const c = S.cards.get(u) || { uid: u, mine: false, pendingEmber: 0 };
    c.name = d.name; c.tier = d.tier; c.power = d.power;
    // [attack, defense, cunning, tempers, hardened, xp, level, vet]
    c.aspects = d.aspects ? d.aspects.split('|').map(Number) : null;
    c.level = c.aspects?.[6] || 0;
    c.wins = d.wins; c.cosmetics = d.cosmetics; c.ability = d.ability || 0;
    c.pending = d.pending; c.staker = d.staker;
    c.delveSince = d.delveSince; c.temperCost = d.temperCost;
    S.cards.set(u, c);
  }
}

// a freshly minted card (pull/fuse) can beat the server's feed poller: ask
// the server to diff the contract's balances until the newcomer appears
async function awaitNewCard(findIt) {
  let won = findIt();
  for (let i = 0; i < 6 && !won; i++) {
    try {
      const payload = await (await fetch('/api/cards?discover=1')).json();
      mergeCards(payload);
    } catch { /* transient; the next lap retries */ }
    won = findIt();
    if (!won) await new Promise(r => setTimeout(r, 2500));
  }
  if (won) {
    render();
    maybeAutoClaim();  // sessions: start the walk home with the reveal, not
                       // on the next background refresh
  }
  return won;
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

  mergeCards(await cardsP);

  if (writsP) {
    const wq = await writsP;
    S.writs = [...Array(writCount).keys()].map(i => {
      const [name, v, b, g] = (wq[`get_writ(${i})`] || '|||').split('|');
      return { id: i, name, valor: +v, bulwark: +b, guile: +g };
    });
  }

  // per-player, time-sensitive card views: only the caller's staked cards
  const stakedMine = [...S.cards.values()]
    .filter(c => c.tier >= 0 && isMine(c.staker)).map(c => c.uid);
  if (stakedMine.length) {
    const pg = await batchCalls(stakedMine.flatMap(u =>
      [`get_pending_ember("${u}", ${now})`, `get_writ_attempts("${u}", ${now})`]));
    for (const u of stakedMine) {
      const c = S.cards.get(u);
      c.pendingEmber = pg[`get_pending_ember("${u}", ${now})`] || 0;
      c.writFights = pg[`get_writ_attempts("${u}", ${now})`] || 0;
    }
  }

  if (S.addr) {
    // binding is chain truth, re-read every refresh: a session whose bind tx
    // never landed (a node hiccup mid-setup is enough) would otherwise read
    // as its main while the contract credits the session key, and the player
    // plays a whole evening as a nameless fragment
    if (S.wallet?.mode === 'session') {
      try {
        const dc = `get_delegate("${S.addr}")`;
        const bound = (await batchCalls([dc]))[dc];
        S.wallet.unbound = !bound;
        if (bound) S.wallet.mainAddr = bound;
      } catch { /* transient read: keep what we knew */ }
    }
    // v4 delegation: one identity, one read — a session's renown, Ember,
    // wins and streak all live on the main address the contract resolves to
    const me = identity();
    const my = await batchCalls([`get_ember_balance("${me}")`, `get_wins("${me}")`,
      `get_renown("${me}")`, `get_vigil_streak("${me}")`, `get_favor_owed("${me}")`,
      'get_favor_pool()', `get_shards("${me}")`, `get_gauntlet_cleared("${me}")`,
      `get_trial_done("${me}", ${now})`, `get_rating("${me}")`,
      'get_ranked_waiting(0)', 'get_ranked_waiting(1)', 'get_ranked_waiting(2)',
      `is_ranked_queued(0, "${me}")`, `is_ranked_queued(1, "${me}")`,
      `is_ranked_queued(2, "${me}")`]);
    const prevRanked = S.ranked;
    S.ranked = {
      rating: my[`get_rating("${me}")`] || 1000,
      waiting: [0, 1, 2].map(t => my[`get_ranked_waiting(${t})`] || 0),
      queued: [0, 1, 2].map(t => my[`is_ranked_queued(${t}, "${me}")`] === true),
    };
    // a queued rated fight settles through the OTHER player's join tx, so
    // this client only sees it in state: the slot vanished without a leave
    // and the rating moved. Voluntary leaves move nothing (transfers are
    // never zero), so a zero delta stays silent.
    if (prevRanked && !S.silentSync) {
      const d = S.ranked.rating - prevRanked.rating;
      if (d && [0, 1, 2].some(t => prevRanked.queued[t] && !S.ranked.queued[t])) {
        ribbon(d > 0
          ? `Ranked: victory! <b>+${d} rating</b> · now ${S.ranked.rating}`
          : `Ranked: defeat · <b>${d} rating</b> · now ${S.ranked.rating}`,
          d > 0 ? 'level' : '', d > 0 ? 'win' : 'lose');
      }
    }
    S.shards = my[`get_shards("${me}")`] || 0;
    S.cleared = my[`get_gauntlet_cleared("${me}")`] || 0;
    S.trialDoneChain = my[`get_trial_done("${me}", ${now})`] === true;
    S.ember = my[`get_ember_balance("${me}")`] || 0;
    const winsNow = my[`get_wins("${me}")`] || 0;
    // covers wins as challenger too (someone answered while we were away)
    if (S.prevWins !== undefined && winsNow > S.prevWins) window.trialEvent?.('duel_win');
    S.prevWins = winsNow;
    S.wins = winsNow;
    S.renown = my[`get_renown("${me}")`] || 0;
    S.vigil = my[`get_vigil_streak("${me}")`] || 0;
    S.favorOwed = my[`get_favor_owed("${me}")`] || 0;
    S.favorPool = my['get_favor_pool()'] || 0;
  }

  if (duelCount > 0) {
    // reads must not grow with realm history: fetch the newest window plus
    // any older duel we already know to be live (open/awaiting reveal).
    // An ancient live duel unseen by this client stays invisible until it
    // re-enters via the feed or a fresh window; acceptable, and open duels
    // rarely outlive the window anyway.
    const FETCH_N = 30;
    const start = Math.max(0, duelCount - FETCH_N);
    const carry = (S.duels || [])
      .filter(d => d.id < start && (d.status === 'open' || d.status === 'reveal'))
      .map(d => d.id);
    const ids = [...carry, ...Array.from({ length: duelCount - start }, (_, i) => start + i)];
    const dd = await batchCalls(ids.flatMap(i => [`get_duel(${i})`, `get_duel_challenger(${i})`]));
    S.duels = ids.map(i => {
      const [status, card, wager] = (dd[`get_duel(${i})`] || '||').split('|');
      return { id: i, status, card, wager: Number(wager || 0), challenger: dd[`get_duel_challenger(${i})`] };
    });
    // stance/bet detail only for duels still in motion (bounded set)
    const live = S.duels.filter(d => d.status === 'open' || d.status === 'reveal');
    if (live.length) {
      const xq = await batchCalls(['get_reveal_window()', ...live.flatMap(d => [
        `get_duel_has_stances(${d.id})`, `get_duel_acceptor(${d.id})`,
        `get_duel_acceptor_card(${d.id})`, `get_duel_accept_ts(${d.id})`,
        `get_duel_kind(${d.id})`, `get_squad_cards(${d.id}, 0)`,
        `get_bet_pool(${d.id}, 0)`, `get_bet_pool(${d.id}, 1)`])]);
      S.revealWindow = xq['get_reveal_window()'] || 21600;
      for (const d of live) {
        d.squad = xq[`get_duel_kind(${d.id})`] === 1;
        d.squadCards = d.squad
          ? (xq[`get_squad_cards(${d.id}, 0)`] || '').split('|').filter(Boolean)
          : null;
        // a squad's sealed lane order also lives in duel_commit; it is not a stance
        d.stances = !d.squad && xq[`get_duel_has_stances(${d.id})`] === true;
        d.acceptor = xq[`get_duel_acceptor(${d.id})`] || null;
        d.acceptorCard = xq[`get_duel_acceptor_card(${d.id})`] || null;
        d.acceptTs = xq[`get_duel_accept_ts(${d.id})`] || 0;
        d.pools = [xq[`get_bet_pool(${d.id}, 0)`] || 0, xq[`get_bet_pool(${d.id}, 1)`] || 0];
      }
    }
    S.duels.reverse();
  } else S.duels = [];

  // tournaments: the newest three cover the calendar (older ones are history)
  try {
    const tc = (await batchCalls(['get_tournament_count()']))['get_tournament_count()'] || 0;
    const ids = [];
    for (let i = Math.max(0, tc - 3); i < tc; i++) ids.push(i);
    const tq = ids.length
      ? await batchCalls(ids.map(i => `get_tournament(${i})`)) : {};
    S.tournaments = [];
    for (const i of ids) {
      const p = (tq[`get_tournament(${i})`] || '').split('|');
      if (p.length < 10) continue;
      S.tournaments.push({
        id: i, name: p[0], state: +p[1], fee: +p[2], seed: +p[3],
        size: +p[4], n: +p[5], start: +p[6], round: +p[7],
        nextTs: +p[8], pool: +p[9], champion: p[10] || '',
      });
    }
    S.tournaments.reverse();
    // seats in decided or cancelled brackets are history: prune the record
    const over = new Set(S.tournaments.filter(t => t.state >= 2).map(t => t.id));
    if (over.size) {
      localStorage.setItem(TOURS_LS, JSON.stringify(
        loadMyTournaments().filter(m => !over.has(m.t))));
    }
    // standing count for the running bracket (bounded by its size)
    const running = S.tournaments.find(t => t.state === 1);
    if (running && running.n > 0) {
      const eq = await batchCalls([...Array(running.n).keys()]
        .map(i => `get_tour_entrant(${running.id}, ${i})`));
      running.standing = [...Array(running.n).keys()].filter(i =>
        ((eq[`get_tour_entrant(${running.id}, ${i})`] || '').split('|')[2]) === '1').length;
    }
  } catch { S.tournaments = []; }

  // world boss + guild hall (public state; membership needs an identity)
  try {
    const gb = await batchCalls(['get_wb_week()', 'get_guild_count()']);
    const wbWeek = gb['get_wb_week()'] || 0;
    const gCount = Math.min(gb['get_guild_count()'] || 0, 30);
    const me = S.addr ? identity() : null;
    const calls = [];
    if (wbWeek > 0) calls.push(`get_world_boss(${wbWeek})`);
    for (let i = 0; i < gCount; i++) calls.push(`get_guild(${i})`);
    if (me) {
      calls.push(`get_member_guild("${me}")`);
      if (wbWeek > 0) calls.push(`get_wb_damage(${wbWeek}, "${me}")`,
        `get_wb_claimed(${wbWeek}, "${me}")`);
    }
    const d2 = calls.length ? await batchCalls(calls) : {};
    const raw = wbWeek > 0 ? (d2[`get_world_boss(${wbWeek})`] || '') : '';
    const bp = raw.split('|');
    S.worldBoss = raw ? {
      week: wbWeek, name: bp[0], hp: +bp[1], hp0: +bp[2],
      valor: +bp[3], bulwark: +bp[4], guile: +bp[5],
      pool: +bp[6], total: +bp[7], topGuild: +bp[8],
      myDamage: me ? d2[`get_wb_damage(${wbWeek}, "${me}")`] || 0 : 0,
      claimed: me ? d2[`get_wb_claimed(${wbWeek}, "${me}")`] === true : false,
    } : null;
    S.guilds = [];
    for (let i = 0; i < gCount; i++) {
      const [n, m] = (d2[`get_guild(${i})`] || '').split('|');
      if (n) S.guilds.push({ id: i, name: n, members: Number(m) || 0 });
    }
    S.myGuild = me ? (d2[`get_member_guild("${me}")`] ?? -1) : -1;
  } catch { S.worldBoss = null; S.guilds = []; S.myGuild = -1; }
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
  // counterfeit guard: the market contract accepts any 100-unit token as a
  // "card", so a listing/swap whose card the gacha never minted is a fake.
  // Pull any unknown referenced cards (real ones resolve server-side, fakes
  // stay unknown), then drop what is still unknown so no fake is ever buyable.
  const isHex = u => typeof u === 'string' && /^[0-9a-f]{64}$/.test(u);
  const unknown = [...new Set([...S.listings.map(l => l.card), ...S.swaps.map(w => w.give)])]
    .filter(u => isHex(u) && !S.cards.has(u)).slice(0, 8);
  if (unknown.length) {
    try { mergeCards(await (await fetch('/api/cards?touch=' + unknown.join(','))).json()); }
    catch { /* on failure, err toward hiding the unknowns below */ }
  }
  S.listings = S.listings.filter(l => S.cards.has(l.card));
  S.swaps = S.swaps.filter(w => S.cards.has(w.give));
  for (const c of S.cards.values()) c.marketPending = d[`get_pending_owner("${c.uid}")`] ?? null;
}

async function loadMine() {
  if (!S.wallet) return;
  // every balance in flight at once: dozens of sequential awaits used to
  // stretch each refresh by seconds on prompt wallets
  const loose = [...S.cards.values()].filter(c =>
    c.tier >= 0 && !c.pending && !c.staker && !c.marketPending);
  for (const c of S.cards.values()) if (!loose.includes(c)) c.mine = false;
  const [htr, ...held] = await Promise.all([
    S.wallet.htrBalance().catch(() => 0),
    ...loose.map(c => S.wallet.tokenBalance(c.uid).catch(() => 0)),
  ]);
  S.htr = htr;
  loose.forEach((c, i) => { c.mine = held[i] > 0; });
  // v4 parity: champions still sitting in the MAIN wallet keep counting for
  // achievements while a session runs (the session key cannot spend them,
  // so they are not "mine" for actions — only for standing)
  const mainA = S.wallet?.mainAddr;
  if (mainA) {
    try {
      const d = await node(`/thin_wallet/address_balance?address=${mainA}`);
      const heldMain = new Set(Object.entries(d.tokens_data || {})
        .filter(([, t]) => ((t.received || 0) - (t.spent || 0)) >= CARD_AMT)
        .map(([u]) => u));
      for (const c of loose) c.heldByMain = heldMain.has(c.uid);
    } catch { /* standing enrichment only; actions never depend on it */ }
  } else for (const c of loose) c.heldByMain = false;
}

/* Some reads do not change on a 45s cadence: banner names and the weekly
   raffle draw move at most a few times a day, so they are fetched at most
   every five minutes (a tx-driven refresh passes force to skip the cache). */
const slowFetch = { names: 0, raffle: 0 };
const SLOW_MS = 300_000;

async function loadRaffle(force) {
  if (!force && S.raffle && Date.now() - slowFetch.raffle < SLOW_MS) return;
  try {
    const r = await fetch('/raffle.json');
    if (r.ok) { S.raffle = await r.json(); slowFetch.raffle = Date.now(); }
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
    case 'challenge': {
      const what = ev.squad ? '3v3 squad challenge' : 'duel';
      return ev.wager > 0
        ? `${name} posted a ${what} · ${fmtEmber(ev.wager)} wager`
        : `${name} posted a free ${ev.squad ? '3v3 squad challenge' : 'duel'}`;
    }
    case 'answer': {
      const what = ev.squad ? 'squad duel' : 'duel';
      return ev.verdict
        ? `<b>${who(ev.verdict.winner)}</b> won ${what} #${ev.id} against ${who(ev.verdict.loser)}`
        : ev.sealed
          ? `${name} answered sealed ${what} #${ev.id} · awaiting the reveal`
          : `${name} answered ${what} #${ev.id}`;
    }
    case 'reveal': {
      const what = ev.squad ? 'squad duel' : 'duel';
      return ev.verdict
        ? `<b>${who(ev.verdict.winner)}</b> won ${what} #${ev.id} against ${who(ev.verdict.loser)} at the reveal`
        : `${name} revealed ${ev.squad ? 'their lane order' : 'their stance'} in ${what} #${ev.id}`;
    }
    case 'forfeit': return ev.winner
      ? `duel #${ev.id} forfeited · <b>${who(ev.winner)}</b> takes the pot`
      : `duel #${ev.id} went unrevealed and was forfeited`;
    case 'duel_cancel': return `${name} withdrew challenge #${ev.id}`;
    case 'bet': return `${name} backed the ${ev.side === 1 ? 'defender' : 'challenger'} in duel #${ev.id}`
      + (ev.amount ? ` · ${fmtEmber(ev.amount)}` : '');
    case 'ranked': {
      const tier = ev.tier === 2 ? '100-Ember' : ev.tier === 1 ? '25-Ember' : 'free';
      if (ev.result === 'won') return `<b>${name}</b> won a ${tier} ranked match and climbed the ladder`;
      if (ev.result === 'lost') return `${name} lost a ${tier} ranked match`;
      if (ev.result === 'queued') return `${name} entered the ${tier} ranked queue`;
      return `${name} fought on the ranked ladder`;
    }
    case 'ranked_leave': return `${name} stepped out of the ranked queue`;
    case 'guild_new': return `${name} raised the banner of <b>${esc(ev.name)}</b>`;
    case 'guild_join': return ev.name
      ? `${name} now rides under <b>${esc(ev.name)}</b>`
      : `${name} joined a guild`;
    case 'guild_leave': return `${name} left their guild`;
    case 'wb_fight': {
      const target = ev.boss ? `<b>${esc(ev.boss)}</b>` : 'the world boss';
      if (ev.slain) return `${name} felled ${target} — the bounty is open!`;
      return `${name} struck ${target}${ev.damage ? ` for ${ev.damage}` : ''}`;
    }
    case 'wb_claim': return `${name} claimed their world-boss bounty`;
    case 'tour_new': return `The Crown has scheduled <b>${esc(ev.name)}</b> · ${fmtEmber(ev.fee)} entry`;
    case 'tour_enter': return ev.name
      ? `${name} took a seat in <b>${esc(ev.name)}</b>`
      : `${name} entered a tournament`;
    case 'tour_leave': return ev.name
      ? `${name} gave up their seat in <b>${esc(ev.name)}</b>`
      : `${name} left a tournament`;
    case 'tour_round': {
      const tn = ev.name ? `<b>${esc(ev.name)}</b>` : 'the tournament';
      if (ev.done) return ev.champion
        ? `<b>${who(ev.champion)}</b> won ${tn} and the lion's share of ${fmtEmber(ev.pool || 0)}`
        : `${tn} is decided: the champion takes the pool`;
      if (ev.cancelled) return `${tn} was called off · too few entrants, all refunded`;
      return `a round of ${tn} is fought · the bracket narrows`;
    }
    case 'listed': return ev.card
      ? `${name} put <b>${esc(ev.card)}</b> up for ${fmtHtr(ev.price)}`
      : `${name} listed a champion for ${fmtHtr(ev.price)}`;
    case 'bought': {
      const what = ev.card ? `<b>${esc(ev.card)}</b>` : 'a champion';
      const from = ev.seller ? ` from ${isMine(ev.seller) ? 'you' : who(ev.seller)}` : '';
      return `${name} bought ${what}${from} for ${fmtHtr(ev.price || 0)}`;
    }
    case 'swap_offer': return ev.card && ev.want
      ? `${name} offers <b>${esc(ev.card)}</b> for <b>${esc(ev.want)}</b>`
      : `${name} offered a trade`;
    case 'swap_done': return ev.card && ev.want
      ? `${name} traded <b>${esc(ev.want)}</b> for <b>${esc(ev.card)}</b>`
      : `${name} struck a trade`;
    case 'delve': return `${name} started a delve`;
    case 'delve_done': {
      const r = ev.result;
      if (!r) return `${name} returned from a delve`;
      if (r.haul === 'relic') return `${name}'s delve found an ancient relic · +${r.shards} shards`
        + (r.ember ? ` and ${fmtEmber(r.ember)}` : '');
      if (r.haul === 'shards') return `${name}'s delve found relic shards · +${r.shards}`;
      if (r.haul === 'ember') return `${name}'s delve struck a seam`
        + (r.ember ? ` · +${fmtEmber(r.ember)}` : '');
      return `${name}'s delve found only dust`;
    }
    case 'temper': return `${name} tempered a champion`;
    case 'banner': return ev.prev
      ? `<b>${ev.prev}</b> changed name to <b>${ev.name}</b>`
      : `<b>${ev.name}</b> joined the game`;
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
    if (S.addr) checkBetOutcomes(d.events || []);
  } catch { /* the feed is decorative */ }
}

async function loadNames(force) {
  if (!force && Object.keys(S.names || {}).length && Date.now() - slowFetch.names < SLOW_MS) return;
  try {
    const r = await fetch('/api/names');
    if (r.ok) { S.names = await r.json(); slowFetch.names = Date.now(); }
  } catch { /* names are cosmetic; addresses still show */ }
}

let refreshing = null;
let refreshStarted = 0;
async function refresh(touch, force) {
  // never two refreshes in flight: the poll and a tx completing together
  // used to double every read for no gain. A stuck one is abandoned after
  // 30s so a single bad request cannot freeze the app.
  if (refreshing && Date.now() - refreshStarted < 30_000) return refreshing;
  refreshStarted = Date.now();
  refreshing = (async () => {
    // independent reads run together; only loadMarket (flags cards) and
    // loadMine (needs the card set) wait for the contract
    await Promise.all([
      loadContract(touch),
      loadRaffle(force),
      loadNames(force),
      loadFeed(),
    ]);
    await Promise.all([loadMarket().catch(() => {}), loadMine()]);
    render();
    maybeAutoClaim();
  })();
  try { await refreshing; } finally { refreshing = null; }
}

// a refresh that syncs achievement/level/muster state WITHOUT replaying its
// ribbons: used on connect, restore and session switches so a reconnect never
// re-announces deeds the player already saw. Genuine play refreshes (doTx, the
// 45s poll) stay noisy so new achievements still pop.
async function silentRefresh(touch, force) {
  S.silentSync = true;
  try { await refresh(touch, force); } finally { S.silentSync = false; }
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
    if (!c || (!isMine(c.pending) && c.marketPending !== S.addr)) autoClaimed.delete(uid);
  }
  const next = [...S.cards.values()].find(c => c.tier >= 0
    && (isMine(c.pending) || c.marketPending === S.addr) && !autoClaimed.has(c.uid));
  if (!next) return;
  autoClaimBusy = true;
  autoClaimed.add(next.uid);
  const fromMarket = next.marketPending === S.addr && !isMine(next.pending);
  const h = await doTx('Champion coming home', 'claim_card', [], [wdAct(next.uid, CARD_AMT)],
    fromMarket ? { target: MKT } : {});
  autoClaimBusy = false;
  if (h) crashLand(next.uid, next.tier);
  // a claim that failed (a node hiccup mid-sign, most often) must not stay
  // marked as attempted: unmark it so the next pass tries again
  else autoClaimed.delete(next.uid);
  if (h) maybeAutoClaim();
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
  { id: 'gem-hoard', name: 'Ember-Hoarder', desc: 'Hold 200 Ember or more', test: s => s.ember >= 200 },
  { id: 'high-court', name: 'Court of Highlords', desc: 'Have a Highlord in your collection', test: s => s.owned.some(c => c.tier >= 2) },
  { id: 'muster-four', name: 'Muster of Four', desc: 'Hold all four rarities at once', test: s => new Set(s.owned.map(c => c.tier)).size >= 4 },
  { id: 'host', name: 'Raise a Host', desc: 'Have twelve champions at once', test: s => s.owned.length >= 12 },
  { id: 'pit-fighter', name: 'Arena Fighter', desc: 'Win five duels', test: s => s.wins >= 5 },
  { id: 'gathering-storm', name: 'The Gathering Storm', desc: 'Command 300 combined power', test: s => s.power >= 300 },
  { id: 'mine-master', name: 'Master of the Mines', desc: 'Have five champions mining at once', test: s => s.staked >= 5 },
  { id: 'gem-baron', name: 'Ember-Baron', desc: 'Hold 1000 Ember or more', test: s => s.ember >= 1000 },
  { id: 'sovereign', name: "Sovereign's Own", desc: 'Have a Sovereign in your collection', test: s => s.owned.some(c => c.tier >= 3) },
  { id: 'army', name: 'Raise an Army', desc: 'Have twenty-five champions at once', test: s => s.owned.length >= 25 },
  { id: 'pit-champion', name: 'Arena Champion', desc: 'Win fifteen duels', test: s => s.wins >= 15 },
  { id: 'storm-banners', name: 'Storm of Banners', desc: 'Command 750 combined power', test: s => s.power >= 750 },
  { id: 'legion', name: 'The Legion of Emberfall', desc: 'Have forty champions at once', test: s => s.owned.length >= 40 },
];

function deedState() {
  // the standing follows the player, not the key: under v4 delegation the
  // contract keys everything by the main identity, so session and main
  // wallets always see the same standing
  const fam = myAddrs();
  const owned = [...S.cards.values()].filter(c => c.tier >= 0 &&
    (c.mine || c.heldByMain || fam.has(c.staker) || fam.has(c.pending) || fam.has(c.marketPending)));
  return {
    owned,
    staked: owned.filter(c => fam.has(c.staker)).length,
    ember: S.ember,
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
  // record silently (no ribbon storm) on the first-ever sync AND on any
  // reconnect / session switch — only deeds earned while connected announce
  const silent = saved == null || S.silentSync;
  const seen = Array.isArray(saved) ? saved : (saved && saved.deeds) || [];
  const prevLevel = Array.isArray(saved) ? null : saved && saved.level;
  const done = deeds.filter(d => d.done).map(d => d.id);
  for (const id of done) if (!seen.includes(id)) {
    track('deed_complete', { deed: id });
    if (!silent) {
      const d = DEEDS.find(x => x.id === id);
      ribbon(`${glyph('favor')} Achievement: <b>${d ? d.name : id}</b>`, null, 'deed');
    }
  }
  const lvl = levelFor(done.length);
  if (!silent && prevLevel != null && lvl > prevLevel)
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

const COUNTED_STATS = ['Ember', 'Duels won', 'Renown'];
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
// Ember a minute per rarity, as the contract pays it
const MINE_RATES = [1, 3, 10, 40];
const WRIT_TIERS = ['Grim', 'Dire', 'Black'];
// what each tier multiplies a boss's aspects by, mirroring fight_writ in the
// contract this build talks to. Change here and in the blueprint together.
const WRIT_MULTS = [1, 3, 9];   // v5: see _writ_spread in the blueprint

function cosmeticsOf(c) {
  const cos = c.cosmetics || 0;
  return { frame: cos & 0xFF, tint: (cos >> 8) & 0xFF, epithet: (cos >> 16) & 0xFF };
}

/* drawn marks, not OS emoji: the aspect glyphs sit on every card and in
   every duel, so they must have one optical weight everywhere */
const glyph = (id, cls) =>
  `<svg class="g${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#g-${id}"/></svg>`;

function aspectsRow(c) {
  if (!c.aspects) return '';
  const [v, b, g, t, h] = c.aspects;
  const marks = (t > 0 ? ` · tempered ×${t}` : '') + (h > 0 ? ` · hardened ×${h}` : '');
  return `<div class="ac-aspects" title="attack · defense · cunning${marks}">
    <span>${glyph('attack')}${v}</span><span>${glyph('defense')}${b}</span><span>${glyph('cunning')}${g}</span></div>`;
}

/* the aspect rail: three numbers behind hairline dividers. Reading a
   matchup is the actual skill in the Arena, so they are the second thing
   the eye lands on after the rank. */
function aspectRail(c) {
  if (!c.aspects) return '';
  const [v, b, g] = c.aspects;
  return `<div class="cf-rail">
    <span class="cf-cell" title="Attack">${glyph('attack')}<b>${v}</b></span>
    <span class="cf-cell" title="Defense">${glyph('defense')}<b>${b}</b></span>
    <span class="cf-cell" title="Cunning">${glyph('cunning')}<b>${g}</b></span>
  </div>`;
}

/* provenance is what the Market is really selling, so it lives on the
   card face permanently rather than in a tooltip */
function pedigree(c) {
  const [, , , tp = 0, hd = 0] = c.aspects || [];
  const bits = [`<span title="victories">${glyph('star')}${c.wins || 0}</span>`];
  if (c.level > 0) bits.push(`<span title="veterancy">Lv ${c.level}</span>`);
  if (tp > 0) bits.push(`<span title="tempered ×${tp}">${glyph('anvil')}${tp}</span>`);
  if (hd > 0) bits.push(`<span title="battle-hardened ×${hd}">${glyph('defense')}${hd}</span>`);
  return `<div class="cf-ped">${bits.join('')}</div>`;
}

/* one action people should take often, three they take rarely: MINE is a
   full-width primary, the rest fold behind an overflow */
function cardActs(primary, secondary) {
  const more = (secondary || []).filter(Boolean);
  return `<div class="cf-acts">${primary || ''}${more.length ? `
    <details class="cf-ovf"><summary title="More actions">${glyph('more')}</summary>
      <div class="cf-menu">${more.join('')}</div></details>` : ''}</div>`;
}

function stationLine(c, t, meta) {
  return `${t.name}${meta ? ' · ' + meta.type : ''}`
    + `${c.level > 0 ? ` · Lv ${c.level}` : ''}${c.wins > 0 ? ` · ${c.wins} won` : ''}`;
}

/* v5 keyword abilities, one per champion type (ids match the contract) */
const ABILITIES = [null,
  { n: 'Vanguard', d: '+20% in the Attack round' },
  { n: 'Warden', d: '+20% in the Defense round' },
  { n: 'Trickster', d: '+20% in the Cunning round' },
  { n: 'Momentum', d: 'winning round 1 grants +10% after' },
  { n: 'Closer', d: '+25% in a 1-1 decider' },
  { n: 'Underdog', d: '+15% in all rounds when weaker' },
  { n: 'Stancebreaker', d: "the foe's stance edge is void" },
  { n: 'Plunderer', d: 'a win carries off the house cut too' },
  { n: 'Scholar', d: 'earns double experience' },
];
function abilityLine(c) {
  const a = ABILITIES[c.ability || 0];
  return a ? `<div class="ac-ability" title="${a.d}">✦ ${a.n}</div>` : '';
}

function cardBox(c, buttonsHtml, selectable) {
  const t = TIERS[c.tier] || TIERS[0];
  const sel = S.selected.has(c.uid) ? ' selected' : '';
  const meta = cardMeta(c.name);
  const cos = cosmeticsOf(c);
  const cosCls = (cos.frame ? ` cframe-${cos.frame}` : '') + (cos.tint ? ` ctint-${cos.tint}` : '');
  // a champion is a CARD: framed art up top, a plate, an aspect rail, and a
  // pedigree strip. Rank rides on the frame's material, not on a label.
  const art = meta?.art
    ? artImg(c.name, 'ac-img', '(max-width: 700px) 46vw, 232px')
    : `<div class="cf-sigil">${artSvg(c.name)}</div>`;
  const typeBits = [meta?.type, cos.epithet ? EPITHETS[cos.epithet - 1] : null].filter(Boolean);
  return `<div class="card cf rank-${c.tier}${sel}${cosCls}" style="--rc:${t.color}" data-open="${c.uid}">
    <div class="cf-art">
      ${art}
      <div class="cf-vign"></div>
      <div class="cf-rank">${t.name}</div>
      <div class="cf-med" title="power">${glyph('power')}<b>${c.power ?? '?'}</b></div>
    </div>
    <div class="cf-body">
      <div class="cf-name">${c.name}</div>
      ${typeBits.length ? `<div class="cf-type">${typeBits.join(' · ')}</div>` : ''}
      ${aspectRail(c)}
      ${abilityLine(c)}
      ${meta?.flavor ? `<div class="cf-flavor">${meta.flavor}</div>` : ''}
      ${pedigree(c)}
      ${buttonsHtml || ''}
    </div>
  </div>`;
}

/* Card art: 440px covers a grid card at 2x, 880px the detail sheet's
   column. The JPEGs stay on disk for the share canvas and og:image. */
function artImg(name, cls, sizes, eager) {
  const sl = slugOf(name);
  return `<img class="${cls}" src="cards/${sl}-440.webp"`
    + ` srcset="cards/${sl}-440.webp 440w, cards/${sl}-880.webp 880w"`
    + ` sizes="${sizes}" width="440" height="440"`
    + `${eager ? '' : ' loading="lazy"'} decoding="async" alt="">`;
}

function rowArt(c) {
  if (!c) return '?';
  const meta = cardMeta(c.name);
  return meta?.art ? `<img class="row-thumb" loading="lazy" decoding="async"
      src="cards/${slugOf(c.name)}-440.webp" width="440" height="440" sizes="34px" alt="">`
    : artSvg(c.name, 'card-art duel-art');
}

/* the delve is an appointment; the appointment should announce itself:
   a badge on The Mines tab and a counter in the browser tab title */
/* Ember can be five figures and the level title can be long, so whether
   three chips fit is a question about content, not about viewport width.
   Drop chips from the right until the row fits its box. */
function fitHeaderChips() {
  const sr = $('statsRow');
  if (!sr) return;
  const chips = [...sr.children];
  chips.forEach(c => { c.hidden = false; });
  // measure real geometry, not summed widths plus a guessed gap: the row is
  // right-aligned, so the leftmost visible chip is the one that overflows,
  // and a one-pixel arithmetic error used to drop a chip that did fit
  const room = () => {
    const vis = chips.filter(c => !c.hidden);
    if (!vis.length) return true;
    return vis[0].getBoundingClientRect().left >= sr.getBoundingClientRect().left - 0.5;
  };
  for (let i = chips.length - 1; i >= 0 && !room(); i--) chips[i].hidden = true;
}
let fitTimer = null;
addEventListener('resize', () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(fitHeaderChips, 120);
});

/* the hero is a pitch for people who have not summoned. Once a champion
   has answered, it retires for good and the rail carries the brazier. */
const HERO_LS = 'emberfall_summoned';
function heroRetired() {
  if (localStorage.getItem(HERO_LS) === '1') return true;
  // no wallet sworn: the visitor is new to us, so the pitch stands. (Without
  // this guard an archived lineage address matched realm cards and retired
  // the hero for first-time visitors.)
  if (!S.addr) return false;
  const owned = [...S.cards.values()].some(c => c.mine || isMine(c.pending) || isMine(c.staker));
  if (owned) { localStorage.setItem(HERO_LS, '1'); return true; }
  return false;
}
function applyHeroFold() {
  const hero = $('heroWrap');
  if (hero) hero.hidden = heroRetired();
}

/* the brazier that shakes on a summon: the hero's showcase while it is
   still up, the rail's panel after it retires */
function brazierEl() {
  const hero = $('heroWrap');
  return (hero && !hero.hidden) ? $('machine') : $('brazier');
}

function updateCues() {
  const ready = [...S.cards.values()].filter(c =>
    S.addr && isMine(c.staker) && (c.delveSince || 0) > 0
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

const CONNECTING = 'Connecting your wallet, please wait…';

function render() {
  updateCues();
  $('walletDot').className = 'dot' + (S.addr ? '' : ' off');
  $('connectingNote').hidden = !S.restoring;
  $('staleNote').hidden = !(S.wallet?.mode === 'session' && S.wallet.unbound);
  $('walletBtn').classList.toggle('beckon', !S.addr && !S.restoring);
  // a banner name stands alone in the chip (the hint span names the wallet
  // kind already); otherwise wallet kind + shortened address
  $('walletAddr').textContent = S.addr
    ? (S.names[identity()] || `${S.wallet.label.split(' ')[0]} · ${short(S.addr)}`)
    : (S.restoring ? 'Connecting…' : 'Connect wallet');
  $('walletHtr').textContent = S.addr ? fmtHtr(S.htr) : '';
  $('walletHtr').title = S.addr ? 'Balance on your main address only; your wallet shows the full total' : '';
  $('walletHint').textContent = S.addr ? (S.wallet?.mode === 'session' ? 'session' : 'this address') : '';
  const hsb = $('headerSessionBtn');
  hsb.hidden = !S.addr;
  const inSess = S.wallet?.mode === 'session';
  // long and short labels; CSS picks per width so the chip never gets cut
  hsb.innerHTML = inSess
    ? `${glyph('flame')} <span class="hs-l">SESSION ACTIVE</span><span class="hs-s">SESSION</span>`
    : `${glyph('flame')} <span class="hs-l">QUICK PLAY</span><span class="hs-s">PLAY</span>`;
  hsb.classList.toggle('active', inSess);
  hsb.classList.toggle('beckon', !!S.qpBeckon && !inSess && !!S.addr);
  syncSessionBox();

  $('odds').innerHTML = TIERS.map(t =>
    `<div class="odd"><span class="swatch" style="background:${t.color}"></span>
     <b style="color:${t.color}">${t.name}</b><span class="pct">${t.pct}</span></div>`).join('');
  // the rail keeps the rates at a glance once the hero has retired
  $('oddsMini').innerHTML = TIERS.map(t =>
    `<span title="${t.name}"><i style="background:${t.color}"></i><b>${t.name}</b>${t.pct}</span>`).join('');
  applyHeroFold();

  // wallets may hold funds on addresses we cannot see; the wallet itself gates affordability
  const canPull = S.addr && S.pullPrice != null;
  $('pullBtn').disabled = !canPull;
  $('pullCost').textContent = S.pullPrice != null ? fmtHtr(S.pullPrice) : '…';
  $('pullNote').innerHTML = !S.addr ? 'Connect a wallet to play.' :
    S.htr < (S.pullPrice ?? 0) ? `Not enough HTR: <a href="https://faucet.testnet.hathor.network" target="_blank">claim free coin</a> → <span class="mono">${S.addr}</span>` :
    'Speak, and the Weaver answers within moments.';

  const me = v => S.addr ? v : '–';
  const deeds = computeDeeds();
  const deedsDone = deeds.filter(d => d.done).length;
  announceNewDeeds(deeds);
  const lvl0 = levelFor(deedsDone);
  $('statsRow').innerHTML = [
    ['Ember', glyph('flame'), me(S.ember), 'Ember'],
    ['Renown', glyph('star'), me(S.renown), S.vigil > 1 ? `Renown · ${S.vigil}-day vigil` : 'Renown'],
    ['Level', '<b class="lv">Lv</b>', me(lvl0), S.addr ? `Level ${lvl0} · ${titleFor(deedsDone)}` : 'Level'],
  ].map(([k, mark, v, tip]) =>
    `<div class="stat" data-stat="${k}" title="${tip}"><div class="k">${mark}</div><div class="v">${v}</div></div>`).join('');

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
    animateStatEl(s.querySelector('.v'), s.dataset.stat));
  fitHeaderChips();

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
  $('collectionCards').innerHTML = mine.map(c => cardBox(c, cardActs(
    `<button class="cf-primary" data-stake="${c.uid}">SEND TO MINES</button>`,
    [`<button class="mini-btn alt" data-duel="${c.uid}">FIGHT</button>`,
     MKT ? `<button class="mini-btn alt" data-sell="${c.uid}">SELL</button>` : '',
     MKT ? `<button class="mini-btn alt" data-trade="${c.uid}">TRADE</button>` : '',
     `<button class="mini-btn alt" data-dress="${c.uid}">STYLE</button>`]), true)).join('');
  // a fresh summon lives in the pending bucket, so the empty line has to
  // account for it: telling a new player they own nothing while their first
  // champion waits above is the worst possible moment for that message
  const pendingNow = [...S.cards.values()].filter(c => S.addr && c.tier >= 0 && isMine(c.pending));
  // champions parked in the main wallet while a session runs: visible,
  // counted for standing, but the session key cannot sign for them
  const mainHeld = [...S.cards.values()].filter(c =>
    c.tier >= 0 && !c.mine && c.heldByMain && !c.pending && !c.staker && !c.marketPending)
    .sort((a, b) => (b.power - a.power) || a.name.localeCompare(b.name));
  $('collectionEmpty').hidden = mine.length > 0 || pendingNow.length > 0 || mainHeld.length > 0;
  $('collectionEmpty').textContent = pendingNow.length
    ? 'Your first champion is waiting below. Claim them and they muster here.'
    : (S.restoring ? CONNECTING
      : 'No champions yet. Summon your first.');

  const inSession = S.wallet?.mode === 'session';
  const pend = [...S.cards.values()].filter(c => S.addr && c.tier >= 0 && isMine(c.pending));
  $('pendingCards').innerHTML = pend.map(c =>
    cardBox(c, inSession
      ? '<div class="cf-state">coming home…</div>'
      : cardActs(`<button class="cf-primary" data-claim="${c.uid}">CLAIM</button>`, []))).join('');
  $('pendingWrap').hidden = pend.length === 0;
  $('mainHeldWrap').hidden = mainHeld.length === 0;
  $('mainHeldCards').innerHTML = mainHeld.map(c =>
    cardBox(c, `<div class="cf-state">${glyph('seal')}held by your main wallet</div>`)).join('');

  const selCount = S.selected.size;
  $('fuseBar').hidden = mine.length < 2;
  const fuseReady = selCount === 2 && sameTierSelected();
  const selTier = fuseReady ? S.cards.get([...S.selected][0]).tier : 0;
  const fuseFee = fuseFeeFor(selTier);
  const canPayFuse = S.ember >= fuseFee;
  $('fuseHint').innerHTML = !fuseReady
    ? `<button class="mini-btn alt${S.fuseMode ? ' active' : ''}" id="fuseModeBtn">${
        S.fuseMode ? 'PICKING…' : 'PICK TWO'}</button>
       <span class="fuse-tip">${S.fuseMode
         ? 'Tap two champions of the same rarity.'
         : `or ${coarsePointer() ? 'long press' : 'shift-click'} two of the same rarity`}</span>`
    : (canPayFuse ? `Fuse into the next rarity for ${fmtEmber(fuseFee)}:`
       : `Fusion costs ${fmtEmber(fuseFee)}; you have ${fmtEmber(S.ember)}. Earn more by mining.`);
  const fmb = $('fuseModeBtn');
  if (fmb) fmb.onclick = () => { S.fuseMode = !S.fuseMode; S.selected.clear(); render(); };
  document.body.classList.toggle('fuse-picking', !!S.fuseMode);
  $('fuseBtn').disabled = !(fuseReady && canPayFuse);

  // farm
  const staked = [...S.cards.values()].filter(c => S.addr && c.tier >= 0 && isMine(c.staker));
  const owed = staked.reduce((a, c) => a + (c.pendingEmber || 0), 0);
  // a delving champion is away from the face, so it earns nothing meanwhile
  const delving = staked.filter(c => (c.delveSince || 0) > 0);
  const rate = staked.reduce((a, c) =>
    a + ((c.delveSince || 0) > 0 ? 0 : (MINE_RATES[c.tier] || 0)), 0);
  $('farmSummary').innerHTML = `
    <div class="stat"><div class="k">Ember at the face</div><div class="v">${fmtEmber(owed)}
      <small>${owed > 0 ? 'waiting to be claimed' : 'nothing to claim yet'}</small></div></div>
    <div class="stat" title="${TIERS.map((t, i) => `${t.name} ${MINE_RATES[i]}`).join(' · ')} Ember a minute">
      <div class="k">Earning /min</div><div class="v">${fmtEmber(rate)}
      <small>${!staked.length ? 'no champion is mining'
        : delving.length ? `${staked.length - delving.length} at the face, ${delving.length} delving`
        : `${staked.length} champion${staked.length > 1 ? 's' : ''} at the face`}</small></div></div>
    <div class="stat"><div class="k">Relic shards</div><div class="v">${S.shards || 0}
      <small>from delves, spent on adornments</small></div></div>`;
  $('stakedCards').innerHTML = staked.map(c => {
    const delving = (c.delveSince || 0) > 0;
    const doneAt = ((c.delveSince || 0) + (S.delveSeconds || 28800)) * 1000;
    const ready = delving && Date.now() >= doneAt;
    const mins = Math.max(0, Math.ceil((doneAt - Date.now()) / 60000));
    const state = delving
      ? `<div class="cf-state">${glyph('delve')}${ready ? 'the delve is done'
          : `delving · ${Math.floor(mins / 60)}h ${mins % 60}m left`}</div>`
      : `<div class="cf-state">${glyph('mines')}${fmtEmber(c.pendingEmber)} pending</div>`;
    return cardBox(c, state + (delving
      ? cardActs(ready
          ? `<button class="cf-primary" data-claimdelve="${c.uid}">CLAIM THE DELVE</button>` : '', [])
      : cardActs(
          `<button class="cf-primary" data-claimember="${c.uid}"${c.pendingEmber < 1 ? ' disabled' : ''}>CLAIM EMBER</button>`,
          [`<button class="mini-btn alt" data-delve="${c.uid}">DELVE</button>`,
           c.temperCost > 0 ? `<button class="mini-btn alt" data-temper="${c.uid}">TEMPER</button>` : '',
           `<button class="mini-btn alt" data-dress="${c.uid}">STYLE</button>`,
           `<button class="mini-btn alt" data-unstake="${c.uid}">RECALL</button>`])));
  }).join('');
  $('stakedEmpty').hidden = staked.length > 0;
  $('stakedEmpty').textContent = S.restoring ? CONNECTING
    : 'Nothing is mining. Send a champion from your collection.';

  // arena: spectators see only open challenges; settled history needs a sworn wallet
  $('newDuelBtn').disabled = !S.addr;
  $('newDuelBtn').title = S.addr ? '' : 'Connect a wallet to issue a challenge';
  assignSeals();
  assignSquadSeals();
  // live fights always show; settled ones age out (newest 5, plus your own
  // challenges from the fetched window) so the Arena is not a graveyard
  let settledSeen = 0;
  const duelsShown = S.duels.filter(d => {
    if (d.status === 'open' || d.status === 'reveal') return S.addr || d.status === 'open';
    if (!S.addr) return false;
    return ++settledSeen <= 5 || isMine(d.challenger);
  });
  // fights in motion first, the graveyard below; newest first within each
  duelsShown.sort((a, b) =>
    ((a.status === 'closed') - (b.status === 'closed')) || b.id - a.id);
  const liveDuels = duelsShown.filter(d => d.status !== 'closed');
  const pastDuels = duelsShown.filter(d => d.status === 'closed');
  const duelRow = d => {
    const c = S.cards.get(d.card);
    const t = TIERS[c?.tier ?? 0] || TIERS[0];
    const mineD = isMine(d.challenger);
    const sealed = d.stances ? ` · ${glyph('seal')} sealed stance`
      : d.squad ? ` · ${glyph('attack')} 3v3 squad` : '';
    // backing a fight and then fighting it is a conflict of interest: this
    // realm's contract refuses it too, but the button should not offer it
    const iBackedIt = !!S.addr && loadMyBets().some(b => b.id === d.id);
    let act;
    if (d.status === 'open') {
      act = mineD
        ? `<button class="mini-btn alt" data-cancelduel="${d.id}">CANCEL</button>`
        : iBackedIt
          ? `<span class="duel-done" title="You have Ember riding on this fight, so you cannot also fight it">your bet is in</span>`
          : (S.addr
            ? `<button class="mini-btn" data-${d.squad ? 'acceptsquad' : 'acceptduel'}="${d.id}">FIGHT</button>`
            : '<span class="duel-done">awaiting a challenger</span>');
    } else if (d.status === 'reveal') {
      const dueAt = ((d.acceptTs || 0) + (S.revealWindow || 21600)) * 1000;
      const minsLeft = Math.max(0, Math.ceil((dueAt - Date.now()) / 60000));
      act = mineD
        ? `<button class="mini-btn" data-${d.squad ? 'revealsquad' : 'revealduel'}="${d.id}">REVEAL</button>`
        : Date.now() >= dueAt && S.addr
          ? `<button class="mini-btn alt" data-forfeitduel="${d.id}">CLAIM FORFEIT</button>`
          : `<span class="duel-done">awaiting reveal · ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m left</span>`;
    } else act = '<span class="duel-done">settled</span>';
    // the squad SET is public; which of the three fights which lane stays
    // sealed until the challenger's reveal
    const trio = d.squad && d.squadCards?.length
      ? `<div class="duel-meta">squad: ${d.squadCards.map(u =>
          `<b>${S.cards.get(u)?.name ?? u.slice(0, 8)}</b>`).join(' · ')} — lane order sealed</div>`
      : '';
    // spectators can back either side while the duel is undecided
    const canBet = S.addr && !mineD && !isMine(d.acceptor)
      && (d.status === 'open' || d.status === 'reveal');
    const pools = d.pools && (d.pools[0] || d.pools[1] || canBet)
      ? `<div class="duel-meta">bets: ${fmtEmber(d.pools[0] || 0)} on the challenger · ${
          fmtEmber(d.pools[1] || 0)} on the defender${canBet
          ? ` <span class="bet-btns"><button class="mini-btn alt" data-bet="${d.id}:0">BACK CHALLENGER</button>
              <button class="mini-btn alt" data-bet="${d.id}:1">BACK DEFENDER</button></span>` : ''}</div>`
      : '';
    return `<div class="duel ${d.status}">
      <span class="duel-emoji">${rowArt(c)}</span>
      <div class="duel-info">
        <b>${c?.name ?? '?'}</b> <span class="pw-inline" style="color:${t.color}">${glyph('power')}${c?.power ?? '?'}</span>
        <div class="duel-meta">#${d.id} · wager ${fmtEmber(d.wager)} · by ${mineD ? 'you' : who(d.challenger)}${sealed}</div>
        ${trio}
        ${pools}
      </div>
      ${act}
    </div>`;
  };
  $('duelList').innerHTML = liveDuels.map(duelRow).join('')
    + (pastDuels.length
      ? `<details class="past-fights"${S.pastOpen ? ' open' : ''}>
           <summary>last ${pastDuels.length} settled fight${pastDuels.length > 1 ? 's' : ''}
             <span class="feed-chev">&#9662;</span></summary>
           ${pastDuels.map(duelRow).join('')}</details>`
      : '');
  const det = $('duelList').querySelector('.past-fights');
  if (det) det.ontoggle = () => { S.pastOpen = det.open; };
  $('duelEmpty').hidden = duelsShown.length > 0;
  $('duelEmpty').textContent = S.restoring ? CONNECTING : 'No open duels. Start one.';

  // the rated ladder: queue-on-join matchmaking within 200 rating
  const rk = S.ranked;
  $('rankedIntro').innerHTML = S.addr && rk
    ? `Rated 1v1: one champion, a fixed wager, no stances and no picking
       opponents. The ladder matches you against a rival within 200 rating;
       the second joiner's move settles the fight on the spot. Win to climb,
       lose to fall. Your rating: <b>${rk.rating}</b>.`
    : 'Connect a wallet to fight rated matches.';
  const RANKED_TIERS = ['Free spar', '25 Ember', '100 Ember'];
  $('rankedBox').innerHTML = (S.addr && rk) ? [0, 1, 2].map(t => `
    <div class="duel open">
      <span class="duel-emoji">${glyph('ladder', 'gl')}</span>
      <div class="duel-info"><b>${RANKED_TIERS[t]}</b>
        <div class="duel-meta">${rk.waiting[t]} waiting${rk.queued[t]
          ? ' · your champion holds the line' : ''}</div>
      </div>
      ${rk.queued[t]
        ? `<button class="mini-btn alt" data-rankedleave="${t}">LEAVE</button>`
        : `<button class="mini-btn" data-rankedjoin="${t}">JOIN</button>`}
    </div>`).join('') : '';

  // tournaments: the calendar's scheduled peak moments
  const myTours = loadMyTournaments();
  $('tourIntro').textContent = 'Scheduled brackets with Ember entry fees; the '
    + "Crown seeds the prize pool from its tithe. One round fights each day: "
    + 'semifinalists take 7.5% of the pool each, the runner-up a quarter, the '
    + 'champion the rest.';
  $('tourBox').innerHTML = (S.tournaments || []).map(t => {
    const mine = myTours.find(m => m.t === t.id);
    const mins = Math.max(0, Math.ceil((t.start * 1000 - Date.now()) / 60000));
    const dueMins = Math.max(0, Math.ceil((t.nextTs * 1000 - Date.now()) / 60000));
    let meta, act = '';
    if (t.state === 0) {
      meta = `${t.n}/${t.size} seats · ${fmtEmber(t.fee)} entry · pool ${fmtEmber(t.pool)}`
        + ` · starts in ${Math.floor(mins / 60)}h ${mins % 60}m`;
      act = !S.addr ? '<span class="duel-done">connect to enter</span>'
        : mine ? `<button class="mini-btn alt" data-tourleave="${t.id}">WITHDRAW</button>`
        : t.n < t.size ? `<button class="mini-btn" data-tourenter="${t.id}">ENTER</button>`
        : '<span class="duel-done">bracket full</span>';
    } else if (t.state === 1) {
      meta = `round ${t.round} fought · ${t.standing ?? '?'} still standing · pool ${fmtEmber(t.pool)}`;
      act = Date.now() >= t.nextTs * 1000 && S.addr
        ? `<button class="mini-btn" data-touradvance="${t.id}">FIGHT THE ROUND</button>`
        : `<span class="duel-done">next round in ${Math.floor(dueMins / 60)}h ${dueMins % 60}m</span>`;
    } else if (t.state === 2) {
      meta = `the crown is claimed · pool ${fmtEmber(t.pool)}`;
      act = '<span class="duel-done">decided</span>';
    } else {
      meta = 'called off: too few entrants, everyone refunded';
      act = '<span class="duel-done">cancelled</span>';
    }
    return `<div class="duel ${t.state <= 1 ? 'open' : 'closed'}">
      <span class="duel-emoji">${glyph('bracket', 'gl')}</span>
      <div class="duel-info"><b>${esc(t.name)}</b>
        <div class="duel-meta">#${t.id} · ${meta}${mine ? ' · you hold a seat' : ''}</div>
      </div>
      ${act}
    </div>`;
  }).join('');
  $('tourEmpty').hidden = (S.tournaments || []).length > 0;

  // the world boss: one shared colossus a week, felled together
  const wb = S.worldBoss;
  $('wbIntro').textContent = wb
    ? 'Once a week the Crown looses a colossus on the realm. Staked champions '
      + 'strike it from the Mines (writ entry fee, three strikes each per day); '
      + 'damage is rounds won times power. When it falls, a tenth of the '
      + "week's summons pays out pro-rata by damage, and the top-damage "
      + "guild's fighters take a quarter more."
    : 'No world boss stands this week. The Crown looses one weekly.';
  const hpPct = wb && wb.hp0 > 0 ? Math.round(100 * wb.hp / wb.hp0) : 0;
  $('wbBox').innerHTML = wb ? `
    <div class="duel ${wb.hp > 0 ? 'open' : ''}">
      <span class="duel-emoji">${glyph('boss', 'gl')}</span>
      <div class="duel-info"><b>${esc(wb.name)}</b>
        <div class="duel-meta">${glyph('attack')} ${wb.valor} · ${glyph('defense')} ${wb.bulwark} · ${glyph('cunning')} ${wb.guile} · bounty ${fmtEmber(wb.pool)}</div>
        <div class="duel-meta">HP ${wb.hp} / ${wb.hp0} (${hpPct}%)${wb.myDamage
          ? ` · your damage ${wb.myDamage}` : ''}</div>
      </div>
      ${wb.hp > 0
        ? (S.addr ? '<button class="mini-btn" data-wbfight="1">STRIKE</button>'
                  : '<span class="duel-done">connect to fight</span>')
        : wb.myDamage > 0 && !wb.claimed && S.addr
          ? `<button class="mini-btn" data-wbclaim="${wb.week}">CLAIM BOUNTY</button>`
          : '<span class="duel-done">felled</span>'}
    </div>` : '';

  // the guild hall
  $('guildIntro').textContent = S.addr
    ? 'Raise a banner for 500 Ember (burned) or ride under another. Guilds fight '
      + 'as one on the world boss: the top-damage banner takes +25% bounty.'
    : 'Connect a wallet to join a guild.';
  const gRows = (S.guilds || []).map(g => `
    <div class="duel open">
      <span class="duel-emoji">${glyph('banner', 'gl')}</span>
      <div class="duel-info"><b>${esc(g.name)}</b>
        <div class="duel-meta">${g.members} member${g.members === 1 ? '' : 's'}${
          S.myGuild === g.id ? ' · your banner' : ''}</div>
      </div>
      ${S.myGuild === g.id
        ? '<button class="mini-btn alt" data-guildleave="1">LEAVE</button>'
        : S.myGuild < 0 && S.addr
          ? `<button class="mini-btn" data-guildjoin="${g.id}">JOIN</button>` : ''}
    </div>`).join('');
  $('guildBox').innerHTML = (S.addr && S.myGuild < 0
    ? `<div class="duel"><span class="duel-emoji">${glyph('crown', 'gl')}</span><div class="duel-info">
        <b>Raise a banner</b>
        <div class="duel-meta">500 Ember, burned; the name is yours for as long as the realm stands</div></div>
        <button class="mini-btn" data-guildcreate="1">CREATE</button></div>` : '')
    + gRows;

  // the bosses of the Sundering, fought from the Mines
  const cleared = S.cleared || 0;
  $('gauntletIntro').innerHTML = S.addr
    ? `<ul class="rulelist">
        <li>Ten bosses, each with a public spread of aspects.</li>
        <li>Fought by <b>mining</b> champions, three fights each per day.</li>
        <li>An Ember entry fee; bounty and renown to the victor.</li>
        <li>Fell a boss at Grim to unlock its Dire, and the boss before it to reach the next.</li>
      </ul>`
    : 'Connect a wallet to fight bosses.';
  $('writList').innerHTML = (S.writs || []).map(w => {
    const writOpen = w.id === 0 || !!(cleared & (1 << ((w.id - 1) * 3)));
    const gates = [true,
      !!(cleared & (1 << (w.id * 3))),
      !!(cleared & (1 << (w.id * 3 + 1)))];
    const btns = [0, 1, 2].map(t => {
      const m = WRIT_MULTS[t];
      // the numbers this tier actually fights, so the comparison with the
      // champion you are about to send needs no arithmetic
      const spread = `<span class="writ-spread aspect-line">${glyph('attack')}${w.valor * m}
        ${glyph('defense')}${w.bulwark * m} ${glyph('cunning')}${w.guile * m}</span>`;
      const done = !!(cleared & (1 << (w.id * 3 + t)));
      const head = done
        ? `<span class="writ-done">${WRIT_TIERS[t]} ${glyph('check')}</span>`
        : writOpen && gates[t] && S.addr
          ? `<button class="mini-btn alt" data-writ="${w.id}:${t}">${WRIT_TIERS[t]}</button>`
          : `<span class="writ-locked">${WRIT_TIERS[t]} ${glyph('seal')}</span>`;
      return `<div class="writ-tier${done ? ' done' : ''}">${head}${spread}</div>`;
    }).join('');
    return `<div class="duel writ-row">
      <div class="duel-info"><b>${w.name}</b>
        <div class="duel-meta">at least 45/80/115% of the champion you send</div></div>
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
        <div class="duel-info"><b>${c?.name ?? '?'}</b> <span class="pw-inline" style="color:${t.color}">${glyph('power')}${c?.power ?? '?'}</span>`;
    };
    // the Market is not a graveyard either: live listings always show,
    // closed ones age out (newest 5, plus your own) exactly like duels
    let soldSeen = 0;
    const listingsShown = S.listings.filter(l => {
      if (l.status === 'open') return true;
      if (!S.addr) return false;          // nothing to act on for a visitor
      return ++soldSeen <= 5 || isMine(l.seller);
    });
    listingsShown.sort((a, b) =>
      ((a.status !== 'open') - (b.status !== 'open')) || b.id - a.id);
    $('listingList').innerHTML = listingsShown.map(l => `
      <div class="duel ${l.status}">${cardBit(l.card)}
        <div class="duel-meta">#${l.id} \u00b7 ${fmtHtr(l.price)} \u00b7 by ${isMine(l.seller) ? 'you' : who(l.seller)}</div></div>
        ${l.status === 'open' ? (isMine(l.seller)
          ? (l.seller === S.addr
            ? `<button class="mini-btn alt" data-cancellisting="${l.id}">CANCEL</button>`
            : '<span class="duel-done">yours · main wallet</span>')
          : `<button class="mini-btn" data-buy="${l.id}" data-price="${l.price}">BUY</button>`)
          : '<span class="duel-done">sold</span>'}
      </div>`).join('');
    $('listingEmpty').hidden = listingsShown.length > 0;
    $('listingEmpty').innerHTML = S.restoring ? CONNECTING : S.addr
      ? `Nothing for sale right now. Champions you list appear here, and the
         Crown takes a 5% tithe on a sale. <b>SELL</b> sits under any champion
         in your Collection.`
      : `Nothing for sale right now. Every champion here is listed by a player,
         never by the house.`;
    let doneSeen = 0;
    const swapsShown = S.swaps.filter(w => {
      if (w.status === 'open') return true;
      if (!S.addr) return false;
      return ++doneSeen <= 5 || isMine(w.maker);
    });
    swapsShown.sort((a, b) =>
      ((a.status !== 'open') - (b.status !== 'open')) || b.id - a.id);
    $('swapList').innerHTML = swapsShown.map(w => {
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
    $('swapEmpty').hidden = swapsShown.length > 0;
    $('swapEmpty').textContent = S.restoring ? CONNECTING
      : 'No trades proposed. Offer one with TRADE on a champion you hold.';
    const mpend = [...S.cards.values()].filter(c => S.addr && c.tier >= 0 && c.marketPending === S.addr);
    $('marketPendingWrap').hidden = mpend.length === 0;
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
  const toggleFusePick = uid => {
    const c = S.cards.get(uid);
    if (!c?.mine) return false;
    if (c.tier >= 3) {
      ribbon('Sovereigns are the top rarity; they cannot be fused');
      return true;
    }
    if (S.selected.has(uid)) S.selected.delete(uid);
    else { if (S.selected.size >= 2) S.selected.clear(); S.selected.add(uid); }
    render();
    return true;
  };
  document.querySelectorAll('[data-open]').forEach(el => {
    const uid = el.dataset.open;
    let timer = null, held = false;
    el.onpointerdown = e => {
      const c = S.cards.get(uid);
      if (e.target.closest('button, summary') || !c?.mine) return;
      held = false;
      timer = setTimeout(() => {
        held = true;
        window.haptic?.([20, 30, 20]);
        toggleFusePick(uid);
      }, 450);
    };
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.onpointerup = cancel;
    el.onpointerleave = cancel;
    el.onpointercancel = cancel;
    el.oncontextmenu = e => { if (S.cards.get(uid)?.mine) e.preventDefault(); };
    el.onclick = e => {
      if (e.target.closest('button, summary')) return;
      if (held) { held = false; return; } // the hold already did its work
      if ((e.shiftKey || S.fuseMode) && toggleFusePick(uid)) return;
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
    // hours of toil approximated from accrued Ember and the station's rate
    const hours = c ? c.pendingEmber / ((MINE_RATES[c.tier] || 1) * 60) : 0;
    const h = await doTx('Recalling champion', 'unstake', [], [wdAct(u, CARD_AMT)]);
    if (h) window.trialEvent?.('recall8', { hours });
  });
  bind('[data-claimember]', u => doTx('Claiming Ember', 'claim_ember', [u], []));
  bind('[data-temper]', u => openTemper(u));
  bind('[data-delve]', u => doTx('Starting the delve', 'begin_delve', [u])
    .then(h => { if (h) window.sfx?.('fuse', { rate: .85, volume: .5 }); }));
  bind('[data-claimdelve]', claimDelve);
  bind('[data-dress]', openDress);
  document.querySelectorAll('[data-writ]').forEach(el => el.onclick = () => {
    const [w, t] = el.dataset.writ.split(':').map(Number);
    openPick('writ', { writ: w, tier: t });
  });
  bind('[data-duel]', u => openPick('create', u));
  bind('[data-acceptduel]', id => openPick('accept', Number(id)));
  bind('[data-acceptsquad]', id => openPick('squadAccept', Number(id)));
  bind('[data-revealsquad]', id => revealSquad(Number(id)));
  bind('[data-rankedjoin]', t => openPick('ranked', Number(t)));
  bind('[data-wbfight]', () => openPick('wbfight', null));
  bind('[data-tourenter]', id => openPick('tourEnter', Number(id)));
  bind('[data-tourleave]', async id => {
    const h = await doTx('Giving up the seat', 'leave_tournament', [Number(id)], []);
    if (h) {
      localStorage.setItem(TOURS_LS, JSON.stringify(
        loadMyTournaments().filter(m => m.t !== Number(id))));
      ribbon('Seat given up: fee returned, champion in Collection to claim', '', 'coin');
    }
  });
  bind('[data-touradvance]', async id => {
    const h = await doTx('Fighting the round', 'advance_tournament', [Number(id)], []);
    if (!h) return;
    const t = (S.tournaments || []).find(x => x.id === Number(id));
    if (t?.state === 2) ribbon('The final is fought: the champion takes the pool — see the World Feed', 'level', 'win');
    else if (t?.state === 3) ribbon('The bracket was called off: too few entrants, everyone refunded', '', 'coin');
    else ribbon('The round is fought: fallen champions return to their lords', '', 'clash');
  });
  bind('[data-wbclaim]', async w => {
    const e0 = S.ember;
    const h = await doTx('Claiming the bounty', 'claim_world_bounty', [Number(w)], []);
    if (h) ribbon(`The colossus paid out: +${fmtEmber(S.ember - e0)}`, 'level', 'coin');
  });
  bind('[data-guildjoin]', id => doTx('Joining the guild', 'join_guild', [Number(id)], [])
    .then(h => { if (h) window.sfx?.('deed', { volume: .6 }); }));
  bind('[data-guildleave]', () => doTx('Leaving the guild', 'leave_guild', [], []));
  bind('[data-guildcreate]', () => {
    const name = prompt('Name your banner (3-16 chars: letters, numbers, spaces or _). Costs 500 Ember, burned:', '');
    if (name === null) return;
    const n = name.trim();
    if (!/^[A-Za-z0-9_ ]{3,16}$/.test(n)) { alert('3-16 chars: letters, numbers, spaces or _.'); return; }
    if (S.ember < 500) { alert(`Raising a banner costs 500 Ember; you hold ${fmtEmber(S.ember)}.`); return; }
    doTx('Raising the banner', 'create_guild', [n], [])
      .then(h => { if (h) window.sfx?.('deed'); });
  });
  bind('[data-rankedleave]', async t => {
    const h = await doTx('Leaving the ranked queue', 'leave_ranked', [Number(t)], []);
    if (h) ribbon('You stepped out of the queue: wager returned, champion in Collection to claim', '', 'coin');
  });
  bind('[data-cancelduel]', id => doTx('Cancelling duel', 'cancel_duel', [Number(id)], []));
  bind('[data-revealduel]', id => revealDuel(Number(id)));
  bind('[data-forfeitduel]', id => doTx('Calling the forfeit', 'claim_forfeit', [Number(id)], []));
  document.querySelectorAll('[data-bet]').forEach(el => el.onclick = () => {
    const [id, side] = el.dataset.bet.split(':').map(Number);
    placeBet(id, side);
  });
  bind('[data-sell]', u => {
    const raw = prompt('Ask price in HTR cents (5 = 0.05 HTR). Name any price you like:', '5');
    if (raw === null) return;
    const p = Math.floor(Number(raw));
    if (!Number.isInteger(p) || p < 1) { alert('Price must be a whole number of HTR cents, 1 or more.'); return; }
    doTx('Listing for sale', 'list_card', [p], [depAct(u, CARD_AMT)], { target: MKT })
      .then(h => { if (h) window.sfx?.('coin', { volume: .45 }); });
  });
  bind('[data-trade]', u => openPick('want', u));
  bind('[data-cancellisting]', id => doTx('Cancelling listing', 'cancel_listing', [Number(id)], [], { target: MKT }));
  bind('[data-cancelswap]', id => doTx('Cancelling trade', 'cancel_swap', [Number(id)], [], { target: MKT }));
  bind('[data-mclaim]', async u => {
    const tier = S.cards.get(u)?.tier ?? 0;
    const h = await doTx('Claiming champion', 'claim_card', [], [wdAct(u, CARD_AMT)], { target: MKT });
    if (h) crashLand(u, tier);
  });
  // buying spends real HTR, so it asks first: the name, the price and the
  // fact that the champion arrives in escrow
  document.querySelectorAll('[data-buy]').forEach(el => el.onclick = () => {
    const id = Number(el.dataset.buy);
    const price = Number(el.dataset.price);
    const l = S.listings.find(x => x.id === id);
    const c = l && S.cards.get(l.card);
    const who = c ? c.name : 'this champion';
    if (!confirm(`Buy ${who} for ${fmtHtr(price)}?

`
        + `The coin leaves your wallet now and ${c ? 'the champion' : 'it'} lands `
        + `in the Market's escrow for you to claim.`)) return;
    doTx('Buying champion', 'buy', [id], [depAct(HTR, price)], { target: MKT });
  });
  document.querySelectorAll('[data-acceptswap]').forEach(el => el.onclick = () => {
    const id = Number(el.dataset.acceptswap);
    const w = S.swaps.find(x => x.id === id);
    const give = S.cards.get(el.dataset.want), get = w && S.cards.get(w.give);
    if (!confirm(`Trade away ${give ? give.name : 'your champion'} for ${
        get ? get.name : 'theirs'}?

The swap is final once it settles.`)) return;
    doTx('Accepting trade', 'accept_swap', [id], [depAct(el.dataset.want, CARD_AMT)], { target: MKT });
  });
}

const depAct = (token, amount) => ({ type: 'deposit', token, amount });
const wdAct = (token, amount) => ({ type: 'withdrawal', token, amount, address: S.addr });

/* ---------------- tx pipeline ---------------- */

// confirmation wait for plain (non-nano) transactions: no execution logs exist
async function waitForConfirm(hash) {
  let wait = 800; // check early, then settle into a steady cadence
  for (;;) {
    await new Promise(r => setTimeout(r, wait));
    wait = 1500;
    const tx = await node(`/transaction?id=${hash}`);
    const meta = tx.meta || {};
    if ((meta.voided_by || []).length) throw new Error('transaction failed; nothing was spent. Try again');
    if (meta.first_block) return;
  }
}

async function waitForExecution(hash, onTick) {
  const start = Date.now();
  let wait = 800; // check early, then settle into a steady cadence
  for (;;) {
    await new Promise(r => setTimeout(r, wait));
    wait = 1500;
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
        t && t !== HTR && /^[0-9a-f]{64}$/.test(t)),
    ];
    await refresh(touched);
    return hash;
  } catch (e) {
    el.classList.add('fail');
    let msg = e.message || String(e);
    if (/invalid blueprint|blueprint not found|nano contract does not exist/i.test(msg)) {
      msg = 'Your wallet is on a different Hathor network. Switch it to testnet and try again.';
    } else if (/did not match the expected pattern|network error|load failed/i.test(msg)) {
      msg = 'Your wallet could not reach the node just then. Nothing was lost — '
        + 'it retries on its own, or press the action again in a moment.';
    } else if (/not enough utxos|insufficient (funds|amount)|no utxos/i.test(msg)) {
      msg = 'Not enough HTR. Just made a move? Wait a few seconds for your change to '
        + 'settle and try again. Empty? Get free testnet coin from the faucet linked '
        + 'under Info.';
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
  const before = new Set([...S.cards.values()].filter(c => isMine(c.pending)).map(c => c.uid));
  const favorBefore = S.favorOwed;
  const brz = brazierEl();
  brz.classList.add('shaking');
  window.sfx?.('summon');
  spawnEmbers(brz, 6);
  const emberInt = REDUCED ? null : setInterval(() => spawnEmbers(brz, 6), 1500);
  const hash = await doTx('Summoning', 'pull', [], [depAct(HTR, S.pullPrice)]);
  brz.classList.remove('shaking');
  if (emberInt) clearInterval(emberInt);
  if (!hash) return;
  if (S.favorOwed > favorBefore)
    ribbon(`Lucky pull: <b>${fmtHtr(S.favorOwed - favorBefore)}</b> refunded`, 'level', 'favor');
  // with overlapping summons, exclude cards already claimed by another reveal
  const won = await awaitNewCard(() => [...S.cards.values()].find(c =>
    isMine(c.pending) && !before.has(c.uid) && !revealSeen.has(c.uid)));
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
  $('temperInfo').innerHTML = `<b>${c.name}</b> <span class="aspect-line">${
    glyph('attack')}${v} ${glyph('defense')}${b} ${glyph('cunning')}${g}</span><br>
    Raise one aspect by 1–3 for <b>${fmtEmber(c.temperCost)}</b>.`;
  showStage('stageTemper');
}

async function doTemper(aspect) {
  const uid = temperUid;
  temperUid = null;
  $('overlay').hidden = true;
  const c = S.cards.get(uid);
  if (!c) return;
  const beforeAsp = c.aspects ? [...c.aspects] : null;
  if (S.ember < c.temperCost) {
    $('errTitle').textContent = 'Not enough Ember';
    $('errMsg').textContent = `Tempering costs ${fmtEmber(c.temperCost)}. Earn more by mining.`;
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
// touch-first devices get told about the long press, a mouse about
// shift-click. Read per render, not once at load: a tablet that gains a
// keyboard (or a phone in desktop mode) then says the right thing.
const coarsePointer = () =>
  !!(window.matchMedia && matchMedia('(hover: none), (pointer: coarse)').matches);
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
    ${artImg(won.name, 'ac-img', '(max-width: 700px) 80vw, 420px', true)}
    <div class="ac-scrim"></div>
    <div class="ac-top"><span class="ac-name">${won.name}</span><span class="ac-power pw-inline">${glyph('power')}${won.power}</span></div>
    <div class="ac-bottom">
      <div class="ac-station" style="color:${t.color}">${tierLabel} \u00b7 ${meta.type}</div>
      ${aspectsRow(won)}
      <div class="ac-flavor">${meta.flavor}</div>
    </div>` : `
    <div class="prize-emoji">${artSvg(won.name, 'card-art prize-art')}</div>
    <div class="prize-tier">${tierLabel}</div>
    <div class="prize-name">${won.name}</div>
    <div class="prize-power">${glyph('power')} POWER ${won.power}</div>
    ${aspectsRow(won)}`;
  pc.innerHTML = `
    <div class="flip-inner">
      <div class="reveal-back"><img src="logo.png" alt=""></div>
      <div class="reveal-face${meta?.art ? '' : ' plain'}">${face}</div>
    </div>`;
  const sessionMode = S.wallet?.mode === 'session';
  $('revealClaimBtn').textContent = sessionMode ? 'ONWARD' : 'CLAIM TO WALLET';
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

let fuseBusy = false;
async function fuse() {
  if (fuseBusy) return;  // a fuse is already in flight; ignore the extra tap
  const [a, b] = [...S.selected];
  if (!a || !b) return;  // selection cleared (double-tap): nothing to fuse
  S.selected.clear();
  S.fuseMode = false;    // the picking is done; the button says PICK TWO again
  const fee = fuseFeeFor(S.cards.get(a)?.tier ?? 0);
  if (S.ember < fee) {
    $('errTitle').textContent = 'Not enough Ember';
    $('errMsg').textContent = `Fusion costs ${fmtEmber(fee)}. Earn more by mining.`;
    showStage('stageError');
    return;
  }
  const before = new Set([...S.cards.values()].filter(c => isMine(c.pending)).map(c => c.uid));
  fuseBusy = true;
  try {
    const hash = await doTx('Fusing champions', 'fuse', [], [depAct(a, CARD_AMT), depAct(b, CARD_AMT)]);
    if (!hash) return;
    window.sfx?.('fuse');
    const won = await awaitNewCard(() =>
      [...S.cards.values()].find(c => isMine(c.pending) && !before.has(c.uid)));
    if (won) revealCard(won, `FUSED \u00b7 ${TIERS[won.tier].name}`);
  } finally {
    fuseBusy = false;
  }
}

let writBusy = false;
async function fightWrit(uid, writ, tier) {
  if (writBusy) {
    $('errTitle').textContent = 'A fight is underway';
    $('errMsg').textContent = 'A boss fight is already confirming. Await that verdict first.';
    showStage('stageError');
    $('overlay').hidden = false;
    return;
  }
  writBusy = true;
  try {
  const c = S.cards.get(uid);
  const entry = Math.max(1, Math.floor(fuseFeeFor(c?.tier ?? 0) / 5));
  if (S.ember < entry) {
    $('errTitle').textContent = 'Boss entry fee';
    $('errMsg').textContent = `Boss entry costs ${fmtEmber(entry)}. Earn more by mining.`;
    showStage('stageError');
    $('overlay').hidden = false;
    return;
  }
  const before = S.ember;
  const h = await doTx('Fighting the boss', 'fight_writ', [uid, writ, tier]);
  if (!h) return;
  const won = S.ember > before;  // victory pays 4x the entry
  const w = S.writs[writ] || { name: 'the writ' };
  const mult = [1, 2, 4][tier] || 1;
  showFight(won
    ? `<div class="duel-banner win">THE WRIT IS FELLED</div>
       <div class="wait-sub">${w.name} (${WRIT_TIERS[tier]}) falls. The bounty and the renown are yours.</div>`
    : `<div class="duel-banner lose">THE WRIT STANDS</div>
       <div class="wait-sub">${w.name} holds the field. The entry is spent; your champion learned from it.</div>`,
    S.cards.get(uid)?.aspects, [w.valor * mult, w.bulwark * mult, w.guile * mult], won);
  } finally {
    writBusy = false;
  }
}

/* ---------------- sealed stances & side bets ---------------- */

// this browser is the only holder of the salts that unseal our stances:
// {pending: [{stance,salt,ts}], byId: {duelId: {stance,salt}}}
const SEALS_LS = 'emberfall_duel_seals';
function loadSeals() {
  try { return JSON.parse(localStorage.getItem(SEALS_LS)) || {}; } catch { return {}; }
}
function saveSeals(s) { localStorage.setItem(SEALS_LS, JSON.stringify(s)); }

// a fresh seal is stored before its create-tx is even submitted (so a reload
// can never lose it); once the duel shows on-chain it is keyed by duel id
function assignSeals() {
  const s = loadSeals();
  const pend = s.pending || [];
  if (!pend.length) return;
  s.byId = s.byId || {};
  const mine = S.duels.filter(d => d.stances && isMine(d.challenger)
    && (d.status === 'open' || d.status === 'reveal') && !s.byId[d.id])
    .sort((a, b) => a.id - b.id);
  for (const d of mine) {
    const seal = pend.shift();
    if (!seal) break;
    s.byId[d.id] = { stance: seal.stance, salt: seal.salt };
  }
  s.pending = pend;
  saveSeals(s);
}

const STANCE_NAMES = ['Attack', 'Defense', 'Cunning'];
/* the three aspect marks as raw paths, for the one place that cannot use
   the sprite: the share canvas. Keep in step with the <symbol>s. */
const GLYPH_PATHS = {
  attack: 'M12 1 L15.2 7.5 V14.2 H8.8 V7.5 Z M4.8 15.2 H19.2 V18.4 H13.7 V23 H10.3 V18.4 H4.8 Z',
  defense: 'M12 1.2 L21 4.6 V11.4 C21 17.4 17.2 21.6 12 23 C6.8 21.6 3 17.4 3 11.4 V4.6 Z '
    + 'M12 4.6 L6 6.9 V11.4 C6 15.4 8.4 18.4 12 19.7 C15.6 18.4 18 15.4 18 11.4 V6.9 Z',
  cunning: 'M20.6 1.4 L22.6 3.4 L13 13 L11 11 Z M11.6 13.4 L10.6 14.4 L6.4 10.2 L7.4 9.2 Z '
    + 'M9.5 15.5 L8.5 16.5 L4.3 12.3 L5.3 11.3 Z M6.4 17.2 L8.4 19.2 L2.6 23 Z',
};

function randSalt() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function revealDuel(id) {
  const seal = (loadSeals().byId || {})[id];
  if (!seal) {
    $('errTitle').textContent = 'The sealed stance is missing';
    $('errMsg').textContent = 'This browser does not hold the salt for that duel '
      + '(storage was cleared, or it was sealed on another device). When the '
      + 'reveal window ends, the fight forfeits to the defender.';
    showStage('stageError');
    return;
  }
  const winsBefore = S.wins;
  const d = S.duels.find(x => x.id === id);
  const hash = await doTx('Revealing your stance', 'reveal_duel',
    [id, seal.stance, seal.salt], []);
  if (!hash) return;
  const won = S.wins > winsBefore;
  const home = S.wallet?.mode === 'session'
    ? 'Your champion is already on the way home.'
    : 'Your champion returns; claim them under Collection.';
  showFight(won
    ? `<div class="duel-banner win">VICTORY</div><div class="wait-sub">Your ${STANCE_NAMES[seal.stance]} stance is unsealed and the pot is yours. ${home}</div>`
    : `<div class="duel-banner lose">DEFEAT</div><div class="wait-sub">The stance is unsealed, the pot is lost, but your champion lives. ${home}</div>`,
    d ? S.cards.get(d.card)?.aspects : null,
    d ? S.cards.get(d.acceptorCard)?.aspects : null, won);
}

/* seats we hold in tournaments, so the UI can offer WITHDRAW without a
   per-player seat view: [{t, uid, ts}] */
const TOURS_LS = 'emberfall_my_tournaments';
function loadMyTournaments() {
  try { return JSON.parse(localStorage.getItem(TOURS_LS)) || []; } catch { return []; }
}

/* squads seal a lane ORDER, not a stance: {pending:[{perm,salt,ts}],
   byId:{duelId:{perm,salt}}} — same recovery rules as duel seals */
const SQUAD_SEALS_LS = 'emberfall_squad_seals';
function loadSquadSeals() {
  try { return JSON.parse(localStorage.getItem(SQUAD_SEALS_LS)) || {}; } catch { return {}; }
}
function assignSquadSeals() {
  const s = loadSquadSeals();
  const pend = s.pending || [];
  if (!pend.length) return;
  s.byId = s.byId || {};
  const mine = S.duels.filter(d => d.squad && isMine(d.challenger)
    && (d.status === 'open' || d.status === 'reveal') && !s.byId[d.id])
    .sort((a, b) => a.id - b.id);
  for (const d of mine) {
    const seal = pend.shift();
    if (!seal) break;
    s.byId[d.id] = { perm: seal.perm, salt: seal.salt };
  }
  s.pending = pend;
  localStorage.setItem(SQUAD_SEALS_LS, JSON.stringify(s));
}

async function revealSquad(id) {
  const seal = (loadSquadSeals().byId || {})[id];
  if (!seal) {
    $('errTitle').textContent = 'The sealed lane order is missing';
    $('errMsg').textContent = 'This browser does not hold the salt for that squad duel '
      + '(storage was cleared, or it was sealed on another device). When the '
      + 'reveal window ends, the fight forfeits to the defender.';
    showStage('stageError');
    return;
  }
  const winsBefore = S.wins;
  const hash = await doTx('Unsealing the lanes', 'reveal_squad',
    [id, seal.perm, seal.salt], []);
  if (!hash) return;
  const won = S.wins > winsBefore;
  const home = S.wallet?.mode === 'session'
    ? 'Your champions are already on the way home.'
    : 'Your champions return; claim them under Collection.';
  $('duelResult').innerHTML = won
    ? `<div class="duel-banner win">THE SQUAD PREVAILS</div><div class="wait-sub">The lanes are unsealed and your side took two or more. The pot is yours. ${home}</div>`
    : `<div class="duel-banner lose">THE SQUAD FALLS</div><div class="wait-sub">The lanes are unsealed and the defenders took the day. The pot is lost, but your champions live. ${home}</div>`;
  window.sfx?.('clash');
  setTimeout(() => window.sfx?.(won ? 'win' : 'lose'), 450);
  showStage('stageDuel');
}

async function placeBet(id, side) {
  const raw = prompt(`Back the ${side === 0 ? 'challenger' : 'defender'} with how much Ember? (you have ${S.ember})`, '10');
  if (raw === null) return;
  const amt = Math.floor(Number(raw));
  if (!Number.isInteger(amt) || amt < 1) { alert('Enter a whole number of Ember.'); return; }
  if (amt > S.ember) { alert(`You have ${fmtEmber(S.ember)}.`); return; }
  const h = await doTx('Placing your bet', 'place_bet', [id, side, amt], []);
  if (h) {
    // remembered so the verdict can come tell you how your bet fared —
    // payouts land silently on the ledger otherwise
    const bets = loadMyBets();
    bets.push({ id, side, amt, ts: Date.now() });
    localStorage.setItem(BETS_LS, JSON.stringify(bets.slice(-30)));
  }
}

/* bets settle silently on the ledger; ribbon the outcome when the duel's
   verdict shows up in the feed */
const BETS_LS = 'emberfall_my_bets';
function loadMyBets() {
  try { return JSON.parse(localStorage.getItem(BETS_LS)) || []; } catch { return []; }
}

function checkBetOutcomes(events) {
  let bets = loadMyBets();
  if (!bets.length) return;
  const keep = [];
  for (const b of bets) {
    // which side took the duel, from the feed's verdict events
    let winSide = null, refunded = false, decided = false;
    for (const ev of events) {
      if (ev.id !== b.id) continue;
      if (ev.kind === 'forfeit') { winSide = 1; decided = true; break; }
      if (ev.kind === 'duel_cancel') { refunded = true; decided = true; break; }
      if ((ev.kind === 'answer' || ev.kind === 'reveal') && ev.verdict) {
        // 'answer' events carry the acceptor, 'reveal' events the challenger
        const acceptorWon = ev.kind === 'answer'
          ? ev.verdict.winner === ev.who
          : ev.verdict.winner !== ev.who;
        winSide = acceptorWon ? 1 : 0;
        decided = true;
        break;
      }
    }
    if (!decided) {
      // verdicts age out of the feed; a very old bet resolves quietly
      if (Date.now() - b.ts > 3 * 86400000) continue;
      keep.push(b);
      continue;
    }
    const which = b.side === 0 ? 'the challenger' : 'the defender';
    if (refunded) {
      ribbon(`Duel #${b.id} was cancelled: your ${fmtEmber(b.amt)} bet came home`, '', 'coin');
    } else if (winSide === b.side) {
      ribbon(`Your bet on ${which} in duel #${b.id} paid out: stake back plus a share of the losing pool`, 'level', 'coin');
    } else {
      ribbon(`Your ${fmtEmber(b.amt)} bet on ${which} in duel #${b.id} was lost with the fight`, '', 'lose');
    }
  }
  localStorage.setItem(BETS_LS, JSON.stringify(keep));
}

/* A fight is three rounds, one per aspect. Each round is a proportional
   bar with its own chance spelled out, so reading a matchup takes no
   arithmetic. The bars arrive one at a time: this is the only dramatic
   beat in the loop and it used to happen instantly inside a list row.

   The bars show the ODDS, not per-round verdicts. The contract rolls the
   rounds but a public node exposes neither its return value nor its
   emitted events, so the honest thing to show is the chance that stood
   and then the settled outcome. When the log API serves the per-round
   marks the v5 blueprint writes, these same bars can fill in for real. */
const ASPECT_IDS = ['attack', 'defense', 'cunning'];
const ASPECT_NAMES = ['Attack', 'Defense', 'Cunning'];
const ROUND_STAGGER = 780;

function matchupHtml(mine, theirs) {
  if (!mine || !theirs) return '';
  const rows = [0, 1, 2].map(i => {
    const a = mine[i] || 0, b = theirs[i] || 0;
    const pct = a + b > 0 ? Math.round(100 * a / (a + b)) : 50;
    return `<div class="rnd" data-rnd="${i}">
      <div class="rnd-head">${glyph(ASPECT_IDS[i])}<span class="rnd-nm">${ASPECT_NAMES[i]}</span>
        <span class="rnd-odds mono">${pct}% yours</span></div>
      <div class="rnd-bar"><span class="rnd-mine" style="flex-basis:${pct}%">${a}</span>
        <span class="rnd-theirs" style="flex-basis:${100 - pct}%">${b}</span></div>
    </div>`;
  }).join('');
  return `<div class="matchup">${rows}
    <div class="mu-note">three rounds, one per aspect · win two to take the fight</div></div>`;
}

/* the staged reveal: banner last, rounds one at a time before it */
function showFight(bannerHtml, mine, theirs, won) {
  const mu = matchupHtml(mine, theirs);
  $('duelResult').innerHTML = mu
    ? `<div class="fight-rounds">${mu}</div><div class="fight-verdict">${bannerHtml}</div>`
    : bannerHtml;
  showStage('stageDuel');
  $('overlay').hidden = false;
  const rounds = [...document.querySelectorAll('#duelResult .rnd')];
  const verdict = $('duelResult').querySelector('.fight-verdict');
  if (REDUCED || !rounds.length) {
    rounds.forEach(r => r.classList.add('in'));
    verdict?.classList.add('in');
    window.sfx?.('clash');
    setTimeout(() => window.sfx?.(won ? 'win' : 'lose'), 300);
    return;
  }
  rounds.forEach((r, i) => setTimeout(() => {
    r.classList.add('in');
    window.sfx?.('clash', { rate: 0.92 + i * 0.09, volume: 0.55 });
  }, ROUND_STAGGER * i));
  setTimeout(() => {
    verdict?.classList.add('in');
    window.sfx?.(won ? 'win' : 'lose');
  }, ROUND_STAGGER * rounds.length + 120);
}

async function claimDelve(uid) {
  const g0 = S.ember;
  const s0 = S.shards || 0;
  const h = await doTx('Claiming the delve', 'claim_delve', [uid]);
  if (!h) return;
  const dg = S.ember - g0;
  const ds = (S.shards || 0) - s0;
  if (ds > 0 && dg > 0) ribbon(`An ancient relic! +${ds} shards and ${fmtEmber(dg)}`, 'level', 'favor');
  else if (ds > 0) ribbon(`The delve found relic shards: +${ds}`, 'level', 'favor');
  else if (dg > 0) ribbon(`The delve struck a seam: +${fmtEmber(dg)}`, 'level', 'coin');
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
    ? artImg(c.name, 'ac-img', '(max-width: 700px) 80vw, 300px', true)
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
      <div class="wait-sub">Frames and tints cost <b>${fmtEmber(price)}</b> each
      (you hold ${fmtEmber(S.ember)}). Epithets cost <b>3 relic shards</b>
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
            ? `<span class="ctint-${i + 1}"><img class="ac-img tint-thumb" loading="lazy" decoding="async"
                src="cards/${slugOf(c.name)}-440.webp" sizes="70px" alt="Tint ${i + 1}"></span>`
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
    if (slot < 2 && value > 0 && S.ember < price) {
      $('errTitle').textContent = 'Not enough Ember';
      $('errMsg').textContent = `This adornment costs ${fmtEmber(price)}.`;
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
  // v4: the name belongs to the main identity, session or not
  $('nameInput').value = S.names[identity()] || '';
  $('nameMsg').textContent = '';
  $('nameClaimBtn').disabled = false;
  showStage('stageName');
}

async function claimName() {
  const name = $('nameInput').value.trim().replace(/\s+/g, ' ');
  const msg = $('nameMsg');
  if (!NAME_RE.test(name)) {
    msg.textContent = 'Names are 3-16 characters: letters, numbers, spaces or _.';
    return;
  }
  if (name === S.names[identity()]) { $('overlay').hidden = true; return; }
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
    // the name is claimed FOR the main identity; in a session the tx is
    // signed by the session key and the server verifies the delegation
    const r = await fetch('/api/name', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx: hash, addr: identity(), secret: nameSecret() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'the name server rejected the claim');
    localStorage.setItem(NAME_LS, name);
    await loadNames(true);
    render();
    $('overlay').hidden = true;
    ribbon(`You are now known as <b>${name}</b>`, 'level', 'deed');
    track('set_name', { ok: true, wallet: walletKind() });
  } catch (e) {
    const m = (e && e.message) || String(e);
    msg.textContent = /not enough|insufficient|no utxos/i.test(m)
      ? 'You need 0.01 HTR to claim a name. Get free testnet coin from the faucet linked under Info.'
      : /not signed by that address/i.test(m)
      ? 'Your wallet signed with a different address than the one playing. '
        + 'Start a quick play session and claim the name there; it signs with the right key.'
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
  const [, , , tp = 0, hd = 0] = c.aspects || [];
  const art = meta?.art
    ? artImg(c.name, 'ac-img', '(max-width: 899px) 92vw, 420px', true)
    : `<div class="cf-sigil">${artSvg(c.name)}</div>`;
  const typeBits = [t.name, meta?.type, cos.epithet ? EPITHETS[cos.epithet - 1] : null].filter(Boolean);
  // the pedigree reads as a record: this history cannot be forged and it
  // travels with the card to the next owner. That IS the product claim.
  const rows = [
    ['Victories', `${c.wins || 0}`],
    ['Veterancy', c.level > 0 ? `Level ${c.level}` : 'unblooded'],
    ['Tempered', tp > 0 ? `${tp}×` : '—'],
    ['Hardened', hd > 0 ? `${hd}×` : '—'],
    ['Rarity', `${t.name}${meta?.type ? ' · ' + meta.type : ''}`],
    ['Token', `<span class="mono">${c.uid.slice(0, 6)}…${c.uid.slice(-4)}</span>`],
  ].map(([k, v]) => `<div class="lg-row"><span class="lg-k">${k}</span><span class="lg-v">${v}</span></div>`).join('');
  $('cardDetail').innerHTML = `
    <div class="detail-sheet rank-${c.tier}${cosCls}" style="--rc:${t.color}">
      <div class="ds-art">
        ${art}
        <div class="cf-vign"></div>
        <div class="cf-med" title="power">${glyph('power')}<b>${c.power ?? '?'}</b></div>
        <div class="ds-plate">
          <div class="ds-name">${c.name}</div>
          <div class="ds-type">${typeBits.join(' · ')}</div>
        </div>
      </div>
      <div class="ds-body">
        ${aspectRail(c)}
        ${meta?.flavor ? `<div class="ds-flavor">${meta.flavor}</div>` : ''}
        <div class="ledger">${rows}</div>
        <a class="verify" href="${EXPLORER}/token_detail/${c.uid}" target="_blank" rel="noopener">
          ${glyph('link')}Read this champion on the Ledger</a>
      </div>
    </div>`;
  // one gold action, the rest quiet icons beside it
  const acts = $('cardDetailActs');
  if (acts) {
    const mineNow = c.mine, staked = isMine(c.staker);
    // a spectator gets no bar furniture: the absent buttons say it already
    acts.classList.toggle('ds-acts-min', !mineNow && !staked);
    acts.innerHTML = (mineNow
      ? `<button class="cf-primary" data-dstake="${uid}">SEND TO MINES</button>`
      : staked
        ? `<button class="cf-primary" data-dunstake="${uid}">RECALL FROM MINES</button>`
        : '')
      + `<button class="ds-icon" id="cardShareBtn" title="${matchMedia('(pointer: coarse)').matches
        ? 'Share this champion' : 'Share on X'}">${glyph('share', 'gl')}</button>`
      + (mineNow ? `<button class="ds-icon" data-dduel="${uid}" title="Challenge in the Arena">${glyph('attack', 'gl')}</button>` : '')
      + (mineNow && MKT ? `<button class="ds-icon" data-dsell="${uid}" title="List in the Market">${glyph('market', 'gl')}</button>` : '');
    acts.querySelectorAll('[data-dstake]').forEach(el => el.onclick = () => {
      $('overlay').hidden = true;
      doTx('Staking in the mines', 'stake', [], [depAct(uid, CARD_AMT)]);
    });
    acts.querySelectorAll('[data-dunstake]').forEach(el => el.onclick = () => {
      $('overlay').hidden = true;
      doTx('Recalling champion', 'unstake', [], [wdAct(uid, CARD_AMT)]);
    });
    acts.querySelectorAll('[data-dduel]').forEach(el => el.onclick = () => openPick('create', uid));
    acts.querySelectorAll('[data-dsell]').forEach(el => el.onclick = () => {
      const raw = prompt('Ask price in HTR cents (5 = 0.05 HTR). Name any price you like:', '5');
      if (raw === null) return;
      const p = Math.floor(Number(raw));
      if (!Number.isInteger(p) || p < 1) { alert('Price must be a whole number of HTR cents, 1 or more.'); return; }
      $('overlay').hidden = true;
      doTx('Listing for sale', 'list_card', [p], [depAct(uid, CARD_AMT)], { target: MKT })
        .then(h => { if (h) window.sfx?.('coin', { volume: .45 }); });
    });
    const sb = $('cardShareBtn');
    if (sb) sb.onclick = () => cardDetailUid && shareCard(cardDetailUid);
  }
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
  const pw = `${c.power}`;
  g.fillText(pw, W - 40 - g.measureText(pw).width, y);
  y += 44;
  g.font = '700 24px Outfit, sans-serif';
  g.fillStyle = t.color.startsWith('var') ? '#d4a843' : t.color;
  g.fillText(stationLine(c, t, meta).toUpperCase(), 40, y);
  y += 52;
  const [v, b, gu] = c.aspects || [0, 0, 0];
  g.font = '32px "JetBrains Mono", "Fragment Mono", monospace';
  // the same three marks the app draws, as paths: a canvas cannot reach the
  // sprite, and emoji here would land in a PNG shared with strangers
  let ax = 40;
  for (const [d, n] of [[GLYPH_PATHS.attack, v], [GLYPH_PATHS.defense, b], [GLYPH_PATHS.cunning, gu]]) {
    g.save();
    g.translate(ax, y - 26);
    g.scale(34 / 24, 34 / 24);          // the sprite's 24-unit viewBox
    g.fillStyle = '#b5ab99';
    g.fill(new Path2D(d));
    g.restore();
    ax += 44;
    g.fillStyle = '#e8dfc9';
    const label = `${n}`;
    g.fillText(label, ax, y);
    ax += g.measureText(label).width + 34;
  }
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
  const text = `${c.name} · ${t.name}, power ${c.power}, bound to my banner in Emberfall, `
    + `the fully onchain TCG on @hathornetwork.\n\n`
    + `Free on testnet. Play with $HTR, earn Ember at emberfall.fun`;
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
    window.open('https://x.com/intent/tweet?text='
      + encodeURIComponent(`${text}\n\n${cardUrl}`), '_blank');
    msg.textContent = 'The champion travels with the link and shows under the post. Edit the words as you like.';
    track('share_card', { method: 'link' });
  } catch (e) {
    if ((e && e.name) === 'AbortError') { msg.textContent = ''; return; }
    msg.textContent = 'Could not build the card image: ' + ((e && e.message) || e);
    track('share_card', { method: 'failed' });
  }
}

let pickCtx = null;
let pickStance = null; // -1 open (classic), 0..2 sealed/answering stance
let pickSquad = [];    // uids picked for a 3v3, in lane order

function toggleSquadPick(el) {
  const uid = el.dataset.pick;
  const at = pickSquad.indexOf(uid);
  if (at >= 0) pickSquad.splice(at, 1);
  else pickSquad.push(uid);
  // relabel every button with its lane slot so the order reads at a glance
  document.querySelectorAll('[data-pick]').forEach(b => {
    const i = pickSquad.indexOf(b.dataset.pick);
    b.textContent = i >= 0 ? `LANE ${i + 1} ✓` : 'SELECT';
    b.classList.toggle('alt', i >= 0);
  });
  if (pickSquad.length === 3) submitSquad();
}

async function submitSquad() {
  const { kind, ref } = pickCtx;
  const cards = pickSquad.slice();
  pickSquad = [];
  $('overlay').hidden = true;
  if (kind === 'squadCreate') {
    const raw = $('pickWager').value.trim();
    if (raw === '') {
      $('errTitle').textContent = 'Name your wager';
      $('errMsg').textContent = 'Enter a wager in Ember, or 0 for a free squad duel '
        + 'where no Ember changes hands.';
      showStage('stageError');
      return;
    }
    const wager = Math.max(0, Number(raw) || 0);
    if (wager > S.ember) { $('errTitle').textContent = 'Wager too high'; $('errMsg').textContent = `You have ${fmtEmber(S.ember)}.`; showStage('stageError'); return; }
    // a random sealed lane order is strategically as good as a chosen one
    // (the defender assigns lanes blind either way) and needs no extra UI
    const perm = ['012', '021', '102', '120', '201', '210'][crypto.getRandomValues(new Uint8Array(1))[0] % 6];
    const salt = randSalt();
    const commit = sha3_256(`${perm}:${salt}`);
    const s = loadSquadSeals();
    (s.pending = s.pending || []).push({ perm, salt, ts: Date.now() });
    localStorage.setItem(SQUAD_SEALS_LS, JSON.stringify(s));
    await doTx('Mustering the squad', 'create_squad_duel', [wager, commit],
      cards.map(u => depAct(u, CARD_AMT)));
    return;
  }
  const hash = await doTx('Answering the 3v3', 'accept_squad_duel', [ref],
    cards.map(u => depAct(u, CARD_AMT)));
  if (!hash) return;
  const hours = Math.round((S.revealWindow || 21600) / 3600);
  $('duelResult').innerHTML = `<div class="duel-banner">${glyph('seal', 'gl')} THE LANES ARE SET</div>
    <div class="wait-sub">Your three champions hold their lanes. The challenger
    now has ${hours}h to unseal their lane order and settle the three fights;
    if they never do, you claim the pot by forfeit. Watch this duel in the Arena list.</div>`;
  window.sfx?.('clash');
  showStage('stageDuel');
  $('overlay').hidden = false;
}
function syncStanceBtns() {
  document.querySelectorAll('.stance-btn').forEach(el =>
    el.classList.toggle('active', Number(el.dataset.stance) === pickStance));
}
function openPick(kind, ref) {
  pickCtx = { kind, ref };
  if (kind === 'writ') {
    const marchers = [...S.cards.values()].filter(c =>
      isMine(c.staker) && !(c.delveSince > 0) && (c.writFights || 0) < 3)
      .sort((a, b) => (b.power - a.power) || a.name.localeCompare(b.name));
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
    $('pickStanceRow').hidden = true; // stances belong to duel picks only
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
    $('pickStanceRow').hidden = true; // stances belong to duel picks only
    $('pickCards').innerHTML = others.map(c =>
      cardBox(c, `<button class="mini-btn" data-pick="${c.uid}">OFFER THE TRADE</button>`)).join('');
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => submitPick(el.dataset.pick));
    showStage('stagePick');
    return;
  }
  if (kind === 'squadCreate' || kind === 'squadAccept') {
    const roster = [...S.cards.values()].filter(c => c.mine);
    if (roster.length < 3) {
      $('errTitle').textContent = 'A squad needs three champions';
      $('errMsg').textContent = 'You hold ' + (roster.length === 1 ? 'one champion' : `${roster.length} champions`)
        + '. Summon or claim until you hold three, then muster the squad.';
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    if (kind === 'squadAccept') {
      const d = S.duels.find(x => x.id === ref);
      if (d && d.wager > 0 && S.ember < d.wager) {
        $('errTitle').textContent = 'Not enough Ember for the wager';
        $('errMsg').textContent = `This squad duel wagers ${fmtEmber(d.wager)}.`;
        showStage('stageError');
        $('overlay').hidden = false;
        return;
      }
    }
    pickSquad = [];
    const wagerNote = kind === 'squadAccept'
      ? ` (wager ${fmtEmber(S.duels.find(x => x.id === ref)?.wager || 0)})`
      : '';
    $('pickTitle').textContent = kind === 'squadCreate'
      ? 'Muster a 3v3 squad: pick three champions & a wager'
      : `Answer squad challenge #${ref}${wagerNote}: pick three champions in lane order`;
    $('pickWagerRow').hidden = kind !== 'squadCreate';
    if (kind === 'squadCreate') $('pickWager').value = '';
    const stanceRowS = $('pickStanceRow');
    if (stanceRowS) stanceRowS.hidden = true;
    $('stanceHint') && ($('stanceHint').textContent = '');
    const hint = kind === 'squadCreate'
      ? 'Your three champions are shown to any challenger, but which lane each fights in stays sealed in this browser until you reveal it after the duel is answered.'
      : 'Pick in the order you want the lanes: first pick fights lane 1, second lane 2, third lane 3. The challenger’s lane order is sealed, so place your champions blind.';
    $('pickCards').innerHTML = `<div class="wait-sub">${hint}</div>`
      + roster.map(c => cardBox(c, `<button class="mini-btn" data-pick="${c.uid}">SELECT</button>`)).join('');
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => toggleSquadPick(el));
    showStage('stagePick');
    $('overlay').hidden = false;
    return;
  }
  if (kind === 'tourEnter') {
    const t = (S.tournaments || []).find(x => x.id === ref);
    if (t && t.fee > S.ember) {
      $('errTitle').textContent = 'Not enough Ember for the entry fee';
      $('errMsg').textContent = `This bracket asks ${fmtEmber(t.fee)}. You hold ${fmtEmber(S.ember)}.`;
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    const roster = [...S.cards.values()].filter(c => c.mine);
    if (!roster.length) {
      $('errTitle').textContent = 'No cards';
      $('errMsg').textContent = 'You hold no champion. Summon or claim one first.';
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    $('pickTitle').textContent = `Enter ${t ? t.name : 'the bracket'} (${fmtEmber(t?.fee || 0)} entry): choose your champion`;
    $('pickWagerRow').hidden = true;
    $('pickStanceRow').hidden = true;
    $('pickCards').innerHTML = roster.map(c => cardBox(c, `<button class="mini-btn" data-pick="${c.uid}">SELECT</button>`)).join('');
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => submitPick(el.dataset.pick));
    showStage('stagePick');
    $('overlay').hidden = false;
    return;
  }
  if (kind === 'wbfight') {
    const marchers = [...S.cards.values()].filter(c =>
      isMine(c.staker) && !(c.delveSince > 0));
    if (!marchers.length) {
      $('errTitle').textContent = 'No champion available';
      $('errMsg').textContent = 'The world boss is struck by staked champions. '
        + 'Stake one in The Mines (not delving) and try again.';
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    $('pickTitle').textContent = `Strike ${S.worldBoss?.name ?? 'the colossus'}: choose a mining champion`;
    $('pickWagerRow').hidden = true;
    $('pickStanceRow').hidden = true;
    $('pickCards').innerHTML = marchers.map(c => cardBox(c,
      `<button class="mini-btn" data-pick="${c.uid}">STRIKE</button>`)).join('');
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => submitPick(el.dataset.pick));
    showStage('stagePick');
    $('overlay').hidden = false;
    return;
  }
  if (kind === 'ranked') {
    const wager = [0, 25, 100][ref] || 0;
    if (wager > S.ember) {
      $('errTitle').textContent = 'Not enough Ember for this tier';
      $('errMsg').textContent = `This ranked tier wagers ${fmtEmber(wager)}. You have ${fmtEmber(S.ember)}.`;
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    const roster = [...S.cards.values()].filter(c => c.mine);
    if (!roster.length) {
      $('errTitle').textContent = 'No cards';
      $('errMsg').textContent = 'You hold no champion. Summon or claim one first.';
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    $('pickTitle').textContent = `Join the ranked queue (${wager ? fmtEmber(wager) + ' wager' : 'free spar'}): choose your champion`;
    $('pickWagerRow').hidden = true;
    const sr = $('pickStanceRow');
    if (sr) sr.hidden = true;
    $('pickCards').innerHTML = roster.map(c => cardBox(c, `<button class="mini-btn" data-pick="${c.uid}">SELECT</button>`)).join('');
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => submitPick(el.dataset.pick));
    showStage('stagePick');
    $('overlay').hidden = false;
    return;
  }
  const mine = [...S.cards.values()].filter(c => c.mine);
  if (!mine.length) { $('errTitle').textContent = 'No cards'; $('errMsg').textContent = 'You hold no champion. Summon or claim one first.'; showStage('stageError'); $('overlay').hidden = false; return; }
  $('pickTitle').textContent = kind === 'create' ? 'Issue a challenge: choose your champion & wager' : `Answer challenge #${ref}: choose your champion`;
  $('pickWagerRow').hidden = kind !== 'create';
  if (kind === 'create') $('pickWager').value = ''; // the stake must be named, not defaulted
  $('pickWagerHint').hidden = true;
  if (kind === 'accept') {
    if (loadMyBets().some(b => b.id === ref)) {
      $('errTitle').textContent = 'Your bet is on this fight';
      $('errMsg').textContent = 'You have Ember riding on this duel, so you cannot also '
        + 'fight it. Back a fight or join it, never both.';
      showStage('stageError');
      $('overlay').hidden = false;
      return;
    }
    const d = S.duels.find(x => x.id === ref);
    $('pickTitle').textContent += ` (wager ${fmtEmber(d.wager)})`;
  }
  // stances: optional on create (sealed), demanded when answering a sealed duel
  const acceptStances = kind === 'accept' && !!S.duels.find(x => x.id === ref)?.stances;
  const stanceRow = $('pickStanceRow');
  if (stanceRow) {
    stanceRow.hidden = !(kind === 'create' || acceptStances);
    pickStance = kind === 'create' ? -1 : null; // create defaults open; accept must choose
    $('stanceHint').innerHTML = acceptStances
      ? '<b>Pick your stance.</b> This challenge is sealed, so you must answer with one. '
        + 'Attack beats Defense, Defense beats Cunning, Cunning beats Attack; the winning stance boosts every round by 20%.'
      : '<b>Seal a stance, or don\'t.</b> A sealed stance stays hidden until you reveal it after '
        + 'the fight is answered. Attack beats Defense, Defense beats Cunning, Cunning beats Attack; '
        + 'the winning stance boosts every round by 20%.';
    $('stanceNone').hidden = acceptStances;
    syncStanceBtns();
  }
  // the label names the deed, so the last click is never a surprise
  const pickLabel = kind === 'create' ? 'ISSUE CHALLENGE' : 'ANSWER THE CHALLENGE';
  $('pickCards').innerHTML = mine.map(c =>
    cardBox(c, `<button class="mini-btn" data-pick="${c.uid}">${pickLabel}</button>`)).join('');
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
  if (kind === 'tourEnter') {
    const hash = await doTx('Taking your seat', 'enter_tournament', [ref],
      [depAct(uid, CARD_AMT)]);
    if (!hash) return;
    window.sfx?.('clash', { rate: .9, volume: .45 });
    const seats = loadMyTournaments();
    seats.push({ t: ref, uid, ts: Date.now() });
    localStorage.setItem(TOURS_LS, JSON.stringify(seats.slice(-10)));
    const t = (S.tournaments || []).find(x => x.id === ref);
    const mins = t ? Math.max(0, Math.ceil((t.start * 1000 - Date.now()) / 60000)) : 0;
    $('duelResult').innerHTML = `<div class="duel-banner">${glyph('bracket', 'gl')} YOUR SEAT IS HELD</div>
      <div class="wait-sub">Your champion stands in the bracket. The first round fights
      ${t ? `in about ${Math.floor(mins / 60)}h ${mins % 60}m` : 'at the start'};
      one round fights each day after. Withdraw any time before the start for a full refund.</div>`;
    window.sfx?.('clash');
    showStage('stageDuel');
    $('overlay').hidden = false;
    return;
  }
  if (kind === 'wbfight') {
    const hpBefore = S.worldBoss?.hp ?? 0;
    const hash = await doTx('Striking the colossus', 'fight_world_boss', [uid], []);
    if (!hash) return;
    const dmg = hpBefore - (S.worldBoss?.hp ?? hpBefore);
    const slain = (S.worldBoss?.hp ?? 1) === 0;
    $('duelResult').innerHTML = slain
      ? `<div class="duel-banner win">THE COLOSSUS FALLS</div>
         <div class="wait-sub">Your blow of ${dmg} damage ended it. Every fighter can now
         claim their share of the bounty in the Arena.</div>`
      : dmg > 0
        ? `<div class="duel-banner win">A TELLING BLOW</div>
           <div class="wait-sub">${dmg} damage. ${S.worldBoss?.hp ?? '?'} HP still stands;
           strike again or let the realm finish it.</div>`
        : `<div class="duel-banner lose">THE BLOW GLANCED OFF</div>
           <div class="wait-sub">No round went your way. The entry is spent; your champion
           learned from it.</div>`;
    window.sfx?.('clash');
    setTimeout(() => window.sfx?.(slain || dmg > 0 ? 'win' : 'lose'), 450);
    showStage('stageDuel');
    $('overlay').hidden = false;
    return;
  }
  if (kind === 'ranked') {
    const winsBefore = S.wins;
    const hash = await doTx('Entering the ranked ladder', 'join_ranked', [ref], [depAct(uid, CARD_AMT)]);
    if (hash) window.sfx?.('clash', { rate: .9, volume: .45 });
    if (!hash) return;
    // doTx refreshed state: either we now wait in the queue, or a waiting
    // rival was in band and the fight already settled
    if (S.ranked?.queued?.[ref]) {
      $('duelResult').innerHTML = `<div class="duel-banner">${glyph('ladder', 'gl')} IN THE QUEUE</div>
        <div class="wait-sub">Your champion holds the line. When a rival within
        200 rating joins this tier, their move settles the fight on the spot:
        watch your rating and the World Feed. LEAVE in the Arena returns your
        wager and champion.</div>`;
    } else {
      const won = S.wins > winsBefore;
      const home = S.wallet?.mode === 'session'
        ? 'Your champion is already on the way home.'
        : 'Your champion returns; claim them under Collection.';
      $('duelResult').innerHTML = (won
        ? `<div class="duel-banner win">RATED VICTORY</div><div class="wait-sub">A rival was waiting and fell. Your rating stands at <b>${S.ranked?.rating ?? '?'}</b>. ${home}</div>`
        : `<div class="duel-banner lose">RATED DEFEAT</div><div class="wait-sub">A rival was waiting and took the fight. Your rating stands at <b>${S.ranked?.rating ?? '?'}</b>. ${home}</div>`);
      window.sfx?.('clash');
      setTimeout(() => window.sfx?.(won ? 'win' : 'lose'), 450);
    }
    showStage('stageDuel');
    $('overlay').hidden = false;
    return;
  }
  if (kind === 'writ') {
    await fightWrit(uid, ref.writ, ref.tier);
    return;
  }
  if (kind === 'want') {
    const swapped = await doTx('Proposing trade', 'offer_swap', [uid], [depAct(ref, CARD_AMT)], { target: MKT });
    if (swapped) window.sfx?.('coin', { volume: .45 });
    return;
  }
  if (kind === 'create') {
    const raw = $('pickWager').value.trim();
    if (raw === '') {
      // stay in the picker: on phones the error stage was a dead end that
      // hid the input entirely. Point at the field and pop the keyboard.
      showStage('stagePick');
      $('pickWagerHint').hidden = false;
      $('pickWager').focus();
      return;
    }
    const wager = Math.max(0, Number(raw) || 0);
    if (wager > S.ember) { $('errTitle').textContent = 'Wager too high'; $('errMsg').textContent = `You have ${fmtEmber(S.ember)}.`; showStage('stageError'); return; }
    let commit = '';
    if (pickStance != null && pickStance >= 0) {
      // the seal is saved BEFORE the tx goes out: a reload can never lose it
      const salt = randSalt();
      commit = sha3_256(`${pickStance}:${salt}`);
      const s = loadSeals();
      (s.pending = s.pending || []).push({ stance: pickStance, salt, ts: Date.now() });
      saveSeals(s);
    }
    await doTx('Issuing challenge', 'create_duel', [wager, commit], [depAct(uid, CARD_AMT)]);
  } else {
    const duel = S.duels.find(x => x.id === ref);
    if (loadMyBets().some(b => b.id === ref)) {
      $('errTitle').textContent = 'Your bet is on this fight';
      $('errMsg').textContent = 'You have Ember riding on this duel, so you cannot also '
        + 'fight it. Back a fight or join it, never both.';
      showStage('stageError');
      return;
    }
    if (duel && duel.wager > 0 && S.ember < duel.wager) {
      $('errTitle').textContent = 'Not enough Ember for the wager';
      $('errMsg').textContent = `This duel wagers ${fmtEmber(duel.wager)}.`;
      showStage('stageError');
      return;
    }
    if (duel?.stances && (pickStance == null || pickStance < 0)) {
      $('errTitle').textContent = 'Pick a stance';
      $('errMsg').textContent = 'This challenge is sealed: answer it with Attack, Defense or Cunning.';
      showStage('stageError');
      return;
    }
    if (duel?.stances) {
      // sealed duels wait for the challenger's reveal; no instant verdict
      const hash = await doTx('Answering the challenge', 'accept_duel',
        [ref, pickStance], [depAct(uid, CARD_AMT)]);
      if (!hash) return;
      const hours = Math.round((S.revealWindow || 21600) / 3600);
      $('duelResult').innerHTML = `<div class="duel-banner">${glyph('seal', 'gl')} THE DUEL IS SEALED</div>
        <div class="wait-sub">Your ${STANCE_NAMES[pickStance]} stance is in. The challenger
        now has ${hours}h to reveal theirs and settle the fight; if they never do,
        you claim the pot by forfeit. Watch this duel in the Arena list.</div>`;
      window.sfx?.('clash');
      showStage('stageDuel');
      $('overlay').hidden = false;
      return;
    }
    const winsBefore = S.wins;
    const hash = await doTx('Trial by combat', 'accept_duel', [ref, -1], [depAct(uid, CARD_AMT)]);
    if (!hash) return;
    const won = S.wins > winsBefore;
    const home = S.wallet?.mode === 'session'
      ? 'Your champion is already on the way home.'
      : 'Your champion returns; claim them under Collection.';
    const d = S.duels.find(x => x.id === ref);
    showFight(won
      ? `<div class="duel-banner win">VICTORY</div><div class="wait-sub">The pot is yours. ${home}</div>`
      : `<div class="duel-banner lose">DEFEAT</div><div class="wait-sub">The pot is lost, but your champion lives. ${home}</div>`,
      S.cards.get(uid)?.aspects, d ? S.cards.get(d.card)?.aspects : null, won);
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
    await silentRefresh();
    // first time in the realm: walk them through it, then point at quick play
    const firstVisit = !localStorage.getItem('emberfall_tutorial_seen');
    if (firstVisit) startTutorial();
    if (S.wallet?.mode !== 'session') {
      // the nudge would hide behind the tutorial overlay; defer it to when the
      // tour closes, otherwise show it right away
      if (firstVisit) window.pendingQpHint = true;
      else showQpHint();
    }
  } catch (e) {
    $('connectMsg').textContent = e.message || String(e);
  }
}

/* ---------------- misc / boot ---------------- */

/* While a dialog is open the page behind must not scroll: a second
   scrollbar beside a sheet is noise, and on iOS the page drags under it.
   An observer on the overlay's hidden attribute covers every call site. */
/* The overflow menu closes as soon as one of its actions is taken. Capture,
   so it happens before a re-render or a dialog opens over it. */
document.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('.cf-ovf button, .cf-ovf .mini-btn');
  if (!btn) return;
  const menu = btn.closest('details.cf-ovf');
  if (menu) menu.open = false;
}, true);

(function lockScrollWithOverlay() {
  const ov = $('overlay');
  if (!ov) return;
  const sync = () => document.documentElement.classList.toggle('modal-open', !ov.hidden);
  new MutationObserver(sync).observe(ov, { attributes: true, attributeFilter: ['hidden'] });
  sync();
})();

function showStage(id) {
  for (const s of ['stageWait', 'stageReveal', 'stageDuel', 'stageError', 'stageConnect', 'stagePick', 'stageTemper', 'stageDress', 'stageName', 'stageCard'])
    $(s).hidden = s !== id;
  $('overlay').hidden = false;
}

$('pullBtn').onclick = pull;
$('fuseBtn').onclick = fuse;
$('newDuelBtn').onclick = () => openPick('create', null);
$('newSquadBtn').onclick = () => openPick('squadCreate', null);
document.querySelectorAll('.stance-btn').forEach(el => el.onclick = () => {
  pickStance = Number(el.dataset.stance);
  syncStanceBtns();
});

/* the realm feed folds away; closed until the player opens it */
const FEED_LS = 'emberfall_feed_open';
function applyFeedFold() {
  const open = localStorage.getItem(FEED_LS) !== '0';
  $('feedPanel').classList.toggle('collapsed', !open);
  $('feedList').hidden = !open;
  $('feedToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
}
$('feedToggle').onclick = () => {
  const open = localStorage.getItem(FEED_LS) !== '0';
  localStorage.setItem(FEED_LS, open ? '0' : '1');
  applyFeedFold();
  window.track && track('feed_toggle', { open: !open });
};
applyFeedFold();
// the hero folds on the FIRST paint, not after the realm loads: a
// returning player should never see the pitch flash past
applyHeroFold();
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
  $('setNameBtn').textContent = S.addr && S.names[identity()] ? 'CHANGE NAME' : 'SET NAME';
  if (!S.sessionStarting) {
    $('sessionInfo').textContent = inSession
      ? (S.wallet.unbound
        ? 'Legacy session from the old realm: it plays as its own identity. Ending it '
          + 'sweeps everything to ' + short(S.wallet.mainAddr) + ' as saved back then; '
          + 'only end it if that address is yours.'
        : 'Session active: every action signs instantly, no popups. Ending the session returns all champions and coin to ' + short(S.wallet.mainAddr) + '.')
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
    // v4 delegation: where does this session key stand on-chain already?
    // (an offer or even the binding may have landed on an earlier visit)
    const st = await batchCalls([`get_delegate("${addr}")`, `get_session_fund("${addr}")`]);
    const bound = !!st[`get_delegate("${addr}")`];
    let waitRounds = 100; // 5 minutes on the automatic path
    if (!bound && (st[`get_session_fund("${addr}")`] || 0) < ECON.sessionFund) {
      try {
        sessionNote('One approval in your wallet funds the session AND binds it to '
          + 'your identity: open your Hathor wallet and approve the '
          + fmtHtr(ECON.sessionFund) + ' offer\u2026');
        await Promise.race([
          main.executeNano('offer_session', [addr], [depAct(HTR, ECON.sessionFund)]),
          new Promise((_, rej) => setTimeout(
            () => rej(new Error('wallet approval timed out')), 120_000)),
        ]);
        track('session_offer', { ok: true, wallet: walletKindOf(main) });
        sessionNote('Offer sent; waiting for it to confirm\u2026');
      } catch (e) {
        track('session_offer', {
          ok: false, wallet: walletKindOf(main),
          reason: String((e && e.message) || e).slice(0, 200),
        });
        waitRounds = 600; // half an hour for a human-driven approval
        showOfferWaitUI(addr, reusing ? 'Reusing your earlier session key. ' : '');
        const why = String((e && e.message) || e).slice(0, 140);
        sessionNote('The wallet did not take the request (' + why + '). '
          + 'Open MetaMask yourself if nothing popped up \u2014 the game watches '
          + 'the chain and finishes the moment the approval lands.');
      }
      const offered = await awaitOffer(addr, waitRounds, ECON.sessionFund);
      if (!offered) {
        if (fundingCancelled) return;
        throw new Error('No offer seen on-chain yet. Your session key is saved in this '
          + 'browser: the moment the approval lands, reopening the game finishes the setup.');
      }
    }
    // only now wake the full wallet: the escrow is already safe in the
    // contract, so even a failed sync loses nothing (reopening retries)
    sessionNote('Offer secured; waking the session key\u2026');
    let sw;
    try { sw = await openSessionWallet(words, main.address); }
    catch {
      throw new Error('Your escrow is safe in the contract, but the session key '
        + 'could not sync yet. Reload the game to finish the setup.');
    }
    sessionNote('Binding the session to your identity\u2026');
    sw = await bindSession(sw, addr, words);
    localStorage.setItem(SESSION_LS, JSON.stringify({ words, mainAddr: main.address, addr }));
    S.mainWallet = main;
    S.wallet = sw;
    S.addr = sw.address;
    track('session_start', { funder: walletKindOf(main) });
    $('overlay').hidden = true;
    await silentRefresh();
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
    try { await silentRefresh(); }
    catch (e) {
      sessionNote((e && e.message) || 'the Ledger could not be read just now; try again in a moment');
      return;
    }
    // v4: game state (staked cards, pending claims, open duels, favor) is
    // keyed to the MAIN identity, so nothing in the game contract can be
    // stranded by ending a session — the main wallet reaches it all later.
    // Only the MARKET keys by the actual caller: anything the session key
    // opened there must be settled before that key is thrown away.
    const blockers = [];
    const cs = [...S.cards.values()];
    const n3 = cs.filter(c => c.marketPending === S.addr).length;
    if (n3) blockers.push(`${n3} champion${n3 > 1 ? 's' : ''} held for you in the Market (claim under 'In escrow: claim yours')`);
    if (S.marketFunds > 0) blockers.push(`${fmtHtr(S.marketFunds)} sale proceeds in the Market (withdraw them)`);
    const revealing = S.duels.filter(d => d.status === 'reveal' && isMine(d.challenger));
    if (revealing.length) blockers.push(
      `${revealing.length} duel${revealing.length > 1 ? 's' : ''} awaiting your reveal in Arena (reveal now or the fight forfeits)`);
    const n5 = S.listings.filter(l => l.status === 'open' && l.seller === S.addr).length;
    if (n5) blockers.push(`${n5} open listing${n5 > 1 ? 's' : ''} in the Market (cancel or sell)`);
    const n6 = S.swaps.filter(w => w.status === 'open' && w.maker === S.addr).length;
    if (n6) blockers.push(`${n6} open trade${n6 > 1 ? 's' : ''} in the Market (cancel them)`);
    if (blockers.length) {
      sessionNote('Before the session can end, settle: '
        + blockers.join(' · ') + '.');
      return;
    }
    // v4: the name never leaves the main address, so there is nothing to
    // bequeath \u2014 the sweep is all that remains
    sessionNote('Returning all champions and coin to your wallet\u2026');
    const r = await S.wallet.sweep();
    track('session_end', { swept: r ? r.moved : 0 });
    sessionNote(r ? `Returned ${r.moved} holdings to your wallet.` : 'Nothing to return.');
    await S.wallet.disconnect();
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
    await silentRefresh();
  } catch (e) {
    sessionNote(e.message || String(e));
  } finally {
    $('sessionEndBtn').disabled = false;
  }
}

/* funding helpers: the wait survives app switches, reloads, and patience */
let fundingCancelled = false;

function showOfferWaitUI(addr, lead) {
  $('sessionInfo').innerHTML = (lead || '')
    + 'The session offer needs one approval in your Hathor wallet. Approve it '
    + 'there; the game keeps watching the chain and finishes the setup the moment '
    + 'it lands, even if you switch apps or reload this page.<br>'
    + `<button class="mini-btn alt" style="margin-top:8px" id="fundCancelBtn">CANCEL</button>`;
  $('fundCancelBtn').onclick = async () => {
    const st = await batchCalls([`get_delegate("${addr}")`, `get_session_fund("${addr}")`])
      .catch(() => ({}));
    if (st[`get_delegate("${addr}")`] || (st[`get_session_fund("${addr}")`] || 0) > 0) {
      sessionNote('The offer already landed on-chain; finishing the setup\u2026');
      return;
    }
    localStorage.removeItem(SESSION_LS);
    fundingCancelled = true;
    sessionNote('Session key discarded. Nothing was approved.');
  };
}

// the offer lives in contract state, so the wait survives app switches and
// reloads: poll the escrow (or an already-completed binding) until it shows
async function awaitOffer(addr, rounds, need) {
  fundingCancelled = false;
  for (let i = 0; i < rounds; i++) {
    if (fundingCancelled) return false;
    try {
      const st = await batchCalls([`get_delegate("${addr}")`, `get_session_fund("${addr}")`]);
      if (st[`get_delegate("${addr}")`] || (st[`get_session_fund("${addr}")`] || 0) >= need) return true;
    } catch { /* transient read failure; keep waiting */ }
    await new Promise(r => setTimeout(r, 3000));
  }
  return false;
}

// the session key's first promptless act: bind to the offering main wallet
// and withdraw the escrowed float in the same tx. Seen in the wild: the very
// first nano tx on a freshly-synced empty wallet can stall inside the lib —
// a reopened wallet signs the same tx instantly, so time out and retry once.
async function bindSession(sw, addr, words) {
  const q = await batchCalls([`get_delegate("${addr}")`, `get_session_fund("${addr}")`]);
  if (q[`get_delegate("${addr}")`]) return sw; // an earlier half-run already bound it
  const escrow = q[`get_session_fund("${addr}")`] || 0;
  const actions = escrow > 0
    ? [{ type: 'withdrawal', token: HTR, amount: escrow, address: addr }] : [];
  const attempt = w => w.executeNano('accept_session', [], actions);
  let hash;
  try {
    ({ hash } = await Promise.race([
      attempt(sw),
      new Promise((_, rej) => setTimeout(() => rej(new Error('bind stalled')), 45_000)),
    ]));
  } catch (e) {
    if (!words) throw e;
    await sw.disconnect().catch(() => {});
    sw = await openSessionWallet(words, sw.mainAddr);
    ({ hash } = await attempt(sw));
  }
  await waitForExecution(hash, () => {});
  return sw;
}

async function resumeSession() {
  const raw = localStorage.getItem(SESSION_LS);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved.funding) {
      resumeOfferWait(saved);  // background: never blocks boot or wallet restore
      return;
    }
    const sw = await openSessionWallet(saved.words, saved.mainAddr);
    // a session saved before the v4 cutover has no on-chain binding: it can
    // only play as its own address, never as the saved main
    try {
      const c = `get_delegate("${sw.address}")`;
      sw.unbound = !(await batchCalls([c]))[c];
    } catch { sw.unbound = false; /* transient read: assume bound, reads self-correct */ }
    S.wallet = sw;
    S.addr = sw.address;
    if (sw.unbound) {
      ribbon('This quick play session is from the old realm and plays as its own '
        + 'identity; see QUICK PLAY before ending it.');
      track('session_unbound_legacy', {});
    }
    await silentRefresh();
  } catch (e) {
    console.warn('session resume failed:', e);
  }
}

async function resumeOfferWait(saved) {
  try {
    const need = saved.funding;
    const addr = saved.addr
      || await window.WALLETS.SessionWallet.addressFor(saved.words);
    const st = await batchCalls([`get_delegate("${addr}")`, `get_session_fund("${addr}")`])
      .catch(() => ({}));
    if (!st[`get_delegate("${addr}")`] && (st[`get_session_fund("${addr}")`] || 0) < need) {
      ribbon('An unfinished session awaits its wallet approval: open QUICK PLAY to finish or discard it');
      const ok = await awaitOffer(addr, 600, need);
      if (!ok) return;  // the key stays saved; the next visit tries again
    }
    if (S.sessionStarting || (S.wallet && S.wallet.mode === 'session')) return;
    ribbon('Offer found; finishing your session…');
    let sw = await openSessionWallet(saved.words, saved.mainAddr);
    sw = await bindSession(sw, addr, saved.words);
    localStorage.setItem(SESSION_LS, JSON.stringify(
      { words: saved.words, mainAddr: saved.mainAddr, addr }));
    if (S.wallet) S.mainWallet = S.wallet;  // e.g. a silently restored pairing
    S.wallet = sw;
    S.addr = sw.address;
    track('session_start', { funder: 'resumed-offer' });
    ribbon('The offer arrived: your session is ready', 'level', 'coin');
    $('overlay').hidden = true;
    await silentRefresh();
  } catch (e) {
    // the record stays saved; syncing is retried on the next visit
    ribbon('Your session key is safe; reload the game to finish the setup');
    console.warn('resume offer failed:', e);
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
  S.wallet = null; S.addr = null; S.htr = 0;
  S.ember = 0; S.wins = 0; S.prevWins = undefined; S.selected.clear();
  for (const c of S.cards.values()) c.mine = false;
  localStorage.removeItem('gacha_wallet');
  $('overlay').hidden = true;
  render();
}

$('walletBtn').onclick = () => {
  $('connectMsg').textContent = S.addr ? `Connected: ${S.wallet.label} · ${S.addr}` : '';
  syncSessionBox();
  // warm the WalletConnect bundle and discover the MetaMask provider while the
  // player reads the options, so whichever they pick opens without our delay
  if (!S.addr) { window.WALLETS.prefetchWc(); window.WALLETS.prefetchSnap(); }
  showStage('stageConnect');
};
$('disconnectBtn').onclick = disconnectWallet;
$('setNameBtn').onclick = openName;
$('sessionStartBtn').onclick = startSession;
// a one-time nudge after a first-ever wallet connect: glow quick play and tag
// it "recommended", then fade out. Shown once per device, cleared on engagement.
function showQpHint() {
  if (localStorage.getItem('emberfall_qp_hinted')) return;
  localStorage.setItem('emberfall_qp_hinted', '1');
  S.qpBeckon = true;
  render();
  setTimeout(() => { S.qpBeckon = false; render(); }, 18000);
}
function clearQpHint() {
  if (!S.qpBeckon) return;
  S.qpBeckon = false;
  render();
}
$('headerSessionBtn').onclick = () => {
  clearQpHint();
  $('walletBtn').onclick();
  if (S.wallet?.mode !== 'session') startSession();
};
$('sessionTopupBtn').onclick = topUpSession;
$('sessionEndBtn').onclick = endSession;
document.querySelectorAll('.connect-opt').forEach(el => el.onclick = () => connectWallet(el.dataset.wallet));
for (const id of ['errCloseBtn', 'duelCloseBtn', 'connectCloseBtn', 'pickCloseBtn', 'temperCancel', 'dressCloseBtn', 'nameCancel', 'cardCloseBtn'])
  $(id).onclick = () => { $('overlay').hidden = true; };
$('nameClaimBtn').onclick = claimName;
// the card, wallet, and reveal views close like any lightbox: Escape or a
// click outside (a dismissed reveal keeps the champion under New champions)
/* Every dialog closes on Escape or a click outside it — an explanation the
   player has read, or a chooser they thought better of, should never need
   its one small button hunted down. The exception is stageWait: a
   transaction is in flight behind it and hiding that would lose the thread. */
const DISMISSABLE = ['stageCard', 'stageConnect', 'stageReveal', 'stageError',
  'stageDuel', 'stagePick', 'stageTemper', 'stageDress', 'stageName'];
const dismissible = () => DISMISSABLE.some(id => $(id) && !$(id).hidden);
function dismissLightbox() {
  const wasReveal = !$('stageReveal').hidden;
  $('overlay').hidden = true;
  if (wasReveal) revealDismissed();
}
/* On a tall dialog the strip of screen outside it can be 70px, so "click
   away to close" needs the dialog's own inert space to count as well: its
   heading, the gaps between cards, the room under the buttons. Anything you
   can actually act on is excluded, and the card sheet, the connect view and
   the name form keep outside-only dismissal so reading or typing in them
   cannot close them by accident. */
const INERT_STAGES = ['stageError', 'stageDuel', 'stagePick', 'stageTemper', 'stageDress'];
const clickedInertSpace = e =>
  INERT_STAGES.some(id => $(id) && !$(id).hidden && e.target.closest('#' + id))
  && !e.target.closest('button, a, input, select, textarea, label, summary, .card, .mini-btn');

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('overlay').hidden) {
    if (dismissible()) dismissLightbox();
    return;                       // a dialog takes the key before the board
  }
  // champions picked for a fusion let go on Escape, the way any selection does
  if (S.selected.size || S.fuseMode) {
    S.selected.clear();
    S.fuseMode = false;
    render();
  }
});
$('overlay').addEventListener('click', e => {
  if (!dismissible()) return;
  if (!e.target.closest('.stage') || clickedInertSpace(e)) dismissLightbox();
});
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

const THEME_LS = 'emberfall_theme';
function syncThemeBtn() {
  const light = document.body.classList.contains('theme-light');
  const b = $('themeBtn');
  b.title = light ? 'Dark mode' : 'Light mode';
  b.innerHTML = `<svg class="g"><use href="#g-${light ? 'moon' : 'sun'}"/></svg>`;
  document.querySelector('meta[name=theme-color]')
    ?.setAttribute('content', light ? '#f0dc9e' : '#0b0a08');
}
$('themeBtn').onclick = () => {
  const light = document.body.classList.toggle('theme-light');
  try { localStorage.setItem(THEME_LS, light ? 'light' : 'dark'); } catch { }
  syncThemeBtn();
  track('theme', { mode: light ? 'light' : 'dark' });
};
syncThemeBtn();

document.querySelectorAll('.tab').forEach(el => el.onclick = () => {
  track('tab_view', { tab: el.dataset.tab });
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === el));
  for (const p of ['collection', 'farm', 'arena', 'market', 'progress', 'learn']) $('pane-' + p).hidden = p !== el.dataset.tab;
});
document.addEventListener('click', async e => {
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
    incoming.src = 'cards/' + slugOf(name) + '-440.webp';
    incoming.onload = () => {
      $('showA').classList.toggle('on', front);
      $('showB').classList.toggle('on', !front);
      $('showName').textContent = name;
      const st = $('showStation');
      st.textContent = `${meta.station} · ${meta.type}`;
      st.style.color = t.color;
      localStorage.setItem(HERO_LS, '1');
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
  // dev-only main wallet (?devmain=1): a browser-held key standing in for
  // Snap/WC on realms those wallets cannot reach (testnet-playground)
  if (new URLSearchParams(location.search).has('devmain') && !savedSession) {
    try {
      let words = localStorage.getItem('emberfall_dev_main');
      if (!words) {
        await new Promise(r => { window.WALLETS.prefetchSession(); r(); });
        words = await window.WALLETS.SessionWallet.create();
        localStorage.setItem('emberfall_dev_main', words);
      }
      const w = await window.WALLETS.DevMainWallet.open(words);
      S.wallet = w;
      S.addr = w.address;
      console.log('dev main wallet:', w.address);
    } catch (e) { console.warn('dev main failed:', e); }
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
    await silentRefresh();
  }
  S.restoring = false;
  render();
})();
/* Watch rather than poll. /api/pulse is a few bytes served from the
   server's own 15s chain poll, so this can run often: another player's
   listing, duel or summon shows up within seconds, and a quiet realm costs
   almost nothing. The 45s sweep stays as a backstop. */
let lastPulse = null;
async function watchPulse() {
  if (document.hidden) return;
  try {
    const p = await (await fetch('/api/pulse', { signal: AbortSignal.timeout(8000) })).json();
    const key = `${p.duels}|${p.listings}|${p.swaps}|${p.cards}|${p.feed}`;
    if (lastPulse === null) { lastPulse = key; return; }
    if (key !== lastPulse) {
      lastPulse = key;
      await silentRefresh();          // no ribbons for someone else's deed
    }
  } catch { /* the backstop below still runs */ }
}
setInterval(watchPulse, 6000);
setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 45000);
// coming back to the tab should never show a stale realm
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { lastPulse = null; refresh().catch(() => {}); }
});

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

