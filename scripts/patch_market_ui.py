import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

s = open("frontend/public/app.js", encoding="utf-8").read()

s = s.replace("const NC = window.GAME.nc;", "const NC = window.GAME.nc;\nconst MKT = window.GAME.market; // {nc, blueprint} or null")
s = s.replace("  duels: [], selected: new Set(), busy: false,",
              "  duels: [], selected: new Set(), busy: false,\n  listings: [], swaps: [], marketFunds: 0,")

market_load = """async function loadMarket() {
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

async function loadMine() {"""
assert "async function loadMine() {" in s
s = s.replace("async function loadMine() {", market_load, 1)

s = s.replace("""async function refresh() {
  await loadContract();
  await loadMine();
  render();
}""", """async function refresh() {
  await loadContract();
  await loadMarket().catch(() => {});
  await loadMine();
  render();
}""")
s = s.replace("if (c.pending || c.staker) { c.mine = false; continue; } // in contract custody",
              "if (c.pending || c.staker || c.marketPending) { c.mine = false; continue; } // in custody")

old_btns = """      <button class="mini-btn" data-stake="${c.uid}">STAKE</button>
      <button class="mini-btn alt" data-duel="${c.uid}">DUEL</button>"""
new_btns = old_btns + """
      ${MKT ? `<button class="mini-btn alt" data-sell="${c.uid}">SELL</button>
      <button class="mini-btn alt" data-trade="${c.uid}">TRADE</button>` : ''}"""
assert old_btns in s
s = s.replace(old_btns, new_btns)

anchor = """  $('duelEmpty').hidden = S.duels.length > 0;

  bindListActions();"""
market_render = """  $('duelEmpty').hidden = S.duels.length > 0;

  if (MKT) {
    $('marketFunds').textContent = `Sale proceeds: ${fmtHtr(S.marketFunds)}`;
    $('wdFundsBtn').hidden = S.marketFunds < 1;
    const cardBit = uid => {
      const c = S.cards.get(uid);
      const t = TIERS[c?.tier ?? 0];
      return `<span class="duel-emoji">${c ? emojiFor(c) : '\\u2754'}</span>
        <div class="duel-info"><b>${c?.name ?? '?'}</b> <span style="color:${t.color}">\\u26a1${c?.power ?? '?'}</span>`;
    };
    $('listingList').innerHTML = S.listings.map(l => `
      <div class="duel ${l.status}">${cardBit(l.card)}
        <div class="duel-meta">#${l.id} \\u00b7 ${fmtHtr(l.price)} \\u00b7 by ${l.seller === S.addr ? 'you' : short(l.seller || '?')}</div></div>
        ${l.status === 'open' ? (l.seller === S.addr
          ? `<button class="mini-btn alt" data-cancellisting="${l.id}">CANCEL</button>`
          : `<button class="mini-btn" data-buy="${l.id}" data-price="${l.price}">BUY</button>`)
          : '<span class="duel-done">sold</span>'}
      </div>`).join('');
    $('listingEmpty').hidden = S.listings.length > 0;
    $('swapList').innerHTML = S.swaps.map(w => {
      const wantMine = S.cards.get(w.want)?.mine;
      return `<div class="duel ${w.status}">${cardBit(w.give)}
        <div class="duel-meta">#${w.id} \\u00b7 wants ${S.cards.get(w.want)?.name ?? w.want.slice(0, 10)} \\u00b7 by ${w.maker === S.addr ? 'you' : short(w.maker || '?')}</div></div>
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

  bindListActions();"""
assert anchor in s
s = s.replace(anchor, market_render)

