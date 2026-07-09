import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

# wallets.js: omit explicit token for HTR (defaults server-side; dodges wallet quirks)
p = "frontend/public/wallets.js"
s = open(p, encoding="utf-8").read()
old = "outputs: [{ address: toAddress, value: String(amount), token: '00' }],"
assert s.count(old) == 2
s = s.replace(old, "outputs: [{ address: toAddress, value: String(amount) }],")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("wallets.js: token field omitted for HTR sends")

# app.js: manual funding fallback with copyable address + extended polling
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()
old = """    const words = await window.WALLETS.SessionWallet.create();
    const sw = await window.WALLETS.SessionWallet.open(words, main.address);
    sessionNote('Approve the 1 HTR funding in your wallet\\u2026');
    await main.sendHtr(sw.address, 100);
    sessionNote('Waiting for the funding to arrive\\u2026');
    for (let i = 0; i < 60; i++) {
      if (await sw.htrBalance() >= 100) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (await sw.htrBalance() < 100) throw new Error('funding never arrived \\u2014 try again');"""
assert old in s
s = s.replace(old, """    const words = await window.WALLETS.SessionWallet.create();
    const sw = await window.WALLETS.SessionWallet.open(words, main.address);
    sessionNote('Approve the 1 HTR funding in your wallet\\u2026');
    let waitRounds = 60; // 2 minutes on the automatic path
    try {
      await main.sendHtr(sw.address, 100);
      sessionNote('Waiting for the funding to arrive\\u2026');
    } catch (e) {
      // wallet could not build the transfer (some wallets' sendTransaction
      // over WalletConnect is flaky) — fall back to a manual send
      waitRounds = 150; // 5 minutes for a human-driven transfer
      $('sessionInfo').innerHTML = 'Automatic funding failed in your wallet. '
        + 'Send <b>1 HTR</b> (or more) to the session address below from your '
        + 'wallet\\u2019s normal send screen \\u2014 the game will detect it.<br>'
        + `<span class="mono" style="word-break:break-all">${sw.address}</span> `
        + `<button class="mini-btn alt" style="margin-top:8px" onclick="navigator.clipboard.writeText('${sw.address}')">COPY ADDRESS</button>`;
      sessionNote('Waiting for a manual 1 HTR transfer\\u2026');
    }
    for (let i = 0; i < waitRounds; i++) {
      if (await sw.htrBalance() >= 100) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (await sw.htrBalance() < 100) throw new Error('funding never arrived \\u2014 try again');"""
)
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: manual funding fallback")
