import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# ---------- index.html: toast container ----------
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()
assert '<div id="txToasts"' not in s
s = s.replace("<!-- overlays -->", '<div class="toasts" id="txToasts"></div>\n\n<!-- overlays -->')
open(p, "w", encoding="utf-8", newline="\n").write(s)

# ---------- style.css: toasts ----------
p = "frontend/public/style.css"
s = open(p, encoding="utf-8").read()
s += """
/* background tx toasts */
.toasts {
  position: fixed; right: 18px; bottom: 18px; z-index: 60;
  display: flex; flex-direction: column-reverse; gap: 10px; max-width: 340px;
}
.toast {
  display: flex; align-items: center; gap: 12px;
  background: #0d1430; border: 1px solid var(--line); border-radius: 12px;
  padding: 11px 14px; box-shadow: 0 14px 40px -12px rgba(0,0,0,.7);
  animation: toast-in .25s ease;
}
@keyframes toast-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
.toast .t-body { flex: 1; min-width: 0; }
.toast b { font-size: 13px; display: block; }
.toast .t-sub { font-size: 11px; color: var(--ink-dim); display: block; word-break: break-word; }
.toast .t-time { font-size: 11px; color: var(--ink-dim); }
.toast .t-spin {
  width: 14px; height: 14px; flex: none; border-radius: 50%;
  border: 2px solid rgba(191,246,88,.25); border-top-color: var(--acid);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.toast.ok { border-color: rgba(191,246,88,.5); }
.toast.ok .t-spin { animation: none; border-color: var(--acid); background: var(--acid); }
.toast.fail { border-color: rgba(255,107,138,.6); }
.toast.fail .t-spin { animation: none; border-color: #ff6b8a; background: #ff6b8a; }
.toast .t-x { background: none; border: none; color: var(--ink-dim); cursor: pointer; font-size: 13px; }
"""
open(p, "w", encoding="utf-8", newline="\n").write(s)

# ---------- app.js: non-blocking doTx ----------
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()

old_dotx = s[s.index("async function doTx(") : s.index("/* ---------------- flows ----------------")]
new_dotx = """let txSeq = 0;
async function doTx(label, method, args, actions, { target } = {}) {
  if (!S.wallet) return null;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="t-spin"></span><div class="t-body"><b>${label}</b>
    <span class="t-sub">sign & push\\u2026</span></div><span class="t-time mono"></span>`;
  $('txToasts').appendChild(el);
  const sub = el.querySelector('.t-sub');
  const tim = el.querySelector('.t-time');
  try {
    const { hash } = await S.wallet.executeNano(method, args, actions, target);
    sub.textContent = 'tx ' + hash.slice(0, 12) + '\\u2026 confirming';
    await waitForExecution(hash, sec => { tim.textContent = sec + 's'; });
    el.classList.add('ok');
    sub.textContent = 'confirmed';
    setTimeout(() => el.remove(), 6000);
    await refresh();
    return hash;
  } catch (e) {
    el.classList.add('fail');
    sub.textContent = e.message || String(e);
    el.insertAdjacentHTML('beforeend', '<button class="t-x">\\u2715</button>');
    el.querySelector('.t-x').onclick = () => el.remove();
    refresh().catch(() => {});
    return null;
  }
}

"""
s = s.replace(old_dotx, new_dotx)

# pull(): keep machine shaking through confirmation, no blocking stage
old = s[s.index("async function pull() {") : s.index("async function fuse() {")]
new = """async function pull() {
  const before = new Set([...S.cards.values()].filter(c => c.pending === S.addr).map(c => c.uid));
  $('machine').classList.add('shaking');
  const hash = await doTx('Pulling', 'pull', [], [depAct(HTR, S.pullPrice)]);
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
  $('prizePower').textContent = `\\u26a1 POWER ${won.power}`;
  $('prizeUid').textContent = won.uid;
  $('revealClaimBtn').onclick = () => { $('overlay').hidden = true; doTx('Claiming card', 'claim_card', [], [wdAct(won.uid, CARD_AMT)]); };
  showStage('stageReveal');
}

"""
s = s.replace(old, new)

old = s[s.index("async function fuse() {") : s.index("let pickCtx = null;")]
new = """async function fuse() {
  const [a, b] = [...S.selected];
  S.selected.clear();
  const before = new Set([...S.cards.values()].filter(c => c.pending === S.addr).map(c => c.uid));
  const hash = await doTx('Fusing', 'fuse', [], [depAct(a, CARD_AMT), depAct(b, CARD_AMT)]);
  if (!hash) return;
  const won = [...S.cards.values()].find(c => c.pending === S.addr && !before.has(c.uid));
  if (won) revealCard(won, `FUSED \\u00b7 ${TIERS[won.tier].name}`);
}

"""
s = s.replace(old, new)

# accept duel result stays as overlay after background confirm
s = s.replace("""    const winsBefore = S.wins;
    const hash = await doTx('Duel', 'accept_duel', [ref], [depAct(uid, 1)]);""",
"""    const winsBefore = S.wins;
    const hash = await doTx('Duel', 'accept_duel', [ref], [depAct(uid, CARD_AMT)]);""")

# drop busy-gating: keep the field but never block interactions
s = s.replace("const canPull = S.addr && S.pullPrice != null && S.htr >= S.pullPrice && !S.busy;",
              "const canPull = S.addr && S.pullPrice != null && S.htr >= S.pullPrice;")
s = s.replace("$('fuseBtn').disabled = !(selCount === 2 && sameTierSelected() && !S.busy);",
              "$('fuseBtn').disabled = !(selCount === 2 && sameTierSelected());")
s = s.replace("<button class=\"mini-btn\" id=\"wdGemsBtn\" ${S.gemsLedger < 1 || S.busy ? 'disabled' : ''}>WITHDRAW ALL</button>",
              "<button class=\"mini-btn\" id=\"wdGemsBtn\" ${S.gemsLedger < 1 ? 'disabled' : ''}>WITHDRAW ALL</button>")
s = s.replace("<button class=\"mini-btn alt\" id=\"depGemsBtn\" ${S.gemsWallet < 1 || S.busy ? 'disabled' : ''}>DEPOSIT WALLET GEMS</button>",
              "<button class=\"mini-btn alt\" id=\"depGemsBtn\" ${S.gemsWallet < 1 ? 'disabled' : ''}>DEPOSIT WALLET GEMS</button>")
s = s.replace("if (S.busy || !S.wallet) return;", "if (!S.wallet) return;")
s = s.replace("setInterval(() => { if (!S.busy) refresh().catch(() => {}); }, 45000);",
              "setInterval(() => refresh().catch(() => {}), 45000);")

open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patched")
