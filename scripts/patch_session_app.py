import io, sys, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()
assert "startSession" not in s, "already applied"

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

pat = re.compile(r"\$\('walletBtn'\)\.onclick = \(\) => \{\n[^\n]*\n  \$\('disconnectBtn'\)\.hidden = !S\.addr;\n  showStage\('stageConnect'\);\n\};\n\$\('disconnectBtn'\)\.onclick = disconnectWallet;")
m = pat.search(s)
assert m, "walletBtn handler not found"
new = """$('walletBtn').onclick = () => {
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
s = s[:m.start()] + new + s[m.end():]

s = s.replace("  $('walletHint').textContent = S.addr ? 'this address' : '';",
              "  $('walletHint').textContent = S.addr ? (S.wallet?.mode === 'session' ? 'session' : 'this address') : '';")

s2, n = re.subn(r"(await loadContract\(\)\.catch\(e => \{ \$\('pullNote'\)\.textContent = 'Failed to load: ' \+ e\.message; \}\);\s*\n\s*render\(\);)",
                r"\1\n  await resumeSession();", s, count=1)
assert n == 1, "boot block not patched"
s = s2

old = "  duels: [], selected: new Set(), busy: false,"
assert old in s
s = s.replace(old, "  duels: [], selected: new Set(), busy: false, mainWallet: null,")

open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: session flows fully wired")
