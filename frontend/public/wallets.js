/* Wallet adapters for GachaArena.
   Every adapter exposes: connect() -> address, executeNano(method, args, actions),
   tokenBalance(uid) -> int, label, mode.

   - snap:  Hathor MetaMask Snap (npm:@hathor/snap), htr_* JSON-RPC
   - wc:    WalletConnect / Reown pairing with the Hathor mobile/desktop
            wallet, same htr_* JSON-RPC over the relay                     */

const SNAP_ID = 'npm:@hathor/snap';

// Locate a Snaps-capable MetaMask provider. Other wallet extensions
// (Brave Wallet, Coinbase, ...) often shadow window.ethereum, and
// MetaMask Mobile's in-app browser does not support Snaps at all.
async function findMetaMask() {
  const announced = [];
  const onAnnounce = e => announced.push(e.detail);
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(r => setTimeout(r, 300));
  window.removeEventListener('eip6963:announceProvider', onAnnounce);
  const mm = announced.find(d => /metamask/i.test(d.info?.name || ''));
  if (mm) return mm.provider;
  const multi = window.ethereum?.providers;
  if (Array.isArray(multi)) {
    const p = multi.find(x => x.isMetaMask);
    if (p) return p;
  }
  return window.ethereum || null;
}

// amounts in htr_sendNanoContractTx actions are strings per the spec.
// changeAddress pins deposit change back to the shared address so the
// node-side balance display stays accurate for multi-address wallets.
function rpcActions(actions, changeAddress) {
  return actions.map(a => ({
    ...a, amount: String(a.amount),
    ...(a.type === 'deposit' && changeAddress ? { changeAddress } : {}),
  }));
}

// Prompt-free balance reads for self-custody wallets: query the node for
// the shared address instead of htr_getBalance (which opens a MetaMask
// confirmation for every call). Cached briefly to avoid hammering the node.
let balCache = { addr: null, at: 0, data: null };
async function addrBalance(address, token) {
  const now = Date.now();
  if (balCache.addr !== address || now - balCache.at > 5000) {
    const r = await fetch(`/node/thin_wallet/address_balance?address=${address}`);
    const d = await r.json();
    balCache = { addr: address, at: now, data: d.tokens_data || {} };
  }
  const t = balCache.data[token];
  return t ? Math.max(0, (t.received || 0) - (t.spent || 0)) : 0;
}

/* ---------------- MetaMask Snap ---------------- */

class SnapWallet {
  constructor() { this.mode = 'snap'; this.label = 'MetaMask (Hathor Snap)'; this.address = null; }

  async invoke(method, params) {
    const r = await this.provider.request({
      method: 'wallet_invokeSnap',
      params: { snapId: SNAP_ID, request: { method, params } },
    });
    // some provider/snap combinations return the result JSON-stringified
    if (typeof r === 'string' && (r.startsWith('{') || r.startsWith('['))) {
      try { return JSON.parse(r); } catch { return r; }
    }
    return r;
  }

  async connect() {
    this.provider = await findMetaMask();
    if (!this.provider) throw new Error('MetaMask is not installed');
    try {
      await this.provider.request({ method: 'wallet_requestSnaps', params: { [SNAP_ID]: {} } });
    } catch (e) {
      const msg = e?.message || String(e);
      if (/unsupported method|method not found|does not exist|not supported/i.test(msg)) {
        throw new Error('This browser wallet cannot run MetaMask Snaps. ' +
          'Use the MetaMask browser extension (v11+) on desktop Chrome/Firefox, and if you have ' +
          'several wallet extensions, disable the others; Snaps do not work in MetaMask Mobile.');
      }
      throw e;
    }
    const info = await this.invoke('htr_getWalletInformation', { network: window.GAME.network });
    this.address = info && (info.response?.address0 ?? info.address ?? info.response?.address);
    if (!this.address) {
      const a = await this.invoke('htr_getAddress', { type: 'index', index: 0, network: window.GAME.network });
      this.address = typeof a === 'string' ? a : a?.address ?? a?.response?.address;
    }
    if (!this.address || !/^[A-Za-z0-9]{30,40}$/.test(this.address)) {
      throw new Error('snap returned an unexpected address format');
    }
    return this.address;
  }

  async executeNano(method, args, actions, target) {
    const res = await this.invoke('htr_sendNanoContractTx', {
      method,
      blueprint_id: (target || window.GAME).blueprint,
      nc_id: (target || window.GAME).nc,
      actions: rpcActions(actions, this.address),
      args,
      push_tx: true,
    });
    const hash = res?.hash ?? res?.response?.hash ?? res?.txId;
    if (!hash) throw new Error('your wallet did not confirm the deed');
    return { hash };
  }

  async tokenBalance(uid) { return addrBalance(this.address, uid); }

  async htrBalance() { return this.tokenBalance('00'); }

