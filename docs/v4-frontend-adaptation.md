# v4 frontend adaptation checklist

## LIVE ON TESTNET-INDIA (2026-07-24)

Hathor published the v4 blueprints (byte-identical to our validated sources):

| Contract | Blueprint (india) | Instance |
| --- | --- | --- |
| Arena | `00a9206990837c936369bb12711be4a5c3e96d736175e367579992d8f9d84e95` | `00c7aaa25c90c5be834df9e99d731bb6024df68f5ef63dba0878cb7c0dfe4bdd` |
| Market | `00356e32686ea741b1a9d027bdf00e3c1e3563553f0d7ae1c2921c91af816d81` | `000000001bc502cf793a7343de99816f574b3b7839e4bd21d8d680afabc799fb` |

Seeded by `scripts/launch_v4.py`: pull 1 HTR, weights 60/30/9/1, delve 8h,
card_unit=1, market fee_bps=500. Branch config/server point at this realm.
MIGRATED + CUT OVER 2026-07-24 (user-approved): scripts/migrate_v4.py
consolidated v3 identities per name lineage (adopt_player: Ember incl.
wallet GEMS + unclaimed accruals, renown, deeds, wins, pulls; report in
scripts/migration-report.json). v3 cards cannot enter a card_unit=1 realm
(100-unit tokens) — owners were refunded HTR at fusion-equivalent tier
rates [1,2,5,9]; shards and gauntlet progress are not adoptable (small,
reported losses). Season/raffle crons repointed; their VPS state files
reset at cutover.

FUTURE (next blueprint revision): Hathor confirmed the events API stays
off on public nodes, but `syscall.log(...)` output IS served by the logs
API — add outcome logs (duel winner + rounds, delve haul) to the methods
then and replace the feed's state-diff inference with log reads.

## Validated v4 blueprints (playground)

These are the **de-tokenized** (Ember, no GEMS token) blueprints, validated
2026-07-24 — they supersede the 007734c8/00301f57 pair:

| Contract | Blueprint hash |
| --- | --- |
| Gacha (EmberfallArena) | `000f4ae9ea365e48bb925f847a12f5c279f29b869c5fe9a676a16e2fcbf9f383` |
| Market (EmberfallCardMarket) | `008eb85b7b08806a12702cff4efe4465e13bb11b13642bc1292a31bcda641d56` |

Validation summary (2026-07-24, arena contract `00b03c0a…`, market `009f30fe…`):
all 47 arena checks green (session delegation escrow, park-not-melt fusion,
card_unit=1, unwagered-duel rules, commit-reveal stances, side-bets settle/
refund/cancel, `withdraw_gems` gone, Ember stays on the ledger, proceeds
withdraw unreserved) plus all 7 market checks at **fee_bps=500** (seller nets
price −5%, fee accrues to owner, authenticity view, card_unit=1 escrow).
One wallet-headless stall mid-run was resumed via `scripts/v4_resume_test.py`;
one assertion bug (owner collects rakes even when losing) fixed in the harness.
Re-run `scripts/v4_playground_test.py` + `scripts/v4_market_fee_test.py`
against a fresh publish if the blueprints change again.

## Work items — STATUS 2026-07-24 (branch `v4-frontend`)

Items 2–7 are DONE on branch `v4-frontend` and verified in a live browser
acceptance run against the playground v4 instance (session identity parity
held with zero drift; a sealed stance duel with a side bet settled through
the UI; in-session actions accrued to the main address on-chain). Details:

1. **Instantiate + seed** — REMAINS for launch day: run `scripts/launch_v4.py`
   (env ARENA_BP/MARKET_BP/NODE_URL) once Hathor publishes on testnet-india,
   then paste the ids it writes into `frontend/public/config.js` and
   `frontend/server.js` (NC/MARKET_NC). Config currently points at the
   playground instance for development.
