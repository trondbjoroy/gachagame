import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

def sub(s, old, new, path):
    assert old in s, f"MISSING in {path}: {old[:70]!r}"
    return s.replace(old, new)

# ================= index.html =================
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()

s = sub(s, "<title>Gacha Arena — onchain card game on Hathor</title>",
        "<title>Emberfall — a realm bound to the chain</title>", p)
s = sub(s, '<meta name="description" content="Pull cards minted by a nano contract, farm GEMS, fuse rarities, and duel other players — every move settles on the Hathor blockchain." />',
        '<meta name="description" content="The throne of Emberfall sits empty. Summon champions bound in soulstone, work the deep mines, forge greater bloodlines, and face trial by combat — every deed witnessed on the Hathor blockchain." />', p)
s = sub(s, "font-size=%2290%22>🎰</text>", "font-size=%2290%22>🏰</text>", p)
s = sub(s, "family=Aldrich&family=Outfit", "family=Cinzel:wght@500;600;700&family=Outfit", p)

s = sub(s, """        <div class="wordmark">GACHA ARENA</div>
        <div class="netline">hathor testnet-playground · pull · farm · fuse · duel</div>""",
"""        <div class="wordmark">EMBERFALL</div>
        <div class="netline">a realm bound to the chain · summon · mine · forge · fight</div>""", p)
s = sub(s, '<div class="mark">H</div>', '<div class="mark">E</div>', p)

# hero
s = sub(s, """      <h1>Pull. Farm. Fuse.<br/><span class="accent">Fight.</span></h1>
      <p class="sub">Every card is a 1-of-1 token minted by the contract with an RNG-rolled
      power stat. Stake cards to farm <b>GEMS</b>, fuse two of a kind into the next
      rarity, and wager GEMS in power-weighted duels — all onchain, no oracle.</p>""",
"""      <h1>The throne is empty.<br/><span class="accent">Raise your host.</span></h1>
      <p class="sub">The Blind Weaver binds a champion into soulstone with every summoning —
      each one a 1-of-1 token with its power struck onchain. Send them to the deep mines
      for <b>GEMS</b>, forge two of a station into a greater bloodline, and stake gems on
      trial by combat in the Pit. Every deed is witnessed on the Great Ledger. No lord,
      no oracle, no take-backs.</p>""", p)

s = sub(s, """        <span class="pull-label">PULL</span>""",
        """        <span class="pull-label">SUMMON</span>""", p)

# brazier: warm the machine SVG (stone base, gold ring, ember knob)
s = sub(s, 'fill="rgba(184,230,92,.05)" stroke="rgba(184,230,92,.28)"',
        'fill="rgba(212,168,67,.05)" stroke="rgba(212,168,67,.3)" stroke-dasharray="6 10"', p)
s = sub(s, '<rect x="30" y="190" width="160" height="82" rx="14" fill="#0d1430" stroke="rgba(191,246,88,.35)" stroke-width="2"/>',
        '<rect x="30" y="190" width="160" height="82" rx="10" fill="#171310" stroke="rgba(212,168,67,.35)" stroke-width="2"/>', p)
s = sub(s, '<circle cx="110" cy="228" r="20" fill="#050a24" stroke="rgba(191,246,88,.8)" stroke-width="3"/>',
        '<circle cx="110" cy="228" r="20" fill="#0d0a07" stroke="rgba(212,168,67,.8)" stroke-width="3"/>', p)
s = sub(s, '<rect x="104" y="212" width="12" height="32" rx="5" fill="rgba(191,246,88,.8)"/>',
        '<rect x="104" y="212" width="12" height="32" rx="5" fill="rgba(212,168,67,.8)"/>', p)

