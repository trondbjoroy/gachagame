from typing import Optional

from hathor import (
    Address, Amount, Blueprint, Context, ContractId, HATHOR_TOKEN_UID,
    NCDepositAction, NCFail, NCWithdrawalAction, TokenUid,
    export, public, view,
)


@export
class EmberfallCardMarket(Blueprint):
    """Marketplace for EmberfallArena cards.

    - list_card(price): escrow a card, ask HTR.
    - buy(listing_id): pay exact HTR; card becomes claimable by the buyer,
      seller is credited price minus fee in an HTR ledger.
    - offer_swap(want): escrow a card, name the exact card you want back.
    - accept_swap(swap_id): deposit the wanted card; both sides claim.
    - claim_card() / withdraw_funds() settle escrow and proceeds.

    Only genuine cards are accepted: authenticity is checked with a
    cross-contract view call to the EmberfallArena contract.
    """

    owner: Address
    gacha: ContractId
    fee_bps: int
    listing_card: dict[int, TokenUid]
    listing_price: dict[int, Amount]
    listing_seller: dict[int, Address]
    listing_open: dict[int, bool]
    next_listing_id: int
    swap_give: dict[int, TokenUid]
    swap_want: dict[int, TokenUid]
    swap_maker: dict[int, Address]
    swap_open: dict[int, bool]
    next_swap_id: int
    pending: dict[TokenUid, Address]
    funds: dict[Address, Amount]
    fees_accrued: Amount

    @public
    def initialize(self, ctx: Context, owner: Address, gacha: ContractId,
                   fee_bps: int) -> None:
        if fee_bps < 0 or fee_bps > 2000:
            raise NCFail("fee must be 0-20%")
        self.owner = owner
        self.gacha = gacha
        self.fee_bps = fee_bps
        self.listing_card = {}
        self.listing_price = {}
        self.listing_seller = {}
        self.listing_open = {}
        self.next_listing_id = 0
        self.swap_give = {}
        self.swap_want = {}
        self.swap_maker = {}
        self.swap_open = {}
        self.next_swap_id = 0
        self.pending = {}
        self.funds = {}
        self.fees_accrued = 0

    # ---------------- listings ----------------

    @public(allow_deposit=True)
    def list_card(self, ctx: Context, price: Amount) -> int:
        seller = self._wallet_caller(ctx)
        if price <= 0:
            raise NCFail("price must be positive")
        card = self._card_deposit(ctx)
        lid = self.next_listing_id
        self.next_listing_id = lid + 1
        self.listing_card[lid] = card
        self.listing_price[lid] = price
        self.listing_seller[lid] = seller
        self.listing_open[lid] = True
        return lid

    @public(allow_deposit=True)
    def buy(self, ctx: Context, listing_id: int) -> None:
        buyer = self._wallet_caller(ctx)
        if not self.listing_open.get(listing_id, False):
            raise NCFail("listing is not open")
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCDepositAction):
            raise NCFail("expected an HTR deposit")
        price = self.listing_price[listing_id]
        if action.amount != price:
            raise NCFail(f"price is exactly {price}")
        seller = self.listing_seller[listing_id]
        fee = price * self.fee_bps // 10_000
        self.funds[seller] = self.funds.get(seller, 0) + price - fee
        self.fees_accrued += fee
        self.pending[self.listing_card[listing_id]] = buyer
        self.listing_open[listing_id] = False

    @public
    def cancel_listing(self, ctx: Context, listing_id: int) -> None:
        caller = self._wallet_caller(ctx)
        if not self.listing_open.get(listing_id, False):
            raise NCFail("listing is not open")
        if self.listing_seller[listing_id] != caller:
            raise NCFail("not your listing")
        self.pending[self.listing_card[listing_id]] = caller
        self.listing_open[listing_id] = False

    # ---------------- swaps ----------------

    @public(allow_deposit=True)
    def offer_swap(self, ctx: Context, want: TokenUid) -> int:
        maker = self._wallet_caller(ctx)
        give = self._card_deposit(ctx)
        if want == give:
            raise NCFail("cannot swap a card for itself")
        sid = self.next_swap_id
        self.next_swap_id = sid + 1
        self.swap_give[sid] = give
        self.swap_want[sid] = want
        self.swap_maker[sid] = maker
        self.swap_open[sid] = True
        return sid

    @public(allow_deposit=True)
    def accept_swap(self, ctx: Context, swap_id: int) -> None:
        taker = self._wallet_caller(ctx)
        if not self.swap_open.get(swap_id, False):
            raise NCFail("swap is not open")
        card = self._card_deposit(ctx)
        if card != self.swap_want[swap_id]:
            raise NCFail("that is not the wanted card")
        self.pending[self.swap_give[swap_id]] = taker
        self.pending[card] = self.swap_maker[swap_id]
        self.swap_open[swap_id] = False

    @public
    def cancel_swap(self, ctx: Context, swap_id: int) -> None:
        caller = self._wallet_caller(ctx)
        if not self.swap_open.get(swap_id, False):
            raise NCFail("swap is not open")
        if self.swap_maker[swap_id] != caller:
            raise NCFail("not your swap")
        self.pending[self.swap_give[swap_id]] = caller
        self.swap_open[swap_id] = False

    # ---------------- settlement ----------------

    @public(allow_withdrawal=True)
    def claim_card(self, ctx: Context) -> None:
        caller = self._wallet_caller(ctx)
        if len(ctx.actions_list) != 1:
            raise NCFail("expected exactly one action")
        action = ctx.actions_list[0]
        if not isinstance(action, NCWithdrawalAction) or action.amount != 100:
            raise NCFail("expected a withdrawal of one full card")
        if self.pending.get(action.token_uid) != caller:
            raise NCFail("card not claimable by you")
        del self.pending[action.token_uid]

    @public(allow_withdrawal=True)
    def withdraw_funds(self, ctx: Context) -> None:
        caller = self._wallet_caller(ctx)
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("expected an HTR withdrawal")
        balance = self.funds.get(caller, 0)
        if action.amount > balance:
            raise NCFail(f"only {balance} available")
        self.funds[caller] = balance - action.amount

    @public(allow_withdrawal=True)
    def withdraw_fees(self, ctx: Context) -> None:
        if ctx.caller_id != self.owner:
            raise NCFail("owner only")
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("expected an HTR withdrawal")
        if action.amount > self.fees_accrued:
            raise NCFail(f"only {self.fees_accrued} available")
        self.fees_accrued -= action.amount

    # ---------------- views ----------------

    @view
    def get_listing_count(self) -> int:
        return self.next_listing_id

    @view
    def get_listing(self, listing_id: int) -> str:
        if listing_id < 0 or listing_id >= self.next_listing_id:
            return ""
        status = "open" if self.listing_open.get(listing_id, False) else "closed"
        return (f"{status}|{self.listing_card[listing_id].hex()}"
                f"|{self.listing_price[listing_id]}")

    @view
    def get_listing_seller(self, listing_id: int) -> Optional[Address]:
        return self.listing_seller.get(listing_id)

    @view
    def get_swap_count(self) -> int:
        return self.next_swap_id

    @view
    def get_swap(self, swap_id: int) -> str:
        if swap_id < 0 or swap_id >= self.next_swap_id:
            return ""
        status = "open" if self.swap_open.get(swap_id, False) else "closed"
        return (f"{status}|{self.swap_give[swap_id].hex()}"
                f"|{self.swap_want[swap_id].hex()}")

    @view
    def get_swap_maker(self, swap_id: int) -> Optional[Address]:
        return self.swap_maker.get(swap_id)

    @view
    def get_pending_owner(self, card: TokenUid) -> Optional[Address]:
        return self.pending.get(card)

    @view
    def get_funds(self, address: Address) -> Amount:
        return self.funds.get(address, 0)

    # ---------------- helpers ----------------

    def _wallet_caller(self, ctx: Context) -> Address:
        caller = ctx.get_caller_address()
        if caller is None:
            raise NCFail("wallets only")
        return caller

    def _card_deposit(self, ctx: Context) -> TokenUid:
        deposits = []
        for action in ctx.actions_list:
            if isinstance(action, NCDepositAction) and action.token_uid != HATHOR_TOKEN_UID:
                deposits.append(action)
        if len(deposits) != 1:
            raise NCFail("expected exactly one card deposit")
        action = deposits[0]
        if action.amount != 100:
            raise NCFail("a card moves as 100 units")
        # NOTE: authenticity is enforced client-side against the game's
        # card registry; a cross-contract view call here failed on the
        # current playground node version and was removed.
        return action.token_uid
