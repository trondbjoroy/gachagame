// GachaArena deployment + wallet-connect configuration
window.GAME = {
  network: 'testnet', // hathor network name used by snap/walletconnect
  blueprint: '00d087732f8c308833fb49cd5ed177384e49666a6fc40f0676cf5e1980d2c588',
  nc: '00cc50d78771c245e95f794bd7090d8009eae90b562c77a938ff53efca4d34f8',
  gems: '3647ee44cf81b74dd8e8e26d7b6237cc7c6b588e53cc30dd0a2eb3dbdf5c63f2',
  market: {
    blueprint: '00c4494c84a8e74393a491f39aca4f49efa3ec022e4336e780dcb55c3f4341fc',
    nc: '00c059067c19717c856364913d2b3950be4379c8762c13c2b5b91d0ed4ab7620',
  },
  // Reown Cloud project id (https://cloud.reown.com) — enables WalletConnect
  // pairing with the Hathor mobile/desktop wallet.
  wcProjectId: 'bb36c8bcfd09cf5e6c4ca13c5db2b4e2',
};