# tabs
s = sub(s, """    <button data-tab="collection" class="tab active">Collection</button>
    <button data-tab="farm" class="tab">GEM Farm</button>
    <button data-tab="arena" class="tab">Arena</button>
    <button data-tab="market" class="tab">Market</button>
    <button data-tab="learn" class="tab">Learn</button>""",
"""    <button data-tab="collection" class="tab active">Your Host</button>
    <button data-tab="farm" class="tab">The Mines</button>
    <button data-tab="arena" class="tab">The Pit</button>
    <button data-tab="market" class="tab">The Bazaar</button>
    <button data-tab="learn" class="tab">The Codex</button>""", p)

# section copy
s = sub(s, "<h2>Your cards</h2>", "<h2>Sworn to your banner</h2>", p)
s = sub(s, "No cards yet — turn the crank!", "Your banner hangs bare. Summon a champion.", p)
s = sub(s, "<h2 class=\"mt\">Won — waiting to be claimed</h2>", "<h2 class=\"mt\">Newly bound — awaiting your claim</h2>", p)
s = sub(s, ">Nothing pending.<", ">No champion waits.<", p)
s = sub(s, "<h2>Staked cards</h2>", "<h2>Toiling in the deep</h2>", p)
s = sub(s, "Stake a card from your collection to start farming GEMS.",
        "The mines stand silent. Send a champion down from your host.", p)
s = sub(s, """      <h2>Duels</h2>
      <button class="mini-btn" id="newDuelBtn">CREATE DUEL</button>""",
"""      <h2>Trials by combat</h2>
      <button class="mini-btn" id="newDuelBtn">ISSUE CHALLENGE</button>""", p)
s = sub(s, "No duels yet. Create one!", "The Pit sands are unbloodied. Issue a challenge.", p)
s = sub(s, "<h2>Card listings</h2>", "<h2>Champions for coin</h2>", p)
s = sub(s, "No listings. Use SELL on a card in your collection.",
        "No merchant cries their wares. SELL a champion from your host.", p)
s = sub(s, "<h2 class=\"mt\">Swap offers</h2>", "<h2 class=\"mt\">Sworn trades</h2>", p)
s = sub(s, "No swap offers. Use TRADE on a card in your collection.",
        "No trades proposed. Offer one with TRADE on a champion you hold.", p)
s = sub(s, "<h2 class=\"mt\">Escrow — claim your cards</h2>", "<h2 class=\"mt\">Held by the guild — claim what is yours</h2>", p)

# codex: chronicle + reworded guide headers (keep FAQ intact where clear)
s = sub(s, """  <section class="shelf tabpane" id="pane-learn" hidden>
    <h2>How to play</h2>""",
"""  <section class="shelf tabpane" id="pane-learn" hidden>
    <h2>The chronicle of Emberfall</h2>
    <div class="lore">
      <p>When the last Sovereign died without an heir, the great houses tore the realm
      apart rather than let a rival sit the throne. The maesters call it the Sundering.
      To end it, the dying king's Ledgerkeepers worked one final rite: they bound the
      realm's champions — its knights and beasts, its wights and firstborn flames —
      into <b>soulstone</b>, and wrote every binding into the <b>Great Ledger</b>, a
      book no lord can burn and no scribe can forge. A thousand unseen witnesses keep
      it, and all of them must agree before a single word is written.</p>
      <p>Above the Ledger sits the <b>Blind Weaver</b>, the fate that decides which
      champion answers a summoning. She cannot be bribed, for she has no hands; she
      cannot be read, for she has no eyes. Her threads are spun from the chain itself.</p>
      <p>Now the banners are yours to raise. Summon champions at the brazier. Send them
      into the <b>deep mines</b>, where soulstone sweats <b>gems</b>. Give two of equal
      station to the <b>Rite of Union</b> and forge a greater bloodline. Wager gems on
      <b>trial by combat</b> in the Pit, where the Crown still takes its tithe. Or sell
      your sworn swords for coin in the Bazaar — the realm has always run on gold.</p>
      <p>The throne of Emberfall stays empty. But a host must still be raised, and
      every deed you do is witnessed forever.</p>
    </div>
    <h2 class="mt">How to play</h2>""", p)

