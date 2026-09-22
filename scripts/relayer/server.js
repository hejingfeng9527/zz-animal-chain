/**
 * server.js —— 本地签名网关
 * 静态页面（GitHub Pages）无法直接持有私钥，读写 FISCO BCOS 由本地网关代理：
 *   GET  /health            健康检查
 *   POST /deploy            部署合约（返回合约地址，写入 deploy.local.json）
 *   POST /call              只读调用（eth_call）
 *   POST /send              写交易（eth_sendRawTransaction，本地私钥签名）
 *
 * 启动：
 *   cd scripts/relayer && npm i && PRIVATE_KEY=0x... RPC_URL=http://127.0.0.1:8545 node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const PORT = process.env.PORT || 8787;
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const CHAIN_ID = Number(process.env.CHAIN_ID || 0);
// 默认账户私钥（FISCO BCOS 开发网常见测试私钥，生产环境务必替换）
const PRIVATE_KEY = process.env.PRIVATE_KEY ||
  '0x3c6a8e9e3b1e2a3f6d1c9b8a7f6e5d4c3b2a1908f7e6d5c4b3a2918070605040';

const ROOT = path.join(__dirname, '..', '..');
const ABI_DIR = path.join(ROOT, 'contracts');
const DEPLOY_FILE = path.join(ROOT, 'scripts', 'deploy.local.json');

const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID === 0 ? undefined : CHAIN_ID);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const ABI_CACHE = {};
function abiOf(name) {
  if (ABI_CACHE[name]) return ABI_CACHE[name];
  const file = path.join(ABI_DIR, name + '.abi.json');
  if (!fs.existsSync(file)) throw new Error('缺少 ABI 文件: ' + file + '，请先执行 npm run compile');
  ABI_CACHE[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
  return ABI_CACHE[name];
}

function binOf(name) {
  const file = path.join(ABI_DIR, name + '.bin');
  if (!fs.existsSync(file)) throw new Error('缺少 bytecode 文件: ' + file);
  return '0x' + fs.readFileSync(file, 'utf8').trim();
}

let ADDRESSES = { charityPoints: '', rescueLedger: '', adoptionLedger: '' };
if (fs.existsSync(DEPLOY_FILE)) {
  try { ADDRESSES = Object.assign(ADDRESSES, JSON.parse(fs.readFileSync(DEPLOY_FILE, 'utf8'))); } catch (e) { /* ignore */ }
}
function saveAddresses() {
  fs.writeFileSync(DEPLOY_FILE, JSON.stringify(ADDRESSES, null, 2));
}

function contract(name, address) {
  return new ethers.Contract(address || ADDRESSES[name], abiOf(name), wallet);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e7) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  try {
    const url = req.url.split('?')[0];

    if (url === '/health') {
      let number = -1, chainId = -1;
      try {
        number = await provider.getBlockNumber();
        chainId = Number((await provider.getNetwork()).chainId);
      } catch (e) { /* 链不可用时仍返回网关状态 */ }
      return send(200, {
        ok: true, rpc: RPC_URL, blockNumber: number, chainId,
        signer: wallet.address, contracts: ADDRESSES
      });
    }

    if (req.method !== 'POST') return send(404, { error: 'not found' });
    const data = await body(req);

    if (url === '/deploy') {
      const name = data.contract;
      const factory = new ethers.ContractFactory(abiOf(name), binOf(name), wallet);
      const c = await factory.deploy(...(data.args || []));
      await c.waitForDeployment();
      const addr = await c.getAddress();
      ADDRESSES[name] = addr;
      saveAddresses();
      return send(200, { address: addr, txHash: c.deploymentTransaction().hash });
    }

    if (url === '/call') {
      const c = contract(data.contract, data.address);
      const result = await c[data.method](...(data.args || []));
      return send(200, { result: normalize(result) });
    }

    if (url === '/send') {
      const c = contract(data.contract, data.address);
      const tx = await c[data.method](...(data.args || []));
      const rc = await tx.wait();
      return send(200, {
        result: {
          txHash: rc.hash, blockNumber: rc.blockNumber, status: rc.status === 1 ? 1 : 0,
          gasUsed: Number(rc.gasUsed), logs: (rc.logs || []).map((l) => ({
            contract: data.contract,
            event: l.fragment ? l.fragment.name : 'Unknown',
            args: l.args ? l.args.slice() : []
          }))
        }
      });
    }

    return send(404, { error: 'unknown endpoint' });
  } catch (e) {
    return send(500, { error: e.message || String(e) });
  }
});

function normalize(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      if (/^\d+$/.test(k) || k === 'length' || k === '_' ) continue;
      out[k] = normalize(v[k]);
    }
    return out;
  }
  return v;
}

server.listen(PORT, () => {
  console.log('[relayer] 监听 http://127.0.0.1:' + PORT);
  console.log('[relayer] RPC:', RPC_URL);
  console.log('[relayer] 签名账户:', wallet.address);
});
