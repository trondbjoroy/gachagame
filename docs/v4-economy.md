# v4 economy: no game token — HTR + NFTs + Ember points

Decision (2026-07-23): **drop the tradeable GEMS token.** The game uses only:

- **HTR** — the one real-money currency. On-ramp for acquisition (pulls) plus
  the marketplace fee (nothing else). Mainnet prices are quoted in **USD**
  and settled in HTR at spot; the UI never shows a fixed HTR number as "the price".
- **NFTs** — the champions (1-of-1 tokens), the only tradeable assets.
- **Ember** — a **closed in-game points balance**, formerly GEMS. Earned by
  mining / delving / winning, spent inside the game. **Never a token, never
  withdrawable, never priced.** No backing, no inflation-to-value, no securities
  surface. (This deletes the whole GEMS-token machinery: `create_deposit_token`
  for gems, `withdraw_gems`, `deposit_gems`, the collateral/backing logic, and
  the M4 `gem_liability` reserve — all become unnecessary.)

## What costs what

DECIDED (Option A, 2026-07-23): **HTR is charged only where value is created or
transferred — pulls and the marketplace fee. Everything you do with champions
you already own runs on Ember.**

| Action | Currency | Mainnet price | Notes |
| --- | --- | --- | --- |
| **Pull** | HTR | **$2.50** equiv, USD-quoted, HTR at spot | never a fixed HTR number |
| **Temper** (raise an aspect) | Ember | points | already Ember today |
| **Fuse** | Ember | points | already burns 2 champions; fee stays Ember |
| **Boss (writ) entry** | Ember | points | |
| **Duel / side-bet wager** | Ember | points | competitive, no real-money stake (legal plus) |
| **Cosmetics (frames/tints)** | Ember | points | |
| **Cosmetics (epithets)** | relic shards | delve drops | unchanged |
| **Marketplace sale** | HTR | **5% fee, paid by the lister** | already lister-side (seller nets price−fee); just raise fee_bps 200→500 |

Rationale: acquisition is already fully gated behind HTR ($2.50/pull, and all 180
champions come from pulls), plus 5% on every secondary sale — a strong, proven
revenue base. Charging again for each upgrade squeezes the deck-building loop that
keeps players engaged between purchases, and fusion already destroys ~$5 of pulled
champions per forge. So Ember carries the whole in-game economy (mine → fuse,
temper, boss entry, wagers, cosmetics); free players build and compete forever on
earned Ember, paying players acquire faster.

## USD → HTR settlement (the pricing cron)

Hathor nano contracts have no native price oracle, so the contract holds prices
in **HTR-cents**, and an off-chain cron pegs them to the USD targets:

1. `scripts/price_peg.py` (new) fetches HTR/USD spot (exchange API), computes
   `htr_cents = round(2.50 / spot * 100)` and calls `set_pull_price` when the
   price has drifted beyond a threshold (e.g. >2%). Pulls are the only USD-priced
   action, so this is the only price it pegs.
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
- **Ember:** the current mine / fusion / temper / wager numbers, just renamed
  from GEMS. No HTR-upgrade path (Option A), so nothing else changes on testnet.
- **No price cron on testnet** — fixed 1 HTR pulls; the cron is a mainnet concern.

## Blueprint changes (v4, pending publish — good timing, mainnet not live)

- Remove: GEMS `create_deposit_token`, `withdraw_gems`, `deposit_gems`, the
  mint-collateral/backing logic, `gem_liability` + the M4 reserve, `get_gem_liability`.
- Rename internally: `gems_ledger`→`ember_ledger`, `gems_uid` gone, all "gems"
  copy → "Ember".
- `temper` / `fuse`: unchanged mechanics — keep debiting the Ember ledger
  (just renamed). No HTR upgrade path.
- Keep `set_pull_price` (the cron pegs pulls to $2.50 on mainnet).
- Market (card_market.py): **no code change** — fee is already deducted from the
  seller's proceeds; instantiate the v4 market with **fee_bps=500** (5%).
- Update `scripts/v4_playground_test.py` for the new flows.

STATUS 2026-07-24: all of the above validated on testnet-playground — arena
blueprint `000f4ae9…` (47 checks green incl. no-withdraw Ember and unreserved
proceeds), market `008eb85b…` at fee_bps=500 (seller nets −5%, fee accrues).
`scripts/price_peg.py` written (dry-run default) on main; the frontend/proxy
sweep below is done on branch `v4-frontend` (see docs/v4-frontend-adaptation.md).

## Frontend / proxy / docs (v4 adaptation)

- Rename GEMS→Ember across UI, guide, both FAQs, tutorial, promo.
- Remove the withdraw/deposit-gems UI entirely; Ember never leaves the contract.
  Temper/fuse keep their Ember flows (renamed).
- Proxy `METHODS`: drop `withdraw_gems`/`deposit_gems`; temper/fuse validators unchanged.
- Economy doc + guide rewrite to match.
