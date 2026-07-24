# v5 design: identity, squads, ranking, guilds

Four features, one blueprint revision (v5 supersedes v4.1 and includes its
fixes: bet-then-accept guard, get_bet view, self.log outcomes). New realm
instance at publish; migration via the existing adopt path plus new state.

## 1. Keyword abilities (card identity beyond stats)

Every champion TYPE (the catalog already types all 180 kinds: Beast, Vermin,
Drake, Knight, Wight, Flame, ...) carries one keyword ability, so the meta is
legible ("Drakes open hard, Vermin never quit") while kinds inside a type
still differ by art, stats, and flavor. Alternative considered: per-kind
abilities (180 hand assignments, maximum variety, illegible meta).

Ability is stored on the template (`add_template(tier, name, ability)`) and
stamped onto each minted card. Proposed keyword set (ids frozen at publish):

| id | keyword | effect in a fight |
| --- | --- | --- |
| 0 | — | none |
| 1 | Vanguard | +20% in the Attack round |
| 2 | Warden | +20% in the Defense round |
| 3 | Trickster | +20% in the Cunning round |
| 4 | Momentum | winning round 1 grants +10% in rounds 2 and 3 |
| 5 | Closer | if rounds split 1-1, +25% in the decider |
| 6 | Underdog | +15% in all rounds when total power is lower |
| 7 | Stancebreaker | opponent's stance edge does not apply |
| 8 | Plunderer | on victory, takes an extra 5% of the pot from the rake |
| 9 | Scholar | earns double veterancy XP from fights |

Rules: effects apply in duels (1v1 and per-lane in 3v3). Boss fights apply
only 1-7 (economic/XP keywords stay player-vs-player). Rounds become
sequential in the engine (they already resolve in order) so Momentum and
Closer are well-defined. Fusion: the child takes its own kind's ability
(no stacking). Market/UI show the keyword on the card face and in listings.

## 2. Squad duels (3v3)

A second duel type alongside 1v1; same wager/pot/rake/bets machinery.

- `create_squad_duel(wager, commitment)` deposits THREE cards. The squad
  SET is public; the challenger's lane assignment (which card fights lane
  1/2/3) is sealed in the commitment: sha3("perm:salt") where perm is a
  permutation like "201". Reuses the stance commit-reveal machinery and the
  browser salt store.
- `accept_squad_duel(duel_id)` deposits three cards; the DEPOSIT ORDER is
  the lane assignment (first deposited card fights lane 1, and so on) — no
  lane args needed. The acceptor sees which champions wait, not where.
- `reveal_squad(duel_id, perm, salt)` unseals lanes and resolves: each lane
  is a full aspect fight (with abilities); the squad taking 2+ lanes wins
  the pot. Same 6h reveal window and claim_forfeit.
- Per-lane veterancy XP; battle-hardened applies per lane under the existing
  wager/power conditions; the win counts once per duelist.
- Stances: none in 3v3 (the sealed lane assignment IS the mind game).
- Abilities apply per lane. Economic squad-level effects stay 1v1-only:
  the Plunderer waives the pot rake only in single duels (in a squad,
  "the winning card" is ambiguous); Scholar XP still doubles per lane.
- Implemented (phase 2): shares the 1v1 duel-id space and bet/cancel/
  forfeit machinery; `duel_kind` view marks squads; `get_squad_cards`
  lists a side's trio. The bettor-cannot-accept guard covers squads.
  The challenger's UI seals a RANDOM permutation (blind lane assignment
  makes any fixed order strategically equal, so no picker is needed).

## 3. Rated ladder (Arena rating + matchmaking)

Elo-style rating per identity, separate from season renown (rating is the
skill ladder; the season stays the activity sprint).

- `rating[identity]`, starting at 1000, K=32, zero-sum update on every
  RATED settle using the standard expected-score formula (integer math).
- Matchmaking by QUEUE, not open challenge: `join_ranked(wager_tier)`
  deposits one card and a fixed wager (tiers: 0 / 25 / 100 Ember). If a
  compatible opponent (rating within ±200, same tier) is already waiting,
  the joining tx matches and resolves the fight immediately: no sniping,
  no choosing your opponent. Otherwise you wait in the queue;
  `leave_ranked` refunds. Queue state is public (unavoidable on-chain);
  band limits and zero-sum Elo make camping unprofitable.
