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
1-of-1 token from inside the `GachaArena` contract
(`00b1bddc439d8b4255c16fec70d9578f7cebdb989e277c2cca934ac7bb48dcbb`, blueprint
`00fd125434accb0f6eeb50936ea0a60b4f8f930e401d3095cb9fa77c2b88d7b5`). These tokens are
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
