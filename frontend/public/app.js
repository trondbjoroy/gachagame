/* Hathor Gacha frontend — talks to local wallet-headless via /api proxy
   and to the playground fullnode via /node proxy. */

const NC = '00afd03115df73ad6aee7c168284144702a70e5d8e2acd820591d36fb76e05fb';
const WALLET_ID = 'player';
const HTR = '00';

const TIERS = [
  { name: 'Common', color: 'var(--common)', key: 0 },
  { name: 'Rare', color: 'var(--rare)', key: 1 },
  { name: 'Epic', color: 'var(--epic)', key: 2 },
  { name: 'Legendary', color: 'var(--legendary)', key: 3 },
];
const EMOJI = {
  'Pixel Slime': '🟢', 'Rusty Dagger': '🗡️', 'Storm Falcon': '🦅',
  'Crystal Golem': '🗿', 'Shadow Dragon': '🐉', 'Genesis Phoenix': '🔥',
  'Moss Snail': '🐌', 'Tin Knight': '🛡️', 'Ember Fox': '🦊', 'Void Kraken': '🐙',
};
const emojiFor = name => EMOJI[name] || '🎁';
const fmtHtr = cents => (cents / 100).toFixed(2) + ' HTR';
const $ = id => document.getElementById(id);

const state = {
  address: null,
  htr: 0,
  pullPrice: null,
  weights: [6000, 3000, 900, 100],
  poolSizes: [0, 0, 0, 0],
  totalPulls: 0,
  prizes: [],        // {uid, name, tier, pendingFor, ownedByMe}
  busy: false,
};

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    ...opts,
    headers: { 'x-wallet-id': WALLET_ID, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return r.json();
}
async function node(path) {
  const r = await fetch('/node' + path);
  return r.json();
}
const ncState = qs => node(`/nano_contract/state?id=${NC}&` + qs);

/* ---------------- data loading ---------------- */

async function loadContract() {
  const base = await ncState(
    'balances[]=__all__&fields[]=total_pulls&fields[]=pull_price' +
    '&calls[]=' + encodeURIComponent('get_pool_size(0)') +
    '&calls[]=' + encodeURIComponent('get_pool_size(1)') +
    '&calls[]=' + encodeURIComponent('get_pool_size(2)') +
    '&calls[]=' + encodeURIComponent('get_pool_size(3)')
  );
  state.pullPrice = base.fields.pull_price.value;
  state.totalPulls = base.fields.total_pulls.value;
  state.poolSizes = [0, 1, 2, 3].map(i => base.calls[`get_pool_size(${i})`].value);

  const uids = Object.keys(base.balances).filter(u => u !== HTR);
  if (uids.length) {
    const calls = uids.flatMap(u => [
      `get_prize_name("${u}")`, `get_prize_tier("${u}")`, `get_pending_winner("${u}")`,
    ]);
    const qs = calls.map(c => 'calls[]=' + encodeURIComponent(c)).join('&');
    const info = await ncState(qs);
    state.prizes = uids.map(u => ({
      uid: u,
      name: info.calls[`get_prize_name("${u}")`].value,
      tier: info.calls[`get_prize_tier("${u}")`].value,
      pendingFor: info.calls[`get_pending_winner("${u}")`].value,
      ownedByMe: false,
    }));
  }
}

async function loadWallet() {
  const [addr, bal] = await Promise.all([api('/wallet/address?index=0'), api('/wallet/balance')]);
  state.address = addr.address;
  state.htr = bal.available;
  await Promise.all(state.prizes.map(async p => {
    const b = await api(`/wallet/balance?token=${p.uid}`);
    p.ownedByMe = (b.available || 0) > 0;
  }));
}

async function refresh() {
  await loadContract();
  await loadWallet();
  render();
}

/* ---------------- rendering ---------------- */

