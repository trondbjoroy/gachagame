# v4 economy: no game token — HTR + NFTs + Ember points

Decision (2026-07-23): **drop the tradeable GEMS token.** The game uses only:

- **HTR** — the one real-money currency. On-ramp for acquisition (pulls) and
  power upgrades, plus the marketplace fee. Mainnet prices are quoted in **USD**
  and settled in HTR at spot; the UI never shows a fixed HTR number as "the price".
- **NFTs** — the champions (1-of-1 tokens), the only tradeable assets.
- **Ember** — a **closed in-game points balance**, formerly GEMS. Earned by
  mining / delving / winning, spent inside the game. **Never a token, never
  withdrawable, never priced.** No backing, no inflation-to-value, no securities
  surface. (This deletes the whole GEMS-token machinery: `create_deposit_token`
  for gems, `withdraw_gems`, `deposit_gems`, the collateral/backing logic, and
  the M4 `gem_liability` reserve — all become unnecessary.)

## What costs what

| Action | Currency | Mainnet price | Notes |
| --- | --- | --- | --- |
| **Pull** | HTR | **$2.50** equiv, USD-quoted, HTR at spot | never a fixed HTR number |
| **Temper** (raise an aspect) | HTR | **$0.50–$5 by tier** (see table) | power upgrade → real money |
| **Fuse** | *(open — see fork)* | — | is fusion a paid upgrade or an Ember sink? |
| **Boss (writ) entry** | Ember | points | keeps the mine loop meaningful |
| **Duel / side-bet wager** | Ember | points | competitive, no real-money stake (legal plus) |
| **Cosmetics (frames/tints)** | Ember | points | |
| **Cosmetics (epithets)** | relic shards | delve drops | unchanged |
| **Marketplace sale** | HTR | **5% fee, paid by the lister** | on sale; today it's 2% buyer-side — flips to lister |

Ember stays the free-play economy: mine → spend on boss entry, wagers, and
cosmetics, and climb renown/leaderboard. HTR is what you spend to acquire new
champions and permanently upgrade stats. Free players compete forever on Ember;
paying players acquire and upgrade faster.

## THE ONE FORK TO CONFIRM: is fusion an HTR upgrade or an Ember sink?

Fusion (2 same-tier cards → 1 higher tier) is both "a card upgrade" (→ HTR by
the rule above) and the core free-progression ladder (Footman→Sovereign).
- **Fusion = Ember (recommended):** you already pay by burning/parking two cards;
  keeping the fee in Ember preserves the F2P climb and avoids a real-money prompt
  on a frequent, core action. HTR upgrades are then just **temper** (optional
  min-maxing) — a clean, non-mandatory money sink.
- **Fusion = HTR:** every rung of the ladder costs real money ($0.50–$5 by the
  tier being forged). More revenue, but steep, and climbing to Sovereign becomes
  a paid gauntlet — likely hurts F2P retention.

## Proposed mainnet HTR price tables (tune freely)

Temper by the champion's tier (Footman/Knight/Highlord/Sovereign):

| Tier | USD | rationale |
| --- | --- | --- |
| Footman | $0.50 | cheap early min-maxing |
| Knight | $1.50 | |
| Highlord | $3.00 | |
| Sovereign | $5.00 | top end of the stated range |

(If fusion is also HTR, mirror the same $0.50→$5 curve by the tier being forged.)

## USD → HTR settlement (the pricing cron)

Hathor nano contracts have no native price oracle, so the contract holds prices
in **HTR-cents**, and an off-chain cron pegs them to the USD targets:

1. `scripts/price_peg.py` (new) fetches HTR/USD spot (exchange API), computes
   `htr_cents = round(usd_target / spot * 100)`, and calls the owner-only
   setters (`set_pull_price`, `set_temper_prices`, and `set_fuse_prices` if
   fusion is HTR) when the price has drifted beyond a threshold (e.g. >2%).
2. Runs every few minutes via cron (same host as the season/raffle crons).
3. The UI reads the current on-chain HTR price and shows **"$2.50 (≈ X HTR)"** —
   USD is the quote, HTR is the live settlement amount. `pull()` still requires
   the exact current HTR price; if the peg updates mid-flight the client rebuilds
   (same as today).

Trust/lag notes: the operator is the price-setter (centralization point);
between cron ticks a player can pay slightly stale HTR (bounded by the drift
threshold). Acceptable and standard.

## Testnet (now)

Test HTR is free, so keep it simple but **exercise the same payment paths** the
mainnet economy uses (so we don't ship an untested checkout):

- **Pull:** 1 HTR (unchanged).
- **Temper / (fuse if HTR):** a nominal test-HTR amount by tier, e.g. 0.10 /
  0.20 / 0.50 / 1.00 HTR — enough to test the HTR-upgrade flow end to end.
- **Ember:** the current mine/fusion/wager numbers, just renamed from GEMS.
- **No price cron on testnet** — fixed HTR amounts; the cron is a mainnet concern.

## Blueprint changes (v4, pending publish — good timing, mainnet not live)

- Remove: GEMS `create_deposit_token`, `withdraw_gems`, `deposit_gems`, the
  mint-collateral/backing logic, `gem_liability` + the M4 reserve, `get_gem_liability`.
- Rename internally: `gems_ledger`→`ember_ledger`, `gems_uid` gone, all "gems"
  copy → "Ember".
- `temper` (and `fuse` if HTR): take an **HTR deposit** action of the current
  tier price instead of debiting the ledger; the HTR feeds `proceeds`.
- Add owner setters + views for the HTR upgrade prices; keep `set_pull_price`.
- Market: fee flips to **5%, charged to the lister on sale** (deduct from the
  seller's HTR proceeds, not the buyer).
- Update `scripts/v4_playground_test.py` for the new flows.

## Frontend / proxy / docs (v4 adaptation)

- Rename GEMS→Ember across UI, guide, both FAQs, tutorial, promo.
- Remove the withdraw/deposit-gems UI; temper/fuse become HTR flows (USD label +
  live HTR).
- Proxy `METHODS`: temper/fuse validators take HTR deposits; drop gems withdraw/deposit.
- Economy doc + guide rewrite to match.
