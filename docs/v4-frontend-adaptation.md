# v4 frontend adaptation checklist

The v4 blueprints are written and validated on **testnet-playground**; they are
**not yet published on testnet-india**. Once the Hathor team publishes them,
the frontend must be adapted to the new session-delegation model and the other
v4 features before the game is repointed at v4.

## Validated v4 blueprints (playground)

| Contract | Blueprint hash |
| --- | --- |
| Gacha (EmberfallArena) | `007734c82c69a9a4fee7d4aaa00b5eeeac80436eac611d6858ce9185f4a3aacb` |
| Market (EmberfallCardMarket) | `00301f5765353675acaa056f590d49137313921d9dceeeba250d99c457f695d3` |

Validation summary: gameplay 47/48 (the 1 fail is a test-assertion artifact —
acceptor==owner collects rakes/bounties, the pot conserves), M4 gem-liability +
reserve gate PASS, M3 per-card first-clear PASS, H1 market authenticity PASS.
Re-run `scripts/v4_playground_test.py` against a fresh publish if the blueprints
change again.

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