- Alternative considered: keep open challenges but gate acceptance to a
  rating band on rated duels. Simpler, keeps sniping.
- Unrated 1v1/3v3 challenges stay exactly as today.
- UI: rating on the wallet chip area and standings; ranked panel in Arena
  with queue status; ladder page ranks by rating (season page unchanged).
- Implemented (phase 3): `_elo_transfer` rounds the standard K=32
  expected-score formula in 25-point buckets: transfer = 16 -/+
  min(|gap|//25, 8), which matches the exact formula to the point inside
  the 200-rating band. Zero-sum with a 100 ladder floor (the loser stops
  at 100 and the winner takes only what moved). Queue slots are
  tombstoned and reused (`ranked_active`), one entry per identity per
  tier, ratings read fresh at match time. Rated fights use
  `_fight_rounds`/`_after_fight` (abilities apply; Plunderer waives the
  rake as in 1v1; no stances, no side bets). `adopt_rating(who, r)`
  (owner, 100..10000) migrates ladders. Views: `get_rating`,
  `get_ranked_waiting(tier)`, `is_ranked_queued(tier, addr)`.

## 4. Guilds and the world boss

- `create_guild(name)` costs 500 Ember (sink), 3-16 chars, unique;
  `join_guild(guild_id)`, `leave_guild`. One guild per identity. Guild of
  each duelist shows in the feed and standings.
- WORLD BOSS: one per week (week = unix-week like the raffle). HP scales
  with the realm: `hp = 5000 + 500 * active_players_last_week` (owner posts
  it weekly via `post_world_boss(name, hp, v, b, g)`; a cron automates it).
- `fight_world_boss(card)`: staked champions only, 3 fights per card per
  day (same throttle pattern as writs), entry fee = the writ formula.
  Damage dealt = rounds won * card power (0-3x), recorded per identity and
  per guild in `wb_damage`.
- When HP reaches 0 the boss falls; every contributor claims
  `claim_world_bounty(week)`: bounty pool = 10% of the week's summon
  proceeds (accrued on-chain, same pattern as the favor pool), split
  pro-rata by damage. The top-damage GUILD's members get +25% on their
  share (the guild layer with teeth). Unslain bosses roll their pool into
  next week.
- Feed: guild creations, joins, world-boss posts, big hits, the kill, and
  bounty claims (all via self.log + state-diff).
- Implemented (phase 4): guild names unique case-insensitively, 500 Ember
  burned outright; the +25% bounty bonus follows the banner an identity
  FOUGHT under (recorded on their first hit of the week), so hopping into
  the top guild after the kill earns nothing. The bounty pool accrues in
  EMBER (pull_price // 10 per summon into the current unix-week, boss
  posted or not) — no HTR reserve needed in the closed-points economy;
  the +25% mints on top of the pool like other bounties. Boss fights
  mirror writs (staked, 3/day per card via wb_attempts, fusion-fee//5
  entry, abilities 1-7 apply). scripts/world_boss.py posts weekly
  (dry-run default, WB_APPLY=1, no default ARENA_NC).

## Migration to v5

Existing adopt path carries player state; new in v5: `adopt_rating`,
ability backfill happens naturally (templates re-seeded with abilities at
launch; already-minted v4 cards would be adopted with ability id by kind).
Same consolidation script pattern as v3→v4.

## Phasing

1. Abilities (contract resolve hooks + template arg + card face UI)
2. Squad duels (contract + Arena UI second tab section)
3. Ranked queue (contract + ladder UI)
4. Guilds + world boss (contract + guild UI + weekly cron)

Each phase lands on the playground with its own focused E2E before the next
begins; v5 publishes to Hathor once all four are validated together.

## Open decisions (blocking the build)

- D1: abilities per TYPE (recommended) or per KIND; and the keyword list.
- D2: 3v3 blind-assignment: sealed challenger lanes + open acceptor
  assignment (recommended) or both sides sealed (two reveals, slower).
- D3: ranked = matchmaking queue (recommended) or band-gated open
  challenges.
- D4: fold v4.1 into v5 and make ONE publish ask (recommended), or publish
  v4.1 first and v5 later.
