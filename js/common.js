/* KryptoCzat – shared helpers (app and setup page) */
(function () {
  'use strict';
  const E = window.ethers;

  const U = {
    $: (s, el) => (el || document).querySelector(s),
    show(id, on) { document.getElementById(id).classList.toggle('hidden', on === false); },
    hide(id) { document.getElementById(id).classList.add('hidden'); },

    chainId() {
      const q = new URLSearchParams(location.search).get('net');
      const id = q && window.KC.networks[q] ? Number(q) : window.KC.defaultChainId;
      return id;
    },
    net() { return window.KC.networks[U.chainId()]; },
    withNet(url) {
      const id = U.chainId();
      if (id === window.KC.defaultChainId) return url;
      return url + (url.includes('?') ? '&' : '?') + 'net=' + id;
    },

    short(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; },
    usdc(units) {
      const n = Number(E.formatUnits(units, 6));
      return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDC';
    },
    time(sec) {
      const d = new Date(Number(sec) * 1000);
      const today = new Date();
      const opts = d.toDateString() === today.toDateString()
        ? { hour: '2-digit', minute: '2-digit' }
        : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
      return d.toLocaleString(undefined, opts);
    },
    avatar(el, addr) {
      const h = parseInt(addr.slice(2, 8), 16);
      const h1 = h % 360, h2 = (h1 + 40 + (h >> 9) % 80) % 360;
      el.style.background = `linear-gradient(135deg, hsl(${h1} 70% 58%), hsl(${h2} 65% 45%))`;
    },

    toast(text, kind, ms) {
      const box = document.getElementById('toasts');
      const t = document.createElement('div');
      t.className = 'toast' + (kind ? ' ' + kind : '');
      if (kind === 'wait') { t.className = 'toast'; t.innerHTML = '<span class="spinner"></span>'; t.append(text); }
      else t.textContent = text;
      box.appendChild(t);
      const close = () => t.remove();
      if (kind !== 'wait') setTimeout(close, ms || (kind === 'err' ? 7000 : 4000));
      return close;
    },

    errMsg(e, iface) {
      const code = e && (e.code || (e.info && e.info.error && e.info.error.code) || (e.error && e.error.code));
      if (code === 'ACTION_REJECTED' || code === 4001) return 'Cancelled in your wallet.';
      if (code === 'INSUFFICIENT_FUNDS') return 'Not enough ETH on Base to pay for gas.';
      let name = e && e.revert && e.revert.name;
      if (!name && iface && e && e.data) { try { name = iface.parseError(e.data).name; } catch (x) { /* ignore */ } }
      const map = {
        IsPaused: 'Sending is temporarily paused by the admin.',
        PaymentFailed: 'The USDC payment failed – check your USDC balance.',
        InvalidRecipient: 'Invalid recipient.',
        InvalidBody: 'The message is empty or too long.',
        NotOwner: 'Only the admin can do this.',
        ZeroAddress: 'Address cannot be empty.',
      };
      if (name && map[name]) return map[name];
      const m = (e && (e.shortMessage || e.reason || e.message)) || String(e);
      if (/insufficient funds/i.test(m)) return 'Not enough ETH on Base to pay for gas.';
      return m.length > 220 ? m.slice(0, 220) + '…' : m;
    },

    async ensureChain() {
      const id = U.chainId();
      const net = U.net();
      const hex = '0x' + id.toString(16);
      const cur = await window.ethereum.request({ method: 'eth_chainId' });
      if (cur === hex) return;
      try {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
      } catch (e) {
        const c = e && (e.code || (e.data && e.data.originalError && e.data.originalError.code));
        if (c === 4902 || /unrecognized|not added|unknown chain/i.test(String(e && e.message))) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: hex, chainName: net.name,
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: [net.rpc], blockExplorerUrls: net.explorer ? [net.explorer] : undefined,
            }],
          });
        } else throw e;
      }
    },

    modal(build) {
      return new Promise((resolve) => {
        const root = document.getElementById('modalRoot');
        const bg = document.createElement('div');
        bg.className = 'modal-bg';
        const m = document.createElement('div');
        m.className = 'modal';
        bg.appendChild(m);
        const close = (v) => { bg.remove(); resolve(v); };
        bg.addEventListener('click', (ev) => { if (ev.target === bg) close(null); });
        build(m, close);
        root.appendChild(bg);
      });
    },

    confirm(title, text, okLabel, cancelLabel) {
      return U.modal((m, close) => {
        const h = document.createElement('h2'); h.textContent = title;
        const p = document.createElement('p'); p.className = 'muted'; p.style.lineHeight = '1.55'; p.textContent = text;
        const row = document.createElement('div'); row.className = 'row'; row.style.justifyContent = 'flex-end';
        const no = document.createElement('button'); no.className = 'ghost'; no.textContent = cancelLabel || 'Cancel';
        const ok = document.createElement('button'); ok.textContent = okLabel || 'OK';
        no.onclick = () => close(false); ok.onclick = () => close(true);
        row.append(no, ok); m.append(h, p, row);
      });
    },

    copy(text) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } finally { t.remove(); }
      return Promise.resolve();
    },
  };
  window.KCU = U;
})();
