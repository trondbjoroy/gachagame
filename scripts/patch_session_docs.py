import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

# ---------- index.html: header button + codex ----------
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()

old = """    <button class="wallet-chip as-btn" id="walletBtn">
      <span class="dot off" id="walletDot"></span>
      <span id="walletAddr">Connect wallet</span>
      <span class="htr" id="walletHtr"></span>
      <span class="hint" id="walletHint"></span>
    </button>"""
assert old in s
s = s.replace(old, """    <div class="wallet-area">
      <button class="mini-btn header-session" id="headerSessionBtn" hidden>&#9889; PROMPTLESS PLAY</button>
      <button class="wallet-chip as-btn" id="walletBtn">
        <span class="dot off" id="walletDot"></span>
        <span id="walletAddr">Connect wallet</span>
        <span class="htr" id="walletHtr"></span>
        <span class="hint" id="walletHint"></span>
      </button>
    </div>""")

# codex guide step 1: mention promptless play
old = """        <p>Click the wallet chip in the header and pair your own wallet &mdash;
        <b>MetaMask (Hathor Snap)</b> or <b>WalletConnect</b> for the Hathor
        mobile/desktop wallet. Every deed is signed by you and owned by you;
        set your wallet's network to <b>testnet</b>.</p>"""
assert old in s
s = s.replace(old, """        <p>Click the wallet chip in the header and pair your own wallet &mdash;
        <b>MetaMask (Hathor Snap)</b> or <b>WalletConnect</b> for the Hathor
        mobile/desktop wallet. Every deed is signed by you and owned by you;
        set your wallet's network to <b>testnet</b>. Then hit
        <b>&#9889; Promptless play</b> to fund a session and skip per-deed
        approvals entirely.</p>""")

# codex FAQ entry on sessions
old = """      <div class="qa"><h4>Is any of this real money?</h4>"""
assert old in s
s = s.replace(old, """      <div class="qa"><h4>What is promptless play?</h4>
        <p>Starting a session forges a fresh key that lives only in your browser and
        funds it with 1 HTR from your wallet (one approval). Every deed after that
        signs instantly &mdash; no popups. <b>Sweep &amp; end</b> returns all champions
        and coin to your main wallet in one transaction, and sessions survive page
        reloads. One caution: the session key lives in this browser's storage, so
        sweep before clearing site data or switching devices &mdash; unswept holdings
        stay locked to that browser.</p></div>
      <div class="qa"><h4>Is any of this real money?</h4>""")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("index.html: header button + codex entries")

# ---------- style.css ----------
p = "frontend/public/style.css"
s = open(p, encoding="utf-8").read()
s += """
.wallet-area { display: flex; align-items: center; gap: 10px; }
.header-session { white-space: nowrap; }
.header-session.active { background: none; color: var(--acid); border: 1px solid rgba(212, 168, 67, .4); }
"""
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("style.css: header button")

# ---------- app.js: visibility + click ----------
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()

old = "  $('walletHint').textContent = S.addr ? (S.wallet?.mode === 'session' ? 'session' : 'this address') : '';"
assert old in s
s = s.replace(old, old + """
  const hsb = $('headerSessionBtn');
  hsb.hidden = !S.addr;
  const inSess = S.wallet?.mode === 'session';
  hsb.innerHTML = inSess ? '\\u26a1 SESSION ACTIVE' : '\\u26a1 PROMPTLESS PLAY';
  hsb.classList.toggle('active', inSess);""")

old = "$('sessionStartBtn').onclick = startSession;"
assert old in s
s = s.replace(old, """$('sessionStartBtn').onclick = startSession;
$('headerSessionBtn').onclick = () => {
  $('walletBtn').onclick();
  if (S.wallet?.mode !== 'session') startSession();
};""")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: header button wired")
