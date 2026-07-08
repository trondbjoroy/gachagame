/* GachaArena frontend. Reads chain state via /node proxy; writes via the
   selected wallet adapter (demo proxy, MetaMask Snap, or WalletConnect). */

const NC = window.GAME.nc;
const MKT = window.GAME.market; // {nc, blueprint} or null
const GEMS = window.GAME.gems;
const HTR = '00';
const CARD_AMT = 100; // one card = 100 base units ('1.00')

const TIERS = [
  { name: 'Footman', color: 'var(--common)', pct: '60%', fallback: '🪓' },
  { name: 'Knight', color: 'var(--rare)', pct: '30%', fallback: '🛡️' },
  { name: 'Highlord', color: 'var(--epic)', pct: '9%', fallback: '🏰' },
  { name: 'Sovereign', color: 'var(--legendary)', pct: '1%', fallback: '👑' },
];
const EMOJI = {
  'Pixel Slime': '🟢', 'Rusty Dagger': '🗡️', 'Storm Falcon': '🦅',
  'Crystal Golem': '🗿', 'Shadow Dragon': '🐉', 'Genesis Phoenix': '🔥',
  'Moss Snail': '🐌', 'Tin Knight': '🛡️', 'Ember Fox': '🦊', 'Void Kraken': '🐙',
  'Levy Spearman': '⚔️', 'Bog Witch': '🧙', 'Plague Rat': '🐀',
  'Raven Keeper': '🐦‍⬛', 'Heartwood Archer': '🏹',
  'Dire Wolf': '🐺', 'Barrow Wight': '💀',
  'The Winter Sovereign': '❄️',
};
const emojiFor = c => EMOJI[c.name] || TIERS[c.tier]?.fallback || '🎁';
const fmtHtr = c => (c / 100).toFixed(2) + ' HTR';
const fmtGems = c => (c / 100).toFixed(2) + ' GEMS';
const short = u => u.slice(0, 10) + '…';
const $ = id => document.getElementById(id);

