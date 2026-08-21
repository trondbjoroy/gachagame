# Emberfall mainnet migration plan

Written 2026-08-16 from a full audit of the code, the VPS, and the on-chain
state. The testnet realm keeps running until the last step. Nothing in this
plan moves assets from testnet to mainnet: the test realm was a playtest,
and its cards stay where they are.

**What mainnet changes in one sentence:** every HTR becomes real money, and
every published blueprint becomes permanent, so the order of work inverts:
decide first, verify twice, deploy once.

Preparations already done alongside this plan:

- The session-wallet bundle derived addresses on a hardwired `testnet`
  network. It now follows `window.GAME.network` (session-lib v22), so the
  same bundle serves both realms. This was the only code that config alone
  could not switch.
- `deploy/config.mainnet-template.js` holds the cutover config with every
  mainnet-specific value marked `<TBD>`.
- The full testnet-assumption inventory is in Phase 4 below, with file and
  line for each.

---

## Phase 0 · Decisions (blocked on you, not on code)

- [ ] **D1: which blueprint goes to mainnet.** A mainnet contract cannot be
  patched. The v6 queue (docs/v6-balance.md) holds 11 items, several of
  which are balance fixes and player-facing repairs (one-transaction
  recalls, cancel_bet, `get_wb_attempts`), and your reveal-key branch adds
  the `get_duel_commit` view. **Recommendation: fold v6 and the reveal-key
  work into one blueprint, soak it on the testnet realm for two weeks, and
  publish that to mainnet.** Publishing v5 now means asking Hathor for a
  second mainnet publish within months.
- [ ] **D2: domains.** Does mainnet take `app.emberfall.fun` (testnet moves
  to `test.emberfall.fun` or retires), or does mainnet get a new home?
  Recommendation: mainnet takes the main domain; a live testnet realm moves.
- [ ] **D3: fresh start.** No cards, Ember, renown, or names migrate
  (decided earlier; v3-to-v5 migrations were possible because both sides
  were testnet). Optional gesture: an owner-op epithet or renown grant for
  the named testers (GauGau, MaBu, MyHan, Bahti4r0) on the new realm.
- [ ] **D4: economy numbers.** Already decided: summon $2.50 USD-quoted,
  settled in HTR at spot via the price-peg cron; market fee 5%; Ember stays
  closed points. Still open: `sessionFund` (10 HTR on testnet; on mainnet
  this is a real float sitting in browser storage: recommend the HTR
  equivalent of a few dollars), name claim cost (0.01 HTR is fine), and the
  launch-day fusion fees.
- [ ] **D5: kill the shared-wallet path.** `/execute` signs with an
  operator-funded wallet for walletless demo play. On mainnet that is free
  real money. Recommendation: disable it (`EXEC_CAP_GLOBAL=0` plus removal
  from the UI) rather than cap it.
- [ ] **D6: the mainnet EMBER token** (`000005358c…bccf`, minted 2026-07-24)
  stays out of the game. In-game Ember remains non-withdrawable points.
  Reconfirm, because wiring a token into the economy would reopen the whole
  v4 economy decision.
- [ ] **D7: rules of play page.** Summons are paid randomness and side bets
  are wagers between players. Before real money flows, decide what the
  site says about eligibility and terms, and get advice if you want it.
  This plan flags the question; it does not answer it.

## Phase 1 · The blueprint (after D1)

- [ ] Freeze the chosen blueprint. Check the compressed size early: the
  protocol caps on-chain blueprints at 24,000 bytes zlib-compressed, and
  v5+tournaments once silently exceeded it.
  `python -c "import zlib;print(len(zlib.compress(open('blueprint/gacha_arena_v6.py','rb').read())))"`
- [ ] Full E2E on testnet-playground with a self-published copy (the
  existing harnesses: the v5 suites plus new tests for every v6 item).
- [ ] Two-week soak on the live testnet realm with real players.
- [ ] **Ask Hathor (open question Q1): the mainnet publish process.** On
  testnet only they could publish blueprints. Confirm who publishes on
  mainnet, lead time, and whether the market blueprint (unchanged) needs a
  fresh mainnet publish too.
