// EmberfallArena v4 deployment + wallet-connect configuration (testnet-india).
// Blueprints published by Hathor 2026-07-24; instance seeded by launch_v4.py
// (ids also in scripts/v4_ids.json).
window.GAME = {
  network: 'testnet', // hathor network name used by snap/walletconnect
  blueprint: '00a9206990837c936369bb12711be4a5c3e96d736175e367579992d8f9d84e95',
  nc: '00c7aaa25c90c5be834df9e99d731bb6024df68f5ef63dba0878cb7c0dfe4bdd',
  market: {
    blueprint: '00356e32686ea741b1a9d027bdf00e3c1e3563553f0d7ae1c2921c91af816d81',
    nc: '000000001bc502cf793a7343de99816f574b3b7839e4bd21d8d680afabc799fb',
  },
  cardUnit: 1, // base units per card (v4 mints 1-unit NFTs; legacy realms used 100)
  // live economy (cents). Fusion fees are tiered by station in the contract.
  economy: { sessionFund: 1000, fusionFees: [5, 10, 50, 100] },
  // Reown Cloud project id (https://cloud.reown.com) — enables WalletConnect
  // pairing with the Hathor mobile/desktop wallet.
  wcProjectId: '7b19452a987a959c2e5a373331e6eb5b',
  // the session wallet talks to the fullnode through our own domain (Caddy
  // proxies /hnode, websocket included): phones that balk at connecting to
  // the node directly still sync fine this way. Off-domain (localhost dev)
  // it talks straight to the partner node.
  sessionNode: location.hostname.endsWith('emberfall.fun')
    ? location.origin + '/hnode/v1a/'
    : 'https://node-partners.testnet.hathor.network/v1a/',
  txMiningUrl: null, // testnet-india uses Hathor's public tx-mining service
};
