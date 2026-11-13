/* KryptoCzat – app */
(function () {
  'use strict';
  const E = window.ethers, C = window.KCCrypto, U = window.KCU, KC = window.KC;
  const LIMIT = 200n;           // how many recent messages (received and sent) to load
  const APPROVE_FACTOR = 20n;   // USDC allowance for ~20 messages
  const MAX_CHARS = 2000;
  const $ = (id) => document.getElementById(id);

  const S = {
    chainId: U.chainId(), net: U.net(),
    provider: null, signer: null, account: null, pm: null, usdc: null, keys: null,
    price: 500000n, owner: null, paused: false, maxLen: 4096, myKey: E.ZeroHash,
    msgs: new Map(), peerKeys: new Map(), sending: [], active: null, loading: false, prefillTo: null,
  };

  const SCREENS = ['scrLoading', 'scrNoWallet', 'scrNotDeployed', 'scrConnect', 'scrUnlock', 'scrApp'];
  function screen(id) { SCREENS.forEach((s) => $(s).classList.toggle('hidden', s !== id)); }
  const lc = (a) => a.toLowerCase();
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  // ------------------------------------------------------------------ start
  async function init() {
    $('netBadge').textContent = S.net.name;
    document.querySelectorAll('.netName').forEach((e) => { e.textContent = S.net.name; });
    $('setupLink').href = U.withNet('setup.html');
    const to = new URLSearchParams(location.search).get('to');
    if (to && E.isAddress(to)) S.prefillTo = E.getAddress(to);

    try {
      const ro = new E.JsonRpcProvider(S.net.rpc, S.chainId, { staticNetwork: true });
      const code = await withTimeout(ro.getCode(S.net.contract), 7000);
      if (code === '0x') { screen('scrNotDeployed'); return; }
      const pmRo = new E.Contract(S.net.contract, KC.abi, ro);
      S.price = await withTimeout(pmRo.sendPrice(), 7000);
      $('pPrice').textContent = U.usdc(S.price);
    } catch (e) { /* public RPC unavailable – will check after wallet connects */ }

    if (!window.ethereum) {
      $('mmDeepLink').href = 'https://metamask.app.link/dapp/' + location.host + location.pathname + location.search;
      screen('scrNoWallet');
      return;
    }
    if (window.ethereum.on) {
      window.ethereum.on('accountsChanged', () => location.reload());
      window.ethereum.on('chainChanged', () => location.reload());
    }
    bind();
    let accs = [];
    try { accs = await window.ethereum.request({ method: 'eth_accounts' }); } catch (e) { /* ignore */ }
    if (accs && accs.length) {
      try { await connect(false); return; } catch (e) { console.warn(e); }
    }
    screen('scrConnect');
  }

  async function connect(interactive) {
    if (interactive) await window.ethereum.request({ method: 'eth_requestAccounts' });
    await U.ensureChain();
    S.provider = new E.BrowserProvider(window.ethereum, 'any');
    S.signer = await S.provider.getSigner();
    S.account = await S.signer.getAddress();
    const code = await S.provider.getCode(S.net.contract);
    if (code === '0x') { screen('scrNotDeployed'); return; }
    S.pm = new E.Contract(S.net.contract, KC.abi, S.signer);
    S.usdc = new E.Contract(S.net.usdc, KC.erc20Abi, S.signer);

    $('topUser').classList.remove('hidden');
    $('meAddr').textContent = U.short(S.account);
    U.avatar($('meAvatar'), S.account);

    const cached = sessionStorage.getItem(keyStore());
    if (cached) {
      try {
        const j = JSON.parse(cached);
        S.keys = { publicKey: C.fromB64(j.p), secretKey: C.fromB64(j.s) };
        return enterApp();
      } catch (e) { sessionStorage.removeItem(keyStore()); }
    }
    $('unlockAddr').textContent = S.account;
    screen('scrUnlock');
  }

  function keyStore() { return 'kc:keys:' + S.chainId + ':' + lc(S.account); }
  function seenStore() { return 'kc:seen:' + S.chainId + ':' + lc(S.account); }
  function getSeen() { try { return JSON.parse(localStorage.getItem(seenStore()) || '{}'); } catch (e) { return {}; } }
  function setSeen(peer, id) {
    try {
      const s = getSeen();
      if ((s[lc(peer)] || -1) < id) { s[lc(peer)] = id; localStorage.setItem(seenStore(), JSON.stringify(s)); }
    } catch (e) { /* private mode */ }
  }

  async function unlock() {
    const btn = $('btnUnlock');
    btn.disabled = true;
    try {
      const sig = await S.signer.signMessage(C.keyMessage(S.account));
      S.keys = C.deriveKeys(sig);
      try { sessionStorage.setItem(keyStore(), JSON.stringify({ p: C.toB64(S.keys.publicKey), s: C.toB64(S.keys.secretKey) })); } catch (e) { /* ignore */ }
      await enterApp();
    } catch (e) {
      U.toast(U.errMsg(e), 'err');
    } finally { btn.disabled = false; }
  }

  async function enterApp() {
    screen('scrApp');
    if (S.prefillTo && lc(S.prefillTo) !== lc(S.account)) openPeer(S.prefillTo);
    await refresh(false);
    setInterval(() => { if (!document.hidden) refresh(true); }, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
  }

  // ------------------------------------------------------------------ dane
  async function refresh(silent) {
    if (S.loading || !S.pm) return;
    S.loading = true;
    try {
      const acc = S.account;
      const [price, owner, paused, maxLen, myKey, inLen, outLen, bal] = await Promise.all([
        S.pm.sendPrice(), S.pm.owner(), S.pm.paused(), S.pm.maxBodyLength(), S.pm.encryptionKey(acc),
        S.pm.inboxLength(acc), S.pm.outboxLength(acc), S.usdc.balanceOf(acc),
      ]);
      Object.assign(S, { price, owner, paused, maxLen: Number(maxLen), myKey });
      $('usdcBal').textContent = U.usdc(bal);
      $('sendPriceLbl').textContent = U.usdc(price);
      $('btnAdmin').classList.toggle('hidden', lc(owner) !== lc(acc));
      $('keyBanner').classList.toggle('hidden', myKey !== E.ZeroHash);

      const page = async (fn, len) => {
        if (len === 0n) return [[], []];
        const off = len > LIMIT ? len - LIMIT : 0n;
        const r = await S.pm[fn](acc, off, LIMIT);
        return [r[0], r[1]];
      };
      const [[inIds, inMsgs], [outIds, outMsgs]] = await Promise.all([page('getInbox', inLen), page('getOutbox', outLen)]);
      addMsgs(inIds, inMsgs, 'in');
      addMsgs(outIds, outMsgs, 'out');
      render();
    } catch (e) {
      if (!silent) U.toast(U.errMsg(e), 'err');
      else console.warn(e);
    } finally { S.loading = false; }
  }

  function addMsgs(ids, msgs, dir) {
    ids.forEach((rawId, i) => {
      const id = Number(rawId);
      if (S.msgs.has(id)) return;
      const m = msgs[i];
      let text = null, err = null;
      try { text = C.decode(E.getBytes(m.body), S.keys); } catch (e) { err = e.message; }
      const peer = E.getAddress(dir === 'in' ? m.from : m.to);
      S.msgs.set(id, { id, from: m.from, to: m.to, sentAt: Number(m.sentAt), encrypted: m.encrypted, dir, peer, text, err });
    });
  }

  function conversations() {
    const map = new Map();
    const get = (peer) => {
      const k = lc(peer);
      if (!map.has(k)) map.set(k, { peer, msgs: [], last: 0 });
      return map.get(k);
    };
    for (const m of S.msgs.values()) {
      const c = get(m.peer);
      c.msgs.push(m);
      c.last = Math.max(c.last, m.sentAt);
    }
    for (const p of S.sending) get(p.peer).last = Math.max(get(p.peer).last, Date.now() / 1000);
    if (S.active) get(S.active);
    const seen = getSeen();
    const list = [...map.values()];
    list.forEach((c) => {
      c.msgs.sort((a, b) => a.id - b.id);
      const s = seen[lc(c.peer)] ?? -1;
      c.unread = c.msgs.filter((m) => m.dir === 'in' && m.id > s).length;
    });
    return list.sort((a, b) => (b.last || Infinity) - (a.last || Infinity));
  }

  // ------------------------------------------------------------------ widok
  function render() { renderConvos(); renderChat(); }

  function renderConvos() {
    const box = $('convos');
    box.textContent = '';
    const list = conversations();
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.innerHTML = 'No messages yet.<br>Click “New chat” and enter a wallet address.';
      box.appendChild(d);
      return;
    }
    for (const c of list) {
      const row = document.createElement('div');
      row.className = 'convo' + (S.active && lc(S.active) === lc(c.peer) ? ' active' : '');
      const av = document.createElement('span'); av.className = 'avatar'; U.avatar(av, c.peer);
      const meta = document.createElement('div'); meta.className = 'meta';
      const name = document.createElement('div'); name.className = 'name';
      const nm = document.createElement('span'); nm.className = 'mono'; nm.textContent = U.short(c.peer);
      name.appendChild(nm);
      if (c.unread && !(S.active && lc(S.active) === lc(c.peer))) {
        const cnt = document.createElement('span'); cnt.className = 'count'; cnt.textContent = c.unread; name.appendChild(cnt);
      }
      const last = document.createElement('div'); last.className = 'last';
      const lm = c.msgs[c.msgs.length - 1];
      if (lm) last.textContent = (lm.dir === 'out' ? 'You: ' : '') + (lm.text != null ? lm.text : '🔒 cannot be read');
      else last.textContent = 'New chat';
      meta.append(name, last);
      row.append(av, meta);
      row.onclick = () => openPeer(c.peer);
      box.appendChild(row);
    }
  }

  function renderChat() {
    const has = !!S.active;
    $('chatPlaceholder').classList.toggle('hidden', has);
    ['chatHead', 'messages', 'composer', 'composerInfo'].forEach((id) => $(id).classList.toggle('hidden', !has));
    $('scrApp').classList.toggle('show-chat', has);
    if (!has) return;

    const peer = S.active;
    $('peerAddr').textContent = U.short(peer);
    $('peerAddr').title = peer;
    U.avatar($('peerAvatar'), peer);
    const pk = S.peerKeys.get(lc(peer));
    const sub = $('peerSub');
    if (pk === undefined) sub.textContent = 'Checking inbox…';
    else if (pk === E.ZeroHash) sub.textContent = '⚠ Inbox not activated – message will be public';
    else sub.textContent = '🔒 End-to-end encrypted';

    const box = $('messages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.textContent = '';
    const conv = conversations().find((c) => lc(c.peer) === lc(peer));
    const msgs = conv ? conv.msgs : [];
    if (!msgs.length && !S.sending.some((p) => lc(p.peer) === lc(peer))) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'Write your first message to ' + U.short(peer) + '. Sending costs ' + U.usdc(S.price) + '.';
      box.appendChild(d);
    }
    for (const m of msgs) box.appendChild(bubble(m.dir, m.text != null ? m.text : '🔒 ' + (m.err || 'Cannot be read'), m.sentAt, !m.encrypted));
    for (const p of S.sending.filter((x) => lc(x.peer) === lc(peer))) {
      const b = bubble('out', p.text, null, false);
      b.classList.add('pending');
      const st = document.createElement('span'); st.className = 'time';
      st.innerHTML = '<span class="spinner"></span>' + (p.stage || 'Confirm in your wallet…');
      b.appendChild(st);
      box.appendChild(b);
    }
    if (msgs.length) setSeen(peer, msgs[msgs.length - 1].id);
    if (atBottom || box.dataset.peer !== lc(peer)) box.scrollTop = box.scrollHeight;
    box.dataset.peer = lc(peer);

    $('composerInfo').textContent = S.paused
      ? '⏸ Sending is temporarily paused by the admin.'
      : 'Each message: ' + U.usdc(S.price) + ' + gas on ' + S.net.name + ' (a fraction of a cent). Enter to send, Shift+Enter for a new line.';
  }

  function bubble(dir, text, sentAt, isPlain) {
    const b = document.createElement('div');
    b.className = 'msg ' + dir;
    b.textContent = text;
    if (sentAt != null) {
      const t = document.createElement('span');
      t.className = 'time';
      t.textContent = (isPlain ? 'public · ' : '') + U.time(sentAt);
      b.appendChild(t);
    }
    return b;
  }

  async function openPeer(addr) {
    S.active = E.getAddress(addr);
    $('newChat').classList.add('hidden');
    render();
    $('msgInput').focus();
    try {
      const k = await S.pm.encryptionKey(S.active);
      S.peerKeys.set(lc(S.active), k);
      renderChat();
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ akcje
  async function ensureFunds(amount) {
    const acc = S.account;
    const eth = await S.provider.getBalance(acc);
    if (eth === 0n) throw new Error('You need a little ETH on ' + S.net.name + ' to pay for gas (a few cents is enough).');
    if (amount === 0n) return;
    const bal = await S.usdc.balanceOf(acc);
    if (bal < amount) throw new Error('Not enough USDC on ' + S.net.name + '. You have ' + U.usdc(bal) + ', you need ' + U.usdc(amount) + '.');
    const allowance = await S.usdc.allowance(acc, S.net.contract);
    if (allowance >= amount) return;
    const want = amount * APPROVE_FACTOR;
    const ok = await U.confirm('Allow message fees',
      'The first time, your wallet will ask you to allow KryptoCzat to charge fees for your messages – up to ' +
      U.usdc(want) + ' in total (about ' + APPROVE_FACTOR + ' messages). After that, each message is a single transaction.', 'Continue', 'Cancel');
    if (!ok) throw new Error('Cancelled.');
    const close = U.toast('Approve in your wallet…', 'wait');
    try { await (await S.usdc.approve(S.net.contract, want)).wait(); } finally { close(); }
  }

  async function send() {
    const peer = S.active;
    const input = $('msgInput');
    const text = input.value.trim();
    if (!peer || !text) return;
    if (text.length > MAX_CHARS) { U.toast('A message can have at most ' + MAX_CHARS + ' characters.', 'err'); return; }
    const btn = $('btnSend');
    btn.disabled = true;
    let pending = null;
    try {
      if (S.paused) throw new Error('Sending is temporarily paused by the admin.');
      const rk = await S.pm.encryptionKey(peer);
      S.peerKeys.set(lc(peer), rk);
      let body, encrypted;
      if (rk !== E.ZeroHash) {
        body = C.encrypt(text, S.keys, E.getBytes(rk));
        encrypted = true;
      } else {
        renderChat();
        const ok = await U.confirm('Recipient has no active inbox yet',
          'This wallet has not used KryptoCzat yet, so the message cannot be encrypted. It will be stored PUBLICLY on the blockchain – anyone can read it. ' +
          'Write a short invitation without private information. Once the recipient visits the site, further messages will be encrypted.',
          'Send publicly', 'Cancel');
        if (!ok) return;
        body = C.plain(text);
        encrypted = false;
      }
      if (body.length > S.maxLen) throw new Error('The message is too long.');
      await ensureFunds(S.price);

      const mine = C.hex(S.keys.publicKey);
      const keyArg = lc(S.myKey) === lc(mine) ? E.ZeroHash : mine;
      pending = { peer, text };
      S.sending.push(pending);
      input.value = '';
      autosize();
      render();
      const tx = await S.pm.sendMessage(peer, body, encrypted, keyArg);
      pending.stage = 'Saving on-chain…';
      renderChat();
      const rc = await tx.wait();
      if (keyArg !== E.ZeroHash) S.myKey = mine;
      for (const log of rc.logs) {
        let ev = null;
        try { ev = S.pm.interface.parseLog(log); } catch (e) { /* other log */ }
        if (ev && ev.name === 'MessageSent') {
          const id = Number(ev.args.id);
          S.msgs.set(id, { id, from: S.account, to: peer, sentAt: Math.floor(Date.now() / 1000), encrypted, dir: 'out', peer, text, err: null });
        }
      }
      U.toast('Sent · ' + U.usdc(S.price), 'ok');
    } catch (e) {
      if (pending && !input.value) input.value = text;
      U.toast(U.errMsg(e, S.pm && S.pm.interface), 'err');
    } finally {
      if (pending) S.sending = S.sending.filter((p) => p !== pending);
      btn.disabled = false;
      render();
      refresh(true);
    }
  }

  async function activate() {
    const btn = $('btnActivate');
    btn.disabled = true;
    const close = U.toast('Confirm in your wallet…', 'wait');
    try {
      const eth = await S.provider.getBalance(S.account);
      if (eth === 0n) throw new Error('You need a little ETH on ' + S.net.name + ' for gas.');
      await (await S.pm.registerKey(C.hex(S.keys.publicKey))).wait();
      S.myKey = C.hex(S.keys.publicKey);
      $('keyBanner').classList.add('hidden');
      U.toast('Inbox activated – others can now send you encrypted messages.', 'ok');
    } catch (e) {
      U.toast(U.errMsg(e, S.pm.interface), 'err');
    } finally { close(); btn.disabled = false; }
  }

  function myLink() {
    let url = location.origin + location.pathname + '?to=' + S.account;
    if (S.chainId !== KC.defaultChainId) url += '&net=' + S.chainId;
    return url;
  }

  async function adminPanel() {
    let count = '…';
    try { count = (await S.pm.messageCount()).toString(); } catch (e) { /* ignore */ }
    const [treasury] = await Promise.all([S.pm.treasury()]);
    U.modal((m, close) => {
      m.innerHTML = '';
      const h = document.createElement('h2'); h.textContent = 'Admin panel';
      const stat = document.createElement('div'); stat.className = 'stat';
      const link = S.net.explorer ? S.net.explorer + '/address/' + S.net.contract : '';
      stat.innerHTML = 'Total messages: <b>' + count + '</b><br>Revenue (approx.): messages × price<br>' +
        'Contract: ' + (link ? '<a target="_blank" rel="noopener" href="' + link + '">' + U.short(S.net.contract) + '</a>' : U.short(S.net.contract)) +
        '<br>Status: <b>' + (S.paused ? 'paused' : 'running') + '</b>';

      const field = (label, value, attrs) => {
        const f = document.createElement('div'); f.className = 'field';
        const l = document.createElement('label'); l.textContent = label;
        const row = document.createElement('div'); row.className = 'row';
        const i = document.createElement('input'); i.value = value; Object.assign(i, attrs || {});
        const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Save';
        row.append(i, b); f.append(l, row);
        return { f, i, b };
      };
      const price = field('Price per message (USDC)', E.formatUnits(S.price, 6), { type: 'number', step: '0.01', min: '0' });
      const tre = field('Fee recipient address', treasury, { spellcheck: false });
      tre.i.className = 'mono';
      const len = field('Max message size (bytes, ~1 byte = 1 character)', String(S.maxLen), { type: 'number', step: '1', min: '100' });
      const pause = document.createElement('button');
      pause.className = S.paused ? 'teal' : 'ghost';
      pause.textContent = S.paused ? '▶ Resume sending' : '⏸ Pause sending';
      pause.style.width = '100%';
      const closeBtn = document.createElement('button'); closeBtn.className = 'ghost'; closeBtn.textContent = 'Close';
      closeBtn.style.cssText = 'width:100%;margin-top:8px';
      closeBtn.onclick = () => close();

      const run = async (btn, fn, okMsg) => {
        btn.disabled = true;
        const c = U.toast('Confirm in your wallet…', 'wait');
        try { await (await fn()).wait(); U.toast(okMsg, 'ok'); close(); refresh(true); }
        catch (e) { U.toast(U.errMsg(e, S.pm.interface), 'err'); }
        finally { c(); btn.disabled = false; }
      };
      price.b.onclick = () => {
        let v;
        try { v = E.parseUnits(String(price.i.value || '0').replace(',', '.'), 6); } catch (e) { U.toast('Invalid amount.', 'err'); return; }
        run(price.b, () => S.pm.setPrice(v), 'New price: ' + U.usdc(v));
      };
      tre.b.onclick = () => {
        if (!E.isAddress(tre.i.value.trim())) { U.toast('Invalid address.', 'err'); return; }
        run(tre.b, () => S.pm.setTreasury(E.getAddress(tre.i.value.trim())), 'Fee recipient updated.');
      };
      len.b.onclick = () => {
        const v = parseInt(len.i.value, 10);
        if (!(v >= 100 && v <= 20000)) { U.toast('Enter a value between 100 and 20000.', 'err'); return; }
        run(len.b, () => S.pm.setMaxBodyLength(v), 'Limit updated.');
      };
      pause.onclick = () => run(pause, () => S.pm.setPaused(!S.paused), S.paused ? 'Sending resumed.' : 'Sending paused.');
      m.append(h, stat, price.f, tre.f, len.f, pause, closeBtn);
    });
  }

  function autosize() {
    const t = $('msgInput');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 160) + 'px';
  }

  function bind() {
    $('btnConnect').onclick = async () => {
      $('btnConnect').disabled = true;
      try { await connect(true); } catch (e) { U.toast(U.errMsg(e), 'err'); } finally { $('btnConnect').disabled = false; }
    };
    $('btnUnlock').onclick = unlock;
    $('btnNew').onclick = () => { $('newChat').classList.toggle('hidden'); $('newAddr').focus(); };
    $('newCancel').onclick = () => $('newChat').classList.add('hidden');
    const go = () => {
      const v = $('newAddr').value.trim();
      if (!E.isAddress(v)) { U.toast('That is not a valid wallet address (0x…, 42 characters).', 'err'); return; }
      if (lc(v) === lc(S.account)) { U.toast('You cannot message yourself.', 'err'); return; }
      $('newAddr').value = '';
      openPeer(v);
    };
    $('newGo').onclick = go;
    $('newAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('btnRefresh').onclick = () => refresh(false);
    $('btnSend').onclick = send;
    $('msgInput').addEventListener('input', autosize);
    $('msgInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(); }
    });
    $('btnBack').onclick = () => { S.active = null; render(); };
    $('btnCopyPeer').onclick = () => U.copy(S.active).then(() => U.toast('Address copied.', 'ok'));
    $('btnMyLink').onclick = () => U.copy(myLink()).then(() => U.toast('Your link is copied – share it so people can message you.', 'ok'));
    $('accountChip').onclick = () => U.copy(S.account).then(() => U.toast('Your address is copied.', 'ok'));
    $('btnActivate').onclick = activate;
    $('btnAdmin').onclick = adminPanel;
  }

  init().catch((e) => { console.error(e); U.toast(U.errMsg(e), 'err'); screen('scrConnect'); });
})();