- [ ] Launch-day instantiation uses the existing script, which already
  verifies all 180 templates and every writ after seeding:
  `ARENA_BP=<hash> MARKET_BP=<hash> NODE_URL=https://node-partners.mainnet.hathor.network/v1a PULL_PRICE=<launch-day cents> python scripts/launch_v5.py`
  (twelve writs now: add The Ashen Regent and The Midnight Court to the
  script's list or post them with scripts/add_writs.py after launch.)

## Phase 2 · Keys and money (the part that cannot be redone)

- [ ] Generate a NEW operator seed for mainnet, offline, on your own
  machine. It never enters the repo, the chat, or a log. The VPS copy lives
  only in `/opt/gacha/wallet-seeds.js` (mode 600), like today's testnet seed.
- [ ] Decide the treasury split: a small working float on the VPS operator
  wallet (writ bounties, favor refunds, crons) and everything else in a
  wallet whose seed never touches the server. Sweep `withdraw_proceeds` to
  the cold wallet on a schedule.
- [ ] Fund the operator with the launch budget: instantiation, 180 template
  registrations, 12 writs, tournament seeds, and a month of cron gas.
  Measure the exact cost during the playground dry run and double it.
- [ ] The demo/player shared wallet does not start on mainnet (D5).
- [ ] VPS pass: rotate SSH keys if stale, confirm backups of names.json,
  feed-state.json, season and raffle state (per-realm files if both realms
  stay up), and add the mainnet seed file to the backup EXCLUDE list.

## Phase 3 · Infrastructure

- [ ] **Nodes.** Primary: `node-partners.mainnet.hathor.network/v1a`
  (verified 2026-07-17: synced, nano contracts enabled, no auth; re-verify
  at cutover). Fallback: none known yet. **Ask Hathor (Q2) for a second
  mainnet endpoint**; the whole failover design assumes two nodes, and the
  testnet pair proved why.
- [ ] **Tx mining (Q3).** Confirm the mainnet public tx-mining service URL
  and its rate limits; `txMiningUrl: null` only works if wallet-lib's
  default resolves per network.
- [ ] **Caddy.** New site block per D2; `/hnode` upstreams point at the two
  mainnet nodes with the same health-check settings the testnet pair uses
  now (10s probe timeout; the 4s probe benched healthy nodes).
- [ ] **Server env.** `NODE_URL`, `FALLBACK_NODE_URL`, `NC`, `MARKET_NC`
  via systemd environment rather than editing defaults, so one unit file
  diff captures the whole cutover. `LEGACY_NCS` and `RETIRED_UIDS` are
  empty on mainnet (they exist to keep testnet's adopted cards visible).
- [ ] **Crons.** New crontab entries with mainnet ids and fresh state
  files: season, weekly favor, world boss, tournament, plus
  `price_peg.py` (PEG_APPLY=1, $2.50 target, 2% drift band) which has
  never run in production. Dry-run it against the live mainnet price feed
  for a week before launch, watching only its log.
- [ ] **demo-fixtures.json is deleted** from the mainnet deployment before
  first boot. Add a startup guard: if the file exists and network is
  mainnet, the server refuses to start. Fictional feed lines on a real-money
  realm are not a cosmetic bug.

## Phase 4 · Frontend and copy cutover (the exact inventory)

Config and code:

- [ ] `frontend/public/config.js` ← `deploy/config.mainnet-template.js`
- [ ] `frontend/server.js:24-25` node defaults (or env, per Phase 3)
- [ ] `frontend/server.js:76-77` contract ids (or env)
- [ ] `frontend/server.js:1464` share-page text "Free on testnet."
- [ ] `frontend/public/app.js:17` explorer base → `explorer.hathor.network`
- [ ] `frontend/public/app.js:1037` faucet link → "top up from your wallet"
- [ ] `frontend/public/app.js:1975,1995,2821,3010` testnet copy and faucet
  mentions; the share text at 3010 says "Free on testnet"
- [ ] `frontend/public/tutorial.js:67` faucet line
- [ ] `frontend/public/index.html:62` the TESTNET flag under the wordmark;
  `:249-256` wallet-network FAQ; `:371` "on the public testnet"
- [ ] `frontend/public/promo-x.html:170` "PLAY FREE ON TESTNET"
- [ ] Landing `landing/index.html:379` "free to play on the test realm"
- [ ] Guide `guide/index.html:267,284,292-293,313,332,802,810-814,911`:
  faucet, "test realm" pricing, and the contract table. **Lines 813-814
  still link the retired v2.2 contract ids: wrong today, fix before
  mainnet regardless.**
- [ ] Sweep check at the end: `grep -rn "testnet\|faucet\|test realm" frontend/public landing guide` returns only intentional lines.

Both-realms note: if testnet stays up on another domain, it keeps its own
checkout of all of the above; nothing is shared except the repo.

## Phase 5 · Launch runbook

1. T-14d: Phase 0 decisions locked. Code freeze on the blueprint.
2. T-14d → T-1d: testnet soak of the mainnet-bound blueprint; price-peg
   dry-run logging daily.
3. T-2d: Hathor publishes the blueprint(s) on mainnet. Verify byte-identity
   against the repo copy, like the v5 publish was verified.
4. T-1d: operator seed generated and funded; VPS env and Caddy prepared on
   disk but not reloaded.
5. T-0, in order, each step verified before the next:
   a. Run the launch script against mainnet; verify ids, 180 templates,
      12 writs, pull price, fusion fees on chain by view calls.
   b. Swap config.js, server env, Caddyfile; deploy; restart.
   c. Smoke test with a real wallet and small money: summon, claim, stake,
      recall, a duel between two of your own wallets, a market listing,
      session start and end-session sweep. On mainnet this costs a few
      dollars; that is the price of knowing.
   d. Install the crons. Watch the first tournament and favor tick.
   e. Open the doors: landing copy, announcement.
6. Post-launch week: canary on NCFail rates in the feed poller log, node
   health, card-cache sweep completeness, and a daily `withdraw_proceeds`
   sweep until the schedule settles.

**Rollback truth:** the chain does not roll back. The frontend can repoint
to testnet in one deploy if mainnet must pause, and the testnet realm stays
alive for at least 30 days as the fallback experience. Money already spent
on mainnet stays spent, which is why step 5c is small and yours.

## Phase 6 · Security gate (before T-0)

- [ ] Re-run the 2026-07-23 audit checklist against the final blueprint.
- [ ] One independent adversarial review of the blueprint (fresh eyes on
  Ember conservation, custody paths, and the delegation flow).
- [ ] Session-key money: cap `sessionFund` (D4), confirm end-session sweeps
  in the smoke test, and keep the existing FAQ warning about clearing site
  data while a session holds funds.
- [ ] Secrets sweep: `git log -S` for seed material, confirm
  wallet-seeds.js gitignored, no seed ever in journalctl.
- [ ] Rate limits and the daily exec caps reviewed for a public real-money
  target; `/execute` disabled per D5.

## Open questions for Hathor (send early, they gate the timeline)

1. Mainnet blueprint publish: process, who signs, lead time, and whether
   the unchanged market blueprint needs a new mainnet publish.
2. A second mainnet node endpoint for failover, or their guidance for
   running our own.
3. The mainnet public tx-mining service URL and rate limits.
4. Partner-node rate limits on mainnet (the card-cache sweep sends ~200
   batched view requests every 10 minutes).

## What this plan deliberately does not do

- No testnet asset migration: decided, and technically moot (different
  realms, different tokens).
- No token launch: Ember stays points; the minted EMBER token stays idle
  unless D6 reopens.
- No date: the timeline hangs on D1 (v6 scope) and Hathor's publish lead
  time. With v6 frozen today, the runbook above fits in about three weeks.
