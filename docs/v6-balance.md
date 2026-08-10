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

## Daily trials for every feature (user request, 2026-07-30)

Today's trial table is kinds 0–7 (pull, stake, duel win, fuse, temper,
claim Ember, recall 8h+, writ won), with rotation `(day*5+2) % 8` and the
renown bonuses hardwired in `_trial_hit`. "Win a duel" already counts 1v1,
3v3 squad, and ranked wins — all three resolve paths hit kind 2. But the
v5 features have no trials of their own. Extend to twelve kinds:

| kind | trial                        | hook                | renown |
|------|------------------------------|---------------------|--------|
| 8    | Send a champion on a delve   | `begin_delve`       | 3      |
| 9    | Strike the world boss        | `fight_world_boss`  | 5      |
| 10   | Join the ranked ladder       | `join_ranked`       | 3      |
| 11   | Back a duelist with Ember    | `place_bet`         | 3      |

Rotation becomes `(day*5+2) % 12` — 5 is coprime with 12, so every trial
still comes around. The client's `TRIALS` list and `METHOD_KIND` map in
`frontend/public/progress.js` must be extended in the SAME deploy as the
v6 cutover; they mirror the contract's order and rotation exactly.

Chosen for daily completability: each is an act any connected player can
perform most days (the boss can die mid-week, but "win a duel" already
depends on an opponent showing up, so that precedent stands). Deliberately
left out:

- **Tournaments and guilds** — entering a tournament is only possible
  while registration is open, and joining a guild is a once-ish act, so
  as daily trials they would land on days where they cannot be done.
- **The Bazaar** — buys, sales, and trades settle on the market contract,
  which cannot call the arena's `_trial_hit`; a market trial needs
  cross-contract calls or a merged contract first.

## One-transaction recalls (user request, 2026-07-30)

Recalling a champion from a fight or queue is two chained confirmations
today: `cancel_duel` / `leave_ranked` / `leave_tournament` only mark the
card `pending`, and a separate `claim_card` walks it home — a 2-3 minute
wait that players read as a stuck transaction (and retry, buying voided
"card not pending" txs; the client now guards against that, b=188).

`unstake` already returns its card directly via a withdrawal action in
the same transaction. Give the three recall methods the same shape: the
caller attaches the withdrawal action(s) for the card(s) being freed
(three for a squad cancel), the contract validates they match the duel /
seat, and the champion is home in ONE confirmation. Client attaches the
actions at the v6 cutover.

Two-step `pending` must STAY wherever custody returns during someone
else's transaction — duel settles, reveals, forfeits (the winner's cards
free up in the opponent's tx, which cannot withdraw to them) — and for
`pull` (the token does not exist when the tx is signed, so it cannot be
named in a withdrawal action).

## Missing view: get_wb_attempts (2026-08-06)

`wb_attempts` is internal-only, so the client cannot know a champion's
world-boss strikes for the day (the picker tracks its own device's
strikes and learns from refusals — see app.js). v6 adds
`get_wb_attempts(card, now)` mirroring `get_writ_attempts`, and the
picker filters on chain truth like the writ picker already does.

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
