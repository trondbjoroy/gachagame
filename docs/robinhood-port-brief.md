# Emberfall → Robinhood Chain: the porting brief

Written 2026-08-03 by the session that built the Hathor version, for the
fresh session that will build the EVM one. Read this first, then verify
the "verify before designing" list — chain facts move faster than briefs.

## How to use this

Start a new working folder (suggested: a sibling `emberfall-evm` repo so
project memories stay scoped). Copy or submodule what the "ports
untouched" section names. Design decisions live in "must be redesigned";
everything else is reference.

## The game, complete feature inventory

Emberfall is a fully onchain TCG. Live at app.emberfall.fun (Hathor
testnet), landing at emberfall.fun, guide at docs.emberfall.fun.

- **Summon** (gacha pull): pays the chain coin, mints a unique champion
  card — name from a 180-template catalog, rarity (Footman/Knight/
  Highlord/Sovereign at 60/30/9/1%), power and three aspects (attack/
  defense/cunning) rolled at mint. ~1-in-25 pulls refunds from a favor
  pool.
- **Mining**: stake a card, accrue Ember (closed in-game points, never a
  token) per minute by rarity (1/3/10/40 per hour). Recall after 8h+ is
  a trial. Accrual is lazy (computed from stake timestamp).
- **Temper**: pay Ember to raise one aspect of a staked card; rising
  costs, per-rarity caps; half the fee burned, half to the Crown.
- **Delve**: 8-hour gamble for a staked card; hauls: dust / ember seam /
  relic shards / ancient relic. Shards buy epithets (cosmetics).
