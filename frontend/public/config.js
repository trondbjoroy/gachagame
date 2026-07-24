// EmberfallArena v4 deployment + wallet-connect configuration.
// Currently pointed at the VALIDATED PLAYGROUND instance for development;
// swap blueprint/nc ids (and network endpoints) when Hathor publishes v4
// on testnet-india — see docs/v4-frontend-adaptation.md.
window.GAME = {
  network: 'testnet', // hathor network name used by snap/walletconnect
  blueprint: '000f4ae9ea365e48bb925f847a12f5c279f29b869c5fe9a676a16e2fcbf9f383',
  nc: '00b03c0a36422c638bb08cbcba5312e230ba187685adfb45f9b4b43778de67db',
  market: {
    blueprint: '008eb85b7b08806a12702cff4efe4465e13bb11b13642bc1292a31bcda641d56',
    nc: '009f30fef812c57f31db2aff102b859012dc8efca4af9dfb50aa08d7f85ae9c1',
  },
  cardUnit: 1, // base units per card (v4 mints 1-unit NFTs; legacy realms used 100)
  // live economy (cents). Fusion fees are tiered by station in the contract.
  economy: { sessionFund: 1000, fusionFees: [5, 10, 50, 100] },
  // Reown Cloud project id (https://cloud.reown.com) — enables WalletConnect
  // pairing with the Hathor mobile/desktop wallet.
  wcProjectId: '7b19452a987a959c2e5a373331e6eb5b',
  // the session wallet talks to the fullnode through our own domain (Caddy
  // proxies /hnode, websocket included): phones that balk at connecting to
  // node1.testnet.hathor.network directly still sync fine this way
  sessionNode: location.hostname.endsWith('emberfall.fun')
    ? location.origin + '/hnode/v1a/'
    : null,
};