function render() {
  $('walletAddr').textContent = state.address ? state.address.slice(0, 10) + '…' + state.address.slice(-6) : '…';
  $('walletHtr').textContent = fmtHtr(state.htr);

  const wsum = state.weights.reduce((a, b) => a + b, 0);
  $('odds').innerHTML = TIERS.map((t, i) =>
    `<div class="odd"><span class="swatch" style="background:${t.color}"></span>
     <b style="color:${t.color}">${t.name}</b>
     <span class="pct">${(state.weights[i] / wsum * 100).toFixed(1)}%</span>
     <span class="left">${state.poolSizes[i]} left</span></div>`).join('');

  const prizesLeft = state.poolSizes.reduce((a, b) => a + b, 0);
  const canAfford = state.pullPrice != null && state.htr >= state.pullPrice;
  const btn = $('pullBtn');
  btn.disabled = state.busy || !canAfford || prizesLeft === 0 || state.pullPrice == null;
  $('pullCost').textContent = state.pullPrice != null ? fmtHtr(state.pullPrice) : '…';
  $('pullNote').innerHTML =
    prizesLeft === 0 ? 'The machine is empty — the operator needs to restock.' :
    !canAfford && state.pullPrice != null
      ? `Not enough HTR — grab a drip from the <a href="https://faucet.hathor.dev" target="_blank">playground faucet</a> and send it to <span class="mono">${state.address || ''}</span>`
      : `${prizesLeft} prize${prizesLeft === 1 ? '' : 's'} inside · draws settle on the next block (~30–90s)`;

  $('statsRow').innerHTML = [
    ['Total pulls', state.totalPulls],
    ['Prizes inside', prizesLeft],
    ['Pull price', state.pullPrice != null ? fmtHtr(state.pullPrice) : '…'],
    ['Your balance', fmtHtr(state.htr)],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  const mine = p => p.pendingFor === state.address;
  const pending = state.prizes.filter(mine);
  $('pendingSection').hidden = pending.length === 0;
  $('pendingCards').innerHTML = pending.map(p => prizeCard(p, true)).join('');

  const owned = state.prizes.filter(p => p.ownedByMe);
  $('collectionCards').innerHTML = owned.map(p => prizeCard(p, false)).join('');
  $('collectionEmpty').hidden = owned.length > 0;

  document.querySelectorAll('[data-claim]').forEach(b =>
    b.addEventListener('click', () => claim(b.dataset.claim, b)));
}

function prizeCard(p, claimable) {
  const t = TIERS[p.tier] || TIERS[0];
  return `<div class="card" style="--rc:${t.color}">
    <div class="emoji">${emojiFor(p.name)}</div>
    <div class="name">${p.name}</div>
    <div class="tier">${t.name}</div>
    <div class="uid">${p.uid.slice(0, 24)}…</div>
    ${claimable ? `<button class="claim-mini" data-claim="${p.uid}">CLAIM</button>` : ''}
  </div>`;
}

/* ---------------- tx helpers ---------------- */

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
      throw new Error('contract rejected the call (' + logs.nc_execution + ')');
    }
  }
}

/* ---------------- pull flow ---------------- */

async function pull() {
  if (state.busy) return;
  state.busy = true;
  render();
  $('machine').classList.add('shaking');

  const before = new Set(state.prizes.filter(p => p.pendingFor === state.address).map(p => p.uid));
  showStage('stageWait');
  $('overlay').hidden = false;

  try {
    const resp = await api('/wallet/nano-contracts/execute', {
      method: 'POST',
      body: JSON.stringify({
        nc_id: NC, method: 'pull', address: state.address,
        data: { actions: [{ type: 'deposit', token: HTR, amount: state.pullPrice }] },
      }),
    });
    if (!resp.success) throw new Error(resp.error || 'wallet rejected the transaction');
    $('waitStatus').textContent = 'tx ' + resp.hash.slice(0, 18) + '… waiting for block confirmation';
    await waitForExecution(resp.hash, s => { $('waitTimer').textContent = s + 's'; });

    await loadContract();
    const won = state.prizes.find(p => p.pendingFor === state.address && !before.has(p.uid));
    await loadWallet();
    if (!won) throw new Error('could not locate the won prize (refresh and check "waiting to be claimed")');

    const t = TIERS[won.tier] || TIERS[0];
    const card = $('prizeCard');
    card.style.setProperty('--rc', t.color);
    $('prizeEmoji').textContent = emojiFor(won.name);
    $('prizeTier').textContent = t.name;
    $('prizeName').textContent = won.name;
    $('prizeUid').textContent = won.uid;
    $('revealClaimBtn').onclick = () => { $('overlay').hidden = true; claim(won.uid); };
    showStage('stageReveal');
  } catch (e) {
    $('errTitle').textContent = 'Pull failed';
    $('errMsg').textContent = e.message || String(e);
    showStage('stageError');
  } finally {
    $('machine').classList.remove('shaking');
    state.busy = false;
    render();
  }
}

/* ---------------- claim flow ---------------- */

async function claim(uid, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'CLAIMING…'; }
  try {
    const resp = await api('/wallet/nano-contracts/execute', {
      method: 'POST',
      body: JSON.stringify({
        nc_id: NC, method: 'claim', address: state.address,
        data: { actions: [{ type: 'withdrawal', token: uid, amount: 1, address: state.address }] },
      }),
    });
    if (!resp.success) throw new Error(resp.error || 'wallet rejected the claim');
    // NFT is spendable as soon as the tx propagates; contract state catches up next block
    const p = state.prizes.find(x => x.uid === uid);
    if (p) { p.ownedByMe = true; p.pendingFor = null; }
    render();
  } catch (e) {
    alert('Claim failed: ' + (e.message || e));
    render();
  }
}

/* ---------------- misc ---------------- */

function showStage(id) {
  for (const s of ['stageWait', 'stageReveal', 'stageError']) $(s).hidden = s !== id;
}

$('pullBtn').addEventListener('click', pull);
$('revealCloseBtn').addEventListener('click', () => { $('overlay').hidden = true; });
$('errCloseBtn').addEventListener('click', () => { $('overlay').hidden = true; });
$('contractLink').innerHTML =
  `contract <a href="https://explorer.playground.testnet.hathor.network/transaction/${NC}" target="_blank">${NC}</a> · GachaMachine blueprint · Hathor testnet-playground`;

refresh().catch(e => { $('pullNote').textContent = 'Failed to load: ' + e.message; });
setInterval(() => { if (!state.busy) refresh().catch(() => {}); }, 30000);
