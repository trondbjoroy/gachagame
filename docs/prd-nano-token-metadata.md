# PRD: Media metadata for contract-minted tokens

## Summary

Allow a nano contract to attach an immutable media URI when it creates a token, so
contract-minted tokens can carry media exactly like manually created NFTs. Concretely:
an optional `data: bytes` parameter on the `create_deposit_token` syscall (mirroring
the NFT standard's data output, e.g. `ipfs://<cid>/plague-rat.jpg`), stored by the
node and exposed through the token-detail APIs, and rendered by the official wallets
the same way manually minted NFT media is.

## Motivation

Emberfall (https://emberfall.fun, testnet-india) mints every game card as a unique
1-of-1 token from inside the `EmberfallArena` contract
(`00599b4b1e879ee1437b828926b7d5a11ac5c5ca094e25e77094420c8b3c9258`, blueprint
`0078b201b50e228833ad6e526c6e0d5c89456502623b4f18807b3991ac3ce0bf`). These tokens are
real player-owned assets — summoned, traded, and swept between wallets — but in the
Hathor wallet they appear only as a bare symbol ("G3"), because `create_deposit_token`
accepts no media and the NFT standard's data output only exists on wallet-built token
creation transactions. Games and other dApps that mint assets programmatically —
likely a major use of nano contracts — currently cannot produce wallet-visible NFTs at
all. Per-token manual curation cannot work here: every summon creates a new token uid.

## Acceptance Criteria

1. A blueprint can call `create_deposit_token(..., data=b"ipfs://<cid>/moss-snail.jpg")`;
   the parameter is optional and existing blueprints are unaffected.
2. The stored data is immutable and readable via the node's token APIs (e.g.
   `GET /v1a/thin_wallet/token?id=<uid>` returns it the same way it returns NFT data
   for manually created NFTs).
3. Official wallets (mobile, desktop, Snap) display media for such tokens under the
   same rules as manually created NFTs — with any review/approval applied at the
   **blueprint or contract level** (one approval covering all tokens it mints), not
   per token uid.
4. Works on testnet and mainnet; melting the token behaves unchanged.
5. Emberfall test: a card summoned on testnet-india shows its illustration in the
   Hathor mobile wallet.
6. Wallets display a token carrying this data as **one item** (like manually created
   NFTs), not as a decimal balance. Context: contract-minted game assets may use a
   supply above 1 base unit out of necessity — melting charges a minimum fee of 1
   base unit, so a 1-unit token can never be melted (Emberfall cards are 100 units
   for this reason, moved only as a whole). Rendering "1.00" instead of "1 item"
   breaks the NFT presentation for exactly the tokens this PRD enables.
