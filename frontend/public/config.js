// EmberfallArena v2.2 deployment + wallet-connect configuration (testnet-india)
window.GAME = {
  network: 'testnet', // hathor network name used by snap/walletconnect
  blueprint: '0037896213a4cb7b1b28ae2116fa95a6bff066a6e19bc395eb9a18541f54717f',
  nc: '0082579ce4e9f6726650048ef90f02034f442d65b443b55d1f64b5de90e7a587',
  gems: 'e05b7b0c7651fabf0424f229abede02fc7d63761a3c48ed2034c557678fd1ef3',
  // the retired v2.2 realm: adopted cards' uids are discovered from its
  // token list, and the season script still sums renown across both
  oldNc: '00599b4b1e879ee1437b828926b7d5a11ac5c5ca094e25e77094420c8b3c9258',
  oldBlueprint: '0078b201b50e228833ad6e526c6e0d5c89456502623b4f18807b3991ac3ce0bf',
  oldGems: 'd99c0aae27eae400cd7eac85eed44064dfedafb47800a481ce90c3c01b0dbd15',
  market: {
    blueprint: '007498c9c4c667c973c2800948aabb34b2cd8eed60c1d801bce2bda2e96fd33b',
    nc: '0033955d297d8460c9a839d242537e71d8fed7c92880305d0c8312055bf5c48b',
  },
  // Reown Cloud project id (https://cloud.reown.com) — enables WalletConnect
  // pairing with the Hathor mobile/desktop wallet.
  // live economy (cents). Fusion fees are tiered by station in the v2.2 contract.
  economy: { sessionFund: 1000, fusionFees: [5, 10, 50, 100] },
  wcProjectId: '7b19452a987a959c2e5a373331e6eb5b',
  // the session wallet talks to the fullnode through our own domain (Caddy
  // proxies /hnode, websocket included): phones that balk at connecting to
  // node1.testnet.hathor.network directly still sync fine this way
  sessionNode: location.hostname.endsWith('emberfall.fun')
    ? location.origin + '/hnode/v1a/'
    : null,
};
