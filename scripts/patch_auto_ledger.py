import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()
assert "ensureLedgerGems" not in s

# helper: top up the in-game ledger from gems in hand when short
anchor = "async function waitForExecution(hash, onTick) {"
assert anchor in s
s = s.replace(anchor, """async function ensureLedgerGems(amount) {
  if (S.gemsLedger >= amount) return true;
  const shortfall = amount - S.gemsLedger;
  if (S.gemsWallet < shortfall) return false;
  const hash = await doTx('Entrusting gems to the ledger', 'deposit_gems', [], [depAct(GEMS, shortfall)]);
  return !!hash && S.gemsLedger >= amount;
}

""" + anchor)

# fuse: auto-deposit the fee first
old = """async function fuse() {
  const [a, b] = [...S.selected];
  S.selected.clear();"""
assert old in s
s = s.replace(old, """async function fuse() {
  const [a, b] = [...S.selected];
  S.selected.clear();
  if (!(await ensureLedgerGems(5))) {
    $('errTitle').textContent = 'Not enough gems';
    $('errMsg').textContent = 'Fusion costs 0.05 GEMS. Earn more in the Mines.';
    showStage('stageError');
    return;
  }""")

# fuse gating counts hand + ledger together
old = "  const canPayFuse = S.gemsLedger >= 5;"
assert old in s
s = s.replace(old, "  const canPayFuse = S.gemsLedger + S.gemsWallet >= 5;")
old = """    : (canPayFuse ? 'Forge into the next station:'
       : `Fusion costs 0.05 GEMS — you have ${fmtGems(S.gemsLedger)}. Earn more in the Mines.`);"""
assert old in s
s = s.replace(old, """    : (S.gemsLedger >= 5 ? 'Forge into the next station:'
       : canPayFuse ? 'Forge into the next station (gems move to your ledger first):'
       : `Fusion costs 0.05 GEMS — you have ${fmtGems(S.gemsLedger + S.gemsWallet)}. Earn more in the Mines.`);""")

# duel create: allow hand+ledger, auto-deposit the wager
old = """    const wager = Math.max(0, Number($('pickWager').value) || 0);
    if (wager > S.gemsLedger) { $('errTitle').textContent = 'Wager too high'; $('errMsg').textContent = `Ledger has ${fmtGems(S.gemsLedger)} — stake cards or deposit GEMS first.`; showStage('stageError'); $('overlay').hidden = false; return; }
    await doTx('Issuing challenge', 'create_duel', [wager], [depAct(uid, CARD_AMT)], { target: MKT });"""
old2 = old.replace(", { target: MKT }", "")
target = old if old in s else (old2 if old2 in s else None)
assert target, "duel create block"
s = s.replace(target, """    const wager = Math.max(0, Number($('pickWager').value) || 0);
    if (wager > S.gemsLedger + S.gemsWallet) { $('errTitle').textContent = 'Wager too high'; $('errMsg').textContent = `You have ${fmtGems(S.gemsLedger + S.gemsWallet)} in total.`; showStage('stageError'); return; }
    if (!(await ensureLedgerGems(wager))) { $('errTitle').textContent = 'Wager too high'; $('errMsg').textContent = 'Could not move enough gems to the ledger.'; showStage('stageError'); return; }
    await doTx('Issuing challenge', 'create_duel', [wager], [depAct(uid, CARD_AMT)]);""")

# duel accept: auto-deposit the wager before fighting
old = """  } else {
    const winsBefore = S.wins;
    const hash = await doTx('Trial by combat', 'accept_duel', [ref], [depAct(uid, CARD_AMT)]);"""
assert old in s
s = s.replace(old, """  } else {
    const duel = S.duels.find(x => x.id === ref);
    if (duel && duel.wager > 0 && !(await ensureLedgerGems(duel.wager))) {
      $('errTitle').textContent = 'Not enough gems for the wager';
      $('errMsg').textContent = `This trial wagers ${fmtGems(duel.wager)}.`;
      showStage('stageError');
      return;
    }
    const winsBefore = S.wins;
    const hash = await doTx('Trial by combat', 'accept_duel', [ref], [depAct(uid, CARD_AMT)]);""")

open(p, "w", encoding="utf-8", newline="\n").write(s)
print("auto ledger top-up wired")
