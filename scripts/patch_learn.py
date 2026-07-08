import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# ---- index.html: Learn tab + pane ----
p = "frontend/public/index.html"
s = open(p, encoding="utf-8").read()
s = s.replace('<button data-tab="market" class="tab">Market</button>',
              '<button data-tab="market" class="tab">Market</button>\n    <button data-tab="learn" class="tab">Learn</button>')

pane = """
  <section class="shelf tabpane" id="pane-learn" hidden>
    <h2>How to play</h2>
    <ol class="guide">
      <li>
        <h3>Connect a wallet</h3>
        <p>Click the wallet chip in the header. The <b>Demo wallet</b> is a shared,
        zero-setup wallet that works instantly &mdash; best for trying the game.
        <b>MetaMask (Hathor Snap)</b> and <b>WalletConnect</b> pair your own wallet;
        they connect today, and signing goes live once the game is deployed on a
        network the official wallets serve.</p>
      </li>
      <li>
        <h3>Get HTR</h3>
        <p>Pulls cost <span class="mono">0.05 HTR</span>. On the playground network the
        <a href="https://faucet.hathor.dev" target="_blank" rel="noopener">faucet</a> sends
        1 HTR per day &mdash; that is 20 pulls.</p>
      </li>
      <li>
        <h3>Pull a card</h3>
        <p>Hit <b>PULL</b>. The contract rolls a rarity tier
        (<span class="mono">60% common &middot; 30% rare &middot; 9% epic &middot; 1% legendary</span>),
        picks a card, and mints it as a unique token with a random <b>power</b> stat.
        Rarer tiers roll higher power. The draw settles when the next block confirms,
        usually 30&ndash;90 seconds; a corner toast tracks it while you keep playing.
        When it lands, claim the card to your wallet.</p>
      </li>
      <li>
        <h3>Farm GEMS</h3>
        <p>Stake cards from your collection to earn <b>GEMS</b> per minute:
        <span class="mono">0.01 common &middot; 0.03 rare &middot; 0.10 epic &middot; 0.40 legendary</span>.
        Earnings accrue to your in-game ledger &mdash; claim them any time, and withdraw
        ledger GEMS to your wallet as real tokens whenever you want. GEMS pay for
        fusion and duel wagers.</p>
      </li>
      <li>
        <h3>Fuse duplicates</h3>
        <p>Select two cards of the same tier in your collection and hit <b>FUSE</b>
        (costs <span class="mono">0.05 GEMS</span> from your ledger). Both cards are
        burned and you receive a card of the next tier that inherits 10% of the
        parents&rsquo; combined power. Legendary cards cannot be fused further.</p>
      </li>
      <li>
        <h3>Fight in the arena</h3>
        <p>Open a duel with any card and an optional GEMS wager, or accept someone
        else&rsquo;s. The contract rolls a number below
        <span class="mono">powerA&nbsp;+&nbsp;powerB</span> &mdash; your chance to win is
        your card&rsquo;s share of the total power. Winner takes the pot minus a 5%
        house rake. Cards always return to their owners; only the wager is at risk.</p>
      </li>
      <li>
        <h3>Trade on the market</h3>
        <p><b>SELL</b> lists a card at your asking price in HTR (2% fee on sale,
        proceeds withdrawable from the Market tab). <b>TRADE</b> offers your card
        for one specific card you want. Buying or swapping escrows through the
        market contract &mdash; claim your side from the escrow shelf after it settles.</p>
      </li>
    </ol>

    <h2 class="mt">Questions</h2>
    <div class="faq">
      <div class="qa"><h4>Why does every action take about a minute?</h4>
        <p>Every move is a real blockchain transaction. It confirms when the next
        Hathor block includes it &mdash; typically 30&ndash;90 seconds. Nothing is
        simulated; the toast in the corner shows the live status.</p></div>
      <div class="qa"><h4>Is the randomness fair?</h4>
        <p>Draws use Hathor&rsquo;s built-in ChaCha20 RNG inside the contract. The seed
        comes from consensus, every node computes the same result, and no server
        (including ours) can influence or predict a roll.</p></div>
      <div class="qa"><h4>What exactly is a card?</h4>
        <p>A real Hathor token with a fixed supply of 100 base units (shown as
        &ldquo;1.00&rdquo;), minted by the game contract with its name, tier, and power
        recorded onchain. It sits in your wallet like any other token and always moves
        as one indivisible piece.</p></div>
      <div class="qa"><h4>What backs GEMS?</h4>
        <p>GEMS is a token created and minted by the game contract. Minting requires
        HTR collateral, which comes from pull proceeds &mdash; so the reward pool is
        funded by play, not by a promise.</p></div>
      <div class="qa"><h4>Ledger GEMS vs wallet GEMS?</h4>
        <p>The ledger is your balance inside the contract &mdash; where farming rewards
        land and what fusion fees and wagers draw from. Wallet GEMS are real tokens you
        hold. Move between them any time with WITHDRAW and DEPOSIT on the Farm tab.</p></div>
      <div class="qa"><h4>Can I lose my cards?</h4>
        <p>Only one action destroys cards: fusion burns both parents. Duels never take
        cards &mdash; win or lose, your fighter returns and only the GEMS wager changes
        hands. Staked, listed, and escrowed cards are always recoverable by you.</p></div>
      <div class="qa"><h4>My own wallet says &ldquo;Invalid blueprint ID&rdquo;.</h4>
        <p>Your wallet runs on a different Hathor network than this deployment
        (testnet-playground). Use the Demo wallet for now; Snap and WalletConnect
        signing activates when the game moves to the public testnet or mainnet.</p></div>
      <div class="qa"><h4>Is any of this real money?</h4>
        <p>No. Everything runs on a Hathor test network with valueless test HTR.
        The mechanics are real; the money is not.</p></div>
      <div class="qa"><h4>Where is the code and the contract?</h4>
        <p>The contract source, frontend, and deployment scripts are open at
        <a href="https://github.com/trondbjoroy/gachagame" target="_blank" rel="noopener">github.com/trondbjoroy/gachagame</a>.
        The contract ID is in the footer &mdash; you can audit every rule described here.</p></div>
      <div class="qa"><h4>What are the odds of a legendary?</h4>
        <p>1% per pull, rolled independently each time. Or skip luck entirely: fuse
        two epics. Two epics take four rares; four rares take eight commons &mdash;
        a guaranteed legendary from 14 fusions&rsquo; worth of cards.</p></div>
    </div>
  </section>
"""
s = s.replace('  <footer><span id="contractLink" class="mono"></span></footer>',
              pane + '\n  <footer><span id="contractLink" class="mono"></span></footer>')
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("index.html: learn pane")

