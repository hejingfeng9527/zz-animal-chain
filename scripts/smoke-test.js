/**
 * smoke-test.js —— 无浏览器环境下跑通核心链路
 * 用法： node scripts/smoke-test.js
 * 覆盖：初始化 → 种子数据 → 线索上报 → 审核 → 流转 → 领养全流程 → 积分 → 存证校验
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---- 浏览器环境模拟 ----
const mem = {};
global.window = global;
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
if (!global.crypto || !global.crypto.subtle) {
  global.crypto = require('crypto').webcrypto;
}
global.document = { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {} } }) };

const files = ['hash', 'config', 'auth', 'notify', 'chain', 'seed', 'map', 'store'];
for (const f of files) {
  const code = fs.readFileSync(path.join(ROOT, 'assets', 'js', f + '.js'), 'utf8');
  new Function(code)();
}

const log = (...a) => console.log(...a);
const assert = (cond, msg) => {
  if (!cond) { console.error('❌ ' + msg); process.exitCode = 1; } else { log('  ✅ ' + msg); }
};

(async () => {
  log('\n=== 1. 初始化链与种子数据 ===');
  const stats = await global.ZZStore.init();
  log('  链状态:', JSON.stringify(stats));
  assert(stats.animalCount === 6, '种子数据写入 6 条动物档案');
  assert(stats.poiCount === 9, '种子数据写入 9 个地图点位');
  assert(stats.appCount === 3, '种子数据写入 3 条领养申请');

  log('\n=== 2. 存证哈希校验（种子数据） ===');
  const animals = await global.ZZStore.animals();
  let okCount = 0;
  for (const a of animals) {
    const v = await global.ZZStore.verifyAnimal(a);
    if (v.match) okCount++;
  }
  assert(okCount === animals.length, '全部 ' + animals.length + ' 条线索哈希可复现校验通过');

  log('\n=== 3. 上报 → 审核 → 流转 ===');
  const admin = global.ZZAuth.accounts[0];
  const user1 = global.ZZAuth.accounts[3];
  global.ZZAuth.set('user1');
  const rc1 = await global.ZZStore.report({
    species: '猫', title: '测试用例：惠济区受伤狸花猫', addressText: '惠济区开元路',
    lat: 34.8691, lng: 113.6411, severity: 3, desc: '疑似被异物划伤', contact: '13800000000', tags: ['测试']
  });
  assert(!!rc1.txHash && rc1.blockNumber > 0, '上报交易已上链，区块 #' + rc1.blockNumber);
  const newId = rc1.value;

  global.ZZAuth.set('admin');
  const rc2 = await global.ZZStore.reviewAnimal(newId, true, '核实通过');
  assert(rc2.status === 1, '管理员审核通过并上链');
  const rc3 = await global.ZZStore.setStatus(newId, 2, '已送入救助站');
  assert(rc3.status === 1, '状态流转（已入站）上链');
  const after = await global.ZZStore.animal(newId);
  assert(after.transfers.length >= 1, '生成 ' + after.transfers.length + ' 条链上流转记录');

  log('\n=== 4. 领养全流程 ===');
  await global.ZZStore.setStatus(newId, 4, '体检完成，转待领养');
  global.ZZAuth.set('user1');
  const rc4 = await global.ZZStore.applyAdoption(newId, { name: '小林', phone: '13800000000', agree: true });
  const appId = rc4.value;
  assert(!!appId, '领养申请已提交并上链，编号 #' + appId);

  global.ZZAuth.set('admin');
  await global.ZZStore.bgCheck(appId, true, '住房稳定，家庭同意');
  await global.ZZStore.reviewApplication(appId, true, '', '首月每周 1 次，共 4 次');
  await global.ZZStore.sign(appId);
  const before = await global.ZZStore.pointsOf(user1.addr);
  await global.ZZStore.addVisit(appId, '第一次回访：适应良好', true);
  await global.ZZStore.addVisit(appId, '第二次回访：饮食正常', true);
  await global.ZZStore.addVisit(appId, '第三次回访：疫苗完成', true);
  const rc5 = await global.ZZStore.completeAdoption(appId);
  assert(rc5.status === 1, '领养完成（回访 3 次达标）上链');

  const apps = await global.ZZStore.applications();
  const mine = apps.find(a => a.id === appId);
  assert(mine.stage === 5, '申请状态 = 已完成');
  assert(mine.visits.length === 3, '回访记录 3 条全部上链');
  const adopted = await global.ZZStore.animal(newId);
  assert(adopted.status === 5, '动物状态已更新为「已领养」，托管权移交 ' + adopted.guardianName);

  log('\n=== 5. 公益积分 ===');
  const after2 = await global.ZZStore.pointsOf(user1.addr);
  const gained = after2.balance - before.balance;
  assert(gained >= 15, '领养人获得积分 ' + gained + '（回访 5×3 + 完成 30，扣除流转等）');
  const board = await global.ZZStore.leaderboard();
  assert(board.length >= 2, '积分排行榜 ' + board.length + ' 个账户');

  log('\n=== 6. 弃养违约（防二次流浪） ===');
  const rc6 = await global.ZZStore.flagAbandon(appId, '测试：确认弃养');
  assert(rc6.status === 1, '弃养标记上链，扣减积分并把动物重新置为待领养');
  const recovered = await global.ZZStore.animal(newId);
  assert(recovered.status === 4, '动物已回到「待领养」状态');

  log('\n=== 7. 消息通知 ===');
  global.ZZAuth.set('user1');
  const msgs = global.ZZNotify.listFor(user1.addr);
  assert(msgs.length > 0, '生成 ' + msgs.length + ' 条站内消息（审核/领养/回访/积分）');

  log('\n=== 8. 区块浏览器数据 ===');
  const s2 = global.ZZChain.stats();
  assert(s2.height > 0 && s2.txCount > 0, '区块高度 #' + s2.height + '，交易 ' + s2.txCount + ' 笔');
  assert(global.ZZChain.blockAt(0) !== null, '创世块存在');

  log('\n=== 结果 ===');
  log(process.exitCode ? '❌ 存在失败项' : '🎉 全部冒烟用例通过');
})().catch(e => { console.error(e); process.exit(1); });