2. **Session delegation flow** — DONE: `startSession` sends `offer_session`
   (one wallet approval, escrowing the float), the session key's first
   promptless tx is `accept_session` (withdraws the escrow, binds); resume
   paths poll contract state; lineage aggregation and name auto-reclaim
   deleted. Known lib quirk handled: the FIRST nano tx on a freshly-synced
   empty wallet can stall inside wallet-lib — `bindSession` times out at 45s
   and retries once on a reopened wallet.
3. **card_unit** — DONE: `CARD_AMT` reads `config.cardUnit` (1 on v4); the
   proxy reads `CARD_UNIT` env (default 1).
4. **Duel stances** — DONE: stance row in the pick dialog, browser-side
   SHA3-256 seal (`sha3.js`, verified bit-exact vs hashlib), salts stored
   before the tx and adopted onto duel ids after confirm, REVEAL and
   CLAIM FORFEIT affordances with the 6h window.
5. **Spectator side-bets** — DONE: BACK CHALLENGER/DEFENDER on open and
   awaiting-reveal duels, live pool display; settlement is contract-side.
6. **park-not-melt fusion** — DONE: all "burned" copy now says sealed in the
   contract's vault; docs synced.
7. **Server proxy** — DONE for the duel surface (create with commitment,
   stance accept, reveal, forfeit, place_bet). Deliberate deviation: the
   session methods (`offer_session`/`accept_session`/`revoke_session`) are
   NOT in the proxy allowlist — that path signs with the shared demo wallet,
   which must never delegate itself; real sessions sign their own nano txs
   in the browser.

Dev conveniences added for playground testing (harmless in prod):
`?devmain=1` boots a browser-held main wallet (Snap/WC cannot reach the
playground); `config.js` uses the playground node + local miner off-domain;
`GAME.txMiningUrl` lets session-lib target a local tx-mining service;
`miner/miner.py` now answers CORS.

## No game token — GEMS → Ember points (see docs/v4-economy.md)

The v4 blueprint is de-tokenized (done 2026-07-23): no GEMS token; **Ember** is a
closed points ledger. Frontend/proxy status:

- **DONE 2026-07-24 on branch `v4-frontend`** (commit f8660bb; merge when the
  game repoints to v4 — main stays deployable against the live v3 realm):
  GEMS → Ember rename across UI/guide/FAQs/tutorial/landing/promo, whole-point
  display (no `/100`), withdraw/deposit UI and wallet/ledger split removed,
  method renames (`get_ember_balance`/`claim_ember`/`get_pending_ember`),
  proxy `METHODS` updated (`withdraw_gems`/`deposit_gems` dropped), market fee
  copy 2% → 5%, `docs/economy.md` rewritten.
- **DONE 2026-07-24 (main):** `scripts/price_peg.py` — the mainnet USD→HTR
  pull-price cron (dry-run by default, 2% drift threshold, plausibility and
  2x-step rails). Mainnet-only; not installed on the VPS.
- **Remaining at v4 launch:** UI shows "$2.50 (≈ X HTR)" quoting (mainnet);
  instantiate the v4 market with **fee_bps=500** on testnet-india (the fee
  math is E2E-verified on the playground).

## Acceptance: session identity parity (the reason delegation exists)

This is the concrete bug delegation must close (reported 2026-07-23): a player
who is **"Desktop", level 5** in non-session play becomes **nameless, level 4**
the moment they start a quick-play session, because v3 keys all state per
address and the session is a fresh address. v4 binds the session to the main
identity, so this must hold once delegation is wired:

- Starting/ending a session **never changes** the displayed banner name.
- **Level and achievements are identical** in and out of a session (the main
  wallet's held, unstaked champions count either way — under delegation the
  contract attributes them to the main identity, so no wallet-visibility gap).
- **Renown, wins, gems, vigil streak, gauntlet progress** are identical in and
  out of a session.
- No name auto-reclaim transaction is needed; the name simply belongs to the
  main address the session delegates to.

Verify by: connect main wallet, note name/level/renown/wins/gems; start a
quick-play session; confirm all five are unchanged; do an action in-session;
end the session; confirm the main reflects it. All must match with zero drift.
