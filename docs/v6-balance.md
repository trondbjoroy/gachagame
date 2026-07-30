# v6 blueprint queue

Changes that need a new blueprint publish — they alter method logic, not
owner-settable parameters, so `scripts/retune_economy.py` could not apply
them to the live v5 contract. Collect them here so the next publish ships
them all at once (one publish ask to Hathor, as with v5).

Remember the protocol cap: NC_ON_CHAIN_BLUEPRINT_CODE_MAX_SIZE_COMPRESSED
is 24,000 bytes zlib-compressed; v5 sits at ~22,700. Check size before
publishing. v6 features may force a second contract.

## From the 2026-07-28 balance review

1. **Fusion at 3:1** — two parents into one child collapses the rarity
   ladder too fast even at the retuned fees; three parents per child.
2. **Boss floor reads BIRTH power** — `fight_world_boss`'s minimum-power
   gate currently reads the champion's tempered power, so tempering
   trivially clears it. Store power-at-mint and gate on that.
3. **Boss entry fees scale ×1/×3/×9 by tier** — today's `fee//5` per-tier
   derivation from the fusion-fee array gives ×1/×3.3/×13.3; the docs
   promise ×1/×3/×9. Make the contract match the docs.
4. **Hardening only from ranked and tournament wins** — open duels can be
   Sybil-farmed between a player's own wallets even with the wager gate;
   ranked (matchmade) and tournament (bracketed) wins cannot.
5. **24-hour cap on unclaimed mining accrual** — idle accrual currently
   grows without bound; cap the claimable window at 24h of the card's
   rate so mining requires showing up.

## Side-bet ring (user requests, 2026-07-30)

6. **`cancel_bet(duel_id)`** — a spectator can withdraw their backing and
   be refunded while the duel is still open or awaiting reveal (the same
   window `place_bet` accepts). Refund from `bet_pool`, tombstone the
   `bet_addr/bet_side/bet_amt` slot (amount 0), leave `bet_count` alone so
   later keys stay stable; `_settle_bets` already pays by amount so a
   zeroed slot is a no-op. The client then swaps YOUR BET IS IN for a
   WITHDRAW BET control.
7. **Refuse backing both sides** — `place_bet` should scan the caller's
   existing bets on the duel and refuse a second side. The client already
   refuses it (b=185), but the contract allows it, where it only donates
   rake; close it at the source of truth.
