// Does a Hathor wallet-lib message signature reproduce byte-for-byte?
const { walletUtils } = require('@hathor/wallet-lib');
const { signMessage, verifyMessage } = require('@hathor/wallet-lib/lib/utils/crypto');
const { P2PKH_ACCT_PATH } = require('@hathor/wallet-lib/lib/constants');
const { deriveAddressFromXPubP2PKH } = require('@hathor/wallet-lib/lib/utils/address');

const NETWORK = 'testnet';
const words = walletUtils.generateWalletWords();
const root = walletUtils.getXPrivKeyFromSeed(words, { networkName: NETWORK });
const change = root.deriveNonCompliantChild(P2PKH_ACCT_PATH).deriveNonCompliantChild(0);
const priv = change.deriveNonCompliantChild(0).privateKey;
const addr = deriveAddressFromXPubP2PKH(change.xpubkey, 0, NETWORK).base58;

const MSG = 'emberfall:duel-salt:v1';
const sigs = [];
for (let i = 0; i < 5; i++) sigs.push(signMessage(MSG, priv));

console.log('address      :', addr);
sigs.forEach((s, i) => console.log(`sig[${i}]      :`, s));
console.log('all identical:', new Set(sigs).size === 1);
console.log('all verify   :', sigs.every(s => verifyMessage(MSG, s, addr)));
