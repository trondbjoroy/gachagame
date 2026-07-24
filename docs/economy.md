# The Economy of Emberfall — a guide for early testers

Everything in Emberfall runs on rules that no one — not even the game's
keepers — can bend after the fact. Every summon, every Ember, every duel
is written on-chain and can be checked by anyone. This document explains
how value moves through the game, and *why* we built it the way we did.
You're testing the game; this is the machinery under it.

---

## The three currencies

**Coin (HTR).** The real money. On the test realm it's free — the
[faucet](https://faucet.testnet.hathor.network) pays enough for a small
army. Coin buys summons and funds quick-play sessions; it's also what
sellers earn in the Market. On mainnet, summons will be quoted in USD
($2.50) and settled in HTR at the live rate.

**Ember.** The in-game working currency: a points balance, earned —
never bought. Champions toiling in the deep Mines sweat Ember by the
minute, faster for higher rarities (1/min for a Footman up to 40/min for
a Sovereign). Ember pays for fusion, tempering, boss entries, wagers,
and cosmetics. It is not a token: it never leaves the game, can't be
withdrawn, and can't be bought. That keeps the whole in-game economy a
closed loop — competitive, but never pay-to-win and never a cash-out
machine.

**Champions (cards).** Each summon binds a unique champion into
soulstone — its name, rarity, and power struck at birth and recorded
forever. Champions are yours: hold them, mine them, fight them, fuse
them, or sell them to other players. They are the only tradeable assets.

---

## Where coin flows

When you summon (price shown on the button), your coin goes two ways:

1. **A slice feeds the favor pool** — 10% of every summon goes into a
   shared pot that flows back to players (see below).
2. **The rest is the operator's revenue.** A game must feed its keepers,
   or there is no game.

The house also takes small cuts elsewhere: **5%** of every duel pot in
the Arena, and **5%** of every sale in the Market (paid by the seller).

## Where Ember flows

Ember has exactly one faucet and several drains, and that balance is
deliberate:

- **Faucet:** the Mines. Ember enters the game only through champions
  staked over time (plus small one-time achievement bounties — see
  below).
- **Drains:** fusion fees (rising steeply by rarity — fusing Footmen is
  cheap, forging toward a Sovereign is dear), tempering fees (half
  destroyed outright), boss entries, duel cuts, and wagers lost to
  better fighters.

Because the faucet is rate-limited by real champions staked over real
time, Ember can't be farmed by bots or printed into worthlessness — and
because it never converts back to coin, it can never become a printing
press. Its value is anchored to the one thing nobody can fake: time.

## Where champions flow

Summons mint champions in; fusion seals them away in the contract's
vault, out of play forever. Every fusion takes
**two** champions and creates **one** of the next rarity — so climbing
toward Sovereigns permanently shrinks the supply of lesser champions.
Rarity comes from the odds (60 / 30 / 9 / 1), but *scarcity* comes from
the forge.

---

## Achievements, levels, and the favor pool

One iron rule governs all progression: **rewards are funded from real
proceeds, never conjured from nothing.**

**Achievements and levels.** The Info tab records eighteen achievements
— from your first champion up to commanding an army of forty and
winning fifteen duels — each read straight from what the chain already
knows about you. Achievements raise your **level**, seven of them from
Level 1 · Wanderer to Level 7 · Sovereign's Hand. The gaps widen as you
climb: early levels come in an evening, but the last ones demand a real
host, real coin spent summoning, and hours of champions toiling in the
Mines. Levels are prestige, not power — they can't be bought, only
earned. Six milestones also pay one-time Ember bounties.

**On-chain progression.**
- **Renown**: every meaningful act earns points on-chain — summons,
  fusions, and *settled* fights in the Arena (you can't farm renown by
  opening and cancelling challenges; only fights that happen count).
- **Daily streak**: play on consecutive days and your renown earnings
  climb, up to double at a seven-day streak. Miss a day and it resets.
- **The favor pool**: every summon has a **1-in-25 chance** of an
  instant refund of up to the summon's full price, paid from the pool
  that summons themselves fill — the pot grows when the game is busy
  and never pays out more than it holds.
- **Aspects**: every champion's power splits at birth into **Attack,
  Defense, and Cunning**, and duels are best-of-three — one round per
  aspect. A balanced champion fights steadily; a specialist crushes one
  round and gambles the rest.
- **Tempering**: while a champion toils in the Mines, you may pay Ember
  to raise one chosen aspect. Each tempering costs half again as much
  as the last, with a hard cap by rarity — a tempered Footman deepens,
  but never outgrows a Knight. Half of every fee is destroyed forever
  (good for everyone's Ember), half goes to the house.
- **Battle-hardened**: champions remember their victories — every duel
  won is written on the card itself, and veterans carry that pedigree
  into the Market. A winner also grows: +1 to a random aspect, but only
  from wagered fights against an equal or stronger foe, and only up to
  a modest cap. Glory earned against weaklings teaches nothing.
- **The weekly drawing**: every point of renown you earn in a week is a
  ticket in a weekly drawing; the pot is 5% of the week's summon
  proceeds. For now the draw runs on a published, deterministic
  algorithm over public chain data (anyone can re-run it and check the
  winner); a future update moves the draw itself into the contract.

## Why "funded from proceeds, never printed"?

Games that conjure rewards from nothing die the same death: rewards
outrun the things that absorb them, the currency's worth collapses, and
with it every reason to play. (The graveyard of play-to-earn games is
full of this exact failure.) So Emberfall follows one rule everywhere:

> Every reward traces back to coin that a player actually spent.

Concretely: the favor pool is filled only by a fixed slice of summon
payments; the weekly drawing pays from real summon proceeds; achievement
bounties are one-time, capped, and paid in Ember that can never be
cashed out; and levels — the biggest reward of all — cost nothing to
grant because prestige can't be counterfeited or inflated. A busy week
means a fatter pool; a quiet week means a leaner one. The economy
breathes with the game instead of bleeding it.

One more consequence worth naming: because every point of renown costs
something real to earn, there is no profitable way to bot it. The
cheapest path to progression is simply *playing*.

## What's different on the test realm

Prices are tuned for testing, not for balance — summons are nearly free
(1 HTR) and the coin itself is free from the faucet, so you can test
every mechanic without grinding. On mainnet, summons are quoted at
$2.50 in USD and settled in HTR at the live rate. Before any real-money
launch, every number in this document (summon price, mine rates, fusion
fees, house cuts, favor odds) gets a dedicated balancing pass. What
will *not* change is the architecture: the rule above, the closed Ember
loop, and the fact that all of it stays open on-chain for anyone to
verify.

## Questions we'd love your help answering

1. Do the Mines feel worth it — do you *want* to keep champions staked?
2. Is fusion priced fairly at each rarity, or does the climb stall?
3. Does the Arena's 5% cut feel fair when you win?
4. Do achievements and levels make you want one more summon — and which
   achievement did you chase first?
5. Anything that feels exploitable? Try to break it — that's the point
   of a test realm.

Tell us what feels generous, what feels stingy, and where you stopped
caring. That last one is the most valuable answer of all.