const S = {
  wallet: null, addr: null, htr: 0, gemsWallet: 0,
  pullPrice: null, totalPulls: 0,
  cards: new Map(),      // uid -> {name,tier,power,pending,staker,mine,pendingGems}
  gemsLedger: 0, wins: 0,
  duels: [], selected: new Set(), busy: false,
  listings: [], swaps: [], marketFunds: 0,
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
    [`get_pending_owner("${u}")`, `get_staker("${u}")`]));
  const now = Math.floor(Date.now() / 1000);
  for (const u of live) {
    const c = S.cards.get(u);
    c.pending = dyn[`get_pending_owner("${u}")`] ?? null;
    c.staker = dyn[`get_staker("${u}")`] ?? null;
  }
  const stakedMine = live.filter(u => S.cards.get(u).staker === S.addr);
  if (stakedMine.length) {
    const pg = await batchCalls(stakedMine.map(u => `get_pending_gems("${u}", ${now})`));
    for (const u of stakedMine) S.cards.get(u).pendingGems = pg[`get_pending_gems("${u}", ${now})`] || 0;
  }

  if (S.addr) {
    const me = await batchCalls([`get_gems_balance("${S.addr}")`, `get_wins("${S.addr}")`]);
    S.gemsLedger = me[`get_gems_balance("${S.addr}")`] || 0;
    S.wins = me[`get_wins("${S.addr}")`] || 0;
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

async function refresh() {
  await loadContract();
  await loadMarket().catch(() => {});
  await loadMine();
  render();
}

/* ---------------- rendering ---------------- */

function cardBox(c, buttonsHtml, selectable) {
  const t = TIERS[c.tier] || TIERS[0];
  const sel = S.selected.has(c.uid) ? ' selected' : '';
  return `<div class="card${sel}" style="--rc:${t.color}" ${selectable ? `data-select="${c.uid}"` : ''}>
    <div class="emoji">${emojiFor(c)}</div>
    <div class="name">${c.name}</div>
    <div class="tier">${t.name} · ⚡${c.power}</div>
    <div class="uid">${c.uid.slice(0, 18)}…</div>
    ${buttonsHtml || ''}
  </div>`;
}

function render() {
  $('walletDot').className = 'dot' + (S.addr ? '' : ' off');
  $('walletAddr').textContent = S.addr ? `${S.wallet.label.split(' ')[0]} · ${short(S.addr)}` : 'Connect wallet';
  $('walletHtr').textContent = S.addr ? fmtHtr(S.htr) : '';

  $('odds').innerHTML = TIERS.map(t =>
    `<div class="odd"><span class="swatch" style="background:${t.color}"></span>
     <b style="color:${t.color}">${t.name}</b><span class="pct">${t.pct}</span></div>`).join('');

  const canPull = S.addr && S.pullPrice != null && S.htr >= S.pullPrice;
  $('pullBtn').disabled = !canPull;
  $('pullCost').textContent = S.pullPrice != null ? fmtHtr(S.pullPrice) : '…';
  $('pullNote').innerHTML = !S.addr ? 'Swear a wallet to your cause to play.' :
    S.htr < (S.pullPrice ?? 0) ? `Not enough HTR — <a href="https://faucet.hathor.dev" target="_blank">faucet</a> → <span class="mono">${S.addr}</span>` :
    'The Weaver binds a champion the moment the next block witnesses it (~30–90s).';

  $('statsRow').innerHTML = [
    ['Souls summoned', S.totalPulls],
    ['Gems in ledger', fmtGems(S.gemsLedger)],
    ['Gems in hand', fmtGems(S.gemsWallet)],
    ['Trials won', S.wins],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  // collection
  const mine = [...S.cards.values()].filter(c => c.mine);
  $('collectionCards').innerHTML = mine.map(c => cardBox(c, `
    <div class="row-btns">
      <button class="mini-btn" data-stake="${c.uid}">MINE</button>
      <button class="mini-btn alt" data-duel="${c.uid}">FIGHT</button>
      ${MKT ? `<button class="mini-btn alt" data-sell="${c.uid}">SELL</button>
      <button class="mini-btn alt" data-trade="${c.uid}">TRADE</button>` : ''}
    </div>`, true)).join('');
  $('collectionEmpty').hidden = mine.length > 0;

  const pend = [...S.cards.values()].filter(c => c.pending === S.addr);
  $('pendingCards').innerHTML = pend.map(c =>
    cardBox(c, `<button class="claim-mini" data-claim="${c.uid}">CLAIM</button>`)).join('');
  $('pendingEmpty').hidden = pend.length > 0;

  const selCount = S.selected.size;
  $('fuseBar').hidden = mine.length < 2;
  $('fuseHint').textContent = selCount === 2 ? 'Fuse into next tier:' : 'Select two cards of the same tier —';
  $('fuseBtn').disabled = !(selCount === 2 && sameTierSelected());

  // farm
  const staked = [...S.cards.values()].filter(c => c.staker === S.addr);
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
    </div>`)).join('');
  $('stakedEmpty').hidden = staked.length > 0;

  // arena
  $('duelList').innerHTML = S.duels.map(d => {
    const c = S.cards.get(d.card);
    const t = TIERS[c?.tier ?? 0];
    const mineD = d.challenger === S.addr;
    return `<div class="duel ${d.status}">
      <span class="duel-emoji">${c ? emojiFor(c) : '❔'}</span>
      <div class="duel-info">
        <b>${c?.name ?? '?'}</b> <span style="color:${t.color}">⚡${c?.power ?? '?'}</span>
        <div class="duel-meta">#${d.id} · wager ${fmtGems(d.wager)} · by ${mineD ? 'you' : short(d.challenger || '?')}</div>
      </div>
      ${d.status === 'open'
        ? (mineD
          ? `<button class="mini-btn alt" data-cancelduel="${d.id}">CANCEL</button>`
          : `<button class="mini-btn" data-acceptduel="${d.id}">FIGHT</button>`)
        : '<span class="duel-done">settled</span>'}
    </div>`;
  }).join('');
  $('duelEmpty').hidden = S.duels.length > 0;

  if (MKT) {
    $('marketFunds').textContent = `Sale proceeds: ${fmtHtr(S.marketFunds)}`;
    $('wdFundsBtn').hidden = S.marketFunds < 1;
    const cardBit = uid => {
      const c = S.cards.get(uid);
      const t = TIERS[c?.tier ?? 0];
      return `<span class="duel-emoji">${c ? emojiFor(c) : '\u2754'}</span>
        <div class="duel-info"><b>${c?.name ?? '?'}</b> <span style="color:${t.color}">\u26a1${c?.power ?? '?'}</span>`;
    };
    $('listingList').innerHTML = S.listings.map(l => `
      <div class="duel ${l.status}">${cardBit(l.card)}
        <div class="duel-meta">#${l.id} \u00b7 ${fmtHtr(l.price)} \u00b7 by ${l.seller === S.addr ? 'you' : short(l.seller || '?')}</div></div>
        ${l.status === 'open' ? (l.seller === S.addr
          ? `<button class="mini-btn alt" data-cancellisting="${l.id}">CANCEL</button>`
          : `<button class="mini-btn" data-buy="${l.id}" data-price="${l.price}">BUY</button>`)
          : '<span class="duel-done">sold</span>'}
      </div>`).join('');
    $('listingEmpty').hidden = S.listings.length > 0;
    $('swapList').innerHTML = S.swaps.map(w => {
      const wantMine = S.cards.get(w.want)?.mine;
      return `<div class="duel ${w.status}">${cardBit(w.give)}
        <div class="duel-meta">#${w.id} \u00b7 wants ${S.cards.get(w.want)?.name ?? w.want.slice(0, 10)} \u00b7 by ${w.maker === S.addr ? 'you' : short(w.maker || '?')}</div></div>
        ${w.status === 'open' ? (w.maker === S.addr
          ? `<button class="mini-btn alt" data-cancelswap="${w.id}">CANCEL</button>`
          : (wantMine ? `<button class="mini-btn" data-acceptswap="${w.id}" data-want="${w.want}">SWAP</button>` : '<span class="duel-done">need the wanted card</span>'))
          : '<span class="duel-done">done</span>'}
      </div>`;
    }).join('');
    $('swapEmpty').hidden = S.swaps.length > 0;
    const mpend = [...S.cards.values()].filter(c => c.marketPending === S.addr);
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
  bind('[data-claim]', u => doTx('Claiming champion', 'claim_card', [], [wdAct(u, CARD_AMT)]));
  bind('[data-stake]', u => doTx('Sending to the mines', 'stake', [], [depAct(u, CARD_AMT)]));
  bind('[data-unstake]', u => doTx('Recalling from the mines', 'unstake', [], [wdAct(u, CARD_AMT)]));
  bind('[data-claimgems]', u => doTx('Gathering gems', 'claim_gems', [u], []));
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
  bind('[data-trade]', u => {
    const want = (prompt('Token UID of the card you want in return:') || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(want)) doTx('Proposing trade', 'offer_swap', [want], [depAct(u, CARD_AMT)], { target: MKT });
    else if (want) alert('That is not a valid 64-hex token UID.');
  });
  bind('[data-cancellisting]', id => doTx('Leaving the stall', 'cancel_listing', [Number(id)], [], { target: MKT }));
  bind('[data-cancelswap]', id => doTx('Recanting the trade', 'cancel_swap', [Number(id)], [], { target: MKT }));
  bind('[data-mclaim]', u => doTx('Claiming champion', 'claim_card', [], [wdAct(u, CARD_AMT)], { target: MKT }));
  document.querySelectorAll('[data-buy]').forEach(el => el.onclick = () =>
    doTx('Buying champion', 'buy', [Number(el.dataset.buy)], [depAct(HTR, Number(el.dataset.price))], { target: MKT }));
  document.querySelectorAll('[data-acceptswap]').forEach(el => el.onclick = () =>
    doTx('Sealing the trade', 'accept_swap', [Number(el.dataset.acceptswap)], [depAct(el.dataset.want, CARD_AMT)], { target: MKT }));
}

const depAct = (token, amount) => ({ type: 'deposit', token, amount });
const wdAct = (token, amount) => ({ type: 'withdrawal', token, amount, address: S.addr });

/* ---------------- tx pipeline ---------------- */

async function waitForExecution(hash, onTick) {
  const start = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 5000));
    onTick?.(Math.round((Date.now() - start) / 1000));
    const tx = await node(`/transaction?id=${hash}`);
    const meta = tx.meta || {};
    if ((meta.voided_by || []).length) throw new Error('transaction was voided');
    if (!meta.first_block) continue;
    const logs = await node(`/nano_contract/logs?id=${hash}`);
    if (logs.nc_execution === 'success') return;
    if (logs.nc_execution && logs.nc_execution !== 'pending') {
      throw new Error(`contract rejected the call (${logs.nc_execution})`);
    }
  }
}

let txSeq = 0;
async function doTx(label, method, args, actions, { target } = {}) {
  if (!S.wallet) return null;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="t-spin"></span><div class="t-body"><b>${label}</b>
    <span class="t-sub">sign & push\u2026</span></div><span class="t-time mono"></span>`;
  $('txToasts').appendChild(el);
  const sub = el.querySelector('.t-sub');
  const tim = el.querySelector('.t-time');
  try {
    const { hash } = await S.wallet.executeNano(method, args, actions, target);
    sub.textContent = 'tx ' + hash.slice(0, 12) + '\u2026 confirming';
    await waitForExecution(hash, sec => { tim.textContent = sec + 's'; });
    el.classList.add('ok');
    sub.textContent = 'confirmed';
    setTimeout(() => el.remove(), 6000);
    await refresh();
    return hash;
  } catch (e) {
    el.classList.add('fail');
    let msg = e.message || String(e);
    if (/invalid blueprint|blueprint not found|nano contract does not exist/i.test(msg)) {
      msg += ' — your wallet is on a different Hathor network than this deployment. Use the Demo wallet for now (Snap/WalletConnect work once the game is deployed on public testnet/mainnet).';
    }
    sub.textContent = msg;
    el.insertAdjacentHTML('beforeend', '<button class="t-x">\u2715</button>');
    el.querySelector('.t-x').onclick = () => el.remove();
    refresh().catch(() => {});
    return null;
  }
}

/* ---------------- flows ---------------- */

async function pull() {
  const before = new Set([...S.cards.values()].filter(c => c.pending === S.addr).map(c => c.uid));
  $('machine').classList.add('shaking');
  const hash = await doTx('Summoning', 'pull', [], [depAct(HTR, S.pullPrice)]);
  $('machine').classList.remove('shaking');
  if (!hash) return;
  const won = [...S.cards.values()].find(c => c.pending === S.addr && !before.has(c.uid));
  if (!won) return;
  revealCard(won, TIERS[won.tier].name);
}

function revealCard(won, tierLabel) {
  const t = TIERS[won.tier] || TIERS[0];
  $('prizeCard').style.setProperty('--rc', t.color);
  $('prizeEmoji').textContent = emojiFor(won);
  $('prizeTier').textContent = tierLabel;
  $('prizeName').textContent = won.name;
  $('prizePower').textContent = `\u26a1 POWER ${won.power}`;
  $('prizeUid').textContent = won.uid;
  $('revealClaimBtn').onclick = () => { $('overlay').hidden = true; doTx('Claiming champion', 'claim_card', [], [wdAct(won.uid, CARD_AMT)]); };
  showStage('stageReveal');
}

async function fuse() {
  const [a, b] = [...S.selected];
  S.selected.clear();
  const before = new Set([...S.cards.values()].filter(c => c.pending === S.addr).map(c => c.uid));
  const hash = await doTx('Forging the Rite of Union', 'fuse', [], [depAct(a, CARD_AMT), depAct(b, CARD_AMT)]);
  if (!hash) return;
  const won = [...S.cards.values()].find(c => c.pending === S.addr && !before.has(c.uid));
  if (won) revealCard(won, `FUSED \u00b7 ${TIERS[won.tier].name}`);
}

let pickCtx = null;
function openPick(kind, ref) {
  pickCtx = { kind, ref };
  const mine = [...S.cards.values()].filter(c => c.mine);
  if (!mine.length) { $('errTitle').textContent = 'No cards'; $('errMsg').textContent = 'You hold no champion. Summon or claim one first.'; showStage('stageError'); $('overlay').hidden = false; return; }
  $('pickTitle').textContent = kind === 'create' ? 'Issue a challenge — choose your champion & wager' : `Answer challenge #${ref} — choose your champion`;
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
  if (kind === 'create') {
    const wager = Math.max(0, Number($('pickWager').value) || 0);
    if (wager > S.gemsLedger) { $('errTitle').textContent = 'Wager too high'; $('errMsg').textContent = `Ledger has ${fmtGems(S.gemsLedger)} — stake cards or deposit GEMS first.`; showStage('stageError'); $('overlay').hidden = false; return; }
    await doTx('Issuing challenge', 'create_duel', [wager], [depAct(uid, CARD_AMT)]);
  } else {
    const winsBefore = S.wins;
    const hash = await doTx('Trial by combat', 'accept_duel', [ref], [depAct(uid, CARD_AMT)]);
    if (!hash) return;
    const won = S.wins > winsBefore;
    $('duelResult').innerHTML = won
      ? '<div class="duel-banner win">⚔️ VICTORY</div><div class="wait-sub">The pot is yours. Your champion returns — claim them under Your Host.</div>'
      : '<div class="duel-banner lose">💀 DEFEAT</div><div class="wait-sub">The pot is lost, but your champion lives — claim them under Your Host.</div>';
    showStage('stageDuel');
    $('overlay').hidden = false;
  }
}

/* ---------------- wallet connect ---------------- */

async function connectWallet(kind) {
  $('connectMsg').textContent = 'connecting…';
  try {
    let w;
    if (kind === 'demo') w = new window.WALLETS.DemoWallet();
    else if (kind === 'snap') w = new window.WALLETS.SnapWallet();
    else w = new window.WALLETS.WcWallet();
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
    localStorage.setItem('gacha_wallet', kind === 'demo' ? 'demo' : '');
    $('overlay').hidden = true;
    $('wcPair').hidden = true;
    await refresh();
  } catch (e) {
    $('connectMsg').textContent = e.message || String(e);
  }
}

/* ---------------- misc / boot ---------------- */

function showStage(id) {
  for (const s of ['stageWait', 'stageReveal', 'stageDuel', 'stageError', 'stageConnect', 'stagePick'])
    $(s).hidden = s !== id;
  $('overlay').hidden = false;
}

$('pullBtn').onclick = pull;
$('fuseBtn').onclick = fuse;
$('newDuelBtn').onclick = () => openPick('create', null);
$('walletBtn').onclick = () => { $('connectMsg').textContent = ''; showStage('stageConnect'); };
document.querySelectorAll('.connect-opt').forEach(el => el.onclick = () => connectWallet(el.dataset.wallet));
for (const id of ['revealCloseBtn', 'errCloseBtn', 'duelCloseBtn', 'connectCloseBtn', 'pickCloseBtn'])
  $(id).onclick = () => { $('overlay').hidden = true; };
document.querySelectorAll('.tab').forEach(el => el.onclick = () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === el));
  for (const p of ['collection', 'farm', 'arena', 'market', 'learn']) $('pane-' + p).hidden = p !== el.dataset.tab;
});
$('wdGemsBtn')?.addEventListener('click', () => {});
document.addEventListener('click', e => {
  if (e.target.id === 'wdGemsBtn') doTx('Drawing gems from the ledger', 'withdraw_gems', [], [wdAct(GEMS, S.gemsLedger)]);
  if (e.target.id === 'depGemsBtn') doTx('Entrusting gems to the ledger', 'deposit_gems', [], [depAct(GEMS, S.gemsWallet)]);
  if (e.target.id === 'wdFundsBtn') doTx('Collecting your coin', 'withdraw_funds', [], [wdAct(HTR, S.marketFunds)], { target: MKT });
});
$('contractLink').innerHTML =
  `contract <a href="https://explorer.playground.testnet.hathor.network/transaction/${NC}" target="_blank">${NC}</a> · GachaArena · Hathor testnet-playground`;

(async () => {
  await loadContract().catch(e => { $('pullNote').textContent = 'Failed to load: ' + e.message; });
  render();
  if (localStorage.getItem('gacha_wallet') === 'demo') await connectWallet('demo');
})();
setInterval(() => refresh().catch(() => {}), 45000);
