# v4 frontend adaptation checklist

The v4 blueprints are written and validated on **testnet-playground**; they are
**not yet published on testnet-india**. Once the Hathor team publishes them,
the frontend must be adapted to the new session-delegation model and the other
v4 features before the game is repointed at v4.

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

## Work items when v4 lands on testnet-india

1. **Instantiate + seed** the v4 gacha (180 templates, writs) and the v4 market
   (points at the v4 gacha, `card_unit=1`), then update `frontend/public/config.js`
   with the new `blueprint` / `nc` / `gems` / `market` ids.
2. **Session delegation flow** — replace the current fund-a-fresh-key session
   with the v4 offer/accept:
   - `offer_session(sessionAddr)` from the **main wallet**, escrowing the float
     (one prompt).
   - `accept_session()` from the **session key** (its first promptless tx),
     which withdraws the escrow and binds `delegate[session] = main`.
   - `revoke_session` to reclaim an unaccepted escrow.
   - Drop the client-side lineage aggregation and banner-name auto-reclaim once
     delegation is live — they become unnecessary (see §Acceptance).
3. **card_unit = 1** — cards are 1 unit in v4, not 100. Audit every deposit/
   withdrawal amount in `app.js` / `wallets.js` / `server.js` (`CARD_AMT`, the
   proxy's `cardDep`/`cardWd` `amount === 100` checks, the market's unit) and
   switch them to the realm's `card_unit`.
4. **Duel stances (commit-reveal)** — the create-duel UI must generate a stance
   + salt, store the salt locally, submit `sha3(stance:salt)` on create, and
   prompt the reveal to settle. Show the 6h reveal window / forfeit affordance.
5. **Spectator side-bets** — UI to place a bet on an open/awaiting-reveal duel
   (bettor ≠ duelist), and to show pools + settle payouts/refunds.
6. **park-not-melt fusion** — parents are parked in contract custody, not
   burned; the collection/fusion copy and any "burned" wording must change.
7. **Server proxy** — add the v4 methods (`offer_session`, `accept_session`,
   `revoke_session`, stance/reveal/forfeit, `place_bet`, bet settlement) to the
   `METHODS` allowlist in `server.js` with correct action/arg validators.

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
