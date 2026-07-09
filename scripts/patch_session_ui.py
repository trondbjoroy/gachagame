import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

# ================= wallets.js =================
p = "frontend/public/wallets.js"
s = open(p, encoding="utf-8").read()

# funding transfers for both main-wallet adapters
snap_anchor = """  async tokenBalance(uid) { return addrBalance(this.address, uid); }

  async htrBalance() { return this.tokenBalance('00'); }
}

/* ---------------- WalletConnect / Reown ---------------- */"""
assert snap_anchor in s
s = s.replace(snap_anchor, """  async tokenBalance(uid) { return addrBalance(this.address, uid); }

  async htrBalance() { return this.tokenBalance('00'); }

  async sendHtr(toAddress, amount) {
    const res = await this.invoke('htr_sendTransaction', {
      network: window.GAME.network,
      outputs: [{ address: toAddress, value: String(amount), token: '00' }],
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('wallet did not return a transaction id');
    return { hash };
  }
}

/* ---------------- WalletConnect / Reown ---------------- */""")

wc_anchor = """  async tokenBalance(uid) { return addrBalance(this.address, uid); }

  async htrBalance() { return this.tokenBalance('00'); }

  async disconnect() {"""
assert wc_anchor in s
s = s.replace(wc_anchor, """  async tokenBalance(uid) { return addrBalance(this.address, uid); }

  async htrBalance() { return this.tokenBalance('00'); }

  async sendHtr(toAddress, amount) {
    const res = await this.request('htr_sendTransaction', {
      network: window.GAME.network,
      outputs: [{ address: toAddress, value: String(amount), token: '00' }],
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('wallet did not return a transaction id');
    return { hash };
  }

  async disconnect() {""")

# session adapter
s = s.replace("window.WALLETS = { SnapWallet, WcWallet };", """/* ---------------- Session (promptless, browser-held key) ---------------- */

let sessionLibLoading = null;
function loadSessionLib() {
  if (window.SessionKit) return Promise.resolve();
  if (!sessionLibLoading) {
    sessionLibLoading = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'session-lib.js';
      el.onload = resolve;
      el.onerror = () => reject(new Error('failed to load the session signer'));
      document.head.appendChild(el);
    });
  }
  return sessionLibLoading;
}

class SessionWallet {
  constructor(handle, mainAddr) {
    this.mode = 'session';
    this.label = 'Session (promptless)';
    this.handle = handle;
    this.address = handle.address;
    this.mainAddr = mainAddr;
  }

  static async create() {
    await loadSessionLib();
    return window.SessionKit.generateWords();
  }

  static async open(words, mainAddr) {
    await loadSessionLib();
    const handle = await window.SessionKit.open(words);
    return new SessionWallet(handle, mainAddr);
  }

  async executeNano(method, args, actions, target) {
    return this.handle.executeNano(method, {
      ncId: (target || window.GAME).nc,
      blueprintId: (target || window.GAME).blueprint,
      args,
      actions,
    });
  }

  async tokenBalance(uid) { return this.handle.balance(uid); }
  async htrBalance() { return this.handle.balance('00'); }
  async sweep() { return this.handle.sweep(this.mainAddr); }
  async disconnect() { await this.handle.stop().catch(() => {}); }
}

window.WALLETS = { SnapWallet, WcWallet, SessionWallet };""")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("wallets.js: sendHtr + SessionWallet")

# ================= index.html =================
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()
old = """      <div class="wait-sub" id="connectMsg"></div>
      <button class="mini-btn alt" id="disconnectBtn" hidden>DISCONNECT</button>"""
assert old in s
s = s.replace(old, """      <div class="session-box" id="sessionBox" hidden>
        <b>&#9889; Promptless play</b>
        <p id="sessionInfo">Fund a session key held in this browser and play without
        approving every deed. Sweep everything back to your wallet whenever you like.</p>
        <button class="mini-btn" id="sessionStartBtn">START SESSION &middot; 1 HTR</button>
        <button class="mini-btn" id="sessionTopupBtn" hidden>TOP UP &middot; 1 HTR</button>
        <button class="mini-btn alt" id="sessionEndBtn" hidden>SWEEP &amp; END SESSION</button>
      </div>
      <div class="wait-sub" id="connectMsg"></div>
      <button class="mini-btn alt" id="disconnectBtn" hidden>DISCONNECT</button>""")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("index.html: session box")

# ================= style.css =================
p = "frontend/public/style.css"
s = open(p, encoding="utf-8").read()
s += """
/* promptless session */
.session-box {
  max-width: 360px; margin: 18px auto 4px; text-align: left;
  border: 1px solid rgba(212, 168, 67, .3); border-radius: var(--r-md);
  background: rgba(212, 168, 67, .05); padding: 14px 16px;
}
.session-box b { font-size: 14px; }
.session-box p { margin: 6px 0 12px; font-size: 12px; color: var(--ink-muted); line-height: 1.55; }
.session-box .mini-btn { margin-right: 8px; }
"""
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("style.css: session box")