s = sub(s, "<h3>Pull a card</h3>", "<h3>Summon a champion</h3>", p)
s = sub(s, "<h3>Farm GEMS</h3>", "<h3>Work the deep mines</h3>", p)
s = sub(s, "<h3>Fuse duplicates</h3>", "<h3>Forge the Rite of Union</h3>", p)
s = sub(s, "<h3>Fight in the arena</h3>", "<h3>Face trial by combat</h3>", p)
s = sub(s, "<h3>Trade on the market</h3>", "<h3>Barter in the Bazaar</h3>", p)
s = sub(s, "<b>PULL</b>", "<b>SUMMON</b>", p)
s = sub(s, "Hit <b>SUMMON</b>. The contract rolls a rarity tier",
        "Light the brazier with <b>SUMMON</b>. The Blind Weaver rolls a station", p)

open(p, "w", encoding="utf-8", newline="\n").write(s)
print("index.html reworded")

# ================= app.js =================
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()

s = sub(s, """const TIERS = [
  { name: 'Common', color: 'var(--common)', pct: '60%', fallback: '🪙' },
  { name: 'Rare', color: 'var(--rare)', pct: '30%', fallback: '💠' },
  { name: 'Epic', color: 'var(--epic)', pct: '9%', fallback: '🔮' },
  { name: 'Legendary', color: 'var(--legendary)', pct: '1%', fallback: '🌟' },
];""",
"""const TIERS = [
  { name: 'Footman', color: 'var(--common)', pct: '60%', fallback: '🪓' },
  { name: 'Knight', color: 'var(--rare)', pct: '30%', fallback: '🛡️' },
  { name: 'Highlord', color: 'var(--epic)', pct: '9%', fallback: '🏰' },
  { name: 'Sovereign', color: 'var(--legendary)', pct: '1%', fallback: '👑' },
];""", p)

s = sub(s, """  'Moss Snail': '🐌', 'Tin Knight': '🛡️', 'Ember Fox': '🦊', 'Void Kraken': '🐙',
};""",
"""  'Moss Snail': '🐌', 'Tin Knight': '🛡️', 'Ember Fox': '🦊', 'Void Kraken': '🐙',
  'Levy Spearman': '⚔️', 'Bog Witch': '🧙', 'Plague Rat': '🐀',
  'Raven Keeper': '🐦‍⬛', 'Heartwood Archer': '🏹',
  'Dire Wolf': '🐺', 'Barrow Wight': '💀',
  'The Winter Sovereign': '❄️',
};""", p)

# stats + notes
s = sub(s, """  $('statsRow').innerHTML = [
    ['Total pulls', S.totalPulls],
    ['GEMS ledger', fmtGems(S.gemsLedger)],
    ['GEMS in wallet', fmtGems(S.gemsWallet)],
    ['Duel wins', S.wins],""",
"""  $('statsRow').innerHTML = [
    ['Souls summoned', S.totalPulls],
    ['Gems in ledger', fmtGems(S.gemsLedger)],
    ['Gems in hand', fmtGems(S.gemsWallet)],
    ['Trials won', S.wins],""", p)
s = sub(s, "'Connect a wallet to play.'", "'Swear a wallet to your cause to play.'", p)
s = sub(s, "'Cards are minted onchain the moment your pull confirms (~30–90s).'",
        "'The Weaver binds a champion the moment the next block witnesses it (~30–90s).'", p)

