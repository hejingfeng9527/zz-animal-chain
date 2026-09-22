/**
 * compile.js —— 用 solc 编译合约，产出 ABI 与 bytecode 到 contracts/ 目录
 * 用法： npm i && npm run compile
 */
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const DIR = path.join(__dirname, '..', 'contracts');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sol'));
const sources = {};
for (const f of files) sources[f] = { content: fs.readFileSync(path.join(DIR, f), 'utf8') };

console.log('solc', solc.version(), '| 合约:', files.join(', '));
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
  }
})));

let failed = false;
for (const e of out.errors || []) {
  if (e.severity === 'error') { failed = true; console.error(e.formattedMessage); }
}
if (failed) process.exit(1);

for (const f in out.contracts) {
  for (const name in out.contracts[f]) {
    const bc = out.contracts[f][name].evm.bytecode.object;
    if (!bc) continue; // 跳过 interface
    fs.writeFileSync(path.join(DIR, name + '.abi.json'), JSON.stringify(out.contracts[f][name].abi, null, 2));
    fs.writeFileSync(path.join(DIR, name + '.bin'), bc);
    console.log('  ✅', name, '| bytecode', bc.length / 2, 'bytes');
  }
}
console.log('编译完成，ABI / bytecode 已写入 contracts/');
