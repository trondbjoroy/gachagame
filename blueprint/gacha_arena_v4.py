from typing import Optional

from hathor import (
    Address, Amount, Blueprint, Context, HATHOR_TOKEN_UID,
    NCDepositAction, NCFail, NCWithdrawalAction, TokenUid,
    export, public, sha3, view,
)


@export
class EmberfallArena(Blueprint):
    """Onchain gacha game: pull cards, farm GEMS, fuse, duel, campaign
    against the Gauntlet, delve, grow veterans, and dress cards.

    Core (v2.2/v3, unchanged):
    - pull(): pay HTR, a fresh 1-of-1 card token is minted from the
      template catalog of an RNG-rolled rarity tier (0..3) with an
      RNG-rolled power split into three aspects (valor/bulwark/guile).
    - stake()/unstake()/claim_gems(): staked cards accrue GEMS
      (a contract-created reward token) per minute by tier.
    - temper(): pay gems to raise one aspect of a staked card (half
      burned, half Crown), capped per station.
    - the Gauntlet (add_writ/fight_writ), delves, veterancy, cosmetics,
      the daily trial, renown w/ vigil multiplier, deed bounties, the
      Weaver's favor pool. All rewards funded from proceeds, never
      printed.

    v4 — session delegation:
    - offer_session()/accept_session()/revoke_session(): a main wallet
      offers a session address delegation, escrowing the session's HTR
      float in the same tx (one prompt); the session key accepts in its
      first promptless tx and withdraws the escrow. From then on every
      game method resolves the session caller to the main address, so
      gems, cards, renown, deeds, streaks and custody all accrue to one
      identity across session and non-session play. Registration
      requires both keys to sign (one tx each), so nobody can bind an
      address they do not control. revoke_session() reclaims an
      unaccepted offer's escrow and cuts a session loose.

    v4 — fusion parks, never melts:
    - fuse() keeps both parent cards in contract custody forever
      (parked) instead of melting them. Works for any card the contract
      did not mint (adopted realms) and matches the 1-unit NFT spec.

    v4 — card_unit:
    - initialize takes card_unit (1 or 100): the number of base units a
      card token is minted with and moved by. Mainnet uses 1 per the
      Hathor NFT spec; realms adopting 100-unit cards keep 100.
      adopt_card must only register cards whose unit matches.

    v4 — duel stances (commit-reveal):
    - create_duel() takes a 32-byte commitment: sha3-256 of
      "{stance}:{salt}" (empty bytes = classic instant duel, no
      stances). The acceptor states their stance openly in
      accept_duel(); the challenger then calls reveal_duel(stance,
      salt) to settle. Stances are rock-paper-scissors (0 beats 1,
      1 beats 2, 2 beats 0); the stance winner's aspects are boosted
      20% in every round. If the challenger does not reveal within the
      reveal window, anyone may call claim_forfeit() and the acceptor
      takes the pot.

    v4 — spectator side-bets:
    - place_bet(): while a duel is open (or awaiting reveal) any
      non-participant may back a side with gems, up to 50 bets per
      duel. Winners split the losing pool pro-rata (5% of it raked to
      the Crown); if a duel is cancelled or nobody backed the winning
      side, every bet is refunded. Bets never earn renown.

    v4 — honest trials:
    - unwagered duels (wager 0) settle cards and experience as before
      but grant no renown and no daily-trial credit.
    """

    owner: Address
    pull_price: Amount
    weights: list[int]
    gems_uid: TokenUid
    card_unit: int
    templates_0: list[str]
    templates_1: list[str]
    templates_2: list[str]
    templates_3: list[str]
    card_name: dict[TokenUid, str]
    card_tier: dict[TokenUid, int]
    card_power: dict[TokenUid, int]
    pending: dict[TokenUid, Address]
    staked: dict[TokenUid, Address]
    stake_since: dict[TokenUid, int]
    gems_ledger: dict[Address, Amount]
    gem_liability: Amount                    # sum of all ledger balances; the HTR
                                             # reserve needed to back every gem that
                                             # could still be withdrawn (see helpers)
    duel_card: dict[int, TokenUid]
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
    mine_rates: list[int]                    # gems-cents/min by tier
    fusion_fees: list[int]                   # gems-cents by tier fused
    temper_bases: list[int]                  # first-rite gems-cents by tier
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
        if not isinstance(action, NCDepositAction) or action.amount < 2:
            raise NCFail("deposit at least 0.02 HTR to create the GEMS token")
        self.owner = owner
        self.pull_price = pull_price
        self.weights = [weight_common, weight_rare, weight_epic, weight_legendary]
        self.card_unit = card_unit
        self.templates_0 = []
        self.templates_1 = []
        self.templates_2 = []
        self.templates_3 = []
        self.card_name = {}
        self.card_tier = {}
        self.card_power = {}
        self.pending = {}
        self.staked = {}
        self.stake_since = {}
        self.gems_ledger = {}
        self.gem_liability = 0
        self.duel_card = {}
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
        # deposited HTR beyond the GEMS-creation collateral seeds the reserve
        self.proceeds = action.amount - 1
        self.gems_uid = self.syscall.create_deposit_token(
            token_name="Emberfall Gems",
            token_symbol="GEMS",
            amount=100,
            mint_authority=True,
            melt_authority=False,
        )

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

    # deed bits and their one-time GEMS-cent bounties
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

    # every gems-ledger write goes through these two so gem_liability stays
    # exactly the sum of all ledger balances. Ledger-to-ledger transfers (duel
    # pots, rakes) net to zero; only creation (mining, rewards) and destruction
    # (burns, withdrawals) move the total. That total is the HTR the reserve
    # must protect from owner withdrawal (see withdraw_proceeds).
    def _credit_gems(self, who: Address, amount: int) -> None:
        self.gems_ledger[who] = self.gems_ledger.get(who, 0) + amount
        self.gem_liability += amount

    def _debit_gems(self, who: Address, amount: int) -> None:
        self.gems_ledger[who] = self.gems_ledger.get(who, 0) - amount
        self.gem_liability -= amount

    def _grant_deed(self, who: Address, bit: int) -> None:
        mask = self.deed_flags.get(who, 0)
        flag = 1 << bit
        if mask & flag:
            return
        self.deed_flags[who] = mask | flag
        bounty = self._deed_bounty(bit)
        if bounty > 0:
            self._credit_gems(who, bounty)

    # the daily trial: one act per UTC day is the Crown's ask; the first
    # matching act per player pays bonus renown and a small gems bounty.
    # kinds: 0 pull, 1 stake, 2 duel win, 3 fuse, 4 temper, 5 claim gems,
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
        self._credit_gems(who, 5)

    # ------------------------------------------------------------------
    # Operator
    # ------------------------------------------------------------------

    @public
    def add_template(self, ctx: Context, tier: int, name: str) -> None:
        self._check_owner(ctx)
        self._check_tier(tier)
        if len(name) < 1 or len(name) > 30:
            raise NCFail("name must be 1-30 chars")
        self._templates(tier).append(name)

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
        # the owner draws only genuine revenue: HTR backing outstanding gems is
        # ring-fenced (100 gems-cents : 1 HTR-cent), so a withdrawal can never
        # strand players holding unredeemed gems
        reserve = (self.gem_liability + 99) // 100
        available = self.proceeds - reserve
        if available < 0:
            available = 0
        if action.amount > available:
            raise NCFail(f"only {available} withdrawable; {reserve} reserved to back gems")
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
                   power: int, attrs: int, card_wins: int) -> None:
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
        self.card_name[uid] = name
        self.card_tier[uid] = tier
        self.card_power[uid] = power
        self.card_attrs[uid] = attrs
        if card_wins > 0:
            self.card_wins[uid] = card_wins

    @public
    def adopt_player(self, ctx: Context, who: Address, gems: Amount,
                     renown_pts: int, deeds: int, wins_n: int, pulls: int) -> None:
        self._check_owner(ctx)
        if gems < 0 or renown_pts < 0 or deeds < 0 or wins_n < 0 or pulls < 0:
            raise NCFail("bad player data")
        if gems > 0:
            self._credit_gems(who, gems)
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
    # Staking / GEMS farming
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
    def claim_gems(self, ctx: Context, card: TokenUid) -> Amount:
        who = self._player(ctx)
        if self.staked.get(card) != who:
            raise NCFail("not your staked card")
        self._check_not_delving(card)
        gems = self._accrue(card, ctx.block.timestamp)
        self._trial_hit(who, 5, ctx.block.timestamp)
        return gems

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
        gems fee that grows each tempering. Half burned, half to the
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
        balance = self.gems_ledger.get(who, 0)
        if balance < cost:
            raise NCFail(f"tempering costs {cost} GEMS-cents")
        self._debit_gems(who, cost)
        self._credit_gems(self.owner, cost // 2)
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

    @public(allow_withdrawal=True)
    def withdraw_gems(self, ctx: Context) -> None:
        who = self._player(ctx)
        action = ctx.get_single_action(self.gems_uid)
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("expected a GEMS withdrawal")
        balance = self.gems_ledger.get(who, 0)
        if action.amount > balance:
            raise NCFail(f"only {balance} GEMS-cents in your ledger")
        held = self.syscall.get_balance_before_current_call(token_uid=self.gems_uid)
        if action.amount > held:
            shortfall = action.amount - held
            collateral = (shortfall + 99) // 100
            if collateral > self.proceeds:
                raise NCFail("reward pool needs more pulls to back this withdrawal")
            self.proceeds -= collateral
            self.syscall.mint_tokens(token_uid=self.gems_uid, amount=shortfall)
        self._debit_gems(who, action.amount)

    @public(allow_deposit=True)
    def deposit_gems(self, ctx: Context) -> None:
        who = self._player(ctx)
        action = ctx.get_single_action(self.gems_uid)
        if not isinstance(action, NCDepositAction):
            raise NCFail("expected a GEMS deposit")
        self._credit_gems(who, action.amount)

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
        # bank the mining so far; the delve itself earns no gems
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
        gems = 0
        shards = 0
        if roll < 1:
            outcome = 4
            gems = base * 10
            shards = 25
        elif roll < 50:
            outcome = 3
            gems = base * 5
        elif roll < 200:
            outcome = 2
            shards = tier + 1
        elif roll < 450:
            outcome = 0
        else:
            outcome = 1
            gems = base * 3 // 2
        if gems > 0:
            self._credit_gems(who, gems)
        if shards > 0:
            self.shards_ledger[who] = self.shards_ledger.get(who, 0) + shards
        self.syscall.emit_event(
            f'{{"event":"delve_done","outcome":{outcome},"gems":{gems},'
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
        balance = self.gems_ledger.get(who, 0)
        if balance < entry:
            raise NCFail(f"the writ demands an entry of {entry} GEMS-cents")
        self._debit_gems(who, entry)
        # half to the Crown; the other half simply ceases to exist
        self._credit_gems(self.owner, entry // 2)

        mult = [1, 2, 4][tier]
        boss = [self.writ_valor[writ] * mult,
                self.writ_bulwark[writ] * mult,
                self.writ_guile[writ] * mult]
        attrs = self.card_attrs[card]
        rounds = 0
        r0 = 0
        r1 = 0
        r2 = 0
        for aspect in range(3):
            pc = self._attr_at(attrs, aspect)
            pb = boss[aspect]
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
            self._credit_gems(who, reward)
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
    # Cosmetics: bought identity that travels with the card, never power
    # ------------------------------------------------------------------

    @public
    def buy_cosmetic(self, ctx: Context, card: TokenUid, slot: int, value: int) -> None:
        """Slots: 0 frame (gems), 1 tint (gems), 2 epithet (shards).
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
                have = self.gems_ledger.get(who, 0)
                if have < price:
                    raise NCFail(f"this adornment costs {price} GEMS-cents")
                self._debit_gems(who, price)
                # cosmetics gems are a pure sink: half Crown, half gone
                self._credit_gems(self.owner, price // 2)
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
        balance = self.gems_ledger.get(who, 0)
        if balance < fee:
            raise NCFail(f"fusion costs {fee} GEMS-cents (earn them by staking)")
        self._debit_gems(who, fee)
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
        balance = self.gems_ledger.get(who, 0)
        if balance < wager:
            raise NCFail("not enough GEMS in your ledger for this wager")
        self._debit_gems(who, wager)
        duel_id = self.next_duel_id
        self.next_duel_id = duel_id + 1
        self.duel_card[duel_id] = action.token_uid
        self.duel_wager[duel_id] = wager
        self.duel_challenger[duel_id] = who
        self.duel_open[duel_id] = True
        if len(commitment) == 32:
            self.duel_commit[duel_id] = commitment
        return duel_id

    @public(allow_deposit=True)
    def accept_duel(self, ctx: Context, duel_id: int, stance: int) -> int:
        """Answer a challenge. Classic duels (no commitment) demand
        stance -1 and settle at once; stance duels demand 0..2 and wait
        for the challenger's reveal. Returns 0 if the challenger won,
        1 if the acceptor won, 2 if the duel awaits a reveal."""
        who = self._player(ctx)
        if not self.duel_open.get(duel_id, False):
            raise NCFail("duel is not open")
        challenger = self.duel_challenger[duel_id]
        if challenger == who:
            raise NCFail("cannot duel yourself")
        action = self._single_card_deposit(ctx)
        wager = self.duel_wager[duel_id]
        balance = self.gems_ledger.get(who, 0)
        if balance < wager:
            raise NCFail("not enough GEMS in your ledger for this wager")
        self._debit_gems(who, wager)
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
        self._credit_gems(acceptor, pot - rake)
        self._credit_gems(self.owner, rake)
        self.wins[acceptor] = self.wins.get(acceptor, 0) + 1
        if wager > 0:
            self.renown[acceptor] = self.renown.get(acceptor, 0) + 10
        self.pending[self.duel_card[duel_id]] = challenger
        self.pending[self.duel_acceptor_card[duel_id]] = acceptor
        self._settle_bets(duel_id, 1)
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

    def _resolve_duel(self, ctx: Context, duel_id: int,
                      c_stance: int, a_stance: int) -> int:
        challenger = self.duel_challenger[duel_id]
        acceptor = self.duel_acceptor[duel_id]
        wager = self.duel_wager[duel_id]
        their_card = self.duel_card[duel_id]
        my_card = self.duel_acceptor_card[duel_id]
        attrs_a = self.card_attrs[their_card]
        attrs_b = self.card_attrs[my_card]
        edge = self._stance_edge(c_stance, a_stance)
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
            won = 1 if self.syscall.rng.randbelow(pa + pb) < pa else 0
            rounds_a += won
            if aspect == 0:
                r0 = won
            elif aspect == 1:
                r1 = won
            else:
                r2 = won
        winner = challenger if rounds_a >= 2 else acceptor
        winner_card = their_card if winner == challenger else my_card
        loser_card = my_card if winner == challenger else their_card
        self.card_wins[winner_card] = self.card_wins.get(winner_card, 0) + 1
        hardened_gain = 0
        w_attrs = self.card_attrs[winner_card]
        w_tier = self.card_tier[winner_card]
        if (wager >= self._fusion_fee(w_tier)
                and self.card_power[loser_card] >= self.card_power[winner_card]
                and self._attr_hardened(w_attrs) < self._harden_cap(w_tier)):
            hardened_gain = 1
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

        # veterancy: mileage for both fighters (after hardening so the
        # level-up reads the freshest aspects)
        self._grant_xp(winner_card, 4)
        self._grant_xp(loser_card, 2)

        pot = 2 * wager
        rake = pot * self._rake_bps() // 10_000
        self._credit_gems(winner, pot - rake)
        self._credit_gems(self.owner, rake)
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
        self._credit_gems(who, self.duel_wager[duel_id])
        self.pending[self.duel_card[duel_id]] = who
        self.duel_open[duel_id] = False
        self._settle_bets(duel_id, -1)

    # ------------------------------------------------------------------
    # Side-bets: spectators back a duelist with gems
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
            raise NCFail("bet at least 1 GEMS-cent")
        if not self.duel_open.get(duel_id, False) \
                and not self.duel_reveal_pending.get(duel_id, False):
            raise NCFail("the wagering is closed for this duel")
        if who == self.duel_challenger[duel_id] or who == self.duel_acceptor.get(duel_id):
            raise NCFail("duelists cannot bet on their own fight")
        count = self.bet_count.get(duel_id, 0)
        if count >= self._max_bets():
            raise NCFail("the ring around this duel is full")
        balance = self.gems_ledger.get(who, 0)
        if balance < amount:
            raise NCFail("not enough GEMS in your ledger for this bet")
        self._debit_gems(who, amount)
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
            self._credit_gems(self.owner, rake)
            prize_pool = lose_pool - rake
        i = 0
        while i < count:
            key = duel_id * 64 + i
            bettor = self.bet_addr[key]
            amount = self.bet_amt[key]
            if refund:
                self._credit_gems(bettor, amount)
            elif self.bet_side[key] == winning_side:
                payout = amount + amount * prize_pool // win_pool
                self._credit_gems(bettor, payout)
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
    def get_gems_uid(self) -> TokenUid:
        return self.gems_uid

    @view
    def get_card_unit(self) -> int:
        return self.card_unit

    @view
    def get_card_name(self, card: TokenUid) -> str:
        return self.card_name.get(card, "")

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
    def get_pending_gems(self, card: TokenUid, now: int) -> Amount:
        since = self.stake_since.get(card)
        if since is None:
            return 0
        if card in self.delve_since:
            return 0
        tier = self.card_tier.get(card, 0)
        return (now - since) * self._rate_per_min(tier) // 60

    @view
    def get_gems_balance(self, address: Address) -> Amount:
        return self.gems_ledger.get(address, 0)

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
    def get_gem_liability(self) -> Amount:
        return self.gem_liability

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
        name = pool[self.syscall.rng.randbelow(len(pool))]
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
        self.card_tier[card] = tier
        self.card_power[card] = power
        self.card_attrs[card] = self._split_power(power)
        return card

    def _accrue(self, card: TokenUid, now: int) -> Amount:
        since = self.stake_since[card]
        tier = self.card_tier[card]
        gems = (now - since) * self._rate_per_min(tier) // 60
        if gems > 0:
            staker = self.staked[card]
            self._credit_gems(staker, gems)
            self.stake_since[card] = now
        return gems
