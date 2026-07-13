/* Emberfall session signer — a full Hathor light wallet on a throwaway seed,
   running entirely in the player's browser. Signs game transactions without
   wallet prompts; sweeps everything back to the main wallet on demand. */
import { HathorWallet, Connection, walletUtils } from '@hathor/wallet-lib';
import { P2PKH_ACCT_PATH } from '@hathor/wallet-lib/lib/constants';
import { deriveAddressFromXPubP2PKH } from '@hathor/wallet-lib/lib/utils/address';
import { JSONBigInt } from '@hathor/wallet-lib/lib/utils/bigint';
import JSONBigIntFactory from 'json-bigint';

// wallet-lib's BigInt JSON codec relies on the V8-only JSON.parse reviver
// `context` argument and JSON.rawJSON. WebKit (every browser on iOS) has
// neither, so the reviver throws on the first number it meets and the wallet
// dies mid-sync. Swap in a pure-JS codec with the same semantics there.
(function patchBigIntCodec() {
  let hasContext = false;
  try {
    JSON.parse('1', (k, v, ctx) => { if (ctx && ctx.source) hasContext = true; return v; });
  } catch { /* engines without the argument may throw via other paths */ }
  const forced = typeof window !== 'undefined' && window.__FORCE_JSONBI_PATCH;
  if (hasContext && typeof JSON.rawJSON === 'function' && !forced) return;
  const JB = JSONBigIntFactory({ useNativeBigInt: true });
  JSONBigInt.parse = text => JB.parse(text);
  JSONBigInt.stringify = (value, space) => JB.stringify(value, null, space);
})();

const NODE = (typeof window !== 'undefined' && window.GAME && window.GAME.sessionNode)
  || 'https://node1.testnet.hathor.network/v1a/';
const NETWORK = 'testnet';
const PIN = 'emberfall-session';

// address 0 straight from the seed words: pure key derivation, no network.
// mirrors generateAccessDataFromSeed's path (acct path -> change 0 -> index)
function addressFor(words) {
  const root = walletUtils.getXPrivKeyFromSeed(words, { networkName: NETWORK });
  const change = root.deriveNonCompliantChild(P2PKH_ACCT_PATH).deriveNonCompliantChild(0);
  return deriveAddressFromXPubP2PKH(change.xpubkey, 0, NETWORK).base58;
}

const HOST = new URL(NODE).host;

function waitReady(wallet, detail) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`sync timeout via ${HOST}: ${detail() || 'no detail'}`)), 90_000);
    wallet.on('state', state => {
      if (state === HathorWallet.READY) { clearTimeout(timer); resolve(); }
      if (state === HathorWallet.ERROR) {
        clearTimeout(timer);
        reject(new Error(`sync error via ${HOST}: ${detail() || 'no detail'}`));
      }
    });
    if (wallet.isReady()) { clearTimeout(timer); resolve(); }
  });
}

// serialize whatever the wallet's logger was handed, Errors included
function logToString(args) {
  try {
    return args.map(x => {
      if (x instanceof Error) return x.message || String(x);
      if (typeof x === 'object' && x !== null) {
        return JSON.stringify(x, (k, v) => (v instanceof Error ? (v.message || String(v)) : v));
      }
      return String(x);
    }).join(' ').slice(0, 300);
  } catch { return 'unserializable error'; }
}

async function open(words) {
  // preflight so failures name the exact broken stage, not a generic sync error
  try {
    const r = await fetch(NODE + 'version');
    if (!r.ok) throw new Error('http ' + r.status);
  } catch (e) {
    throw new Error(`node unreachable via ${HOST} (${(e && e.message) || e})`);
  }
  const connection = new Connection({ network: NETWORK, servers: [NODE] });
  // capture the wallet's own error logs: they carry the real failure cause,
  // which the generic ERROR state hides
  let lastError = '';
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (...a) => { lastError = logToString(a); console.error(...a); },
  };
  const wallet = new HathorWallet({
    connection, seed: words, password: PIN, pinCode: PIN, logger,
  });
  try {
    await wallet.start();
  } catch (e) {
    throw new Error(`wallet start failed via ${HOST}: ${(e && e.message) || e}`);
  }
  await waitReady(wallet, () => lastError);
  const address = await wallet.getAddressAtIndex(0);

  return {
    address,

    async executeNano(method, data) {
      const hydrated = {
        ...data,
        actions: (data.actions || []).map(a => ({
          ...a,
          amount: BigInt(a.amount),
          // keep everything on address 0 so balances stay legible
          ...(a.type === 'deposit' ? { changeAddress: address } : {}),
        })),
      };
      const tx = await wallet.createAndSendNanoContractTransaction(
        method, address, hydrated, { pinCode: PIN });
      return { hash: tx.hash };
    },

    async balance(token) {
      const b = await wallet.getBalance(token || '00');
      return Number(b[0]?.balance?.unlocked ?? 0);
    },

    async tokens() {
      return wallet.getTokens();
    },

    async sweep(toAddress) {
      const uids = await wallet.getTokens();
      const outputs = [];
      for (const uid of uids) {
        const b = await wallet.getBalance(uid);
        const amount = b[0]?.balance?.unlocked ?? 0n;
        if (amount > 0n || Number(amount) > 0) {
          outputs.push({ address: toAddress, value: BigInt(amount), token: uid });
        }
      }
      if (!outputs.length) return null;
      const tx = await wallet.sendManyOutputsTransaction(outputs, { pinCode: PIN });
      return { hash: tx.hash, moved: outputs.length };
    },

    stop() { return wallet.stop({ cleanStorage: true, cleanAddresses: true }); },
  };
}

window.SessionKit = {
  generateWords: () => walletUtils.generateWalletWords(),
  addressFor,
  open,
};
