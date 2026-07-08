/* GachaArena frontend. Reads chain state via /node proxy; writes via the
   selected wallet adapter (demo proxy, MetaMask Snap, or WalletConnect). */

const NC = window.GAME.nc;
const GEMS = window.GAME.gems;
const HTR = '00';
const CARD_AMT = 100; // one card = 100 base units ('1.00')

const TIERS = [
  { name: 'Common', color: 'var(--common)', pct: '60%', fallback: '🪙' },
  { name: 'Rare', color: 'var(--rare)', pct: '30%', fallback: '💠' },
  { name: 'Epic', color: 'var(--epic)', pct: '9%', fallback: '🔮' },
  { name: 'Legendary', color: 'var(--legendary)', pct: '1%', fallback: '🌟' },
];
const EMOJI = {
  'Pixel Slime': '🟢', 'Rusty Dagger': '🗡️', 'Storm Falcon': '🦅',
  'Crystal Golem': '🗿', 'Shadow Dragon': '🐉', 'Genesis Phoenix': '🔥',
  'Moss Snail': '🐌', 'Tin Knight': '🛡️', 'Ember Fox': '🦊', 'Void Kraken': '🐙',
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

async function loadMine() {
  if (!S.wallet) return;
  S.htr = await S.wallet.htrBalance().catch(() => 0);
  S.gemsWallet = await S.wallet.tokenBalance(GEMS).catch(() => 0);
  for (const c of S.cards.values()) {
    if (c.tier < 0) { c.mine = false; continue; }
    if (c.pending || c.staker) { c.mine = false; continue; } // in contract custody
    c.mine = (await S.wallet.tokenBalance(c.uid).catch(() => 0)) > 0;
  }
}

async function refresh() {
  await loadContract();
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

  const canPull = S.addr && S.pullPrice != null && S.htr >= S.pullPrice && !S.busy;
  $('pullBtn').disabled = !canPull;
  $('pullCost').textContent = S.pullPrice != null ? fmtHtr(S.pullPrice) : '…';
  $('pullNote').innerHTML = !S.addr ? 'Connect a wallet to play.' :
    S.htr < (S.pullPrice ?? 0) ? `Not enough HTR — <a href="https://faucet.hathor.dev" target="_blank">faucet</a> → <span class="mono">${S.addr}</span>` :
    'Cards are minted onchain the moment your pull confirms (~30–90s).';

  $('statsRow').innerHTML = [
    ['Total pulls', S.totalPulls],
    ['GEMS ledger', fmtGems(S.gemsLedger)],
    ['GEMS in wallet', fmtGems(S.gemsWallet)],
    ['Duel wins', S.wins],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  // collection
  const mine = [...S.cards.values()].filter(c => c.mine);
  $('collectionCards').innerHTML = mine.map(c => cardBox(c, `
    <div class="row-btns">
      <button class="mini-btn" data-stake="${c.uid}">STAKE</button>
      <button class="mini-btn alt" data-duel="${c.uid}">DUEL</button>
    </div>`, true)).join('');
  $('collectionEmpty').hidden = mine.length > 0;

  const pend = [...S.cards.values()].filter(c => c.pending === S.addr);
  $('pendingCards').innerHTML = pend.map(c =>
    cardBox(c, `<button class="claim-mini" data-claim="${c.uid}">CLAIM</button>`)).join('');
  $('pendingEmpty').hidden = pend.length > 0;

  const selCount = S.selected.size;
  $('fuseBar').hidden = mine.length < 2;
  $('fuseHint').textContent = selCount === 2 ? 'Fuse into next tier:' : 'Select two cards of the same tier —';
  $('fuseBtn').disabled = !(selCount === 2 && sameTierSelected() && !S.busy);

  // farm
  const staked = [...S.cards.values()].filter(c => c.staker === S.addr);
  $('farmSummary').innerHTML = `
    <div class="stat"><div class="k">Ledger balance</div><div class="v">${fmtGems(S.gemsLedger)}</div>
      <div class="row-btns">
        <button class="mini-btn" id="wdGemsBtn" ${S.gemsLedger < 1 || S.busy ? 'disabled' : ''}>WITHDRAW ALL</button>
        <button class="mini-btn alt" id="depGemsBtn" ${S.gemsWallet < 1 || S.busy ? 'disabled' : ''}>DEPOSIT WALLET GEMS</button>
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
  bind('[data-claim]', u => doTx('Claiming card', 'claim_card', [], [wdAct(u, CARD_AMT)]));
  bind('[data-stake]', u => doTx('Staking card', 'stake', [], [depAct(u, CARD_AMT)]));
  bind('[data-unstake]', u => doTx('Unstaking card', 'unstake', [], [wdAct(u, CARD_AMT)]));
  bind('[data-claimgems]', u => doTx('Claiming GEMS', 'claim_gems', [u], []));
  bind('[data-duel]', u => openPick('create', u));
  bind('[data-acceptduel]', id => openPick('accept', Number(id)));
  bind('[data-cancelduel]', id => doTx('Cancelling duel', 'cancel_duel', [Number(id)], []));
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

async function doTx(label, method, args, actions, { silent } = {}) {
  if (S.busy || !S.wallet) return null;
  S.busy = true; render();
  if (!silent) { $('waitTitle').textContent = label + '…'; $('waitStatus').textContent = 'confirm in your wallet, then wait for a block'; showStage('stageWait'); }
  try {
    const { hash } = await S.wallet.executeNano(method, args, actions);
    if (!silent) $('waitStatus').textContent = `tx ${hash.slice(0, 16)}… waiting for confirmation`;
    await waitForExecution(hash, s => { $('waitTimer').textContent = s + 's'; });
    await refresh();
    if (!silent) $('overlay').hidden = true;
    return hash;
  } catch (e) {
    $('errTitle').textContent = label + ' failed';
    $('errMsg').textContent = e.message || String(e);
    showStage('stageError');
    return null;
  } finally { S.busy = false; render(); }
}

/* ---------------- flows ---------------- */

async function pull() {
  const before = new Set([...S.cards.values()].filter(c => c.pending === S.addr).map(c => c.uid));
  $('machine').classList.add('shaking');
  const winsBefore = S.wins;
  const hash = await doTx('Pulling', 'pull', [], [depAct(HTR, S.pullPrice)], { silent: false });
  $('machine').classList.remove('shaking');
  if (!hash) return;
  const won = [...S.cards.values()].find(c => c.pending === S.addr && !before.has(c.uid));
  if (!won) return;
  const t = TIERS[won.tier];
  $('prizeCard').style.setProperty('--rc', t.color);
  $('prizeEmoji').textContent = emojiFor(won);
  $('prizeTier').textContent = t.name;
  $('prizeName').textContent = won.name;
  $('prizePower').textContent = `⚡ POWER ${won.power}`;
  $('prizeUid').textContent = won.uid;
  $('revealClaimBtn').onclick = () => { doTx('Claiming card', 'claim_card', [], [wdAct(won.uid, CARD_AMT)]); };
  showStage('stageReveal');
  $('overlay').hidden = false;
}

async function fuse() {
  const [a, b] = [...S.selected];
  S.selected.clear();
  const before = new Set([...S.cards.values()].filter(c => c.pending === S.addr).map(c => c.uid));
  const hash = await doTx('Fusing', 'fuse', [], [depAct(a, CARD_AMT), depAct(b, CARD_AMT)]);
  if (!hash) return;
  const won = [...S.cards.values()].find(c => c.pending === S.addr && !before.has(c.uid));
  if (!won) return;
  const t = TIERS[won.tier];
  $('prizeCard').style.setProperty('--rc', t.color);
  $('prizeEmoji').textContent = emojiFor(won);
  $('prizeTier').textContent = `FUSED · ${t.name}`;
  $('prizeName').textContent = won.name;
  $('prizePower').textContent = `⚡ POWER ${won.power}`;
  $('prizeUid').textContent = won.uid;
  $('revealClaimBtn').onclick = () => { doTx('Claiming card', 'claim_card', [], [wdAct(won.uid, CARD_AMT)]); };
  showStage('stageReveal');
  $('overlay').hidden = false;
}

let pickCtx = null;
function openPick(kind, ref) {
  pickCtx = { kind, ref };
  const mine = [...S.cards.values()].filter(c => c.mine);
  if (!mine.length) { $('errTitle').textContent = 'No cards'; $('errMsg').textContent = 'You need a card in your wallet.'; showStage('stageError'); $('overlay').hidden = false; return; }
  $('pickTitle').textContent = kind === 'create' ? 'Create duel — confirm card & wager' : `Accept duel #${ref} — choose your fighter`;
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
    await doTx('Creating duel', 'create_duel', [wager], [depAct(uid, CARD_AMT)]);
  } else {
    const winsBefore = S.wins;
    const hash = await doTx('Duel', 'accept_duel', [ref], [depAct(uid, CARD_AMT)]);
    if (!hash) return;
    const won = S.wins > winsBefore;
    $('duelResult').innerHTML = won
      ? '<div class="duel-banner win">🏆 VICTORY</div><div class="wait-sub">Your card takes the pot. Claim it back in Collection.</div>'
      : '<div class="duel-banner lose">💀 DEFEAT</div><div class="wait-sub">The pot is gone, but your card returns — claim it in Collection.</div>';
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
  for (const p of ['collection', 'farm', 'arena']) $('pane-' + p).hidden = p !== el.dataset.tab;
});
$('wdGemsBtn')?.addEventListener('click', () => {});
document.addEventListener('click', e => {
  if (e.target.id === 'wdGemsBtn') doTx('Withdrawing GEMS', 'withdraw_gems', [], [wdAct(GEMS, S.gemsLedger)]);
  if (e.target.id === 'depGemsBtn') doTx('Depositing GEMS', 'deposit_gems', [], [depAct(GEMS, S.gemsWallet)]);
});
$('contractLink').innerHTML =
  `contract <a href="https://explorer.playground.testnet.hathor.network/transaction/${NC}" target="_blank">${NC}</a> · GachaArena · Hathor testnet-playground`;

(async () => {
  await loadContract().catch(e => { $('pullNote').textContent = 'Failed to load: ' + e.message; });
  render();
  if (localStorage.getItem('gacha_wallet') === 'demo') await connectWallet('demo');
})();
setInterval(() => { if (!S.busy) refresh().catch(() => {}); }, 45000);
