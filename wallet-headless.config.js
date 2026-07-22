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

  seeds: {
    operator: 'opera trim input off muscle shove elevator shuffle practice filter lunch soldier train ramp gadget museum limb color october daring hurt also feel resist',
    player: 'inspire outer march slab clap window mirror together pig style fan shrug trial expire emerge item task supply donkey bar gospel tennis worth goat',
  },

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