# ---- app.js: register the pane ----
p = "frontend/public/app.js"
s = open(p, encoding="utf-8").read()
s = s.replace("for (const p of ['collection', 'farm', 'arena', 'market']) $('pane-' + p).hidden = p !== el.dataset.tab;",
              "for (const p of ['collection', 'farm', 'arena', 'market', 'learn']) $('pane-' + p).hidden = p !== el.dataset.tab;")
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("app.js: tab registered")

# ---- style.css: guide + faq ----
p = "frontend/public/style.css"
s = open(p, encoding="utf-8").read()
s += """
/* learn page */
.guide { list-style: none; margin: 0; padding: 0; counter-reset: step; max-width: 64ch; }
.guide li { counter-increment: step; position: relative; padding: 0 0 30px 58px; }
.guide li::before {
  content: counter(step, decimal-leading-zero);
  position: absolute; left: 0; top: 1px;
  font-family: 'Fragment Mono', monospace; font-size: 13px; color: var(--acid);
  border: 1px solid rgba(184, 230, 92, .3); border-radius: var(--r-sm);
  padding: 6px 8px; background: rgba(184, 230, 92, .06);
}
.guide li:not(:last-child)::after {
  content: ''; position: absolute; left: 16px; top: 40px; bottom: 8px;
  width: 1px; background: var(--line);
}
.guide h3 { margin: 2px 0 7px; font-size: 16.5px; font-weight: 700; letter-spacing: -.01em; }
.guide p { margin: 0; color: var(--ink-muted); font-size: 14px; line-height: 1.7; text-wrap: pretty; }
.guide a, .faq a { color: var(--acid); text-decoration-color: rgba(184, 230, 92, .4); }

.faq { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 26px 34px; }
.faq .qa h4 { margin: 0 0 7px; font-size: 14.5px; font-weight: 700; letter-spacing: -.005em; }
.faq .qa p { margin: 0; color: var(--ink-muted); font-size: 13.5px; line-height: 1.65; text-wrap: pretty; }
@media (max-width: 700px) { .faq { grid-template-columns: 1fr; } }
"""
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("style.css: learn styles")
