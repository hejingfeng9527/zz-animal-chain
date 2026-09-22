/**
 * hash.js —— 线索哈希存证工具
 * - sha256Hex: 真实 SHA-256（Web Crypto），用于线索/协议/回访凭证存证
 * - syncHex:   同步哈希，仅用于生成演示用地址、交易/区块哈希标识
 */
(function (global) {
  'use strict';

  async function sha256Hex(input) {
    const buf = typeof input === 'string'
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return '0x' + Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /** 同步哈希（FNV-1a 变体，非加密强度，仅用于演示标识生成） */
  function syncHex(str, len) {
    len = len || 64;
    const MASK = 0xffffffffffffffffn;
    const PRIME = 0x100000001b3n;
    let out = '';
    for (let round = 0; out.length < len; round++) {
      let h = 0xcbf29ce484222325n + BigInt(round) * 0x9e3779b97f4a7c15n;
      const s = String(str);
      for (let i = 0; i < s.length; i++) {
        h ^= BigInt(s.charCodeAt(i) + round);
        h = (h * PRIME) & MASK;
      }
      out += h.toString(16).padStart(16, '0');
    }
    return out.slice(0, len);
  }

  /** 规范化 JSON（键排序 + 去掉 undefined），保证同样内容得到同样哈希 */
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }

  async function hashRecord(obj) {
    return sha256Hex(canonical(obj));
  }

  async function hashFile(file) {
    const ab = await file.arrayBuffer();
    return sha256Hex(ab);
  }

  /** 由昵称生成稳定的演示地址（20 字节） */
  function addressOf(name) {
    return '0x' + syncHex('addr:' + name, 40);
  }

  function shortHash(h, head, tail) {
    if (!h) return '-';
    head = head || 10;
    tail = tail === undefined ? 8 : tail;
    return h.length > head + tail ? h.slice(0, head) + '…' + h.slice(-tail) : h;
  }

  global.ZZHash = { sha256Hex, syncHex, canonical, hashRecord, hashFile, addressOf, shortHash };
})(window);
