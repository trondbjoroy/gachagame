/* Wallet adapters for GachaArena.
   Every adapter exposes: connect() -> address, executeNano(method, args, actions),
   tokenBalance(uid) -> int, label, mode.

   - demo:  server-side custodial wallet via the hardened /api proxy
   - snap:  Hathor MetaMask Snap (npm:@hathor/snap), htr_* JSON-RPC
   - wc:    WalletConnect / Reown pairing with the Hathor mobile/desktop
            wallet, same htr_* JSON-RPC over the relay                     */

const SNAP_ID = 'npm:@hathor/snap';

// amounts in htr_sendNanoContractTx actions are strings per the spec
function rpcActions(actions) {
  return actions.map(a => ({ ...a, amount: String(a.amount) }));
}

/* ---------------- demo (custodial) ---------------- */

class DemoWallet {
  constructor() { this.mode = 'demo'; this.label = 'Demo wallet (shared)'; this.address = null; }

  async connect() {
    const r = await fetch('/api/wallet/address?index=0', { headers: { 'x-wallet-id': 'player' } });
    const d = await r.json();
    if (!d.address) throw new Error('demo wallet unavailable');
    this.address = d.address;
    return this.address;
  }

  async executeNano(method, args, actions) {
    const r = await fetch('/api/wallet/nano-contracts/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wallet-id': 'player' },
      body: JSON.stringify({
        nc_id: window.GAME.nc, method, address: this.address,
        data: { args, actions },
      }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'transaction rejected');
    return { hash: d.hash };
  }

  async tokenBalance(uid) {
    const r = await fetch(`/api/wallet/balance?token=${uid}`, { headers: { 'x-wallet-id': 'player' } });
    const d = await r.json();
    return d.available || 0;
  }

  async htrBalance() {
    const r = await fetch('/api/wallet/balance', { headers: { 'x-wallet-id': 'player' } });
    return (await r.json()).available || 0;
  }
}

/* ---------------- MetaMask Snap ---------------- */

class SnapWallet {
  constructor() { this.mode = 'snap'; this.label = 'MetaMask (Hathor Snap)'; this.address = null; }

  async invoke(method, params) {
    return window.ethereum.request({
      method: 'wallet_invokeSnap',
      params: { snapId: SNAP_ID, request: { method, params } },
    });
  }

  async connect() {
    if (!window.ethereum) throw new Error('MetaMask is not installed');
    await window.ethereum.request({ method: 'wallet_requestSnaps', params: { [SNAP_ID]: {} } });
    const info = await this.invoke('htr_getWalletInformation', { network: window.GAME.network });
    this.address = info && (info.address ?? info.response?.address ?? info.firstAddress);
    if (!this.address) {
      const a = await this.invoke('htr_getAddress', { type: 'index', index: 0, network: window.GAME.network });
      this.address = typeof a === 'string' ? a : a?.address ?? a?.response?.address;
    }
    if (!this.address) throw new Error('snap did not return an address');
    return this.address;
  }

  async executeNano(method, args, actions) {
    const res = await this.invoke('htr_sendNanoContractTx', {
      method,
      blueprint_id: window.GAME.blueprint,
      nc_id: window.GAME.nc,
      actions: rpcActions(actions),
      args,
      push_tx: true,
    });
    const hash = res?.hash ?? res?.response?.hash ?? res?.txId;
    if (!hash) throw new Error('snap did not return a transaction id');
    return { hash };
  }

  async tokenBalance(uid) {
    const res = await this.invoke('htr_getBalance', { network: window.GAME.network, tokens: [uid] });
    const list = Array.isArray(res) ? res : res?.response ?? [];
    return list[0]?.balance?.unlocked ?? 0;
  }

  async htrBalance() { return this.tokenBalance('00'); }
}

/* ---------------- WalletConnect / Reown ---------------- */

class WcWallet {
  constructor() {
    this.mode = 'wc'; this.label = 'WalletConnect (Hathor wallet)';
    this.address = null; this.client = null; this.session = null;
    this.chain = `hathor:${window.GAME.network}`;
  }

  async connect(onUri) {
    if (!window.GAME.wcProjectId) {
      throw new Error('WalletConnect needs a (free) Reown Cloud project id — set wcProjectId in config.js');
    }
    const { SignClient } = await import('https://esm.sh/@walletconnect/sign-client@2.17.2?bundle');
    this.client = await SignClient.init({
      projectId: window.GAME.wcProjectId,
      metadata: {
        name: 'Hathor Gacha Arena',
        description: 'Onchain gacha: pull, farm, fuse, duel',
        url: window.location.origin,
        icons: [`${window.location.origin}/icon.png`],
      },
    });
    const { uri, approval } = await this.client.connect({
      requiredNamespaces: {
        hathor: {
          methods: ['htr_sendNanoContractTx', 'htr_getBalance', 'htr_getAddress',
                    'htr_getConnectedNetwork', 'htr_signWithAddress'],
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

  async executeNano(method, args, actions) {
    const res = await this.request('htr_sendNanoContractTx', {
      method,
      blueprint_id: window.GAME.blueprint,
      nc_id: window.GAME.nc,
      actions: rpcActions(actions),
      args,
      push_tx: true,
    });
    const hash = res?.hash ?? res?.response?.hash;
    if (!hash) throw new Error('wallet did not return a transaction id');
    return { hash };
  }

  async tokenBalance(uid) {
    const res = await this.request('htr_getBalance', { network: window.GAME.network, tokens: [uid] });
    const list = Array.isArray(res) ? res : res?.response ?? [];
    return list[0]?.balance?.unlocked ?? 0;
  }

  async htrBalance() { return this.tokenBalance('00'); }
}

window.WALLETS = { DemoWallet, SnapWallet, WcWallet };