old_bind = "  bind('[data-cancelduel]', id => doTx('Cancelling duel', 'cancel_duel', [Number(id)], []));"
new_bind = old_bind + """
  bind('[data-sell]', u => {
    const p = Math.floor(Number(prompt('Ask price in HTR cents (e.g. 5 = 0.05 HTR):', '5')));
    if (p > 0) doTx('Listing card', 'list_card', [p], [depAct(u, CARD_AMT)], { target: MKT });
  });
  bind('[data-trade]', u => {
    const want = (prompt('Token UID of the card you want in return:') || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(want)) doTx('Offering swap', 'offer_swap', [want], [depAct(u, CARD_AMT)], { target: MKT });
    else if (want) alert('That is not a valid 64-hex token UID.');
  });
  bind('[data-cancellisting]', id => doTx('Cancelling listing', 'cancel_listing', [Number(id)], [], { target: MKT }));
  bind('[data-cancelswap]', id => doTx('Cancelling swap', 'cancel_swap', [Number(id)], [], { target: MKT }));
  bind('[data-mclaim]', u => doTx('Claiming card', 'claim_card', [], [wdAct(u, CARD_AMT)], { target: MKT }));
  document.querySelectorAll('[data-buy]').forEach(el => el.onclick = () =>
    doTx('Buying card', 'buy', [Number(el.dataset.buy)], [depAct(HTR, Number(el.dataset.price))], { target: MKT }));
  document.querySelectorAll('[data-acceptswap]').forEach(el => el.onclick = () =>
    doTx('Swapping', 'accept_swap', [Number(el.dataset.acceptswap)], [depAct(el.dataset.want, CARD_AMT)], { target: MKT }));"""
assert old_bind in s
s = s.replace(old_bind, new_bind)

s = s.replace("async function doTx(label, method, args, actions, { silent } = {}) {",
              "async function doTx(label, method, args, actions, { silent, target } = {}) {")
s = s.replace("const { hash } = await S.wallet.executeNano(method, args, actions);",
              "const { hash } = await S.wallet.executeNano(method, args, actions, target);")
s = s.replace("for (const p of ['collection', 'farm', 'arena']) $('pane-' + p).hidden = p !== el.dataset.tab;",
              "for (const p of ['collection', 'farm', 'arena', 'market']) $('pane-' + p).hidden = p !== el.dataset.tab;")
old_dep = "  if (e.target.id === 'depGemsBtn') doTx('Depositing GEMS', 'deposit_gems', [], [depAct(GEMS, S.gemsWallet)]);"
assert old_dep in s
s = s.replace(old_dep, old_dep + "\n  if (e.target.id === 'wdFundsBtn') doTx('Withdrawing funds', 'withdraw_funds', [], [wdAct(HTR, S.marketFunds)], { target: MKT });")
open("frontend/public/app.js", "w", encoding="utf-8", newline="\n").write(s)

# proxy
s = open("frontend/server.js", encoding="utf-8").read()
s = s.replace("const NC = '00cc50d78771c245e95f794bd7090d8009eae90b562c77a938ff53efca4d34f8';",
              "const NC = '00cc50d78771c245e95f794bd7090d8009eae90b562c77a938ff53efca4d34f8';\nconst MKT_NC = process.env.MARKET_NC || 'MARKET_NC_PLACEHOLDER';")
mkt_table = """const MKT_METHODS = {
  list_card:      { actions: [cardDep],  args: [v => Number.isInteger(v) && v > 0 && v <= MAX_DEPOSIT] },
  buy:            { actions: [htrDep],   args: [isSmallInt] },
  cancel_listing: { actions: [],         args: [isSmallInt] },
  offer_swap:     { actions: [cardDep],  args: [isHex64] },
  accept_swap:    { actions: [cardDep],  args: [isSmallInt] },
  cancel_swap:    { actions: [],         args: [isSmallInt] },
  claim_card:     { actions: [cardWd],   args: [] },
  withdraw_funds: { actions: [a => a.type === 'withdrawal' && a.token === '00' && Number.isInteger(a.amount) && a.amount > 0 && a.amount <= MAX_DEPOSIT && a.address === playerAddress], args: [] },
};

const METHODS = {
  pull:"""
assert "const METHODS = {\n  pull:" in s
s = s.replace("const METHODS = {\n  pull:", mkt_table)
old_v = """  if (body.nc_id !== NC) return 'unknown contract';
  if (!playerAddress) return 'wallet not ready, try again shortly';
  if (body.address !== playerAddress) return 'caller address not allowed';
  const spec = METHODS[body.method];"""
new_v = """  const table = body.nc_id === NC ? METHODS : (body.nc_id === MKT_NC ? MKT_METHODS : null);
  if (!table) return 'unknown contract';
  if (!playerAddress) return 'wallet not ready, try again shortly';
  if (body.address !== playerAddress) return 'caller address not allowed';
  const spec = table[body.method];"""
assert old_v in s
s = s.replace(old_v, new_v)
open("frontend/server.js", "w", encoding="utf-8", newline="\n").write(s)
print("app+proxy patched")
