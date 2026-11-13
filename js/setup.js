/* KryptoCzat – one-time contract deployment via the deterministic CREATE2 proxy */
(function () {
  'use strict';
  const E = window.ethers, U = window.KCU, KC = window.KC;
  const $ = (id) => document.getElementById(id);
  const chainId = U.chainId();
  const net = U.net();

  $('netBadge').textContent = net.name;
  $('netName').textContent = net.name;
  $('cAddr').textContent = net.contract;
  $('cAdmin').textContent = KC.admin;
  $('cTreasury').textContent = '—';
  $('homeLink').href = U.withNet('index.html');
  $('openApp').href = U.withNet('index.html');
  if (chainId !== KC.defaultChainId) {
    $('testLink').textContent = 'back to Base mainnet';
    $('testLink').href = 'setup.html';
  }

  function status(html) { $('status').innerHTML = html; }
  function done() {
    const link = net.explorer ? ' <a target="_blank" rel="noopener" href="' + net.explorer + '/address/' + net.contract + '">View in explorer</a>' : '';
    status('✅ KryptoCzat is live on ' + net.name + '.' + link);
    $('btnDeploy').classList.add('hidden');
    $('openApp').classList.remove('hidden');
  }

  async function check() {
    try {
      const ro = new E.JsonRpcProvider(net.rpc, chainId, { staticNetwork: true });
      const code = await Promise.race([ro.getCode(net.contract), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 7000))]);
      if (code !== '0x') {
        try { $('cTreasury').textContent = await new E.Contract(net.contract, KC.abi, ro).treasury(); } catch (e) { /* ignore */ }
        return done();
      }
      $('cTreasury').textContent = KC.admin;
      status('The contract is not deployed yet.');
    } catch (e) {
      status('Could not check the network – connect your wallet to check through it.');
    }
    $('btnDeploy').classList.remove('hidden');
  }

  async function deploy() {
    if (!window.ethereum) { U.toast('Install MetaMask (or open this page in the MetaMask app).', 'err'); return; }
    const btn = $('btnDeploy');
    btn.disabled = true;
    let close = null;
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      await U.ensureChain();
      const provider = new E.BrowserProvider(window.ethereum, 'any');
      const signer = await provider.getSigner();
      if ((await provider.getCode(net.contract)) !== '0x') return done();
      if ((await provider.getCode(KC.deployProxy)) === '0x') throw new Error('The CREATE2 deployment proxy is missing on this network.');
      const me = await signer.getAddress();
      if ((await provider.getBalance(me)) === 0n) throw new Error('You need a little ETH on ' + net.name + ' for gas.');

      const data = window.KC_DEPLOY[chainId];
      close = U.toast('Confirm the transaction in your wallet…', 'wait');
      const tx = await signer.sendTransaction({ to: KC.deployProxy, data, gasLimit: 1800000n });
      close(); close = U.toast('Deploying… (a few seconds)', 'wait');
      status('Transaction sent: <span class="mono">' + U.short(tx.hash) + '</span>');
      const rc = await tx.wait();
      if (!rc || rc.status !== 1) throw new Error('The deployment transaction failed.');
      let ok = false;
      for (let i = 0; i < 8 && !ok; i++) {
        // fresh provider – no cache; RPC nodes may lag a block behind
        const fresh = new E.BrowserProvider(window.ethereum, 'any');
        ok = (await fresh.getCode(net.contract)) !== '0x';
        if (!ok) await new Promise((r) => setTimeout(r, 1500));
      }
      if (!ok) throw new Error('The transaction succeeded but the contract is not visible yet – refresh in a moment.');
      U.toast('Done! KryptoCzat is live.', 'ok');
      done();
    } catch (e) {
      U.toast(U.errMsg(e), 'err');
    } finally { if (close) close(); btn.disabled = false; }
  }

  $('btnDeploy').onclick = deploy;
  if (window.ethereum && window.ethereum.on) window.ethereum.on('chainChanged', () => location.reload());
  check();
})();
