import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

# ---------- app.js ----------
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()

# card boxes: drop the uid line
old = """    <div class="tier">${t.name} · ⚡${c.power}</div>
    <div class="uid">${c.uid.slice(0, 18)}…</div>"""
assert old in s, "cardBox uid"
s = s.replace(old, """    <div class="tier">${t.name} · ⚡${c.power}</div>""")

# reveal: drop the uid
old = "  $('prizeUid').textContent = won.uid;\n"
assert old in s, "reveal uid"
s = s.replace(old, "")

# TRADE: replace the paste-a-hash prompt with a card picker
old = """  bind('[data-trade]', u => {
    const want = (prompt('Token UID of the card you want in return:') || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(want)) doTx('Proposing trade', 'offer_swap', [want], [depAct(u, CARD_AMT)], { target: MKT });
    else if (want) alert('That is not a valid 64-hex token UID.');
  });"""
assert old in s, "trade prompt"
s = s.replace(old, """  bind('[data-trade]', u => openPick('want', u));""")

# picker: support the 'want' mode (choose another player's champion)
old = """function openPick(kind, ref) {
  pickCtx = { kind, ref };
  const mine = [...S.cards.values()].filter(c => c.mine);"""
assert old in s, "openPick head"
s = s.replace(old, """function openPick(kind, ref) {
  pickCtx = { kind, ref };
  if (kind === 'want') {
    const others = [...S.cards.values()].filter(c => c.tier >= 0 && !c.mine);
    if (!others.length) {
      $('errTitle').textContent = 'No champions to trade for';
      $('errMsg').textContent = 'No other champion is known to the realm yet.';
      showStage('stageError'); return;
    }
    $('pickTitle').textContent = 'Choose the champion you want in return';
    $('pickWagerRow').hidden = true;
    $('pickCards').innerHTML = others.map(c => cardBox(c, `<button class="mini-btn" data-pick="${c.uid}">SELECT</button>`)).join('');
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => submitPick(el.dataset.pick));
    showStage('stagePick');
    return;
  }
  const mine = [...S.cards.values()].filter(c => c.mine);"""
)

old = """async function submitPick(uid) {
  const { kind, ref } = pickCtx;
  $('overlay').hidden = true;
  if (kind === 'create') {"""
assert old in s, "submitPick head"
s = s.replace(old, """async function submitPick(uid) {
  const { kind, ref } = pickCtx;
  $('overlay').hidden = true;
  if (kind === 'want') {
    await doTx('Proposing trade', 'offer_swap', [uid], [depAct(ref, CARD_AMT)], { target: MKT });
    return;
  }
  if (kind === 'create') {"""
)
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: hashes removed, trade picker added")

# ---------- index.html: drop the reveal uid element ----------
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()
old = '        <div class="prize-uid mono" id="prizeUid"></div>\n'
assert old in s, "prizeUid element"
s = s.replace(old, "")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("index.html: reveal uid element removed")
