/* KryptoCzat – message encryption (requires globals: ethers, nacl)
 *
 * On-chain body format:
 *   encrypted: [0x01][sender pubkey 32][recipient pubkey 32][nonce 24][ciphertext]
 *              (nacl.box – only sender and recipient can read it)
 *   plain:     [0x00][UTF-8 text]
 */
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // Text to sign. Signatures are deterministic, so the same wallet always restores
  // the same key. Do NOT change this text after launch (old messages would become unreadable).
  function keyMessage(address) {
    return 'KryptoCzat – unlock your inbox\n\n' +
      'This signature is free and does not send any transaction.\n' +
      'It is only used to restore your private message encryption key.\n\n' +
      'Wallet: ' + address.toLowerCase();
  }

  function deriveKeys(signatureHex) {
    const sig = root.ethers.getBytes(signatureHex);
    const h = root.nacl.hash(sig); // 64 bytes
    const kp = root.nacl.box.keyPair.fromSecretKey(h.slice(0, 32));
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  }

  function concat(...parts) {
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function eq(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function encrypt(text, myKeys, recipientPub) {
    const nonce = root.nacl.randomBytes(24);
    const ct = root.nacl.box(enc.encode(text), nonce, recipientPub, myKeys.secretKey);
    return concat(new Uint8Array([1]), myKeys.publicKey, recipientPub, nonce, ct);
  }

  function plain(text) {
    return concat(new Uint8Array([0]), enc.encode(text));
  }

  /** Returns the text or throws if it can't be read. */
  function decode(body, myKeys) {
    if (!body || body.length < 1) throw new Error('Empty message');
    if (body[0] === 0) return dec.decode(body.slice(1));
    if (body[0] !== 1 || body.length < 1 + 32 + 32 + 24 + 16) throw new Error('Unknown format');
    const senderPub = body.slice(1, 33);
    const recipientPub = body.slice(33, 65);
    const nonce = body.slice(65, 89);
    const ct = body.slice(89);
    let other;
    if (eq(myKeys.publicKey, recipientPub)) other = senderPub;
    else if (eq(myKeys.publicKey, senderPub)) other = recipientPub;
    else throw new Error('Encrypted with a different key');
    const m = root.nacl.box.open(ct, nonce, other, myKeys.secretKey);
    if (!m) throw new Error('Cannot decrypt');
    return dec.decode(m);
  }

  root.KCCrypto = {
    keyMessage, deriveKeys, encrypt, plain, decode,
    hex: (b) => root.ethers.hexlify(b),
    bytes: (h) => root.ethers.getBytes(h),
    toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); },
    fromB64(b64) { const s = atob(b64); const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
