module.exports = {
  http_bind_address: 'localhost',
  http_port: 8000,

  network: 'testnet',
  server: 'https://node-partners.testnet.hathor.network/v1a/',

  // Local mini tx-mining service (playground min_tx_weight=8)
  txMiningUrl: 'https://txmining.testnet.hathor.network/',

  atomicSwapService: null,

  hsmHost: null,
  hsmUsername: null,
  hsmPassword: null,

  fireblocksUrl: 'https://api.fireblocks.io',
  fireblocksApiKey: null,
  fireblocksApiSecret: null,
  fireblocksApiSecretFile: null,

  txMiningApiKey: null,

  // seeds live in ./wallet-seeds.js (gitignored) or OPERATOR_SEED/PLAYER_SEED
  // env vars — never committed. See wallet-seeds.js for the mainnet rule.
  seeds: require('./wallet-seeds.js'),

  multisig: {},

  httpLogFormat: null,
  consoleLevel: 'info',

  tokenUid: '',
  gapLimit: null,
  connectionTimeout: null,
  allowPassphrase: false,
  confirmFirstAddress: false,
  enabled_plugins: [],
};
