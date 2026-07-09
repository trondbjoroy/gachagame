import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()
assert "isMine" not in s, "already applied"

old = "const short = u => u.slice(0, 10) + '…';"
assert old in s, "short helper"
s = s.replace(old, old + """
const myAddrs = () => new Set([S.addr, S.wallet?.mainAddr].filter(Boolean));
const isMine = a => !!a && myAddrs().has(a);""")

# --- Pit ---
old = "    const mineD = d.challenger === S.addr;"
assert old in s, "duel mineD"
s = s.replace(old, "    const mineD = isMine(d.challenger);\n    const cancellable = d.challenger === S.addr;")

old = """        ? (mineD
          ? `<button class="mini-btn alt" data-cancelduel="${d.id}">CANCEL</button>`
          : `<button class="mini-btn" data-acceptduel="${d.id}">FIGHT</button>`)"""
assert old in s, "duel buttons"
s = s.replace(old, """        ? (mineD
          ? (cancellable
            ? `<button class="mini-btn alt" data-cancelduel="${d.id}">CANCEL</button>`
            : '<span class="duel-done">yours · main wallet</span>')
          : `<button class="mini-btn" data-acceptduel="${d.id}">FIGHT</button>`)""")

# --- Bazaar listings ---
old = """        ${l.status === 'open' ? (l.seller === S.addr
          ? `<button class="mini-btn alt" data-cancellisting="${l.id}">CANCEL</button>`
          : `<button class="mini-btn" data-buy="${l.id}" data-price="${l.price}">BUY</button>`)"""
assert old in s, "listing buttons"
s = s.replace(old, """        ${l.status === 'open' ? (isMine(l.seller)
          ? (l.seller === S.addr
            ? `<button class="mini-btn alt" data-cancellisting="${l.id}">CANCEL</button>`
            : '<span class="duel-done">yours · main wallet</span>')
          : `<button class="mini-btn" data-buy="${l.id}" data-price="${l.price}">BUY</button>`)""")

old = "${l.seller === S.addr ? 'you' : short(l.seller || '?')}"
assert old in s, "listing byline"
s = s.replace(old, "${isMine(l.seller) ? 'you' : short(l.seller || '?')}")

# --- Bazaar swaps ---
old = """        ${w.status === 'open' ? (w.maker === S.addr
          ? `<button class="mini-btn alt" data-cancelswap="${w.id}">CANCEL</button>`
          : (wantMine ? `<button class="mini-btn" data-acceptswap="${w.id}" data-want="${w.want}">SWAP</button>` : '<span class="duel-done">need the wanted card</span>'))"""
assert old in s, "swap buttons"
s = s.replace(old, """        ${w.status === 'open' ? (isMine(w.maker)
          ? (w.maker === S.addr
            ? `<button class="mini-btn alt" data-cancelswap="${w.id}">CANCEL</button>`
            : '<span class="duel-done">yours · main wallet</span>')
          : (wantMine ? `<button class="mini-btn" data-acceptswap="${w.id}" data-want="${w.want}">SWAP</button>` : '<span class="duel-done">need the wanted card</span>'))""")

old = "${w.maker === S.addr ? 'you' : short(w.maker || '?')}"
assert old in s, "swap byline"
s = s.replace(old, "${isMine(w.maker) ? 'you' : short(w.maker || '?')}")

# --- endSession safety gate ---
old = """    $('sessionEndBtn').disabled = true;
    sessionNote('Sweeping your champions and coin home\\u2026');
    const r = await S.wallet.sweep();"""
assert old in s, "end session block"
s = s.replace(old, """    $('sessionEndBtn').disabled = true;
    sessionNote('Checking for anything still in play\\u2026');
    await refresh();
    const blockers = [];
    const cs = [...S.cards.values()];
    const n1 = cs.filter(c => c.pending === S.addr).length;
    if (n1) blockers.push(`${n1} unclaimed champion${n1 > 1 ? 's' : ''}`);
    const n2 = cs.filter(c => c.staker === S.addr).length;
    if (n2) blockers.push(`${n2} in the mines`);
    const n3 = cs.filter(c => c.marketPending === S.addr).length;
    if (n3) blockers.push(`${n3} in market escrow`);
    if (S.gemsLedger > 0) blockers.push(`${fmtGems(S.gemsLedger)} in the ledger`);
    if (S.marketFunds > 0) blockers.push(`${fmtHtr(S.marketFunds)} sale proceeds`);
    const n4 = S.duels.filter(d => d.status === 'open' && d.challenger === S.addr).length;
    if (n4) blockers.push(`${n4} open challenge${n4 > 1 ? 's' : ''}`);
    const n5 = S.listings.filter(l => l.status === 'open' && l.seller === S.addr).length;
    if (n5) blockers.push(`${n5} open listing${n5 > 1 ? 's' : ''}`);
    const n6 = S.swaps.filter(w => w.status === 'open' && w.maker === S.addr).length;
    if (n6) blockers.push(`${n6} open trade${n6 > 1 ? 's' : ''}`);
    if (blockers.length) {
      sessionNote('Resolve before ending: ' + blockers.join(', ') +
        '. Claim, recall, cancel, and withdraw \\u2014 then sweep.');
      return;
    }
    sessionNote('Sweeping your champions and coin home\\u2026');
    const r = await S.wallet.sweep();""")

# --- archive the key on end (best-effort safety net) ---
old = "    await S.wallet.disconnect();\n    localStorage.removeItem(SESSION_LS);"
assert old in s, "archive point"
s = s.replace(old, """    await S.wallet.disconnect();
    try {
      const arch = JSON.parse(localStorage.getItem(SESSION_LS + '_archive') || '[]');
      const cur = JSON.parse(localStorage.getItem(SESSION_LS) || 'null');
      if (cur) arch.push({ ...cur, endedAt: Date.now(), address: S.wallet.address });
      localStorage.setItem(SESSION_LS + '_archive', JSON.stringify(arch.slice(-10)));
    } catch { /* best effort */ }
    localStorage.removeItem(SESSION_LS);""")

open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: dual identity + end-session safety + key archive")