# ================= app.js =================
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()

anchor = "async function disconnectWallet() {"
assert anchor in s
session_code = """/* ---------------- promptless session ---------------- */

const SESSION_LS = 'emberfall_session';

function sessionNote(msg) { $('connectMsg').textContent = msg; }

async function startSession() {
  if (!S.wallet || S.wallet.mode === 'session') return;
  const main = S.wallet;
  try {
    $('sessionStartBtn').disabled = true;
    sessionNote('Forging a session key in this browser\\u2026');
    const words = await window.WALLETS.SessionWallet.create();
    const sw = await window.WALLETS.SessionWallet.open(words, main.address);
    sessionNote('Approve the 1 HTR funding in your wallet\\u2026');
    await main.sendHtr(sw.address, 100);
    sessionNote('Waiting for the funding to arrive\\u2026');
    for (let i = 0; i < 60; i++) {
      if (await sw.htrBalance() >= 100) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (await sw.htrBalance() < 100) throw new Error('funding never arrived \\u2014 try again');
    localStorage.setItem(SESSION_LS, JSON.stringify({ words, mainAddr: main.address }));
    S.mainWallet = main;
    S.wallet = sw;
    S.addr = sw.address;
    $('overlay').hidden = true;
    await refresh();
  } catch (e) {
    sessionNote(e.message || String(e));
  } finally {
    $('sessionStartBtn').disabled = false;
  }
}

async function topUpSession() {
  if (!S.mainWallet || S.wallet?.mode !== 'session') return;
  try {
    $('sessionTopupBtn').disabled = true;
    sessionNote('Approve the 1 HTR top-up in your wallet\\u2026');
    await S.mainWallet.sendHtr(S.wallet.address, 100);
    sessionNote('Top-up sent \\u2014 it lands within seconds.');
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
    sessionNote('Sweeping your champions and coin home\\u2026');
    const r = await S.wallet.sweep();
    sessionNote(r ? `Swept ${r.moved} holdings back to your wallet.` : 'Nothing to sweep.');
    await S.wallet.disconnect();
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

async function disconnectWallet() {"""
s = s.replace(anchor, session_code, 1)

old = """$('walletBtn').onclick = () => {
  $('connectMsg').textContent = S.addr ? `Sworn: ${S.wallet.label} \\u00b7 ${short(S.addr)}` : '';
  $('disconnectBtn').hidden = !S.addr;
  showStage('stageConnect');
};
$('disconnectBtn').onclick = disconnectWallet;"""
assert old in s
s = s.replace(old, """$('walletBtn').onclick = () => {
  $('connectMsg').textContent = S.addr ? `Sworn: ${S.wallet.label} \\u00b7 ${short(S.addr)}` : '';
  $('disconnectBtn').hidden = !S.addr || S.wallet?.mode === 'session';
  const inSession = S.wallet?.mode === 'session';
  $('sessionBox').hidden = !S.addr;
  $('sessionStartBtn').hidden = inSession;
  $('sessionEndBtn').hidden = !inSession;
  $('sessionTopupBtn').hidden = !(inSession && S.mainWallet);
  if (inSession) $('sessionInfo').textContent =
    'Session active \\u2014 every deed signs instantly. Sweep returns all champions and coin to ' + short(S.wallet.mainAddr) + '.';
  showStage('stageConnect');
};
$('disconnectBtn').onclick = disconnectWallet;
$('sessionStartBtn').onclick = startSession;
$('sessionTopupBtn').onclick = topUpSession;
$('sessionEndBtn').onclick = endSession;"""
)

# session badge on the chip + auto-resume at boot
old = "  $('walletHint').textContent = S.addr ? 'this address' : '';"
assert old in s
s = s.replace(old, "  $('walletHint').textContent = S.addr ? (S.wallet?.mode === 'session' ? 'session' : 'this address') : '';")

old = "(async () => {\n  await loadContract().catch(e => { $('pullNote').textContent = 'Failed to load: ' + e.message; });\n  render();\n})();"
assert old in s
s = s.replace(old, "(async () => {\n  await loadContract().catch(e => { $('pullNote').textContent = 'Failed to load: ' + e.message; });\n  render();\n  await resumeSession();\n})();")

# S.mainWallet slot
old = "  duels: [], selected: new Set(), busy: false,"
assert old in s
s = s.replace(old, "  duels: [], selected: new Set(), busy: false, mainWallet: null,")

open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: session flows wired")
