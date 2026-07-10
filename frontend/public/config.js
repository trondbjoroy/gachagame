// EmberfallArena v2.2 deployment + wallet-connect configuration (testnet-india)
window.GAME = {
  network: 'testnet', // hathor network name used by snap/walletconnect
  blueprint: '0078b201b50e228833ad6e526c6e0d5c89456502623b4f18807b3991ac3ce0bf',
  nc: '00599b4b1e879ee1437b828926b7d5a11ac5c5ca094e25e77094420c8b3c9258',
  gems: 'd99c0aae27eae400cd7eac85eed44064dfedafb47800a481ce90c3c01b0dbd15',
  market: {
    blueprint: '007498c9c4c667c973c2800948aabb34b2cd8eed60c1d801bce2bda2e96fd33b',
    nc: '0033955d297d8460c9a839d242537e71d8fed7c92880305d0c8312055bf5c48b',
  },
  // Reown Cloud project id (https://cloud.reown.com) — enables WalletConnect
  // pairing with the Hathor mobile/desktop wallet.
  // live economy (cents). Fusion fees are tiered by station in the v2.2 contract.
  economy: { sessionFund: 1000, fusionFees: [5, 10, 50, 100] },
  wcProjectId: '7b19452a987a959c2e5a373331e6eb5b',
};