# toast labels
for old, new in [
    ("doTx('Pulling', 'pull'", "doTx('Summoning', 'pull'"),
    ("doTx('Claiming card', 'claim_card'", "doTx('Claiming champion', 'claim_card'"),
    ("doTx('Staking card', 'stake'", "doTx('Sending to the mines', 'stake'"),
    ("doTx('Unstaking card', 'unstake'", "doTx('Recalling from the mines', 'unstake'"),
    ("doTx('Claiming GEMS', 'claim_gems'", "doTx('Gathering gems', 'claim_gems'"),
    ("doTx('Withdrawing GEMS', 'withdraw_gems'", "doTx('Drawing gems from the ledger', 'withdraw_gems'"),
    ("doTx('Depositing GEMS', 'deposit_gems'", "doTx('Entrusting gems to the ledger', 'deposit_gems'"),
    ("doTx('Fusing', 'fuse'", "doTx('Forging the Rite of Union', 'fuse'"),
    ("doTx('Creating duel', 'create_duel'", "doTx('Issuing challenge', 'create_duel'"),
    ("doTx('Duel', 'accept_duel'", "doTx('Trial by combat', 'accept_duel'"),
    ("doTx('Cancelling duel', 'cancel_duel'", "doTx('Withdrawing challenge', 'cancel_duel'"),
    ("doTx('Listing card', 'list_card'", "doTx('Crying your wares', 'list_card'"),
    ("doTx('Buying card', 'buy'", "doTx('Buying champion', 'buy'"),
    ("doTx('Offering swap', 'offer_swap'", "doTx('Proposing trade', 'offer_swap'"),
    ("doTx('Swapping', 'accept_swap'", "doTx('Sealing the trade', 'accept_swap'"),
    ("doTx('Cancelling listing', 'cancel_listing'", "doTx('Leaving the stall', 'cancel_listing'"),
    ("doTx('Cancelling swap', 'cancel_swap'", "doTx('Recanting the trade', 'cancel_swap'"),
    ("doTx('Withdrawing funds', 'withdraw_funds'", "doTx('Collecting your coin', 'withdraw_funds'"),
]:
    s = sub(s, old, new, p)

# duel banners + buttons + pick titles
s = sub(s, "'<div class=\"duel-banner win\">🏆 VICTORY</div><div class=\"wait-sub\">Your card takes the pot. Claim it back in Collection.</div>'",
        "'<div class=\"duel-banner win\">⚔️ VICTORY</div><div class=\"wait-sub\">The pot is yours. Your champion returns — claim them under Your Host.</div>'", p)
s = sub(s, "'<div class=\"duel-banner lose\">💀 DEFEAT</div><div class=\"wait-sub\">The pot is gone, but your card returns — claim it in Collection.</div>'",
        "'<div class=\"duel-banner lose\">💀 DEFEAT</div><div class=\"wait-sub\">The pot is lost, but your champion lives — claim them under Your Host.</div>'", p)
s = sub(s, ">STAKE</button>", ">MINE</button>", p)
s = sub(s, ">DUEL</button>", ">FIGHT</button>", p)
s = sub(s, "kind === 'create' ? 'Create duel — confirm card & wager' : `Accept duel #${ref} — choose your fighter`",
        "kind === 'create' ? 'Issue a challenge — choose your champion & wager' : `Answer challenge #${ref} — choose your champion`", p)
s = sub(s, "$('errMsg').textContent = 'You need a card in your wallet.';",
        "$('errMsg').textContent = 'You hold no champion. Summon or claim one first.';", p)
s = sub(s, "'FUSED \\u00b7 '", "'FORGED \\u00b7 '", p) if "'FUSED \\u00b7 '" in s else s
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js reworded")

# ================= style.css =================
p = "frontend/public/style.css"
s = open(p, encoding="utf-8").read()

# ember-gold accent, warm iron neutrals
s = sub(s, """  --bg: #050817;
  --panel: rgba(255, 255, 255, .035);
  --line: rgba(255, 255, 255, .09);
  --ink: #f2f5ff;
  --ink-muted: #a9b1d6;
  --ink-dim: #67708f;
  --acid: #b8e65c;      /* single accent, sat < 80% */
  --acid-hot: #a4e635;
  --cyan: #b8e65c;      /* cyan retired: aliases to the one accent */""",
"""  --bg: #0b0a08;
  --panel: rgba(255, 250, 240, .035);
  --line: rgba(255, 245, 230, .09);
  --ink: #f4efe6;
  --ink-muted: #b5ab99;
  --ink-dim: #776f60;
  --acid: #d4a843;      /* ember gold — the realm's one accent */
  --acid-hot: #e2b44d;
  --cyan: #d4a843;""", p)