  async sendHtr(toAddress, amount) {
    const res = await this.invoke('htr_sendTransaction', {
      network: window.GAME.network,
      outputs: [{ address: toAddress, value: String(amount) }],
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('your wallet did not confirm the deed');
    return { hash };
  }
}

/* ---------------- WalletConnect / Reown ---------------- */

class WcWallet {
  constructor() {
    this.mode = 'wc'; this.label = 'WalletConnect (Hathor wallet)';
    this.address = null; this.client = null; this.session = null;
    this.chain = `hathor:${window.GAME.network}`;
  }

  async initClient() {
    if (this.client) return this.client;
    if (!window.GAME.wcProjectId) {
      throw new Error('WalletConnect needs a (free) Reown Cloud project id; set wcProjectId in config.js');
    }
    // module imports can fail transiently on mobile (memory pressure,
    // flaky radio): one retry turns most of those into non-events
    let SignClient;
    try {
      ({ SignClient } = await import('https://esm.sh/@walletconnect/sign-client@2.17.2?bundle'));
    } catch {
      await new Promise(r => setTimeout(r, 1500));
      ({ SignClient } = await import('https://esm.sh/@walletconnect/sign-client@2.17.2?bundle'));
    }
    this.client = await SignClient.init({
      projectId: window.GAME.wcProjectId,
      metadata: {
        name: 'Hathor Gacha Arena',
        description: 'Onchain gacha: pull, farm, fuse, duel',
        url: window.location.origin,
        icons: [`${window.location.origin}/icon.png`],
      },
    });
    this.client.on('session_delete', e => {
      if (this.session && e.topic === this.session.topic) this.session = null;
    });
    return this.client;
  }

  // adopt a still-valid pairing from a previous visit, if one exists
  async restore() {
    await this.initClient();
    const live = this.client.session.getAll().filter(s =>
      s.namespaces?.hathor && s.expiry * 1000 > Date.now() + 60_000);
    const s = live.sort((a, b) => b.expiry - a.expiry)[0];
    if (!s) return null;
    this.session = s;
    const accounts = s.namespaces.hathor?.accounts ?? [];
    this.address = accounts[0]?.split(':')[2] || null;
    return this.address;
  }

  async connect(onUri) {
    await this.initClient();
    const restored = await this.restore().catch(() => null);
    if (restored) return restored;
    const { uri, approval } = await this.client.connect({
      requiredNamespaces: {
        hathor: {
          methods: ['htr_sendNanoContractTx', 'htr_sendTransaction', 'htr_getBalance',
                    'htr_getAddress', 'htr_getConnectedNetwork', 'htr_signWithAddress'],
          chains: [this.chain],
          events: [],
        },
      },
    });
    if (uri && onUri) onUri(uri);
    this.session = await approval();
    const accounts = this.session.namespaces.hathor?.accounts ?? [];
    this.address = accounts[0]?.split(':')[2];
    if (!this.address) throw new Error('wallet did not share an address');
    return this.address;
  }

  async request(method, params) {
    return this.client.request({
      topic: this.session.topic,
      chainId: this.chain,
      request: { method, params },
    });
  }

  async executeNano(method, args, actions, target) {
    const res = await this.request('htr_sendNanoContractTx', {
      network: window.GAME.network,
      method,
      blueprint_id: (target || window.GAME).blueprint,
      nc_id: (target || window.GAME).nc,
      actions: rpcActions(actions, this.address),
      args,
      push_tx: true,
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('your wallet did not confirm the deed');
    return { hash };
  }

  async tokenBalance(uid) { return addrBalance(this.address, uid); }

  async htrBalance() { return this.tokenBalance('00'); }

  async sendHtr(toAddress, amount) {
    const res = await this.request('htr_sendTransaction', {
      network: window.GAME.network,
      outputs: [{ address: toAddress, value: String(amount) }],
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('your wallet did not confirm the deed');
    return { hash };
  }

  async disconnect() {
    if (this.client && this.session) {
      await this.client.disconnect({
        topic: this.session.topic,
        reason: { code: 6000, message: 'user disconnected' },
      }).catch(() => {});
    }
  }
}

/* ---------------- Session (promptless, browser-held key) ---------------- */

let sessionLibLoading = null;
function loadSessionLib() {
  if (window.SessionKit) return Promise.resolve();
  if (!sessionLibLoading) {
    sessionLibLoading = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      // versioned: phones pin heuristically-cached copies of this 3.7MB
      // bundle even after the server starts sending no-cache
      el.src = 'session-lib.js?v=10';
      el.onload = resolve;
      el.onerror = () => reject(new Error('failed to load the session signer'));
      document.head.appendChild(el);
    });
  }
  return sessionLibLoading;
}

class SessionWallet {
  constructor(handle, mainAddr) {
    this.mode = 'session';
    this.label = 'Session (promptless)';
    this.handle = handle;
    this.address = handle.address;
    this.mainAddr = mainAddr;
  }

  static async create() {
    await loadSessionLib();
    return window.SessionKit.generateWords();
  }

  // address 0 for a seed, derived offline: lets the funding step show an
  // address without waiting on (or risking) a full wallet sync
  static async addressFor(words) {
    await loadSessionLib();
    return window.SessionKit.addressFor(words);
  }

  static async open(words, mainAddr) {
    await loadSessionLib();
    const handle = await window.SessionKit.open(words);
    return new SessionWallet(handle, mainAddr);
  }

  async executeNano(method, args, actions, target) {
    return this.handle.executeNano(method, {
      ncId: (target || window.GAME).nc,
      blueprintId: (target || window.GAME).blueprint,
      args,
      actions,
    });
  }

  async tokenBalance(uid) { return this.handle.balance(uid); }
  async htrBalance() { return this.handle.balance('00'); }
  async sweep() { return this.handle.sweep(this.mainAddr); }
  async disconnect() { await this.handle.stop().catch(() => {}); }
}

// HTR balance of any address over plain HTTP: immune to the wallet's live
// sync sleeping through a transfer while the tab is suspended (phones)
window.WALLETS = { SnapWallet, WcWallet, SessionWallet, addrHtr: a => addrBalance(a, '00') };
