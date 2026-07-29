// EmberfallArena v5 deployment + wallet-connect configuration (testnet-india).
// Blueprint published by Hathor 2026-07-28; instance seeded by launch_v5.py
// (ids also in scripts/v5_ids.json).
window.GAME = {
  network: 'testnet', // hathor network name used by snap/walletconnect
  blueprint: '000a1fd471e575a4eb8919b56dd58df0abfc2091a8002bc89c114645157cb9d7',
  nc: '0061589e138059dcc670e392442c55bd6a55487adaa0b519ad41cf09bb0129b4',
  market: {
    blueprint: '00356e32686ea741b1a9d027bdf00e3c1e3563553f0d7ae1c2921c91af816d81',
    nc: '000000004c077094120091a3f333efcae1fc8cdc98f758bc07b519aeed788627',
  },
  cardUnit: 1, // base units per card (v4 mints 1-unit NFTs; legacy realms used 100)
  // live economy (cents). Fusion fees are tiered by station in the contract.
  // retuned on chain 2026-07-28: half a day of the child's mine rate.
  // These MUST match set_fusion_fees or the app offers a rite the
  // contract refuses, which is what "fusing fails repeatedly" was.
  economy: { sessionFund: 1000, fusionFees: [2160, 7200, 28800, 28800] },
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
