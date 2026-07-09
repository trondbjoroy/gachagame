import io, sys, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

# ---------- config.js: economy block (CURRENT live values; flip with v2.1) ----------
p = "frontend/public/config.js"
s = open(p, encoding="utf-8").read()
assert "economy" not in s
old = "  wcProjectId: '7b19452a987a959c2e5a373331e6eb5b',"
assert old in s
s = s.replace(old, """  // live economy (cents). v2.1 target: sessionFund 50000, fusionFees [5,10,50,100]
  economy: { sessionFund: 100, fusionFees: [5, 5, 5, 5] },
  wcProjectId: '7b19452a987a959c2e5a373331e6eb5b',""")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("config.js: economy block")

# ---------- app.js ----------
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()

old = "const CARD_AMT = 100; // one card = 100 base units ('1.00')"
assert old in s
s = s.replace(old, old + """
const ECON = window.GAME.economy || { sessionFund: 100, fusionFees: [5, 5, 5, 5] };
const fuseFeeFor = tier => ECON.fusionFees[tier] ?? 5;""")

# fuse gating: fee by the selected pair's station
old = """  const fuseReady = selCount === 2 && sameTierSelected();
  const canPayFuse = S.gemsLedger + S.gemsWallet >= 5;
  $('fuseHint').textContent = !fuseReady ? 'Select two champions of the same station —'
    : (S.gemsLedger >= 5 ? 'Forge into the next station:'
       : canPayFuse ? 'Forge into the next station (gems move to your ledger first):'
       : `Fusion costs 0.05 GEMS — you have ${fmtGems(S.gemsLedger + S.gemsWallet)}. Earn more in the Mines.`);
  $('fuseBtn').disabled = !(fuseReady && canPayFuse);"""
assert old in s
s = s.replace(old, """  const fuseReady = selCount === 2 && sameTierSelected();
  const selTier = fuseReady ? S.cards.get([...S.selected][0]).tier : 0;
  const fuseFee = fuseFeeFor(selTier);
  const canPayFuse = S.gemsLedger + S.gemsWallet >= fuseFee;
  $('fuseHint').textContent = !fuseReady ? 'Select two champions of the same station —'
    : (S.gemsLedger >= fuseFee ? `Forge into the next station for ${fmtGems(fuseFee)}:`
       : canPayFuse ? `Forge for ${fmtGems(fuseFee)} (gems move to your ledger first):`
       : `Fusion costs ${fmtGems(fuseFee)} — you have ${fmtGems(S.gemsLedger + S.gemsWallet)}. Earn more in the Mines.`);
  $('fuseBtn').disabled = !(fuseReady && canPayFuse);""")

# fuse(): tiered fee
old = """  if (!(await ensureLedgerGems(5))) {
    $('errTitle').textContent = 'Not enough gems';
    $('errMsg').textContent = 'Fusion costs 0.05 GEMS. Earn more in the Mines.';
    showStage('stageError');
    return;
  }"""
assert old in s
s = s.replace(old, """  const fee = fuseFeeFor(S.cards.get(a)?.tier ?? 0);
  if (!(await ensureLedgerGems(fee))) {
    $('errTitle').textContent = 'Not enough gems';
    $('errMsg').textContent = `Fusion costs ${fmtGems(fee)}. Earn more in the Mines.`;
    showStage('stageError');
    return;
  }""")

# session funding amounts + copy from config
s = s.replace("await main.sendHtr(sw.address, 100);", "await main.sendHtr(sw.address, ECON.sessionFund);")
s = s.replace("await S.mainWallet.sendHtr(S.wallet.address, 100);", "await S.mainWallet.sendHtr(S.wallet.address, ECON.sessionFund);")
s = s.replace("if (await sw.htrBalance() >= 100) break;", "if (await sw.htrBalance() >= ECON.sessionFund) break;")
s = s.replace("if (await sw.htrBalance() < 100) throw new Error('funding never arrived", "if (await sw.htrBalance() < ECON.sessionFund) throw new Error('funding never arrived")
s = re.sub(r"Approve the 1 HTR funding", "Approve the ' + fmtHtr(ECON.sessionFund) + ' funding", s)
s = s.replace("sessionNote('Approve the ' + fmtHtr(ECON.sessionFund) + ' funding in your wallet\\u2026');",
              "sessionNote('Approve the ' + fmtHtr(ECON.sessionFund) + ' funding in your wallet\\u2026');")
s = re.sub(r"Approve the 1 HTR top-up", "Approve the ' + fmtHtr(ECON.sessionFund) + ' top-up", s)
s = s.replace("'Send <b>1 HTR</b> (or more) to the session address below", "`Send <b>${fmtHtr(ECON.sessionFund)}</b> (or more) to the session address below`")
s = s.replace("+ 'Send <b>1 HTR</b> (or more) to the session address below from your '", "+ `Send <b>${fmtHtr(ECON.sessionFund)}</b> (or more) to the session address below from your `")
s = re.sub(r"Waiting for a manual 1 HTR transfer", "Waiting for the funding transfer", s)
s = s.replace("'Top-up sent \\u2014 it lands within seconds.'", "'Top-up sent \\u2014 it lands within seconds.'")
# dynamic button labels
old = "  $('sessionStartBtn').hidden = inSession;"
assert old in s
s = s.replace(old, "  $('sessionStartBtn').hidden = inSession;\n  $('sessionStartBtn').innerHTML = 'START SESSION \\u00b7 ' + fmtHtr(ECON.sessionFund);\n  $('sessionTopupBtn').innerHTML = 'TOP UP \\u00b7 ' + fmtHtr(ECON.sessionFund);")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: economy from config")

# ---------- index.html: genericize static labels + codex fee/funding copy ----------
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()
s = s.replace(">START SESSION &middot; 1 HTR<", ">START SESSION<")
s = s.replace(">TOP UP &middot; 1 HTR<", ">TOP UP<")
s = s.replace(">FUSE (0.05 GEMS)<", ">FUSE<")
s = s.replace("hit <b>FUSE</b>\n        (costs <span class=\"mono\">0.05 GEMS</span> from your ledger)", "hit <b>FUSE</b>\n        (a GEMS fee from your ledger that rises with the station being forged)")
s = s.replace("Select two cards of the same tier in your collection and hit <b>FUSE</b>", "Select two cards of the same tier in your collection and hit <b>FUSE</b>")
s = s.replace("(costs <span class=\"mono\">0.05 GEMS</span> from your ledger)", "(a GEMS fee from your ledger that rises with the station being forged)")
s = s.replace("<b>Fusion (0.05 GEMS)</b>", "<b>Fusion</b>")
s = s.replace("funds it with 1 HTR from your wallet (one approval)", "funds it with a fixed HTR stake from your wallet (one approval)")
s = s.replace("Pulls cost <span class=\"mono\">0.05 HTR</span> in testnet coin.", "Summons cost a fixed HTR price \\u2014 shown on the button \\u2014 in testnet coin.".replace("\\u2014", "—"))
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("index.html: labels + codex genericized")
