/**
 * deploy-chain.js —— 通过本地 relayer 把三份合约部署到 FISCO BCOS，并回填前端配置
 * 前置：
 *   1) WSL2 中启动 FISCO BCOS 链，RPC 端口可访问（默认 http://127.0.0.1:8545）
 *   2) npm run compile （生成 ABI / bytecode）
 *   3) cd scripts/relayer && npm i && PRIVATE_KEY=0x... node server.js
 * 用法： node scripts/deploy-chain.js [--rpc http://127.0.0.1:8545] [--relayer http://127.0.0.1:8787]
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : d;
};
const RELAYER = argOf('relayer', 'http://127.0.0.1:8787');
const RPC = argOf('rpc', 'http://127.0.0.1:8545');
const ROOT = path.join(__dirname, '..');

// 载入前端的 hash.js 以复用演示地址生成规则
const hashSrc = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'hash.js'), 'utf8');
global.window = global;
new Function(hashSrc)();
const addressOf = global.ZZHash.addressOf;

async function post(p, data) {
  const r = await fetch(RELAYER + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {})
  });
  const j = await r.json();
  if (j.error) throw new Error(p + ' → ' + j.error);
  return j;
}
async function get(p) {
  const r = await fetch(RELAYER + p);
  return r.json();
}

(async () => {
  console.log('[1/5] 检查网关与链状态…');
  const health = await get('/health');
  console.log('  签名账户:', health.signer, '| 区块高度:', health.blockNumber, '| RPC:', health.rpc || RPC);
  if (health.blockNumber < 0) console.warn('  ⚠️ 链不可达，请确认 FISCO BCOS RPC 已启动：' + RPC);

  console.log('[2/5] 部署 CharityPoints…');
  const charity = (await post('/deploy', { contract: 'CharityPoints' })).address;
  console.log('  →', charity);

  console.log('[3/5] 部署 AnimalRescueLedger…');
  const rescue = (await post('/deploy', { contract: 'AnimalRescueLedger' })).address;
  console.log('  →', rescue);

  console.log('[4/5] 部署 AdoptionLedger 并建立合约间引用…');
  const adoption = (await post('/deploy', { contract: 'AdoptionLedger' })).address;
  console.log('  →', adoption);

  const admin = addressOf('admin');
  const shelter1 = addressOf('shelter1');
  const shelter2 = addressOf('shelter2');

  const inits = [
    ['AnimalRescueLedger', 'setPointsContract', [charity], rescue],
    ['AdoptionLedger', 'setPointsContract', [charity], adoption],
    ['AdoptionLedger', 'setRescueLedger', [rescue], adoption],
    ['AnimalRescueLedger', 'setShelter', [shelter1, true], rescue],
    ['AnimalRescueLedger', 'setShelter', [shelter2, true], rescue],
    ['AnimalRescueLedger', 'setAdmin', [adoption, true], rescue], // 允许领养合约回调 markAdopted
    ['AdoptionLedger', 'setShelter', [shelter1, true], adoption],
    ['AdoptionLedger', 'setShelter', [shelter2, true], adoption],
    ['AdoptionLedger', 'setAdmin', [shelter1, true], adoption]
  ];
  for (const [name, method, args, addr] of inits) {
    const r = await post('/send', { contract: name, method, args, address: addr });
    console.log('  ⛓️ ' + method + ' → 区块 #' + r.result.blockNumber);
  }

  console.log('[5/5] 回填前端配置 assets/js/config.js…');
  const cfgPath = path.join(ROOT, 'assets', 'js', 'config.js');
  let cfg = fs.readFileSync(cfgPath, 'utf8');
  cfg = cfg
    .replace(/driver: 'mock'/, "driver: 'fisco'")
    .replace(/rpcUrl: '[^']*'/, "rpcUrl: '" + RPC + "'")
    .replace(/relayerUrl: '[^']*'/, "relayerUrl: '" + RELAYER + "'")
    .replace(/charityPoints: '[^']*'/, "charityPoints: '" + charity + "'")
    .replace(/rescueLedger: '[^']*'/, "rescueLedger: '" + rescue + "'")
    .replace(/adoptionLedger: '[^']*'/, "adoptionLedger: '" + adoption + "'");
  fs.writeFileSync(cfgPath, cfg);

  console.log('\n🎉 部署完成');
  console.log('  CharityPoints       ', charity);
  console.log('  AnimalRescueLedger  ', rescue);
  console.log('  AdoptionLedger      ', adoption);
  console.log('\n前端已切换为 FISCO BCOS 模式（config.js: driver=fisco）。');
  console.log('若链不可达，页面会自动回退到内置模拟链。');
})().catch((e) => { console.error('部署失败：', e.message); process.exit(1); });
