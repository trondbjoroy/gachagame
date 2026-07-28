from typing import Optional

from hathor import (
    Address, Amount, Blueprint, Context, HATHOR_TOKEN_UID,
    NCDepositAction, NCFail, NCWithdrawalAction, TokenUid,
    export, public, sha3, view,
)


@export
class EmberfallArena(Blueprint):
    """Emberfall: the full game in one contract. Design + phase notes in
    docs/v5-design.md.

    v5 = v4 (session delegation, sealed-stance duels, side-bets,
    park-not-melt fusion, 1-unit NFT cards, closed Ember points) plus:
    keyword abilities stamped at mint (template "Name|a", ids 1-9);
    3v3 squad duels (sealed lane order, deposit order = lanes, 2+ lanes
    take the pot, shared duel-id space); a rated Elo ladder (K=32 in
    25-point buckets, queue-on-join within a 200 band, zero-sum, floor
    100); guilds (500 Ember, unique names) and a weekly world boss
    (staked champions, damage pro-rata bounty from a tenth of summons,
    +25% for the top guild as fought); and scheduled tournaments
    (Crown-seeded pools, one round per interval, 60/25/7.5+7.5 split,
    cancel-and-refund below four seats). Logging via self.log.info.
    """

    owner: Address
    pull_price: Amount
    weights: list[int]
    card_unit: int
    templates_0: list[str]
    templates_1: list[str]
    templates_2: list[str]
    templates_3: list[str]
    card_name: dict[TokenUid, str]
    card_ability: dict[TokenUid, int]
    card_tier: dict[TokenUid, int]
    card_power: dict[TokenUid, int]
    pending: dict[TokenUid, Address]
    staked: dict[TokenUid, Address]
    stake_since: dict[TokenUid, int]
    ember_ledger: dict[Address, Amount]      # closed in-game points, never a token
    duel_card: dict[int, TokenUid]
    duel_kind: dict[int, int]                # 0 single (default), 1 squad
    rating: dict[Address, int]               # rated ladder, absent = 1000
    ranked_n: dict[int, int]                 # tier -> queue slots ever used
    ranked_addr: dict[int, Address]          # tier*4096+slot
    ranked_card: dict[int, TokenUid]
    ranked_active: dict[int, bool]
    guild_count: int
    guild_name: dict[int, str]
    guild_taken: dict[str, bool]        # lowercase name -> raised
    guild_members: dict[int, int]
    member_guild: dict[Address, int]
    wb_week: int                        # latest posted boss week (0 = none)
    wb_name: dict[int, str]
    wb_hp: dict[int, int]               # remaining
    wb_hp0: dict[int, int]
    wb_valor: dict[int, int]
    wb_bulwark: dict[int, int]
    wb_guile: dict[int, int]
    wb_pool: dict[int, Amount]          # Ember bounty accrued per week
    wb_total: dict[int, int]            # damage dealt in total
    wb_damage: dict[str, int]           # "week|addr" -> damage
    wb_fought_guild: dict[str, int]     # "week|addr" -> guild at first hit
    wb_guild_damage: dict[str, int]     # "week|guild" -> damage
    wb_top_guild: dict[int, int]
    wb_claimed: dict[str, bool]
    wb_attempts: dict[TokenUid, int]    # day*10+fights, like writ_attempts
    next_tourney_id: int
    tour_name: dict[int, str]
    tour_state: dict[int, int]          # 0 open, 1 running, 2 done, 3 cancelled
    tour_fee: dict[int, Amount]
    tour_seed: dict[int, Amount]
    tour_size: dict[int, int]           # bracket cap: 4/8/16/32
    tour_start: dict[int, int]          # registration closes, fights may begin
    tour_round_secs: dict[int, int]
    tour_round: dict[int, int]
    tour_next_ts: dict[int, int]        # earliest next advance
    tour_n: dict[int, int]              # entrants
    tour_entrant: dict[int, Address]    # t*64 + i
    tour_card: dict[int, TokenUid]      # t*64 + i
    tour_alive: dict[int, bool]         # t*64 + i
    tour_paid: dict[int, Amount]        # semis + runner-up already credited
    tour_champion: dict[int, Address]
    squad_card: dict[int, TokenUid]          # duel_id*4+slot, challenger
    squad_acceptor_card: dict[int, TokenUid] # duel_id*4+lane, acceptor
    duel_wager: dict[int, Amount]
    duel_challenger: dict[int, Address]
    duel_open: dict[int, bool]
    next_duel_id: int
    wins: dict[Address, int]
    total_pulls: int
    pulls_by: dict[Address, int]
    total_minted: int
    proceeds: Amount
    renown: dict[Address, int]
    vigil_day: dict[Address, int]
    vigil_streak: dict[Address, int]
    deed_flags: dict[Address, int]
    favor_pool: Amount
    favor_owed: dict[Address, Amount]
    card_attrs: dict[TokenUid, int]
    card_wins: dict[TokenUid, int]
    writ_name: list[str]
    writ_valor: list[int]
    writ_bulwark: list[int]
    writ_guile: list[int]
    gauntlet_cleared: dict[Address, int]     # bit = writ*3 + tier (per address)
    card_cleared: dict[TokenUid, int]        # bit = writ*3 + tier (per card): the
                                             # first-clear bonus is paid once per
                                             # champion, so shuttling one card
                                             # across many addresses cannot re-mint it
    writ_attempts: dict[TokenUid, int]       # day*10 + fights used today
    delve_since: dict[TokenUid, int]
    delve_seconds: int
    shards_ledger: dict[Address, int]
    trial_done: dict[Address, int]           # last UTC day completed
    card_cosmetics: dict[TokenUid, int]      # frame | tint<<8 | epithet<<16
    mine_rates: list[int]                    # Embers/min by tier
    fusion_fees: list[int]                   # Embers by tier fused
    temper_bases: list[int]                  # first-rite Embers by tier
    # ---- v4 ----
    delegate: dict[Address, Address]         # session -> main
    session_offer: dict[Address, Address]    # session -> offering main
    session_fund: dict[Address, Amount]      # session -> escrowed HTR float
    is_main: dict[Address, bool]             # has offered or holds sessions
    parked: dict[TokenUid, bool]             # fusion parents held forever
    duel_commit: dict[int, bytes]            # challenger stance commitment
    duel_acceptor: dict[int, Address]
    duel_acceptor_card: dict[int, TokenUid]
    duel_acceptor_stance: dict[int, int]
    duel_accept_ts: dict[int, int]
    duel_reveal_pending: dict[int, bool]
    bet_count: dict[int, int]                # per duel
    bet_addr: dict[int, Address]             # key = duel_id*64 + i
    bet_side: dict[int, int]                 # key = duel_id*64 + i
    bet_amt: dict[int, Amount]               # key = duel_id*64 + i
    bet_pool: dict[int, Amount]              # key = duel_id*2 + side

    @public(allow_deposit=True)
    def initialize(self, ctx: Context, owner: Address, pull_price: Amount,
                   weight_common: int, weight_rare: int,
                   weight_epic: int, weight_legendary: int,
                   delve_seconds: int, card_unit: int) -> None:
        if pull_price <= 1:
            raise NCFail("pull_price must exceed the 1-cent mint collateral")
        if weight_common < 0 or weight_rare < 0 or weight_epic < 0 or weight_legendary < 0:
            raise NCFail("weights cannot be negative")
        if weight_common + weight_rare + weight_epic + weight_legendary <= 0:
            raise NCFail("weights must sum to a positive number")
        if delve_seconds < 60 or delve_seconds > 172_800:
            raise NCFail("delve_seconds must be 60..172800")
        if card_unit != 1 and card_unit != 100:
            raise NCFail("card_unit must be 1 (NFT spec) or 100 (legacy)")
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCDepositAction) or action.amount < 1:
            raise NCFail("deposit at least 0.01 HTR to seed the reserve")
        self.owner = owner
        self.pull_price = pull_price
        self.weights = [weight_common, weight_rare, weight_epic, weight_legendary]
        self.card_unit = card_unit
        self.templates_0 = []
        self.templates_1 = []
        self.templates_2 = []
        self.templates_3 = []
        self.card_name = {}
        self.card_ability = {}
        self.card_tier = {}
        self.card_power = {}
        self.pending = {}
        self.staked = {}
        self.stake_since = {}
        self.ember_ledger = {}
        self.duel_card = {}
        self.duel_kind = {}
        self.rating = {}
        self.ranked_n = {}
        self.ranked_addr = {}
        self.ranked_card = {}
        self.ranked_active = {}
        self.guild_count = 0
        self.guild_name = {}
        self.guild_taken = {}
        self.guild_members = {}
        self.member_guild = {}
        self.wb_week = 0
        self.wb_name = {}
        self.wb_hp = {}
        self.wb_hp0 = {}
        self.wb_valor = {}
        self.wb_bulwark = {}
        self.wb_guile = {}
        self.wb_pool = {}
        self.wb_total = {}
        self.wb_damage = {}
        self.wb_fought_guild = {}
        self.wb_guild_damage = {}
        self.wb_top_guild = {}
        self.wb_claimed = {}
        self.wb_attempts = {}
        self.next_tourney_id = 0
        self.tour_name = {}
        self.tour_state = {}
        self.tour_fee = {}
        self.tour_seed = {}
        self.tour_size = {}
        self.tour_start = {}
        self.tour_round_secs = {}
        self.tour_round = {}
        self.tour_next_ts = {}
        self.tour_n = {}
        self.tour_entrant = {}
        self.tour_card = {}
        self.tour_alive = {}
        self.tour_paid = {}
        self.tour_champion = {}
        self.squad_card = {}
        self.squad_acceptor_card = {}
        self.duel_wager = {}
        self.duel_challenger = {}
        self.duel_open = {}
        self.next_duel_id = 0
        self.wins = {}
        self.total_pulls = 0
        self.pulls_by = {}
        self.total_minted = 0
        self.renown = {}
        self.vigil_day = {}
        self.vigil_streak = {}
        self.deed_flags = {}
        self.favor_pool = 0
        self.favor_owed = {}
        self.card_attrs = {}
        self.card_wins = {}
        self.writ_name = []
        self.writ_valor = []
        self.writ_bulwark = []
        self.writ_guile = []
        self.gauntlet_cleared = {}
        self.card_cleared = {}
        self.writ_attempts = {}
        self.delve_since = {}
        self.delve_seconds = delve_seconds
        self.shards_ledger = {}
        self.trial_done = {}
        self.card_cosmetics = {}
        self.mine_rates = [1, 3, 10, 40]
        self.fusion_fees = [5, 10, 50, 100]
        self.temper_bases = [10, 20, 80, 150]
        self.delegate = {}
        self.session_offer = {}
        self.session_fund = {}
        self.is_main = {}
        self.parked = {}
        self.duel_commit = {}
        self.duel_acceptor = {}
        self.duel_acceptor_card = {}
        self.duel_acceptor_stance = {}
        self.duel_accept_ts = {}
        self.duel_reveal_pending = {}
        self.bet_count = {}
        self.bet_addr = {}
        self.bet_side = {}
        self.bet_amt = {}
        self.bet_pool = {}
        # the deposited HTR seeds the reserve (favor pool + operator revenue).
        # Ember is a closed in-game points balance, never a token — there is
        # nothing to mint here.
        self.proceeds = action.amount

    # ------------------------------------------------------------------
    # Tuning tables (settable within bounds)
    # ------------------------------------------------------------------

    def _rate_per_min(self, tier: int) -> int:
        return self.mine_rates[tier]

    def _power_base(self, tier: int) -> int:
        return [10, 25, 60, 150][tier]

    def _fusion_fee(self, tier: int) -> Amount:
        return self.fusion_fees[tier]

    def _rake_bps(self) -> int:
        return 500  # 5% of the duel pot, and of each losing side-bet pool

    def _favor_bps(self) -> int:
        return 1000  # 10% of each pull payment feeds the favor pool

    def _favor_odds(self) -> int:
        return 25  # 1-in-25 pulls wins the Weaver's favor

    def _fuse_renown(self, tier: int) -> int:
        return [20, 40, 80, 0][tier]

    def _reveal_window(self) -> int:
        return 21_600  # 6 hours for the challenger to reveal a stance

    def _max_bets(self) -> int:
        return 50  # per duel; also bounds the settlement loop

    # deed bits and their one-time Ember bounties
    # 0 first summoning, 1 first rite of union, 2 forge a highlord,
    # 3 forge a sovereign, 4 first trial won, 5 ten trials won,
    # 6 first writ felled, 7 a Black writ felled
    def _deed_bounty(self, bit: int) -> Amount:
        return [10, 20, 50, 200, 25, 100, 25, 100][bit]

    def _temper_base(self, tier: int) -> Amount:
        return self.temper_bases[tier]

    def _temper_cap(self, tier: int) -> int:
        return [3, 5, 8, 12][tier]

    # ------------------------------------------------------------------
    # Aspects and veterancy: valor/bulwark/guile (12 bits each),
    # tempers @36 (8b), hardened @44 (8b), xp @52 (14b), vet gains @66 (8b)
    # ------------------------------------------------------------------

    def _attrs_pack(self, valor: int, bulwark: int, guile: int,
                    tempers: int, hardened: int, xp: int, vet: int) -> int:
        return (valor | (bulwark << 12) | (guile << 24)
                | (tempers << 36) | (hardened << 44)
                | (xp << 52) | (vet << 66))

    def _attr_at(self, attrs: int, aspect: int) -> int:
        return (attrs >> (aspect * 12)) & 0xFFF

    def _attr_tempers(self, attrs: int) -> int:
        return (attrs >> 36) & 0xFF

    def _attr_hardened(self, attrs: int) -> int:
        return (attrs >> 44) & 0xFF

    def _attr_xp(self, attrs: int) -> int:
        return (attrs >> 52) & 0x3FFF

    def _attr_vet(self, attrs: int) -> int:
        return (attrs >> 66) & 0xFF

    def _harden_cap(self, tier: int) -> int:
        return [2, 3, 4, 6][tier]

    def _vet_cap(self, tier: int) -> int:
        # veterancy aspect gains, about half of tempering's ceiling
        return [2, 3, 4, 6][tier]

    def _xp_level(self, xp: int) -> int:
        thresholds = [5, 15, 35, 70, 120, 200, 320]
        level = 0
        for t in thresholds:
            if xp >= t:
                level += 1
        return level

    def _ability_boost(self, ability: int, aspect: int, won_first: int,
                       split: int, weaker: int, p: int) -> int:
        """A fighter's own keyword applied to its strength p this round."""
        if ability == aspect + 1:              # Vanguard / Warden / Trickster
            p = p * 6 // 5
        if ability == 4 and won_first == 1 and aspect > 0:
            p = p * 11 // 10                   # Momentum
        if ability == 5 and aspect == 2 and split == 1:
            p = p * 5 // 4                     # Closer
        if ability == 6 and weaker == 1:
            p = p * 23 // 20                   # Underdog
        return p

    def _split_power(self, power: int) -> int:
        w1 = self.syscall.rng.randbelow(100) + 1
        w2 = self.syscall.rng.randbelow(100) + 1
        w3 = self.syscall.rng.randbelow(100) + 1
        tot = w1 + w2 + w3
        valor = 1 + (power - 3) * w1 // tot
        bulwark = 1 + (power - 3) * w2 // tot
        guile = power - valor - bulwark
        return self._attrs_pack(valor, bulwark, guile, 0, 0, 0, 0)

    def _grant_xp(self, card: TokenUid, amount: int) -> None:
        """Experience for a settled fight; every even level grants +1 to
        a random aspect until the station's veterancy cap."""
        attrs = self.card_attrs[card]
        old_xp = self._attr_xp(attrs)
        new_xp = old_xp + amount
        if new_xp > 0x3FFF:
            new_xp = 0x3FFF
        tier = self.card_tier[card]
        vet = self._attr_vet(attrs)
        valor = self._attr_at(attrs, 0)
        bulwark = self._attr_at(attrs, 1)
        guile = self._attr_at(attrs, 2)
        gained = 0
        level = self._xp_level(old_xp)
        new_level = self._xp_level(new_xp)
        while level < new_level:
            level += 1
            if level % 2 == 0 and vet < self._vet_cap(tier):
                which = self.syscall.rng.randbelow(3)
                if which == 0:
                    valor += 1
                elif which == 1:
                    bulwark += 1
                else:
                    guile += 1
                vet += 1
                gained += 1
        self.card_attrs[card] = self._attrs_pack(
            valor, bulwark, guile, self._attr_tempers(attrs),
            self._attr_hardened(attrs), new_xp, vet)
        if gained > 0:
            self.card_power[card] = self.card_power[card] + gained

    def _temper_cost(self, tier: int, tempers: int) -> Amount:
        cost = self._temper_base(tier)
        step = 0
        while step < tempers:
            cost = cost * 3 // 2
            step += 1
        return cost

    # ------------------------------------------------------------------
    # Session delegation: one identity across session and main wallets
    # ------------------------------------------------------------------

    def _player(self, ctx: Context) -> Address:
        """Resolve the caller to the identity all state is keyed by:
        a registered session acts as its main address."""
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can play")
        return self.delegate.get(caller, caller)

    @public(allow_deposit=True)
    def offer_session(self, ctx: Context, session: Address) -> None:
        """A main wallet offers delegation to a session address,
        escrowing the session's HTR float in the same tx (one prompt).
        The offer binds nothing until the session key itself accepts
        and withdraws the escrow. Offering again tops the escrow up."""
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can offer a session")
        if session == caller:
            raise NCFail("a session must be a different address")
        if caller in self.delegate:
            raise NCFail("a session cannot offer sessions of its own")
        if self.is_main.get(session, False):
            raise NCFail("that address already leads a banner of its own")
        if session in self.delegate:
            raise NCFail("that address already serves another banner")
        existing = self.session_offer.get(session)
        if existing is not None and existing != caller:
            raise NCFail("another banner already courts that address")
        for action in ctx.actions_list:
            if action.token_uid != HATHOR_TOKEN_UID or not isinstance(action, NCDepositAction):
                raise NCFail("only an HTR deposit may ride along with an offer")
            self.session_fund[session] = self.session_fund.get(session, 0) + action.amount
        # offering marks the caller as a banner address for good, so it
        # can never itself be talked into serving as someone's session
        self.is_main[caller] = True
        self.session_offer[session] = caller
        self.syscall.emit_event(
            b'{"event":"session_offer"}'
        )

    @public(allow_withdrawal=True)
    def accept_session(self, ctx: Context) -> None:
        """Called by the session key itself: binds the pending offer
        and withdraws the escrowed float (an empty wallet can do this —
        withdrawals need no inputs). Requiring this second signature
        means nobody can register an address they do not control."""
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can accept")
        main = self.session_offer.get(caller)
        if main is None:
            raise NCFail("no banner has offered this address a session")
        if self.is_main.get(caller, False):
            raise NCFail("a banner address cannot serve as a session")
        if caller in self.delegate:
            raise NCFail("this address already serves a banner")
        fund = self.session_fund.get(caller, 0)
        taken = 0
        for action in ctx.actions_list:
            if action.token_uid != HATHOR_TOKEN_UID or not isinstance(action, NCWithdrawalAction):
                raise NCFail("only the escrowed HTR may be withdrawn here")
            taken += action.amount
        if taken > fund:
            raise NCFail(f"the escrow holds {fund}")
        if caller in self.session_fund:
            del self.session_fund[caller]
        if fund > taken:
            self.proceeds += fund - taken  # unclaimed remainder feeds the reserve
        del self.session_offer[caller]
        self.delegate[caller] = main
        self.is_main[main] = True
        self.syscall.emit_event(
            b'{"event":"session_bound"}'
        )

    @public(allow_withdrawal=True)
    def revoke_session(self, ctx: Context, session: Address) -> None:
        """The main wallet cuts a session loose (e.g. a lost device) or
        reclaims the escrow of an offer that was never accepted. Any
        withdrawal in the tx must fit inside that reclaimed escrow."""
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("only wallets can revoke")
        fund = 0
        matched = False
        if self.session_offer.get(session) == caller:
            matched = True
            del self.session_offer[session]
            fund = self.session_fund.get(session, 0)
            if session in self.session_fund:
                del self.session_fund[session]
        if self.delegate.get(session) == caller:
            matched = True
            del self.delegate[session]
        if not matched:
            raise NCFail("no such session under your banner")
        taken = 0
        for action in ctx.actions_list:
            if action.token_uid != HATHOR_TOKEN_UID or not isinstance(action, NCWithdrawalAction):
                raise NCFail("only the reclaimed escrow may be withdrawn here")
            taken += action.amount
        if taken > fund:
            raise NCFail(f"the escrow holds {fund}")
        if fund > taken:
            self.proceeds += fund - taken

    # ------------------------------------------------------------------
    # Progression internals
    # ------------------------------------------------------------------

    def _earn_renown(self, who: Address, base: int, now: int) -> None:
        day = now // 86400
        last = self.vigil_day.get(who, 0)
        if day == last:
            streak = self.vigil_streak.get(who, 1)
        elif day == last + 1:
            streak = self.vigil_streak.get(who, 0) + 1
            self.vigil_streak[who] = streak
            self.vigil_day[who] = day
        else:
            streak = 1
            self.vigil_streak[who] = 1
            self.vigil_day[who] = day
        capped = streak if streak < 7 else 7
        self.renown[who] = self.renown.get(who, 0) + base + base * (capped - 1) // 6

    # Ember is closed in-game points: earned, spent and transferred entirely
    # inside the contract, never minted as a token and never withdrawable.
    def _credit_ember(self, who: Address, amount: int) -> None:
        self.ember_ledger[who] = self.ember_ledger.get(who, 0) + amount

    def _debit_ember(self, who: Address, amount: int) -> None:
        self.ember_ledger[who] = self.ember_ledger.get(who, 0) - amount

    def _grant_deed(self, who: Address, bit: int) -> None:
        mask = self.deed_flags.get(who, 0)
        flag = 1 << bit
        if mask & flag:
            return
        self.deed_flags[who] = mask | flag
        bounty = self._deed_bounty(bit)
        if bounty > 0:
            self._credit_ember(who, bounty)

    # the daily trial: one act per UTC day is the Crown's ask; the first
    # matching act per player pays bonus renown and a small ember bounty.
    # kinds: 0 pull, 1 stake, 2 duel win, 3 fuse, 4 temper, 5 claim ember,
    #        6 recall after 8h+, 7 writ won
    def _trial_today(self, now: int) -> int:
        return ((now // 86400) * 5 + 2) % 8

    def _trial_hit(self, who: Address, kind: int, now: int) -> None:
        if self._trial_today(now) != kind:
            return
        day = now // 86400
        if self.trial_done.get(who, 0) == day:
            return
        self.trial_done[who] = day
        self.renown[who] = self.renown.get(who, 0) + [5, 3, 5, 10, 3, 3, 3, 3][kind]
        self._credit_ember(who, 5)

    # ------------------------------------------------------------------
    # Operator
    # ------------------------------------------------------------------

    @public
    def add_template(self, ctx: Context, tier: int, name: str, ability: int) -> None:
        self._check_owner(ctx)
        self._check_tier(tier)
        if len(name) < 1 or len(name) > 30:
            raise NCFail("name must be 1-30 chars")
        if ability < 0 or ability > 9:
            raise NCFail("ability must be 0-9")
        # the ability rides inside the template entry: "Name|a"
        self._templates(tier).append(f"{name}|{ability}")

    @public
    def remove_template(self, ctx: Context, tier: int, index: int) -> None:
        # storage lists support tail-pop and item assignment only: swap the
        # last entry into the hole, then drop the tail (order is not
        # meaningful for template pools)
        self._check_owner(ctx)
        self._check_tier(tier)
        pool = self._templates(tier)
        n = len(pool)
        if index < 0 or index >= n:
            raise NCFail("no such template")
        if index != n - 1:
            pool[index] = pool[n - 1]
        pool.pop()

    @public
    def set_pull_price(self, ctx: Context, new_price: Amount) -> None:
        self._check_owner(ctx)
        if new_price <= 1:
            raise NCFail("pull_price must exceed the 1-cent mint collateral")
        self.pull_price = new_price

    def _set_four(self, target: list[int], v0: int, v1: int, v2: int, v3: int) -> None:
        # storage lists take item assignment, not whole-field reassignment
        target[0] = v0
        target[1] = v1
        target[2] = v2
        target[3] = v3

    @public
    def set_mine_rates(self, ctx: Context, r0: int, r1: int, r2: int, r3: int) -> None:
        self._check_owner(ctx)
        if r0 < 1 or r1 < r0 or r2 < r1 or r3 < r2 or r3 > 10_000:
            raise NCFail("rates must ascend within 1..10000")
        self._set_four(self.mine_rates, r0, r1, r2, r3)

    @public
    def set_fusion_fees(self, ctx: Context, f0: int, f1: int, f2: int, f3: int) -> None:
        self._check_owner(ctx)
        if f0 < 1 or f1 < f0 or f2 < f1 or f3 < f2 or f3 > 100_000:
            raise NCFail("fees must ascend within 1..100000")
        self._set_four(self.fusion_fees, f0, f1, f2, f3)

    @public
    def set_temper_bases(self, ctx: Context, t0: int, t1: int, t2: int, t3: int) -> None:
        self._check_owner(ctx)
        if t0 < 1 or t1 < t0 or t2 < t1 or t3 < t2 or t3 > 100_000:
            raise NCFail("bases must ascend within 1..100000")
        self._set_four(self.temper_bases, t0, t1, t2, t3)

    @public
    def set_delve_seconds(self, ctx: Context, seconds: int) -> None:
        self._check_owner(ctx)
        if seconds < 60 or seconds > 172_800:
            raise NCFail("delve_seconds must be 60..172800")
        self.delve_seconds = seconds

    @public(allow_withdrawal=True)
    def withdraw_proceeds(self, ctx: Context) -> None:
        self._check_owner(ctx)
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("expected an HTR withdrawal")
        # Ember is never withdrawable, so proceeds is pure operator revenue
        if action.amount > self.proceeds:
            raise NCFail(f"only {self.proceeds} available")
        self.proceeds -= action.amount

    # ------------------------------------------------------------------
    # Migration (owner-only): adopt a prior realm's cards and standings.
    # Cards are tokens in players' wallets; the new instance only needs
    # their metadata registered. Deed flags are set without re-paying
    # bounties (the old realm already paid them). Only adopt cards whose
    # token amount equals this realm's card_unit.
    # ------------------------------------------------------------------

    @public
    def adopt_card(self, ctx: Context, uid: TokenUid, name: str, tier: int,
                   power: int, attrs: int, card_wins: int, ability: int) -> None:
        self._check_owner(ctx)
        self._check_tier(tier)
        if uid in self.card_tier:
            raise NCFail("card already known")
        if len(name) < 1 or len(name) > 30:
            raise NCFail("name must be 1-30 chars")
        if power < 1 or power > 1_000:
            raise NCFail("power out of range")
        if attrs < 0 or card_wins < 0:
            raise NCFail("bad card data")
        if ability < 0 or ability > 9:
            raise NCFail("ability must be 0-9")
        self.card_name[uid] = name
        self.card_ability[uid] = ability
        self.card_tier[uid] = tier
        self.card_power[uid] = power
        self.card_attrs[uid] = attrs
        if card_wins > 0:
            self.card_wins[uid] = card_wins

    @public
    def adopt_rating(self, ctx: Context, who: Address, rating_pts: int) -> None:
        self._check_owner(ctx)
        if rating_pts < 100 or rating_pts > 10_000:
            raise NCFail("rating out of range")
        self.rating[who] = rating_pts

    @public
    def adopt_player(self, ctx: Context, who: Address, ember: Amount,
                     renown_pts: int, deeds: int, wins_n: int, pulls: int) -> None:
        self._check_owner(ctx)
        if ember < 0 or renown_pts < 0 or deeds < 0 or wins_n < 0 or pulls < 0:
            raise NCFail("bad player data")
        if ember > 0:
            self._credit_ember(who, ember)
        if renown_pts > 0:
            self.renown[who] = self.renown.get(who, 0) + renown_pts
        if deeds > 0:
            self.deed_flags[who] = self.deed_flags.get(who, 0) | deeds
        if wins_n > 0:
            self.wins[who] = self.wins.get(who, 0) + wins_n
        if pulls > 0:
            self.pulls_by[who] = self.pulls_by.get(who, 0) + pulls
            self.total_pulls += pulls

    # ------------------------------------------------------------------
    # Gacha
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def pull(self, ctx: Context) -> TokenUid:
        who = self._player(ctx)
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCDepositAction):
            raise NCFail("expected an HTR deposit")
        if action.amount != self.pull_price:
            raise NCFail(f"pull costs exactly {self.pull_price}")
        tier = self._fallback_tier(self._roll_tier())
        card = self._mint_card(tier, 0)
        self.pending[card] = who
        self.proceeds += action.amount - 1  # 1 cent consumed as mint collateral
        self.total_pulls += 1
        self.pulls_by[who] = self.pulls_by.get(who, 0) + 1
        share = action.amount * self._favor_bps() // 10_000
        if share > self.proceeds:
            share = self.proceeds
        self.proceeds -= share
        self.favor_pool += share
        # the world boss eats too: a tenth of every summon, in Ember,
        # into the CURRENT week's bounty pool (posted boss or not)
        week = ctx.block.timestamp // 604_800
        self.wb_pool[week] = self.wb_pool.get(week, 0) + self.pull_price // 10
        self._earn_renown(who, 10, ctx.block.timestamp)
        self._grant_deed(who, 0)
        self._trial_hit(who, 0, ctx.block.timestamp)
        if self.favor_pool > 0 and self.syscall.rng.randbelow(self._favor_odds()) == 0:
            prize = self.pull_price if self.pull_price <= self.favor_pool else self.favor_pool
            self.favor_pool -= prize
            self.favor_owed[who] = self.favor_owed.get(who, 0) + prize
            self.syscall.emit_event(
                f'{{"event":"favor","amount":{prize}}}'.encode()
            )
        self.syscall.emit_event(
            f'{{"event":"pull","tier":{tier},"token":"{card.hex()}"}}'.encode()
        )
        return card

    @public(allow_withdrawal=True)
    def claim_card(self, ctx: Context) -> None:
        who = self._player(ctx)
        action = self._single_card_withdrawal(ctx)
        winner = self.pending.get(action.token_uid)
        if winner is None:
            raise NCFail("card not pending")
        if winner != who:
            raise NCFail("card belongs to someone else")
        del self.pending[action.token_uid]

    # ------------------------------------------------------------------
    # Staking / Ember mining
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def stake(self, ctx: Context) -> None:
        who = self._player(ctx)
        action = self._single_card_deposit(ctx)
        card = action.token_uid
        self.staked[card] = who
        self.stake_since[card] = ctx.block.timestamp
        self._trial_hit(who, 1, ctx.block.timestamp)

    @public
    def claim_ember(self, ctx: Context, card: TokenUid) -> Amount:
        who = self._player(ctx)
        if self.staked.get(card) != who:
            raise NCFail("not your staked card")
        self._check_not_delving(card)
        ember = self._accrue(card, ctx.block.timestamp)
        self._trial_hit(who, 5, ctx.block.timestamp)
        return ember

    @public(allow_withdrawal=True)
    def unstake(self, ctx: Context) -> None:
        who = self._player(ctx)
        action = self._single_card_withdrawal(ctx)
        card = action.token_uid
        if self.staked.get(card) != who:
            raise NCFail("not your staked card")
        self._check_not_delving(card)
        toiled = ctx.block.timestamp - self.stake_since[card]
        self._accrue(card, ctx.block.timestamp)
        del self.staked[card]
        del self.stake_since[card]
        if toiled >= 8 * 3600:
            self._trial_hit(who, 6, ctx.block.timestamp)

    @public
    def temper(self, ctx: Context, card: TokenUid, aspect: int) -> Amount:
        """Raise one aspect of a champion toiling in the Mines, for a
        ember fee that grows each tempering. Half burned, half to the
        Crown."""
        who = self._player(ctx)
        if self.staked.get(card) != who:
            raise NCFail("temper a champion of yours while it toils in the Mines")
        self._check_not_delving(card)
        if aspect < 0 or aspect > 2:
            raise NCFail("aspect must be 0 (valor), 1 (bulwark) or 2 (guile)")
        tier = self.card_tier[card]
        attrs = self.card_attrs[card]
        tempers = self._attr_tempers(attrs)
        if tempers >= self._temper_cap(tier):
            raise NCFail("this champion can be tempered no further")
        cost = self._temper_cost(tier, tempers)
        balance = self.ember_ledger.get(who, 0)
        if balance < cost:
            raise NCFail(f"tempering costs {cost} Ember")
        self._debit_ember(who, cost)
        self._credit_ember(self.owner, cost // 2)
        bonus = 1 + self.syscall.rng.randbelow(3)
        valor = self._attr_at(attrs, 0)
        bulwark = self._attr_at(attrs, 1)
        guile = self._attr_at(attrs, 2)
        if aspect == 0:
            valor += bonus
        elif aspect == 1:
            bulwark += bonus
        else:
            guile += bonus
        self.card_attrs[card] = self._attrs_pack(
            valor, bulwark, guile, tempers + 1, self._attr_hardened(attrs),
            self._attr_xp(attrs), self._attr_vet(attrs))
        self.card_power[card] = self.card_power[card] + bonus
        self._earn_renown(who, 5, ctx.block.timestamp)
        self._trial_hit(who, 4, ctx.block.timestamp)
        self.syscall.emit_event(
            f'{{"event":"temper","aspect":{aspect},"bonus":{bonus},"cost":{cost}}}'.encode()
        )
        return cost

    # ------------------------------------------------------------------
    # Delves: lock a staked champion for a spell, roll a fortune
    # ------------------------------------------------------------------

    @public
    def begin_delve(self, ctx: Context, card: TokenUid) -> None:
        who = self._player(ctx)
        if self.staked.get(card) != who:
            raise NCFail("only a champion of yours toiling in the Mines may delve")
        if card in self.delve_since:
            raise NCFail("already delving")
        # bank the mining so far; the delve itself earns no ember
        self._accrue(card, ctx.block.timestamp)
        self.delve_since[card] = ctx.block.timestamp
        self.syscall.emit_event(f'{{"event":"delve","token":"{card.hex()}"}}'.encode())

    @public
    def claim_delve(self, ctx: Context, card: TokenUid) -> int:
        """Outcomes: 0 dust (25%), 1 seam 1.5x (55%), 2 shards (15%),
        3 rich vein 5x (4.9%), 4 ancient relic (0.1%)."""
        who = self._player(ctx)
        if self.staked.get(card) != who:
            raise NCFail("not your staked card")
        since = self.delve_since.get(card)
        if since is None:
            raise NCFail("this champion is not delving")
        if ctx.block.timestamp - since < self.delve_seconds:
            raise NCFail("the delve is not finished")
        del self.delve_since[card]
        self.stake_since[card] = ctx.block.timestamp  # mining resumes now
        tier = self.card_tier[card]
        base = self.delve_seconds * self._rate_per_min(tier) // 60
        roll = self.syscall.rng.randbelow(1000)
        outcome = 0
        ember = 0
        shards = 0
        if roll < 1:
            outcome = 4
            ember = base * 10
            shards = 25
        elif roll < 50:
            outcome = 3
            ember = base * 5
        elif roll < 200:
            outcome = 2
            shards = tier + 1
        elif roll < 450:
            outcome = 0
        else:
            outcome = 1
            ember = base * 3 // 2
        if ember > 0:
            self._credit_ember(who, ember)
        if shards > 0:
            self.shards_ledger[who] = self.shards_ledger.get(who, 0) + shards
        self.log.info('delve_claimed', outcome=outcome, ember=ember, shards=shards)
        self.syscall.emit_event(
            f'{{"event":"delve_done","outcome":{outcome},"ember":{ember},'
            f'"shards":{shards}}}'.encode()
        )
        return outcome

    # ------------------------------------------------------------------
    # The Gauntlet: writs posted by the Crown, fought from the Mines
    # ------------------------------------------------------------------

    @public
    def add_writ(self, ctx: Context, name: str, valor: int,
                 bulwark: int, guile: int) -> None:
        self._check_owner(ctx)
        if len(name) < 1 or len(name) > 30:
            raise NCFail("name must be 1-30 chars")
        if valor < 1 or bulwark < 1 or guile < 1:
            raise NCFail("aspects must be positive")
        if valor + bulwark + guile > 4_000:
            raise NCFail("writ too mighty")
        self.writ_name.append(name)
        self.writ_valor.append(valor)
        self.writ_bulwark.append(bulwark)
        self.writ_guile.append(guile)

    @public
    def set_writ(self, ctx: Context, writ: int, valor: int, bulwark: int,
                 guile: int) -> None:
        """Retune a posted boss. Balance is a moving target and a realm
        should not need a new contract to answer it."""
        self._check_owner(ctx)
        if writ < 0 or writ >= len(self.writ_name):
            raise NCFail("no such writ")
        if valor < 1 or bulwark < 1 or guile < 1:
            raise NCFail("aspects must be positive")
        if valor + bulwark + guile > 4_000:
            raise NCFail("writ too mighty")
        self.writ_valor[writ] = valor
        self.writ_bulwark[writ] = bulwark
        self.writ_guile[writ] = guile
        self.log.info('writ_retuned', writ=writ)

    def _writ_spread(self, writ: int, tier: int, power: int) -> list[int]:
        """The aspects a champion of this power actually faces. Tiers step
        x1/x3/x9, then the spread is floored at 45/80/115% of the champion's
        power, keeping its shape: a posting of 6/5/5 was no gate at all for a
        Highlord, let alone a Sovereign."""
        mult = [1, 3, 9][tier]
        bv = self.writ_valor[writ] * mult
        bb = self.writ_bulwark[writ] * mult
        bg = self.writ_guile[writ] * mult
        total = bv + bb + bg
        floor = power * [45, 80, 115][tier] // 100
        if 0 < total < floor:
            bv = bv * floor // total
            bb = bb * floor // total
            bg = bg * floor // total
        return [bv, bb, bg]

    @view
    def get_writ_spread(self, writ: int, tier: int, power: int) -> str:
        """What a fight will face, "v|b|g", from the same code the fight
        runs: the UI never has to guess or duplicate the maths."""
        if writ < 0 or writ >= len(self.writ_name) or tier < 0 or tier > 2:
            return ""
        sp = self._writ_spread(writ, tier, power)
        return f"{sp[0]}|{sp[1]}|{sp[2]}"

    @public
    def fight_writ(self, ctx: Context, card: TokenUid, writ: int, tier: int) -> int:
        """Best-of-three against a posted writ, tier Grim(0)/Dire(1)/Black(2)
        scaling its aspects 1x/2x/4x. Entry: a fifth of the champion's
        fusion fee (half burned, half Crown). Victory pays four entries;
        first clears pay ten and grant deeds. Three fights per champion
        per day. Returns 1 on victory."""
        who = self._player(ctx)
        if self.staked.get(card) != who:
            raise NCFail("champions march on writs from the Mines")
        self._check_not_delving(card)
        if writ < 0 or writ >= len(self.writ_name):
            raise NCFail("no such writ")
        if tier < 0 or tier > 2:
            raise NCFail("tier must be 0 (Grim), 1 (Dire) or 2 (Black)")
        cleared = self.gauntlet_cleared.get(who, 0)
        if tier > 0 and not (cleared & (1 << (writ * 3 + tier - 1))):
            raise NCFail("fell the lesser tier of this writ first")
        if writ > 0 and not (cleared & (1 << ((writ - 1) * 3))):
            raise NCFail("the previous writ still stands")
        now = ctx.block.timestamp
        day = now // 86400
        packed = self.writ_attempts.get(card, 0)
        used = packed % 10 if packed // 10 == day else 0
        if used >= 3:
            raise NCFail("this champion has fought enough for one day")
        self.writ_attempts[card] = day * 10 + used + 1
        card_tier = self.card_tier[card]
        entry = self._fusion_fee(card_tier) // 5
        if entry < 1:
            entry = 1
        balance = self.ember_ledger.get(who, 0)
        if balance < entry:
            raise NCFail(f"the writ demands an entry of {entry} Ember")
        self._debit_ember(who, entry)
        # half to the Crown; the other half simply ceases to exist
        self._credit_ember(self.owner, entry // 2)

        boss = self._writ_spread(writ, tier, self.card_power[card])
        attrs = self.card_attrs[card]
        ab = self.card_ability.get(card, 0)
        weaker = 1 if self.card_power[card] < boss[0] + boss[1] + boss[2] else 0
        rounds = 0
        r0 = 0
        r1 = 0
        r2 = 0
        for aspect in range(3):
            pc = self._attr_at(attrs, aspect)
            pb = boss[aspect]
            split = 1 if aspect == 2 and r0 + r1 == 1 else 0
            pc = self._ability_boost(ab, aspect, r0, split, weaker, pc)
            won = 1 if self.syscall.rng.randbelow(pc + pb) < pc else 0
            rounds += won
            if aspect == 0:
                r0 = won
            elif aspect == 1:
                r1 = won
            else:
                r2 = won
        victory = 1 if rounds >= 2 else 0
        self._earn_renown(who, 3, now)
        if victory:
            reward = entry * 4
            bit = 1 << (writ * 3 + tier)
            # progression and the felled-writ deed are per address (identity);
            # the fat 10x first-clear bounty is per CARD, so one champion shuttled
            # across fresh addresses cannot farm it more than once
            if not (cleared & bit):
                self.gauntlet_cleared[who] = cleared | bit
                self._grant_deed(who, 6)
                if tier == 2:
                    self._grant_deed(who, 7)
            card_bits = self.card_cleared.get(card, 0)
            if not (card_bits & bit):
                self.card_cleared[card] = card_bits | bit
                reward += entry * 10
            self._credit_ember(who, reward)
            self.renown[who] = self.renown.get(who, 0) + 6
            self._grant_xp(card, 2)
            self._trial_hit(who, 7, now)
        else:
            self._grant_xp(card, 1)
        self.syscall.emit_event(
            f'{{"event":"writ","writ":{writ},"tier":{tier},"won":{victory},'
            f'"valor":{r0},"bulwark":{r1},"guile":{r2}}}'.encode()
        )
        return victory

    # ------------------------------------------------------------------
    # Guilds and the world boss
    # ------------------------------------------------------------------

    def _wb_key(self, week: int, who: Address) -> str:
        return f"{week}|{who.hex()}"

    @public
    def create_guild(self, ctx: Context, name: str) -> int:
        """Raise a banner for 500 Ember (burned). One guild per identity;
        names are unique, case-insensitively."""
        who = self._player(ctx)
        if who in self.member_guild:
            raise NCFail("you already ride under a banner")
        if len(name) < 3 or len(name) > 16:
            raise NCFail("guild name must be 3-16 chars")
        key = name.lower()
        if self.guild_taken.get(key, False):
            raise NCFail("that banner is already raised")
        balance = self.ember_ledger.get(who, 0)
        if balance < 500:
            raise NCFail("raising a banner costs 500 Ember")
        self._debit_ember(who, 500)
        gid = self.guild_count
        self.guild_count = gid + 1
        self.guild_name[gid] = name
        self.guild_taken[key] = True
        self.guild_members[gid] = 1
        self.member_guild[who] = gid
        self.log.info('guild_created', guild_id=gid)
        self.syscall.emit_event(
            f'{{"event":"guild_created","id":{gid}}}'.encode()
        )
        return gid

    @public
    def join_guild(self, ctx: Context, guild_id: int) -> None:
        who = self._player(ctx)
        if who in self.member_guild:
            raise NCFail("you already ride under a banner")
        if guild_id < 0 or guild_id >= self.guild_count:
            raise NCFail("no such guild")
        self.member_guild[who] = guild_id
        self.guild_members[guild_id] = self.guild_members.get(guild_id, 0) + 1
        self.log.info('guild_joined', guild_id=guild_id)

    @public
    def leave_guild(self, ctx: Context) -> None:
        who = self._player(ctx)
        if who not in self.member_guild:
            raise NCFail("you ride under no banner")
        gid = self.member_guild[who]
        del self.member_guild[who]
        self.guild_members[gid] = self.guild_members.get(gid, 1) - 1
        self.log.info('guild_left', guild_id=gid)

    @public
    def post_world_boss(self, ctx: Context, name: str, hp: int,
                        valor: int, bulwark: int, guile: int) -> int:
        """The Crown posts the week's boss (a cron scales hp to the realm).
        An unslain previous boss rolls its bounty pool forward."""
        self._check_owner(ctx)
        if len(name) < 1 or len(name) > 30:
            raise NCFail("name must be 1-30 chars")
        if hp < 100 or hp > 1_000_000:
            raise NCFail("hp out of range")
        if valor < 1 or bulwark < 1 or guile < 1:
            raise NCFail("aspects must be positive")
        if valor + bulwark + guile > 10_000:
            raise NCFail("boss too mighty")
        week = ctx.block.timestamp // 604_800
        if week in self.wb_name:
            raise NCFail("this week's boss already stands")
        prev = self.wb_week
        if prev > 0 and prev != week and self.wb_hp.get(prev, 0) > 0:
            self.wb_pool[week] = self.wb_pool.get(week, 0) + self.wb_pool.get(prev, 0)
            self.wb_pool[prev] = 0
        self.wb_week = week
        self.wb_name[week] = name
        self.wb_hp[week] = hp
        self.wb_hp0[week] = hp
        self.wb_valor[week] = valor
        self.wb_bulwark[week] = bulwark
        self.wb_guile[week] = guile
        self.log.info('world_boss_posted', week=week, hp=hp)
        self.syscall.emit_event(
            f'{{"event":"world_boss","week":{week},"hp":{hp}}}'.encode()
        )
        return week

    @public
    def fight_world_boss(self, ctx: Context, card: TokenUid) -> int:
        """A staked champion strikes the week's boss. Entry: a fifth of the
        champion's fusion fee (half burned, half Crown), three fights per
        champion per day. Damage = rounds won x power. Returns the damage."""
        who = self._player(ctx)
        now = ctx.block.timestamp
        week = now // 604_800
        if week not in self.wb_name:
            raise NCFail("no world boss stands this week")
        if self.wb_hp.get(week, 0) <= 0:
            raise NCFail("the boss has already fallen")
        if self.staked.get(card) != who:
            raise NCFail("champions march on the boss from the Mines")
        self._check_not_delving(card)
        day = now // 86400
        packed = self.wb_attempts.get(card, 0)
        used = packed % 10 if packed // 10 == day else 0
        if used >= 3:
            raise NCFail("this champion has fought enough for one day")
        self.wb_attempts[card] = day * 10 + used + 1
        entry = self._fusion_fee(self.card_tier[card]) // 5
        if entry < 1:
            entry = 1
        balance = self.ember_ledger.get(who, 0)
        if balance < entry:
            raise NCFail(f"the boss demands an entry of {entry} Ember")
        self._debit_ember(who, entry)
        self._credit_ember(self.owner, entry // 2)

        boss = [self.wb_valor[week], self.wb_bulwark[week], self.wb_guile[week]]
        attrs = self.card_attrs[card]
        ab = self.card_ability.get(card, 0)
        weaker = 1 if self.card_power[card] < boss[0] + boss[1] + boss[2] else 0
        rounds = 0
        r0 = 0
        r1 = 0
        for aspect in range(3):
            pc = self._attr_at(attrs, aspect)
            pb = boss[aspect]
            split = 1 if aspect == 2 and r0 + r1 == 1 else 0
            pc = self._ability_boost(ab, aspect, r0, split, weaker, pc)
            won = 1 if self.syscall.rng.randbelow(pc + pb) < pc else 0
            rounds += won
            if aspect == 0:
                r0 = won
            elif aspect == 1:
                r1 = won
        damage = rounds * self.card_power[card]
        slain = 0
        if damage > 0:
            hp = self.wb_hp[week] - damage
            if hp <= 0:
                hp = 0
                slain = 1
            self.wb_hp[week] = hp
            dkey = self._wb_key(week, who)
            if dkey not in self.wb_damage:
                # the bounty bonus follows the banner you FOUGHT under
                self.wb_fought_guild[dkey] = self.member_guild.get(who, -1)
            self.wb_damage[dkey] = self.wb_damage.get(dkey, 0) + damage
            self.wb_total[week] = self.wb_total.get(week, 0) + damage
            gid = self.wb_fought_guild.get(dkey, -1)
            if gid >= 0:
                gkey = f"{week}|{gid}"
                gdmg = self.wb_guild_damage.get(gkey, 0) + damage
                self.wb_guild_damage[gkey] = gdmg
                top = self.wb_top_guild.get(week, -1)
                if top < 0 or gid == top:
                    self.wb_top_guild[week] = gid
                elif gdmg > self.wb_guild_damage.get(f"{week}|{top}", 0):
                    self.wb_top_guild[week] = gid
        self._earn_renown(who, 3, now)
        self._grant_xp(card, 2 if rounds > 0 else 1)
        if slain == 1:
            self.renown[who] = self.renown.get(who, 0) + 6
            self.log.info('world_boss_slain', week=week)
        self.log.info('world_boss_hit', week=week, damage=damage)
        self.syscall.emit_event(
            f'{{"event":"wb_hit","week":{week},"damage":{damage},"slain":{slain}}}'.encode()
        )
        return damage

    @public
    def claim_world_bounty(self, ctx: Context, week: int) -> Amount:
        """After the boss falls, every contributor claims the pool pro-rata
        by damage; the top-damage guild's fighters take +25%."""
        who = self._player(ctx)
        if week not in self.wb_name:
            raise NCFail("no boss stood that week")
        if self.wb_hp.get(week, 1) > 0:
            raise NCFail("the boss still stands")
        ckey = self._wb_key(week, who)
        if self.wb_claimed.get(ckey, False):
            raise NCFail("already claimed")
        dmg = self.wb_damage.get(ckey, 0)
        if dmg <= 0:
            raise NCFail("you dealt no damage that week")
        total = self.wb_total.get(week, 0)
        pool = self.wb_pool.get(week, 0)
        share = pool * dmg // total if total > 0 else 0
        top = self.wb_top_guild.get(week, -1)
        if top >= 0 and self.wb_fought_guild.get(ckey, -1) == top:
            share += share // 4
        self.wb_claimed[ckey] = True
        if share > 0:
            self._credit_ember(who, share)
        self.log.info('world_bounty_claimed', week=week, share=share)
        return share

    # ------------------------------------------------------------------
    # Tournaments: scheduled brackets, Crown-seeded prize pools
    # ------------------------------------------------------------------

    @public
    def create_tournament(self, ctx: Context, name: str, fee: Amount,
                          size: int, start_ts: int, round_secs: int,
                          seed: Amount) -> int:
        """The Crown schedules a bracket. The seed comes out of its own
        Ember ledger now and returns only if the bracket cancels."""
        self._check_owner(ctx)
        if len(name) < 1 or len(name) > 30:
            raise NCFail("name must be 1-30 chars")
        if fee < 0 or seed < 0:
            raise NCFail("fee and seed cannot be negative")
        if size != 4 and size != 8 and size != 16 and size != 32:
            raise NCFail("bracket size must be 4, 8, 16 or 32")
        if start_ts <= ctx.block.timestamp:
            raise NCFail("the start must lie ahead")
        if round_secs < 30 or round_secs > 7 * 86400:
            raise NCFail("round interval out of range")
        who = self._player(ctx)
        if seed > 0:
            if self.ember_ledger.get(who, 0) < seed:
                raise NCFail("the Crown's ledger cannot cover that seed")
            self._debit_ember(who, seed)
        t = self.next_tourney_id
        self.next_tourney_id = t + 1
        self.tour_name[t] = name
        self.tour_state[t] = 0
        self.tour_fee[t] = fee
        self.tour_seed[t] = seed
        self.tour_size[t] = size
        self.tour_start[t] = start_ts
        self.tour_round_secs[t] = round_secs
        self.tour_round[t] = 0
        self.tour_next_ts[t] = start_ts
        self.tour_n[t] = 0
        self.tour_paid[t] = 0
        self.log.info('tournament_posted', tournament=t, start=start_ts)
        self.syscall.emit_event(
            f'{{"event":"tournament","id":{t},"start":{start_ts}}}'.encode()
        )
        return t

    @public(allow_deposit=True)
    def enter_tournament(self, ctx: Context, t: int) -> int:
        """One champion and the entry fee buy a bracket seat. One seat
        per identity; leave_tournament refunds fully before the start."""
        who = self._player(ctx)
        if self.tour_state.get(t, -1) != 0:
            raise NCFail("that tournament is not open")
        if ctx.block.timestamp >= self.tour_start[t]:
            raise NCFail("registration has closed")
        n = self.tour_n[t]
        if n >= self.tour_size[t]:
            raise NCFail("the bracket is full")
        i = 0
        while i < n:
            if self.tour_entrant[t * 64 + i] == who:
                raise NCFail("you already hold a seat")
            i += 1
        action = self._single_card_deposit(ctx)
        fee = self.tour_fee[t]
        if self.ember_ledger.get(who, 0) < fee:
            raise NCFail("not enough Ember for the entry fee")
        self._debit_ember(who, fee)
        key = t * 64 + n
        self.tour_entrant[key] = who
        self.tour_card[key] = action.token_uid
        self.tour_alive[key] = True
        self.tour_n[t] = n + 1
        self.log.info('tournament_entered', tournament=t, seat=n)
        return n

    @public
    def leave_tournament(self, ctx: Context, t: int) -> None:
        """Give up the seat before the start: fee and champion return."""
        who = self._player(ctx)
        if self.tour_state.get(t, -1) != 0:
            raise NCFail("that tournament is not open")
        if ctx.block.timestamp >= self.tour_start[t]:
            raise NCFail("the bracket is set; seats are held to the end")
        n = self.tour_n[t]
        i = 0
        while i < n:
            if self.tour_entrant[t * 64 + i] == who:
                self._credit_ember(who, self.tour_fee[t])
                self.pending[self.tour_card[t * 64 + i]] = who
                last = t * 64 + (n - 1)
                self.tour_entrant[t * 64 + i] = self.tour_entrant[last]
                self.tour_card[t * 64 + i] = self.tour_card[last]
                self.tour_n[t] = n - 1
                self.log.info('tournament_left', tournament=t)
                return
            i += 1
        raise NCFail("you hold no seat in that tournament")

    @public
    def advance_tournament(self, ctx: Context, t: int) -> int:
        """Anyone may push the bracket once a round is due. Below four
        entrants at start the bracket cancels with full refunds. Returns
        the number of entrants still standing (0 on cancellation)."""
        now = ctx.block.timestamp
        state = self.tour_state.get(t, -1)
        if state != 0 and state != 1:
            raise NCFail("that tournament is over")
        if now < self.tour_next_ts[t]:
            raise NCFail("the next round is not due yet")
        n = self.tour_n[t]
        if state == 0:
            if n < 4:
                i = 0
                while i < n:
                    key = t * 64 + i
                    self._credit_ember(self.tour_entrant[key], self.tour_fee[t])
                    self.pending[self.tour_card[key]] = self.tour_entrant[key]
                    i += 1
                if self.tour_seed[t] > 0:
                    self._credit_ember(self.owner, self.tour_seed[t])
                self.tour_state[t] = 3
                self.log.info('tournament_cancelled', tournament=t)
                self.syscall.emit_event(
                    f'{{"event":"tour_cancel","id":{t}}}'.encode()
                )
                return 0
            self.tour_state[t] = 1
        pool = self.tour_fee[t] * n + self.tour_seed[t]
        alive: list[int] = []
        i = 0
        while i < n:
            if self.tour_alive.get(t * 64 + i, False):
                alive.append(i)
            i += 1
        m = len(alive)
        if m < 2:
            raise NCFail("the bracket is already decided")
        fee = self.tour_fee[t]
        k = 0
        while k + 1 < m:
            key_a = t * 64 + alive[k]
            key_b = t * 64 + alive[k + 1]
            card_a = self.tour_card[key_a]
            card_b = self.tour_card[key_b]
            packed = self._fight_rounds(card_a, card_b, -1, -1)
            a_won = packed // 1000 >= 2
            lose_key = key_b if a_won else key_a
            win_card = card_a if a_won else card_b
            lose_card = card_b if a_won else card_a
            loser = self.tour_entrant[lose_key]
            self._after_fight(win_card, lose_card, fee)
            self.tour_alive[lose_key] = False
            self.pending[lose_card] = loser
            if 2 < m <= 4:
                # falling in the semifinals still pays: 7.5% of the pool
                # (the final's loser is the runner-up, paid below instead)
                share = pool * 75 // 1000
                if share > 0:
                    self._credit_ember(loser, share)
                self.tour_paid[t] = self.tour_paid.get(t, 0) + share
            k += 2
        # an odd tail walks through on a bye
        self.tour_round[t] = self.tour_round.get(t, 0) + 1
        self.tour_next_ts[t] = now + self.tour_round_secs[t]
        survivors = m - m // 2
        if m == 2:
            # that was the final
            win_i = alive[0] if self.tour_alive.get(t * 64 + alive[0], False) else alive[1]
            lose_i = alive[1] if win_i == alive[0] else alive[0]
            champion = self.tour_entrant[t * 64 + win_i]
            runner = self.tour_entrant[t * 64 + lose_i]
            runner_share = pool * 250 // 1000
            if runner_share > 0:
                self._credit_ember(runner, runner_share)
            paid = self.tour_paid.get(t, 0) + runner_share
            champ_share = pool - paid
            self._credit_ember(champion, champ_share)
            self.pending[self.tour_card[t * 64 + win_i]] = champion
            self.tour_champion[t] = champion
            self.tour_state[t] = 2
            self.wins[champion] = self.wins.get(champion, 0) + 1
            self._earn_renown(champion, 25, now)
            self._earn_renown(runner, 10, now)
            self.log.info('tournament_won', tournament=t, prize=champ_share)
            self.syscall.emit_event(
                f'{{"event":"tour_won","id":{t},"prize":{champ_share}}}'.encode()
            )
            return 1
        self.log.info('tournament_round', tournament=t,
                      round_no=self.tour_round[t], standing=survivors)
        self.syscall.emit_event(
            f'{{"event":"tour_round","id":{t},"standing":{survivors}}}'.encode()
        )
        return survivors

    # ------------------------------------------------------------------
    # Cosmetics: bought identity that travels with the card, never power
    # ------------------------------------------------------------------

    @public
    def buy_cosmetic(self, ctx: Context, card: TokenUid, slot: int, value: int) -> None:
        """Slots: 0 frame (ember), 1 tint (ember), 2 epithet (shards).
        Value 0 clears a slot for free."""
        who = self._player(ctx)
        if self.staked.get(card) != who and self.pending.get(card) != who:
            raise NCFail("dress a champion of yours in the Mines or awaiting claim")
        if slot < 0 or slot > 2:
            raise NCFail("no such slot")
        if value < 0 or value > 255:
            raise NCFail("value must be 0-255")
        if value > 0:
            tier = self.card_tier[card]
            if slot == 2:
                price = 3
                have = self.shards_ledger.get(who, 0)
                if have < price:
                    raise NCFail(f"epithets cost {price} relic shards (delve for them)")
                self.shards_ledger[who] = have - price
            else:
                price = 25 * (tier + 1)
                have = self.ember_ledger.get(who, 0)
                if have < price:
                    raise NCFail(f"this adornment costs {price} Ember")
                self._debit_ember(who, price)
                # cosmetics ember are a pure sink: half Crown, half gone
                self._credit_ember(self.owner, price // 2)
        packed = self.card_cosmetics.get(card, 0)
        if slot == 0:
            packed = (packed & ~0xFF) | value
        elif slot == 1:
            packed = (packed & ~0xFF00) | (value << 8)
        else:
            packed = (packed & ~0xFF0000) | (value << 16)
        self.card_cosmetics[card] = packed

    # ------------------------------------------------------------------
    # Fusion: parents are parked in the vault, never destroyed
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def fuse(self, ctx: Context) -> TokenUid:
        who = self._player(ctx)
        if len(ctx.actions_list) != 2:
            raise NCFail("deposit exactly two cards")
        a = ctx.actions_list[0]
        b = ctx.actions_list[1]
        for act in (a, b):
            if not isinstance(act, NCDepositAction) or act.amount != self.card_unit:
                raise NCFail("each action must deposit one full card")
            if act.token_uid not in self.card_tier:
                raise NCFail("unknown card")
            if self.parked.get(act.token_uid, False):
                raise NCFail("that champion rests in the vault")
        if a.token_uid == b.token_uid:
            raise NCFail("two distinct cards required")
        tier = self.card_tier[a.token_uid]
        if self.card_tier[b.token_uid] != tier:
            raise NCFail("cards must be the same tier")
        if tier >= 3:
            raise NCFail("legendary cards cannot be fused")
        fee = self._fusion_fee(tier)
        balance = self.ember_ledger.get(who, 0)
        if balance < fee:
            raise NCFail(f"fusion costs {fee} Ember (earn it by mining)")
        self._debit_ember(who, fee)
        bonus = (self.card_power[a.token_uid] + self.card_power[b.token_uid]) // 10
        # the parents stay in contract custody forever: no melt authority
        # needed, adopted cards fuse too, and the lineage survives on chain
        self.parked[a.token_uid] = True
        self.parked[b.token_uid] = True
        new_tier = tier + 1
        if len(self._templates(new_tier)) == 0:
            raise NCFail("no templates for the next tier")
        if self.proceeds < 1:
            raise NCFail("reward pool too low to mint")
        self.proceeds -= 1
        card = self._mint_card(new_tier, bonus)
        self.pending[card] = who
        self._earn_renown(who, self._fuse_renown(tier), ctx.block.timestamp)
        self._grant_deed(who, 1)
        if new_tier >= 2:
            self._grant_deed(who, 2)
        if new_tier >= 3:
            self._grant_deed(who, 3)
        self._trial_hit(who, 3, ctx.block.timestamp)
        self.syscall.emit_event(
            f'{{"event":"fuse","tier":{new_tier},"token":"{card.hex()}"}}'.encode()
        )
        return card

    # ------------------------------------------------------------------
    # Duels: open challenges, optional sealed stances, side-bets
    # ------------------------------------------------------------------

    @public(allow_deposit=True)
    def create_duel(self, ctx: Context, wager: Amount, commitment: bytes) -> int:
        """Post a challenge. commitment is either empty (classic duel,
        settled the moment someone accepts) or the 32-byte sha3-256 of
        "{stance}:{salt}" sealing the challenger's stance."""
        who = self._player(ctx)
        if wager < 0:
            raise NCFail("wager cannot be negative")
        if len(commitment) != 0 and len(commitment) != 32:
            raise NCFail("commitment must be empty or 32 bytes")
        action = self._single_card_deposit(ctx)
        balance = self.ember_ledger.get(who, 0)
        if balance < wager:
            raise NCFail("not enough Ember in your ledger for this wager")
        self._debit_ember(who, wager)
        duel_id = self.next_duel_id
        self.next_duel_id = duel_id + 1
        self.duel_card[duel_id] = action.token_uid
        self.duel_wager[duel_id] = wager
        self.duel_challenger[duel_id] = who
        self.duel_open[duel_id] = True
        if len(commitment) == 32:
            self.duel_commit[duel_id] = commitment
        return duel_id

    def _three_card_deposits(self, ctx: Context) -> list[TokenUid]:
        if len(ctx.actions_list) != 3:
            raise NCFail("deposit exactly three cards")
        cards: list[TokenUid] = []
        for act in ctx.actions_list:
            if not isinstance(act, NCDepositAction) or act.amount != self.card_unit:
                raise NCFail("each action must deposit one full card")
            if act.token_uid not in self.card_tier:
                raise NCFail("unknown card")
            if self.parked.get(act.token_uid, False):
                raise NCFail("that champion rests in the vault")
            if act.token_uid in cards:
                raise NCFail("three distinct cards required")
            cards.append(act.token_uid)
        return cards

    @public(allow_deposit=True)
    def create_squad_duel(self, ctx: Context, wager: Amount, commitment: bytes) -> int:
        """Post a 3v3 challenge. The squad is public; the lane order is
        sealed: commitment = sha3("perm:salt") with perm a permutation
        of the digits 012 (lane i is fought by your card perm[i], in
        deposit order)."""
        who = self._player(ctx)
        if wager < 0:
            raise NCFail("wager cannot be negative")
        if len(commitment) != 32:
            raise NCFail("squads always seal the lane order (32 bytes)")
        cards = self._three_card_deposits(ctx)
        balance = self.ember_ledger.get(who, 0)
        if balance < wager:
            raise NCFail("not enough Ember in your ledger for this wager")
        self._debit_ember(who, wager)
        duel_id = self.next_duel_id
        self.next_duel_id = duel_id + 1
        self.duel_kind[duel_id] = 1
        self.duel_card[duel_id] = cards[0]
        i = 0
        while i < 3:
            self.squad_card[duel_id * 4 + i] = cards[i]
            i += 1
        self.duel_wager[duel_id] = wager
        self.duel_challenger[duel_id] = who
        self.duel_open[duel_id] = True
        self.duel_commit[duel_id] = commitment
        return duel_id

    @public(allow_deposit=True)
    def accept_squad_duel(self, ctx: Context, duel_id: int) -> int:
        """Answer a 3v3: deposit three cards; the deposit order IS your
        lane assignment. Settles at the challenger's reveal."""
        who = self._player(ctx)
        if not self.duel_open.get(duel_id, False):
            raise NCFail("duel is not open")
        if self.duel_kind.get(duel_id, 0) != 1:
            raise NCFail("this is not a squad duel")
        challenger = self.duel_challenger[duel_id]
        if challenger == who:
            raise NCFail("cannot duel yourself")
        bet_n = self.bet_count.get(duel_id, 0)
        i = 0
        while i < bet_n:
            if self.bet_addr[duel_id * 64 + i] == who:
                raise NCFail("you have a bet riding on this duel")
            i += 1
        cards = self._three_card_deposits(ctx)
        wager = self.duel_wager[duel_id]
        balance = self.ember_ledger.get(who, 0)
        if balance < wager:
            raise NCFail("not enough Ember in your ledger for this wager")
        self._debit_ember(who, wager)
        self.duel_open[duel_id] = False
        self.duel_acceptor[duel_id] = who
        self.duel_acceptor_card[duel_id] = cards[0]
        i = 0
        while i < 3:
            self.squad_acceptor_card[duel_id * 4 + i] = cards[i]
            i += 1
        self.duel_accept_ts[duel_id] = ctx.block.timestamp
        self.duel_reveal_pending[duel_id] = True
        self.log.info('squad_accepted', duel_id=duel_id)
        self.syscall.emit_event(
            f'{{"event":"squad_accepted","id":{duel_id}}}'.encode()
        )
        return 2

    @public
    def reveal_squad(self, ctx: Context, duel_id: int, perm: str, salt: str) -> int:
        """The challenger unseals the lane order and the three lane fights
        settle. Two lanes take the pot. Returns 0 (challenger) or 1."""
        who = self._player(ctx)
        if not self.duel_reveal_pending.get(duel_id, False):
            raise NCFail("this duel awaits no reveal")
        if self.duel_kind.get(duel_id, 0) != 1:
            raise NCFail("this is not a squad duel")
        if self.duel_challenger[duel_id] != who:
            raise NCFail("only the challenger may reveal")
        if len(perm) != 3 or "0" not in perm or "1" not in perm or "2" not in perm:
            raise NCFail("perm must arrange the digits 012")
        if sha3(f"{perm}:{salt}".encode()) != self.duel_commit[duel_id]:
            raise NCFail("that is not the sealed lane order")
        self.duel_reveal_pending[duel_id] = False
        challenger = self.duel_challenger[duel_id]
        acceptor = self.duel_acceptor[duel_id]
        wager = self.duel_wager[duel_id]
        lanes_c = 0
        lane = 0
        digits = "012"
        results = [0, 0, 0]
        while lane < 3:
            c_card = self.squad_card[duel_id * 4 + digits.find(perm[lane])]
            a_card = self.squad_acceptor_card[duel_id * 4 + lane]
            packed = self._fight_rounds(c_card, a_card, -1, -1)
            c_won = 1 if packed // 1000 >= 2 else 0
            lanes_c += c_won
            results[lane] = c_won
            if c_won == 1:
                self._after_fight(c_card, a_card, wager)
            else:
                self._after_fight(a_card, c_card, wager)
            lane += 1
        winner = challenger if lanes_c >= 2 else acceptor
        pot = 2 * wager
        rake = pot * self._rake_bps() // 10_000
        self._credit_ember(winner, pot - rake)
        self._credit_ember(self.owner, rake)
        self.wins[winner] = self.wins.get(winner, 0) + 1
        if wager > 0:
            self._earn_renown(challenger, 5, ctx.block.timestamp)
            self._earn_renown(acceptor, 5, ctx.block.timestamp)
            self.renown[winner] = self.renown.get(winner, 0) + 10
            self._trial_hit(winner, 2, ctx.block.timestamp)
        self._grant_deed(winner, 4)
        if self.wins[winner] >= 10:
            self._grant_deed(winner, 5)
        i = 0
        while i < 3:
            self.pending[self.squad_card[duel_id * 4 + i]] = challenger
            self.pending[self.squad_acceptor_card[duel_id * 4 + i]] = acceptor
            i += 1
        winning_side = 0 if winner == challenger else 1
        self._settle_bets(duel_id, winning_side)
        self.log.info('squad_settled', duel_id=duel_id,
                      winner_side=winning_side,
                      l0=results[0], l1=results[1], l2=results[2])
        self.syscall.emit_event(
            f'{{"event":"squad","id":{duel_id},"lanes":"{results[0]}{results[1]}{results[2]}"}}'.encode()
        )
        return winning_side

    def _rating_of(self, who: Address) -> int:
        return self.rating.get(who, 1000)

    def _ranked_wager(self, tier: int) -> Amount:
        if tier == 0:
            return 0
        if tier == 1:
            return 25
        if tier == 2:
            return 100
        raise NCFail("unknown ranked tier")

    def _elo_transfer(self, winner_r: int, loser_r: int) -> int:
        """Standard Elo K=32 expected-score transfer, rounded to integers
        in 25-point buckets (matches the exact formula to the point within
        the 200-rating matchmaking band)."""
        adv = winner_r - loser_r
        if adv >= 0:
            bucket = adv // 25
            if bucket > 8:
                bucket = 8
            return 16 - bucket
        bucket = (-adv) // 25
        if bucket > 8:
            bucket = 8
        return 16 + bucket

    @public(allow_deposit=True)
    def join_ranked(self, ctx: Context, tier: int) -> int:
        """Enter the rated queue with one card and the tier's fixed wager
        (0/25/100 Ember). If a compatible opponent waits (rating within
        200), this tx settles the fight at once: returns 1. Otherwise you
        wait in the queue: returns 0."""
        who = self._player(ctx)
        wager = self._ranked_wager(tier)
        action = self._single_card_deposit(ctx)
        my_card = action.token_uid
        balance = self.ember_ledger.get(who, 0)
        if balance < wager:
            raise NCFail("not enough Ember in your ledger for this wager")
        self._debit_ember(who, wager)
        my_r = self._rating_of(who)
        n = self.ranked_n.get(tier, 0)
        free = -1
        match_i = -1
        i = 0
        while i < n:
            key = tier * 4096 + i
            if not self.ranked_active.get(key, False):
                if free < 0:
                    free = i
                i += 1
                continue
            other = self.ranked_addr[key]
            if other == who:
                raise NCFail("you are already in this queue")
            d = self._rating_of(other) - my_r
            if match_i < 0 and -200 <= d <= 200:
                match_i = i
            i += 1
        if match_i < 0:
            slot = free if free >= 0 else n
            key = tier * 4096 + slot
            self.ranked_addr[key] = who
            self.ranked_card[key] = my_card
            self.ranked_active[key] = True
            if slot == n:
                self.ranked_n[tier] = n + 1
            self.log.info('ranked_queued', tier=tier)
            self.syscall.emit_event(
                f'{{"event":"ranked_queued","tier":{tier}}}'.encode()
            )
            return 0
        key = tier * 4096 + match_i
        self.ranked_active[key] = False
        opponent = self.ranked_addr[key]
        opp_card = self.ranked_card[key]
        packed = self._fight_rounds(opp_card, my_card, -1, -1)
        opp_won = packed // 1000 >= 2
        winner = opponent if opp_won else who
        loser = who if opp_won else opponent
        winner_card = opp_card if opp_won else my_card
        loser_card = my_card if opp_won else opp_card
        self._after_fight(winner_card, loser_card, wager)
        pot = 2 * wager
        rake = pot * self._rake_bps() // 10_000
        if self.card_ability.get(winner_card, 0) == 8:
            rake = 0                           # the Plunderer carries it all off
        self._credit_ember(winner, pot - rake)
        self._credit_ember(self.owner, rake)
        self.wins[winner] = self.wins.get(winner, 0) + 1
        if wager > 0:
            self._earn_renown(who, 5, ctx.block.timestamp)
            self._earn_renown(opponent, 5, ctx.block.timestamp)
            self.renown[winner] = self.renown.get(winner, 0) + 10
            self._trial_hit(winner, 2, ctx.block.timestamp)
        self._grant_deed(winner, 4)
        if self.wins[winner] >= 10:
            self._grant_deed(winner, 5)
        w_r = self._rating_of(winner)
        l_r = self._rating_of(loser)
        move = self._elo_transfer(w_r, l_r)
        if l_r - move < 100:
            # ladder floor: the loser never drops below 100; the winner
            # takes only what actually moved (stays zero-sum)
            move = l_r - 100
            if move < 0:
                move = 0
        self.rating[winner] = w_r + move
        self.rating[loser] = l_r - move
        self.pending[my_card] = who
        self.pending[opp_card] = opponent
        self.log.info('ranked_settled', tier=tier,
                      joiner_won=0 if opp_won else 1, move=move)
        self.syscall.emit_event(
            f'{{"event":"ranked","tier":{tier},"move":{move}}}'.encode()
        )
        return 1

    @public
    def leave_ranked(self, ctx: Context, tier: int) -> None:
        """Step out of the rated queue: the wager returns to your ledger
        and your champion goes to pending for claiming."""
        who = self._player(ctx)
        n = self.ranked_n.get(tier, 0)
        i = 0
        while i < n:
            key = tier * 4096 + i
            if self.ranked_active.get(key, False) and self.ranked_addr[key] == who:
                self.ranked_active[key] = False
                self._credit_ember(who, self._ranked_wager(tier))
                self.pending[self.ranked_card[key]] = who
                self.log.info('ranked_left', tier=tier)
                return
            i += 1
        raise NCFail("you are not in this queue")

    @public(allow_deposit=True)
    def accept_duel(self, ctx: Context, duel_id: int, stance: int) -> int:
        """Answer a challenge. Classic duels (no commitment) demand
        stance -1 and settle at once; stance duels demand 0..2 and wait
        for the challenger's reveal. Returns 0 if the challenger won,
        1 if the acceptor won, 2 if the duel awaits a reveal."""
        who = self._player(ctx)
        if not self.duel_open.get(duel_id, False):
            raise NCFail("duel is not open")
        if self.duel_kind.get(duel_id, 0) != 0:
            raise NCFail("this is a squad duel: answer with three cards")
        challenger = self.duel_challenger[duel_id]
        if challenger == who:
            raise NCFail("cannot duel yourself")
        # a bettor cannot become a participant: their bet was placed as a
        # spectator and must not ride on their own fight
        bet_n = self.bet_count.get(duel_id, 0)
        i = 0
        while i < bet_n:
            if self.bet_addr[duel_id * 64 + i] == who:
                raise NCFail("you have a bet riding on this duel")
            i += 1
        action = self._single_card_deposit(ctx)
        wager = self.duel_wager[duel_id]
        balance = self.ember_ledger.get(who, 0)
        if balance < wager:
            raise NCFail("not enough Ember in your ledger for this wager")
        self._debit_ember(who, wager)
        self.duel_open[duel_id] = False
        self.duel_acceptor[duel_id] = who
        self.duel_acceptor_card[duel_id] = action.token_uid
        if duel_id in self.duel_commit:
            if stance < 0 or stance > 2:
                raise NCFail("this duel is fought with stances: pick 0, 1 or 2")
            self.duel_acceptor_stance[duel_id] = stance
            self.duel_accept_ts[duel_id] = ctx.block.timestamp
            self.duel_reveal_pending[duel_id] = True
            self.syscall.emit_event(
                f'{{"event":"duel_accepted","id":{duel_id}}}'.encode()
            )
            return 2
        if stance != -1:
            raise NCFail("this duel has no stances: pass -1")
        return self._resolve_duel(ctx, duel_id, -1, -1)

    @public
    def reveal_duel(self, ctx: Context, duel_id: int, stance: int, salt: str) -> int:
        """The challenger unseals their stance and the duel settles.
        Returns 0 if the challenger won, 1 if the acceptor won."""
        who = self._player(ctx)
        if not self.duel_reveal_pending.get(duel_id, False):
            raise NCFail("this duel awaits no reveal")
        if self.duel_kind.get(duel_id, 0) != 0:
            raise NCFail("this is a squad duel: reveal the lane order")
        if self.duel_challenger[duel_id] != who:
            raise NCFail("only the challenger may reveal")
        if stance < 0 or stance > 2:
            raise NCFail("stance must be 0, 1 or 2")
        if sha3(f"{stance}:{salt}".encode()) != self.duel_commit[duel_id]:
            raise NCFail("that is not the sealed stance")
        self.duel_reveal_pending[duel_id] = False
        return self._resolve_duel(ctx, duel_id, stance,
                                  self.duel_acceptor_stance[duel_id])

    @public
    def claim_forfeit(self, ctx: Context, duel_id: int) -> None:
        """If the challenger sits on their sealed stance past the
        reveal window, anyone may call the duel: the acceptor takes the
        pot, both cards go home, and bets settle for the acceptor."""
        if not self.duel_reveal_pending.get(duel_id, False):
            raise NCFail("this duel awaits no reveal")
        now = ctx.block.timestamp
        if now - self.duel_accept_ts[duel_id] < self._reveal_window():
            raise NCFail("the reveal window is still open")
        self.duel_reveal_pending[duel_id] = False
        challenger = self.duel_challenger[duel_id]
        acceptor = self.duel_acceptor[duel_id]
        wager = self.duel_wager[duel_id]
        pot = 2 * wager
        rake = pot * self._rake_bps() // 10_000
        self._credit_ember(acceptor, pot - rake)
        self._credit_ember(self.owner, rake)
        self.wins[acceptor] = self.wins.get(acceptor, 0) + 1
        if wager > 0:
            self.renown[acceptor] = self.renown.get(acceptor, 0) + 10
        if self.duel_kind.get(duel_id, 0) == 1:
            i = 0
            while i < 3:
                self.pending[self.squad_card[duel_id * 4 + i]] = challenger
                self.pending[self.squad_acceptor_card[duel_id * 4 + i]] = acceptor
                i += 1
        else:
            self.pending[self.duel_card[duel_id]] = challenger
            self.pending[self.duel_acceptor_card[duel_id]] = acceptor
        self._settle_bets(duel_id, 1)
        self.log.info('duel_forfeited', duel_id=duel_id, winner_side=1)
        self.syscall.emit_event(
            f'{{"event":"duel_forfeit","id":{duel_id}}}'.encode()
        )

    def _stance_edge(self, c_stance: int, a_stance: int) -> int:
        """Rock-paper-scissors: 0 beats 1, 1 beats 2, 2 beats 0.
        Returns 0 if the challenger holds the edge, 1 if the acceptor
        does, -1 for no edge (same stance or a classic duel)."""
        if c_stance < 0 or a_stance < 0 or c_stance == a_stance:
            return -1
        if a_stance == (c_stance + 1) % 3:
            return 0
        return 1

    def _fight_rounds(self, card_a: TokenUid, card_b: TokenUid,
                      c_stance: int, a_stance: int) -> int:
        """One full aspect fight between two cards with abilities and an
        optional stance edge. Returns rounds_a*1000 + r0*100 + r1*10 + r2."""
        attrs_a = self.card_attrs[card_a]
        attrs_b = self.card_attrs[card_b]
        ab_a = self.card_ability.get(card_a, 0)
        ab_b = self.card_ability.get(card_b, 0)
        edge = self._stance_edge(c_stance, a_stance)
        # a Stancebreaker voids the FOE'S edge, never its own
        if edge == 0 and ab_b == 7:
            edge = -1
        if edge == 1 and ab_a == 7:
            edge = -1
        weaker_a = 1 if self.card_power[card_a] < self.card_power[card_b] else 0
        weaker_b = 1 if self.card_power[card_b] < self.card_power[card_a] else 0
        rounds_a = 0
        r0 = 0
        r1 = 0
        r2 = 0
        for aspect in range(3):
            pa = self._attr_at(attrs_a, aspect)
            pb = self._attr_at(attrs_b, aspect)
            if edge == 0:
                pa = pa * 6 // 5
            elif edge == 1:
                pb = pb * 6 // 5
            split = 1 if aspect == 2 and r0 + r1 == 1 else 0
            pa = self._ability_boost(ab_a, aspect, r0, split, weaker_a, pa)
            pb = self._ability_boost(ab_b, aspect,
                                     1 - r0 if aspect > 0 else 0,
                                     split, weaker_b, pb)
            won = 1 if self.syscall.rng.randbelow(pa + pb) < pa else 0
            rounds_a += won
            if aspect == 0:
                r0 = won
            elif aspect == 1:
                r1 = won
            else:
                r2 = won
        return rounds_a * 1000 + r0 * 100 + r1 * 10 + r2

    def _after_fight(self, winner_card: TokenUid, loser_card: TokenUid,
                     wager: Amount) -> None:
        """Per-fight card rewards: the win mark, battle-hardening under the
        usual conditions, veterancy XP (Scholars double)."""
        self.card_wins[winner_card] = self.card_wins.get(winner_card, 0) + 1
        w_attrs = self.card_attrs[winner_card]
        w_tier = self.card_tier[winner_card]
        if (wager >= self._fusion_fee(w_tier)
                and self.card_power[loser_card] >= self.card_power[winner_card]
                and self._attr_hardened(w_attrs) < self._harden_cap(w_tier)):
            which = self.syscall.rng.randbelow(3)
            valor = self._attr_at(w_attrs, 0)
            bulwark = self._attr_at(w_attrs, 1)
            guile = self._attr_at(w_attrs, 2)
            if which == 0:
                valor += 1
            elif which == 1:
                bulwark += 1
            else:
                guile += 1
            self.card_attrs[winner_card] = self._attrs_pack(
                valor, bulwark, guile, self._attr_tempers(w_attrs),
                self._attr_hardened(w_attrs) + 1,
                self._attr_xp(w_attrs), self._attr_vet(w_attrs))
            self.card_power[winner_card] = self.card_power[winner_card] + 1
        xp_w = 8 if self.card_ability.get(winner_card, 0) == 9 else 4
        xp_l = 4 if self.card_ability.get(loser_card, 0) == 9 else 2
        self._grant_xp(winner_card, xp_w)
        self._grant_xp(loser_card, xp_l)

    def _resolve_duel(self, ctx: Context, duel_id: int,
                      c_stance: int, a_stance: int) -> int:
        challenger = self.duel_challenger[duel_id]
        acceptor = self.duel_acceptor[duel_id]
        wager = self.duel_wager[duel_id]
        their_card = self.duel_card[duel_id]
        my_card = self.duel_acceptor_card[duel_id]
        packed = self._fight_rounds(their_card, my_card, c_stance, a_stance)
        rounds_a = packed // 1000
        r0 = (packed // 100) % 10
        r1 = (packed // 10) % 10
        r2 = packed % 10
        winner = challenger if rounds_a >= 2 else acceptor
        winner_card = their_card if winner == challenger else my_card
        loser_card = my_card if winner == challenger else their_card
        power_before = self.card_power[winner_card]
        self._after_fight(winner_card, loser_card, wager)
        hardened_gain = self.card_power[winner_card] - power_before

        pot = 2 * wager
        rake = pot * self._rake_bps() // 10_000
        if self.card_ability.get(winner_card, 0) == 8:
            rake = 0                           # the Plunderer carries it all off
        self._credit_ember(winner, pot - rake)
        self._credit_ember(self.owner, rake)
        self.wins[winner] = self.wins.get(winner, 0) + 1
        if wager > 0:
            # unwagered sparring earns no renown and no trial credit
            self._earn_renown(challenger, 5, ctx.block.timestamp)
            self._earn_renown(acceptor, 5, ctx.block.timestamp)
            self.renown[winner] = self.renown.get(winner, 0) + 10
            self._trial_hit(winner, 2, ctx.block.timestamp)
        self._grant_deed(winner, 4)
        if self.wins[winner] >= 10:
            self._grant_deed(winner, 5)

        self.pending[their_card] = challenger
        self.pending[my_card] = acceptor
        self._settle_bets(duel_id, 0 if winner == challenger else 1)
        self.log.info('duel_settled', duel_id=duel_id,
                      winner_side=0 if winner == challenger else 1,
                      r0=r0, r1=r1, r2=r2, hardened=hardened_gain)
        self.syscall.emit_event(
            f'{{"event":"duel","id":{duel_id},"valor":{r0},"bulwark":{r1},'
            f'"guile":{r2},"hardened":{hardened_gain},'
            f'"stance_c":{c_stance},"stance_a":{a_stance}}}'.encode()
        )
        return 0 if winner == challenger else 1

    @public
    def cancel_duel(self, ctx: Context, duel_id: int) -> None:
        who = self._player(ctx)
        if not self.duel_open.get(duel_id, False):
            raise NCFail("duel is not open")
        if self.duel_challenger[duel_id] != who:
            raise NCFail("not your duel")
        self._credit_ember(who, self.duel_wager[duel_id])
        if self.duel_kind.get(duel_id, 0) == 1:
            i = 0
            while i < 3:
                self.pending[self.squad_card[duel_id * 4 + i]] = who
                i += 1
        else:
            self.pending[self.duel_card[duel_id]] = who
        self.duel_open[duel_id] = False
        self._settle_bets(duel_id, -1)

    # ------------------------------------------------------------------
    # Side-bets: spectators back a duelist with ember
    # ------------------------------------------------------------------

    @public
    def place_bet(self, ctx: Context, duel_id: int, side: int, amount: Amount) -> None:
        """Back side 0 (challenger) or 1 (acceptor) while the duel is
        open or awaiting a reveal. Duelists cannot bet on their own
        fight. Winners split the losing pool pro-rata, minus the rake;
        with no winners (or a cancelled duel) every bet is refunded."""
        who = self._player(ctx)
        if duel_id < 0 or duel_id >= self.next_duel_id:
            raise NCFail("no such duel")
        if side != 0 and side != 1:
            raise NCFail("side must be 0 (challenger) or 1 (acceptor)")
        if amount < 1:
            raise NCFail("bet at least 1 Ember")
        if not self.duel_open.get(duel_id, False) \
                and not self.duel_reveal_pending.get(duel_id, False):
            raise NCFail("the wagering is closed for this duel")
        if who == self.duel_challenger[duel_id] or who == self.duel_acceptor.get(duel_id):
            raise NCFail("duelists cannot bet on their own fight")
        count = self.bet_count.get(duel_id, 0)
        if count >= self._max_bets():
            raise NCFail("the ring around this duel is full")
        balance = self.ember_ledger.get(who, 0)
        if balance < amount:
            raise NCFail("not enough Ember in your ledger for this bet")
        self._debit_ember(who, amount)
        key = duel_id * 64 + count
        self.bet_addr[key] = who
        self.bet_side[key] = side
        self.bet_amt[key] = amount
        self.bet_count[duel_id] = count + 1
        pool_key = duel_id * 2 + side
        self.bet_pool[pool_key] = self.bet_pool.get(pool_key, 0) + amount
        self.syscall.emit_event(
            f'{{"event":"bet","id":{duel_id},"side":{side},"amount":{amount}}}'.encode()
        )

    def _settle_bets(self, duel_id: int, winning_side: int) -> None:
        """winning_side 0/1 pays winners from the losing pool (5% of it
        raked to the Crown); -1 refunds everyone (cancelled duel). With
        no bets on the winning side, all bets are refunded. Pro-rata
        rounding dust is burned."""
        count = self.bet_count.get(duel_id, 0)
        if count == 0:
            return
        win_pool = 0
        lose_pool = 0
        if winning_side >= 0:
            win_pool = self.bet_pool.get(duel_id * 2 + winning_side, 0)
            lose_pool = self.bet_pool.get(duel_id * 2 + (1 - winning_side), 0)
        refund = winning_side < 0 or win_pool == 0
        prize_pool = 0
        if not refund and lose_pool > 0:
            rake = lose_pool * self._rake_bps() // 10_000
            self._credit_ember(self.owner, rake)
            prize_pool = lose_pool - rake
        i = 0
        while i < count:
            key = duel_id * 64 + i
            bettor = self.bet_addr[key]
            amount = self.bet_amt[key]
            if refund:
                self._credit_ember(bettor, amount)
            elif self.bet_side[key] == winning_side:
                payout = amount + amount * prize_pool // win_pool
                self._credit_ember(bettor, payout)
            i += 1
        self.bet_count[duel_id] = 0
        self.bet_pool[duel_id * 2] = 0
        self.bet_pool[duel_id * 2 + 1] = 0

    @public(allow_withdrawal=True)
    def claim_favor(self, ctx: Context) -> None:
        who = self._player(ctx)
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("expected an HTR withdrawal")
        owed = self.favor_owed.get(who, 0)
        if action.amount > owed:
            raise NCFail(f"the Weaver owes you {owed}")
        self.favor_owed[who] = owed - action.amount

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @view
    def get_pull_price(self) -> Amount:
        return self.pull_price

    @view
    def get_card_unit(self) -> int:
        return self.card_unit

    @view
    def get_card_name(self, card: TokenUid) -> str:
        return self.card_name.get(card, "")

    @view
    def get_card_ability(self, card: TokenUid) -> int:
        return self.card_ability.get(card, 0)

    @view
    def get_card_tier(self, card: TokenUid) -> int:
        return self.card_tier.get(card, -1)

    @view
    def get_card_power(self, card: TokenUid) -> int:
        return self.card_power.get(card, 0)

    @view
    def get_pending_owner(self, card: TokenUid) -> Optional[Address]:
        return self.pending.get(card)

    @view
    def get_staker(self, card: TokenUid) -> Optional[Address]:
        return self.staked.get(card)

    @view
    def get_parked(self, card: TokenUid) -> bool:
        return self.parked.get(card, False)

    @view
    def get_delegate(self, session: Address) -> Optional[Address]:
        return self.delegate.get(session)

    @view
    def get_session_offer(self, session: Address) -> Optional[Address]:
        return self.session_offer.get(session)

    @view
    def get_session_fund(self, session: Address) -> Amount:
        return self.session_fund.get(session, 0)

    @view
    def get_is_main(self, address: Address) -> bool:
        return self.is_main.get(address, False)

    @view
    def get_pending_ember(self, card: TokenUid, now: int) -> Amount:
        since = self.stake_since.get(card)
        if since is None:
            return 0
        if card in self.delve_since:
            return 0
        tier = self.card_tier.get(card, 0)
        return (now - since) * self._rate_per_min(tier) // 60

    @view
    def get_ember_balance(self, address: Address) -> Amount:
        return self.ember_ledger.get(address, 0)

    @view
    def get_shards(self, address: Address) -> int:
        return self.shards_ledger.get(address, 0)

    @view
    def get_wins(self, address: Address) -> int:
        return self.wins.get(address, 0)

    @view
    def get_duel_count(self) -> int:
        return self.next_duel_id

    @view
    def get_duel(self, duel_id: int) -> str:
        if duel_id < 0 or duel_id >= self.next_duel_id:
            return ""
        if self.duel_open.get(duel_id, False):
            status = "open"
        elif self.duel_reveal_pending.get(duel_id, False):
            status = "reveal"
        else:
            status = "closed"
        card = self.duel_card[duel_id]
        return f"{status}|{card.hex()}|{self.duel_wager[duel_id]}"

    @view
    def get_tournament_count(self) -> int:
        return self.next_tourney_id

    @view
    def get_tournament(self, t: int) -> str:
        """"name|state|fee|seed|size|n|start|round|next_ts|pool|champion";
        empty when absent, champion empty until decided."""
        if t < 0 or t >= self.next_tourney_id:
            return ""
        champ = self.tour_champion.get(t)
        pool = self.tour_fee[t] * self.tour_n[t] + self.tour_seed[t]
        return (f"{self.tour_name[t]}|{self.tour_state[t]}|{self.tour_fee[t]}"
                f"|{self.tour_seed[t]}|{self.tour_size[t]}|{self.tour_n[t]}"
                f"|{self.tour_start[t]}|{self.tour_round.get(t, 0)}"
                f"|{self.tour_next_ts[t]}|{pool}"
                f"|{champ.hex() if champ is not None else ''}")

    @view
    def get_tour_entrant(self, t: int, i: int) -> str:
        """"addr_hex|card_hex|alive(0/1)", empty when absent."""
        if i < 0 or i >= self.tour_n.get(t, 0):
            return ""
        key = t * 64 + i
        return (f"{self.tour_entrant[key].hex()}|{self.tour_card[key].hex()}"
                f"|{1 if self.tour_alive.get(key, False) else 0}")

    @view
    def get_guild_count(self) -> int:
        return self.guild_count

    @view
    def get_guild(self, guild_id: int) -> str:
        """"name|members", empty when absent."""
        if guild_id < 0 or guild_id >= self.guild_count:
            return ""
        return f"{self.guild_name[guild_id]}|{self.guild_members.get(guild_id, 0)}"

    @view
    def get_member_guild(self, who: Address) -> int:
        return self.member_guild.get(who, -1)

    @view
    def get_wb_week(self) -> int:
        return self.wb_week

    @view
    def get_world_boss(self, week: int) -> str:
        """"name|hp|hp0|valor|bulwark|guile|pool|total|topguild", empty
        when that week has no boss."""
        if week not in self.wb_name:
            return ""
        return (f"{self.wb_name[week]}|{self.wb_hp.get(week, 0)}"
                f"|{self.wb_hp0.get(week, 0)}|{self.wb_valor.get(week, 0)}"
                f"|{self.wb_bulwark.get(week, 0)}|{self.wb_guile.get(week, 0)}"
                f"|{self.wb_pool.get(week, 0)}|{self.wb_total.get(week, 0)}"
                f"|{self.wb_top_guild.get(week, -1)}")

    @view
    def get_wb_damage(self, week: int, who: Address) -> int:
        return self.wb_damage.get(f"{week}|{who.hex()}", 0)

    @view
    def get_wb_claimed(self, week: int, who: Address) -> bool:
        return self.wb_claimed.get(f"{week}|{who.hex()}", False)

    @view
    def get_rating(self, who: Address) -> int:
        return self.rating.get(who, 1000)

    @view
    def get_ranked_waiting(self, tier: int) -> int:
        n = self.ranked_n.get(tier, 0)
        count = 0
        i = 0
        while i < n:
            if self.ranked_active.get(tier * 4096 + i, False):
                count += 1
            i += 1
        return count

    @view
    def is_ranked_queued(self, tier: int, who: Address) -> bool:
        n = self.ranked_n.get(tier, 0)
        i = 0
        while i < n:
            key = tier * 4096 + i
            if self.ranked_active.get(key, False) and self.ranked_addr[key] == who:
                return True
            i += 1
        return False

    @view
    def get_duel_kind(self, duel_id: int) -> int:
        return self.duel_kind.get(duel_id, 0)

    @view
    def get_squad_cards(self, duel_id: int, side: int) -> str:
        """The three card uids of a squad side (0 challenger, 1 acceptor),
        pipe-joined in deposit order; empty when absent."""
        store = self.squad_card if side == 0 else self.squad_acceptor_card
        out = ""
        i = 0
        while i < 3:
            if duel_id * 4 + i not in store:
                return out
            card = store[duel_id * 4 + i]
            if i > 0:
                out += "|"
            out += card.hex()
            i += 1
        return out

    @view
    def get_duel_challenger(self, duel_id: int) -> Optional[Address]:
        return self.duel_challenger.get(duel_id)

    @view
    def get_duel_has_stances(self, duel_id: int) -> bool:
        return duel_id in self.duel_commit

    @view
    def get_duel_acceptor(self, duel_id: int) -> Optional[Address]:
        return self.duel_acceptor.get(duel_id)

    @view
    def get_duel_acceptor_card(self, duel_id: int) -> str:
        card = self.duel_acceptor_card.get(duel_id)
        if card is None:
            return ""
        return card.hex()

    @view
    def get_duel_accept_ts(self, duel_id: int) -> int:
        return self.duel_accept_ts.get(duel_id, 0)

    @view
    def get_reveal_window(self) -> int:
        return self._reveal_window()

    @view
    def get_bet_pool(self, duel_id: int, side: int) -> Amount:
        if side != 0 and side != 1:
            return 0
        return self.bet_pool.get(duel_id * 2 + side, 0)

    @view
    def get_bet_count(self, duel_id: int) -> int:
        return self.bet_count.get(duel_id, 0)

    @view
    def get_bet(self, duel_id: int, address: Address) -> str:
        """The address's live stakes on a duel, 'side0|side1' in Ember."""
        s0 = 0
        s1 = 0
        n = self.bet_count.get(duel_id, 0)
        i = 0
        while i < n:
            key = duel_id * 64 + i
            if self.bet_addr[key] == address:
                if self.bet_side[key] == 0:
                    s0 += self.bet_amt[key]
                else:
                    s1 += self.bet_amt[key]
            i += 1
        return f"{s0}|{s1}"

    @view
    def get_template_count(self, tier: int) -> int:
        if tier < 0 or tier > 3:
            return 0
        return len(self._templates(tier))

    @view
    def get_total_pulls(self) -> int:
        return self.total_pulls

    @view
    def get_player_pulls(self, address: Address) -> int:
        return self.pulls_by.get(address, 0)

    @view
    def get_proceeds(self) -> Amount:
        return self.proceeds

    @view
    def get_renown(self, address: Address) -> int:
        return self.renown.get(address, 0)

    @view
    def get_vigil_streak(self, address: Address) -> int:
        return self.vigil_streak.get(address, 0)

    @view
    def get_vigil_day(self, address: Address) -> int:
        return self.vigil_day.get(address, 0)

    @view
    def get_deed_flags(self, address: Address) -> int:
        return self.deed_flags.get(address, 0)

    @view
    def get_favor_pool(self) -> Amount:
        return self.favor_pool

    @view
    def get_favor_owed(self, address: Address) -> Amount:
        return self.favor_owed.get(address, 0)

    @view
    def get_card_aspects(self, card: TokenUid) -> str:
        attrs = self.card_attrs.get(card)
        if attrs is None:
            return ""
        return (f"{self._attr_at(attrs, 0)}|{self._attr_at(attrs, 1)}"
                f"|{self._attr_at(attrs, 2)}|{self._attr_tempers(attrs)}"
                f"|{self._attr_hardened(attrs)}|{self._attr_xp(attrs)}"
                f"|{self._xp_level(self._attr_xp(attrs))}|{self._attr_vet(attrs)}")

    @view
    def get_card_wins(self, card: TokenUid) -> int:
        return self.card_wins.get(card, 0)

    @view
    def get_card_cosmetics(self, card: TokenUid) -> int:
        return self.card_cosmetics.get(card, 0)

    @view
    def get_temper_cost(self, card: TokenUid) -> Amount:
        attrs = self.card_attrs.get(card)
        tier = self.card_tier.get(card)
        if attrs is None or tier is None:
            return 0
        tempers = self._attr_tempers(attrs)
        if tempers >= self._temper_cap(tier):
            return 0
        return self._temper_cost(tier, tempers)

    @view
    def get_writ_count(self) -> int:
        return len(self.writ_name)

    @view
    def get_writ(self, writ: int) -> str:
        if writ < 0 or writ >= len(self.writ_name):
            return ""
        return (f"{self.writ_name[writ]}|{self.writ_valor[writ]}"
                f"|{self.writ_bulwark[writ]}|{self.writ_guile[writ]}")

    @view
    def get_gauntlet_cleared(self, address: Address) -> int:
        return self.gauntlet_cleared.get(address, 0)

    @view
    def get_writ_attempts(self, card: TokenUid, now: int) -> int:
        packed = self.writ_attempts.get(card, 0)
        if packed // 10 != now // 86400:
            return 0
        return packed % 10

    @view
    def get_delve_since(self, card: TokenUid) -> int:
        return self.delve_since.get(card, 0)

    @view
    def get_delve_seconds(self) -> int:
        return self.delve_seconds

    @view
    def get_trial_today(self, now: int) -> int:
        return self._trial_today(now)

    @view
    def get_trial_done(self, address: Address, now: int) -> bool:
        return self.trial_done.get(address, 0) == now // 86400

    @view
    def get_mine_rate(self, tier: int) -> int:
        if tier < 0 or tier > 3:
            return 0
        return self.mine_rates[tier]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_owner(self, ctx: Context) -> None:
        if ctx.caller_id != self.owner:
            raise NCFail("owner only")

    def _check_tier(self, tier: int) -> None:
        if tier < 0 or tier > 3:
            raise NCFail("tier must be 0-3")

    def _check_not_delving(self, card: TokenUid) -> None:
        if card in self.delve_since:
            raise NCFail("this champion is away on a delve")

    def _templates(self, tier: int) -> list[str]:
        if tier == 0:
            return self.templates_0
        if tier == 1:
            return self.templates_1
        if tier == 2:
            return self.templates_2
        return self.templates_3

    def _single_card_deposit(self, ctx: Context) -> NCDepositAction:
        if len(ctx.actions_list) != 1:
            raise NCFail("expected exactly one action")
        action = ctx.actions_list[0]
        if not isinstance(action, NCDepositAction) or action.amount != self.card_unit:
            raise NCFail("expected a deposit of one full card")
        if action.token_uid not in self.card_tier:
            raise NCFail("unknown card")
        if self.parked.get(action.token_uid, False):
            raise NCFail("that champion rests in the vault")
        return action

    def _single_card_withdrawal(self, ctx: Context) -> NCWithdrawalAction:
        if len(ctx.actions_list) != 1:
            raise NCFail("expected exactly one action")
        action = ctx.actions_list[0]
        if not isinstance(action, NCWithdrawalAction) or action.amount != self.card_unit:
            raise NCFail("expected a withdrawal of one full card")
        if action.token_uid not in self.card_tier:
            raise NCFail("unknown card")
        if self.parked.get(action.token_uid, False):
            raise NCFail("that champion rests in the vault")
        return action

    def _roll_tier(self) -> int:
        total = (self.weights[0] + self.weights[1]
                 + self.weights[2] + self.weights[3])
        roll = self.syscall.rng.randbelow(total)
        acc = 0
        for i in range(4):
            acc += self.weights[i]
            if roll < acc:
                return i
        return 3

    def _fallback_tier(self, tier: int) -> int:
        if len(self._templates(tier)) > 0:
            return tier
        step = tier - 1
        while step >= 0:
            if len(self._templates(step)) > 0:
                return step
            step -= 1
        step = tier + 1
        while step <= 3:
            if len(self._templates(step)) > 0:
                return step
            step += 1
        raise NCFail("no card templates configured")

    def _mint_card(self, tier: int, power_bonus: int) -> TokenUid:
        pool = self._templates(tier)
        entry = pool[self.syscall.rng.randbelow(len(pool))]
        sep = entry.rfind('|')
        name = entry[:sep] if sep >= 0 else entry
        ability = "0123456789".find(entry[sep + 1:]) if sep >= 0 else 0
        if ability < 0:
            ability = 0
        base = self._power_base(tier)
        power = base + self.syscall.rng.randbelow(base) + power_bonus
        serial = self.total_minted
        self.total_minted = serial + 1
        card = self.syscall.create_deposit_token(
            token_name=name,
            token_symbol=f"G{serial}",
            amount=self.card_unit,
            mint_authority=False,
            melt_authority=False,
        )
        self.card_name[card] = name
        self.card_ability[card] = ability
        self.card_tier[card] = tier
        self.card_power[card] = power
        self.card_attrs[card] = self._split_power(power)
        return card

    def _accrue(self, card: TokenUid, now: int) -> Amount:
        since = self.stake_since[card]
        tier = self.card_tier[card]
        ember = (now - since) * self._rate_per_min(tier) // 60
        if ember > 0:
            staker = self.staked[card]
            self._credit_ember(staker, ember)
            self.stake_since[card] = now
        return ember