s = sub(s, """  --common: #9aa4b2;
  --rare: #4c8dff;
  --epic: #b45bff;
  --legendary: #ffb52e;""",
"""  --common: #98928a;    /* footman iron */
  --rare: #6f9bd1;      /* knight steel-blue */
  --epic: #a678d4;      /* highlord amethyst */
  --legendary: #e0a63c; /* sovereign gold */""", p)

# serif display everywhere Aldrich was
s = s.replace("'Aldrich', sans-serif", "'Cinzel', serif")
assert "'Aldrich'" not in s

# retint background washes + grain hue to ember
s = sub(s, "radial-gradient(1000px 640px at 85% -12%, rgba(184, 230, 92, .045), transparent 62%),",
        "radial-gradient(1000px 640px at 85% -12%, rgba(212, 168, 67, .05), transparent 62%),", p)
s = sub(s, "radial-gradient(820px 520px at -8% 108%, rgba(184, 230, 92, .03), transparent 60%),",
        "radial-gradient(820px 520px at -8% 108%, rgba(212, 168, 67, .035), transparent 60%),", p)
s = sub(s, """    linear-gradient(rgba(184, 230, 92, .05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(184, 230, 92, .05) 1px, transparent 1px);""",
"""    linear-gradient(rgba(212, 168, 67, .045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(212, 168, 67, .045) 1px, transparent 1px);""", p)
s = sub(s, ".glow.a { top: -140px; left: -100px; width: 420px; height: 420px; background: #0e1526; opacity: .7; }",
        ".glow.a { top: -140px; left: -100px; width: 420px; height: 420px; background: #1a140c; opacity: .75; }", p)
s = sub(s, ".glow.b { bottom: -180px; right: -140px; width: 480px; height: 480px; background: #23331c; opacity: .22; }",
        ".glow.b { bottom: -180px; right: -140px; width: 480px; height: 480px; background: #33230f; opacity: .28; }", p)

# accent-tinted chrome that referenced the old green rgba
s = s.replace("rgba(191, 246, 88, .6)", "rgba(212, 168, 67, .55)")
s = s.replace("rgba(191,246,88,.25)", "rgba(212,168,67,.25)")
s = s.replace("rgba(191,246,88,.5)", "rgba(212,168,67,.5)")
s = s.replace("rgba(110, 255, 0, .55)", "rgba(212, 168, 67, .5)")
s = s.replace("rgba(110, 255, 0, .7)", "rgba(226, 180, 77, .6)")
s = s.replace("rgba(110, 255, 0, .5)", "rgba(212, 168, 67, .45)")
s = s.replace("rgba(164, 230, 53, .4)", "rgba(212, 168, 67, .38)")
s = s.replace("rgba(191, 246, 88, .35)", "rgba(212, 168, 67, .32)")
s = s.replace("rgba(184, 230, 92, .3)", "rgba(212, 168, 67, .3)")
s = s.replace("rgba(184, 230, 92, .06)", "rgba(212, 168, 67, .06)")
s = s.replace("rgba(184, 230, 92, .4)", "rgba(212, 168, 67, .4)")
s = s.replace("color: #06210a;", "color: #241703;")
s = s.replace("color: #081c8d;", "color: #241703;")

# brand mark: gold gradient
s = s.replace("background: linear-gradient(135deg, var(--acid), var(--acid-hot));",
              "background: linear-gradient(135deg, #caa03f, #e6bd5e);")

# lore block styling
s += """
/* codex chronicle */
.lore { max-width: 64ch; border-left: 2px solid rgba(212, 168, 67, .35); padding-left: 22px; margin-bottom: 8px; }
.lore p { color: var(--ink-muted); font-size: 14.5px; line-height: 1.75; margin: 0 0 14px; text-wrap: pretty; }
.lore b { color: var(--ink); font-weight: 600; }
"""
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("style.css retinted for Emberfall")
