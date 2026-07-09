// GachaArena deployment + wallet-connect configuration
window.GAME = {
  network: 'testnet', // hathor network name used by snap/walletconnect
  blueprint: '00fd125434accb0f6eeb50936ea0a60b4f8f930e401d3095cb9fa77c2b88d7b5',
  nc: '00b1bddc439d8b4255c16fec70d9578f7cebdb989e277c2cca934ac7bb48dcbb',
  gems: '357ec146e2492361474c4d6d685a9e7747360b44a5ec829c856f020a10f834d5',
  market: {
    blueprint: '00ddf5d21557d3d6dd9d34e88c43abc1a399faeb1bd5088dc5af617ed5be8938',
    nc: '006318ef0471d957345db139f9b5e0b1d830e596180de558ea37b289845d1391',
  },
  // Reown Cloud project id (https://cloud.reown.com) — enables WalletConnect
  // pairing with the Hathor mobile/desktop wallet.
  wcProjectId: '7b19452a987a959c2e5a373331e6eb5b',
};
