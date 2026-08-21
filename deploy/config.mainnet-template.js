// MAINNET config template (docs/mainnet-migration.md, Phase 4).
// Copy over frontend/public/config.js at cutover and fill every <TBD>.
// Nothing reads this file where it sits: it is a template, not config.
window.GAME = {
  network: 'mainnet', // drives snap/walletconnect AND session address derivation
  blueprint: '<TBD: mainnet arena blueprint hash>',
  nc: '<TBD: mainnet arena instance id>',
  market: {
    blueprint: '<TBD: mainnet market blueprint hash>',
    nc: '<TBD: mainnet market instance id>',
  },
  cardUnit: 1,
  // economy in cents. sessionFund is REAL money on mainnet: keep the float
  // small (decision D4). fusionFees MUST match set_fusion_fees on chain.
  economy: { sessionFund: '<TBD>', fusionFees: '<TBD: match the contract>' },
  wcProjectId: '7b19452a987a959c2e5a373331e6eb5b',
  sessionNode: location.hostname.endsWith('emberfall.fun')
    ? location.origin + '/hnode/v1a/'
    : 'https://node-partners.mainnet.hathor.network/v1a/',
  txMiningUrl: null, // verify the mainnet public tx-mining service first (open question Q3)
};