- **Fusion**: two same-rarity cards + an Ember fee (half a day of the
  child's mine rate: 2160/7200/28800) => parents locked in contract
  vault forever, child of next rarity minted with 10% of parents' power
  as bonus. Sovereigns never fuse.
- **Duels**: best-of-three (aspect vs aspect), Ember wagers, 5% rake,
  hidden stances (commit-reveal: sha3(stance:salt), 6h reveal window,
  forfeit on timeout). Spectator side-bets on either side; winning pool
  splits losers' minus 5%.
- **3v3 squads**: three cards, sealed lane order (commit-reveal of a
  permutation), lanes pair off best-of-three, two lanes take the pot.
- **Ranked ladder**: queue at free/25/100 Ember, matched within 200
  Elo-ish rating, everyone starts at 1000.
- **Bosses (writs)**: 12 owner-posted bosses, three tiers each (Grim/
  Dire/Black at x1/x2/x4 aspects), fought by staked cards, 3 fights per
  card per day, entry fee, bounty pays 4x entry, first-clear bonuses,
  progression gates (beat boss N's Grim to reach N+1). Boss floor scales
  to the challenger: fights at >= 45/80/115% of your card's power.
- **World boss**: weekly, HP scales with active players, staked cards
  deal damage under guild banners, bounty by damage share.
- **Guilds**: 500 Ember (burned) to raise, free to join/leave.
- **Tournaments**: weekly bracket, Ember entry, one round a day,
  60/25/7.5 splits.
- **Market** (separate contract): fixed-price listings (5% lister-side
  fee) and card-for-card swaps, escrow settlement.
- **Sessions / quick play**: browser-held key funded once from the main
  wallet (10 HTR escrowed through the contract); the contract binds
  session=>identity so ALL per-player state accrues to the main address.
  Every action after that is promptless. Ending sweeps everything home.
- **Cosmetics**: frames/tints (Ember), epithets (shards). Identity only,
  never power. Written on the card, travel with it.
- **Progression**: renown (levels, 18 achievements), daily trials (one
  of 8 rotating, paid on-chain on first matching act), 8-week seasons
  with title payouts, weekly favor raffle (renown = tickets).
- **Names**: self-sovereign — a tiny tx burning 0.01 coin carrying
  `emberfall:name:X`; only your key can name your address.
- **World feed**: everything above narrated live.

## Current architecture (Hathor)

- `blueprint/gacha_arena_v5.py` — ONE Python nano contract (~2650
  lines) holding all game logic + `card_market.py` separate.
- `frontend/server.js` — node proxy/cache: card-state cache (the
  contract's per-card views are slow to read en masse), feed poller,
  seqnum map, share pages, rate limiting. Serves static frontend.
- `frontend/public/` — vanilla JS SPA (no framework, no build step):
  `app.js` (~4k lines), `wallets.js` (wallet adapters), `session-build/`
  (bundled wallet-lib for the in-browser session wallet), `catalog.js`
  (180 champions + flavor), `cards/` (all art).
- VPS (Caddy + systemd) at 104.105.106.165; deploy = git bundle + scp.
- Crons: weekly world boss post, hourly tournament advance.

## Ports untouched (copy these)

- Game design and every number above (docs/v6-balance.md holds queued
  changes — fold them into the EVM contract from day one: fusion 3:1,
  boss floor from birth power, hardening only from ranked/tournament
  wins, 24h accrual cap, trials for delve/world-boss/ranked/side-bets,
  one-transaction recalls).
- `catalog.js` + `frontend/public/cards/` art (and the landing).
- The UI: layout, copy (modern feature names, lore only in content),
  themes, tutorial, staged fight reveal, card frames (rank-as-material).
- The error-UX lessons (see "hard-won lessons").

## Must be redesigned

1. **Randomness — THE decision.** Hathor gives consensus-seeded ChaCha20
   inside the contract. EVM does not. Options: Chainlink VRF (if
   deployed on Robinhood Chain — verify), commit-reveal against a future
   blockhash (weak to sequencer, fine for testnet), or a VRF the chain
   itself blesses. Summons, duel rounds, delve hauls, favor draws all
   consume randomness. Async VRF changes UX: a summon becomes
   request->fulfill (two steps) — design the reveal around the wait.
2. **Cards**: native 1-unit tokens become ERC-721 (a marketing upgrade:
   real standard, wallet/marketplace support, tokenURI metadata with the
   art). Aspects/power/wins go in contract storage keyed by tokenId, and
   tokenURI renders them.
3. **Fees**: Hathor is feeless; an Orbit L2 is cheap, not free. The
   "feeless" pitch dies; "cents per move" replaces it. Batch reads are
   free (RPC), writes cost gas — the economy copy changes.
4. **Sessions**: rebuild on account abstraction (ERC-4337 session keys
   or an app-signer pattern). Cleaner than our offer/bind escrow — the
   identity-delegation CONCEPT ports, the mechanism is standard there.
5. **State reads**: no `/nano_contract/state?calls[]=`. Use view
   functions + multicall for the client, and EVENTS + an indexer (or
   ponder/subgraph) to replace the feed poller and card cache. The world
   feed becomes an event stream — strictly better than our polling.
6. **Nonces**: EVM nonces are native; the whole seqnum saga (server
   seqnum map, address_history pagination) does not exist there.
7. **Commit-reveal**: keccak256 instead of sha3-256; the client seal
   storage pattern (localStorage before tx) ports as-is.
8. **Market**: consider Seaport or a minimal escrow contract; ERC-721
   approvals replace deposit actions.

## Hard-won lessons that transfer (do these from day one)

- **Optimistic custody**: the moment a tx confirms, show the new state;
  let indexer/poll correct. We learned this five times (stake, delve,
  claims, fusion). On EVM with an indexer lag, same rule.
- **Lock buttons through the whole flow** (claim double-fire bought
  voided txs) and surface the CONTRACT's revert reason, mapped to plain
  words ("already on the way home"), never a generic failure.
- **Self-retry transport errors** (bounded: 3 attempts) and say
  "settling", not "retrying" — rapid play spends unconfirmed change.
- **A wallet-gated app needs every logged-out action to open connect**,
  not silently no-op.
- The four-typeface system, tab contrast, 44px touch targets, and the
  pinch-zoom lock (iOS needs gesturestart preventDefault, CSS is not
  enough).

## Do NOT port

- v3 relic handling, legacy contract discovery, fragment repair scripts,
  the seqnum endpoint, wallet-headless/miner rigs (Hathor-only).
- `scripts/demo-fixtures.json` (fictional company) — decide fresh.

## Verify before designing (chain facts, current as of 2026-08)

Robinhood Chain: Arbitrum Orbit L2 by Robinhood, announced for tokenized
assets (EU first). VERIFY with current docs/web search before any code:

1. Is there a public testnet? Faucet? Chain id, RPC, explorer?
2. Is deployment permissionless, or allowlisted (it may be a closed
   chain for tokenized equities — the port may need their partner
   program, which changes everything)?
3. Chainlink VRF / any oracle infra deployed there?
4. ERC-4337 bundler/paymaster infra available? (Paymaster sponsorship
   could resurrect the "feels free" UX.)
5. NFT marketplace/indexer ecosystem (Seaport? Reservoir? subgraph
   hosting?).
6. Gas token and typical costs; whether Robinhood sponsors gas.

If deployment is closed, consider the same port targeting a generic
Arbitrum Orbit testnet first — the code is identical, the chain is a
config value.

## Suggested first milestones

1. Verify chain access (above). 2. `EmberfallArena.sol` skeleton: mint
(with chosen RNG), stake/accrue/temper, fuse. 3. Port the frontend with
a `wallets-evm.js` adapter (viem) behind the same interface app.js
already consumes. 4. Duels + commit-reveal. 5. Indexer + feed. 6. The
rest of the feature inventory, then the v6-balance queue items.
