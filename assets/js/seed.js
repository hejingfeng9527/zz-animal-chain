/**
 * seed.js —— 郑州本地种子数据（首次访问时写入链上，便于直接体验全流程）
 */
(function (global) {
  'use strict';

  const A = () => global.ZZAuth.accounts;
  const adminAddr = () => A()[0].addr;
  const shelter1 = () => A()[1].addr;
  const shelter2 = () => A()[2].addr;
  const user1 = () => A()[3].addr;
  const user2 = () => A()[4].addr;

  const POIS = [
    { kind: 1, name: '郑州市小动物保护协会救助站', addressText: '惠济区大河路中段', lat: 34.8765, lng: 113.6123, contact: '0371-6xxxxx01' },
    { kind: 1, name: '二七区毛毛雨救助小院', addressText: '二七区侯寨乡', lat: 34.6854, lng: 113.5987, contact: '0371-6xxxxx02' },
    { kind: 1, name: '中原区暖爪救助站', addressText: '中原区西流湖路', lat: 34.7621, lng: 113.5654, contact: '0371-6xxxxx03' },
    { kind: 2, name: '康旭宠物医院（金水店）', addressText: '金水区花园路 128 号', lat: 34.7865, lng: 113.6852, contact: '0371-6xxxxx11' },
    { kind: 2, name: '瑞派宠物医院（郑东新区店）', addressText: '郑东新区商务内环', lat: 34.7712, lng: 113.7623, contact: '0371-6xxxxx12' },
    { kind: 2, name: '安安宠医（高新区店）', addressText: '高新区科学大道', lat: 34.8102, lng: 113.5521, contact: '0371-6xxxxx13' },
    { kind: 3, name: '人民公园投喂点', addressText: '金水区人民公园东门', lat: 34.7598, lng: 113.6652, contact: '志愿者轮值' },
    { kind: 3, name: '郑州大学南校区投喂点', addressText: '二七区大学北路', lat: 34.7490, lng: 113.6403, contact: '校园动保社团' },
    { kind: 3, name: '东风渠滨河公园投喂点', addressText: '金水区东风渠北岸', lat: 34.8100, lng: 113.6940, contact: '志愿者轮值' }
  ];

  const ANIMALS = [
    {
      from: user1, species: '猫', title: '金水区花园路受伤橘猫',
      addressText: '金水区花园路与农业路交叉口', lat: 34.7993, lng: 113.6764, severity: 1,
      meta: { desc: '右后腿疑似骨折，躲在绿化带，精神尚可，怕生。', contact: '138xxxx2101', tags: ['受伤', '怕生'] }
    },
    {
      from: user2, species: '犬', title: '二七广场重伤白色小型犬',
      addressText: '二七区二七广场地铁口', lat: 34.7477, lng: 113.6339, severity: 3,
      meta: { desc: '被车撞伤，后肢无法站立，有出血，情况危急，急需送医。', contact: '139xxxx3320', tags: ['重伤', '紧急', '需送医'] }
    },
    {
      from: user1, species: '猫', title: '中原万达三花猫（亲人）',
      addressText: '中原区万达广场北侧', lat: 34.7469, lng: 113.6029, severity: 0,
      meta: { desc: '约 1 岁，已驱虫，亲人可抱，适合家庭领养。', contact: '138xxxx2101', tags: ['亲人', '已驱虫', '待领养'] }
    },
    {
      from: user2, species: '猫', title: '如意湖畔奶牛猫（疑似猫癣）',
      addressText: '郑东新区如意湖文化广场', lat: 34.7695, lng: 113.7507, severity: 2,
      meta: { desc: '耳朵附近脱毛，疑似猫癣，正在药浴治疗中。', contact: '139xxxx3320', tags: ['患病', '治疗中'] }
    },
    {
      from: user1, species: '犬', title: '高新区流浪田园犬「大黄」',
      addressText: '高新区科学大道与长椿路', lat: 34.8038, lng: 113.5461, severity: 0,
      meta: { desc: '成年雄性，已免疫，性格温顺，已完成领养签约。', contact: '138xxxx2101', tags: ['已免疫', '已领养'] }
    },
    {
      from: user2, species: '猫', title: '管城区商城路幼猫（约 2 月）',
      addressText: '管城区商城路与紫荆山路', lat: 34.7520, lng: 113.6740, severity: 1,
      meta: { desc: '纸箱内发现 3 只幼猫，其中 1 只眼睛发炎。', contact: '139xxxx3320', tags: ['幼崽', '待审核'] }
    }
  ];

  async function ensure() {
    if (localStorage.getItem('zz.seeded') === 'v1') return false;
    const C = global.ZZChain;
    const st = C._state().contracts.rescue.storage;
    if (st.poiCount > 0 || st.animalCount > 0) {
      localStorage.setItem('zz.seeded', 'v1');
      return false;
    }

    // 1. 角色授权
    await C.sendBatch([
      { contract: 'rescueLedger', method: 'setShelter', args: [shelter1(), true] },
      { contract: 'rescueLedger', method: 'setShelter', args: [shelter2(), true] },
      { contract: 'adoptionLedger', method: 'setShelter', args: [shelter1(), true] },
      { contract: 'adoptionLedger', method: 'setShelter', args: [shelter2(), true] },
      { contract: 'adoptionLedger', method: 'setAdmin', args: [shelter1(), true] }
    ], { from: adminAddr() });

    // 2. 点位上链
    for (const p of POIS) {
      await C.send('rescueLedger', 'registerPOI',
        [p.kind, p.name, p.addressText, Math.round(p.lat * 1e6), Math.round(p.lng * 1e6), p.contact],
        { from: p.kind === 1 ? shelter1() : adminAddr() });
    }

    // 3. 线索上报（含 SHA-256 存证）
    const ids = [];
    for (const a of ANIMALS) {
      const payload = {
        species: a.species, title: a.title, addressText: a.addressText,
        lat: a.lat, lng: a.lng, severity: a.severity,
        desc: a.meta.desc, contact: a.meta.contact, tags: a.meta.tags, photoHash: null
      };
      const dataHash = await global.ZZHash.hashRecord(payload);
      const rc = await C.send('rescueLedger', 'reportAnimal', [{
        dataHash, metaURI: JSON.stringify(a.meta), species: a.species, title: a.title,
        lat1e6: Math.round(a.lat * 1e6), lng1e6: Math.round(a.lng * 1e6),
        addressText: a.addressText, severity: a.severity
      }], { from: a.from() });
      ids.push(rc.value);
    }

    // 4. 管理员审核：#1 #2 保留待审核（含 1 条紧急），其余通过
    const approveIdx = [0, 2, 3, 4];
    for (const i of approveIdx) {
      await C.send('rescueLedger', 'reviewAnimal', [ids[i], true, '现场核实，情况属实'], { from: adminAddr() });
    }
    // #4 驳回一条：重复线索
    await C.send('rescueLedger', 'reviewAnimal', [ids[5], false, '与 #' + ids[0] + ' 为同一地点重复上报'], { from: adminAddr() });

    // 5. 流转：入站 / 救治 / 待领养 / 已领养
    await C.send('rescueLedger', 'updateStatus', [ids[0], 2, await h('入站交接单-A1'), '已送入郑州市小动物保护协会救助站'], { from: shelter1() });
    await C.send('rescueLedger', 'updateStatus', [ids[2], 2, await h('入站交接单-A3'), '已入站，健康状态良好'], { from: shelter1() });
    await C.send('rescueLedger', 'updateStatus', [ids[2], 4, await h('体检报告-A3'), '体检完成，转为待领养'], { from: shelter1() });
    await C.send('rescueLedger', 'updateStatus', [ids[3], 2, await h('入站交接单-A4'), '入站并送医'], { from: shelter2() });
    await C.send('rescueLedger', 'updateStatus', [ids[3], 3, await h('诊断书-A4'), '猫癣药浴治疗中'], { from: shelter2() });
    await C.send('rescueLedger', 'updateStatus', [ids[4], 2, await h('入站交接单-A5'), '入站'], { from: shelter1() });
    await C.send('rescueLedger', 'updateStatus', [ids[4], 4, await h('免疫记录-A5'), '完成免疫，待领养'], { from: shelter1() });

    // 6. 领养流程（A5 已完成签约 + 2 次回访；A3 有一条待签约申请）
    const form1 = { name: '张先生', phone: '139xxxx3320', address: '中原区', house: '自有住房', experience: '养过 2 只猫', agree: true };
    const rApp1 = await C.send('adoptionLedger', 'applyFor',
      [ids[4], await global.ZZHash.hashRecord(form1), JSON.stringify(form1)], { from: user2() });
    const app1Id = rApp1.value;

    await C.send('adoptionLedger', 'backgroundCheck', [app1Id, await h('背景核验-App1'), true, '住房稳定，家庭成员同意，无弃养记录'], { from: adminAddr() });
    await C.send('adoptionLedger', 'reviewApplication', [app1Id, true, '', '首月每周 1 次，之后每月 1 次，共 6 次'], { from: adminAddr() });
    await C.send('adoptionLedger', 'signContract', [app1Id, await h('领养协议-App1-大黄')], { from: shelter1() });
    await C.send('adoptionLedger', 'addVisitRecord', [app1Id, await h('回访记录-App1-第1次'), '新家适应良好，饮食正常', true], { from: adminAddr() });
    await C.send('adoptionLedger', 'addVisitRecord', [app1Id, await h('回访记录-App1-第2次'), '已完成体内驱虫，疫苗第二针', true], { from: adminAddr() });

    const form2 = { name: '小林', phone: '138xxxx2101', address: '金水区', house: '租房（房东同意）', experience: '首次养猫', agree: true };
    const rApp2 = await C.send('adoptionLedger', 'applyFor',
      [ids[2], await global.ZZHash.hashRecord(form2), JSON.stringify(form2)], { from: user1() });
    const app2Id = rApp2.value;
    await C.send('adoptionLedger', 'backgroundCheck', [app2Id, await h('背景核验-App2'), true, '房东已书面同意饲养'], { from: adminAddr() });
    await C.send('adoptionLedger', 'reviewApplication', [app2Id, true, '', '首月每周 1 次，共 4 次'], { from: adminAddr() });

    const form3 = { name: '王同学', phone: '137xxxx8899', address: '高新区学生宿舍', house: '集体宿舍', experience: '无', agree: true };
    const rApp3 = await C.send('adoptionLedger', 'applyFor',
      [ids[3], await global.ZZHash.hashRecord(form3), JSON.stringify(form3)], { from: user2() });
    const app3Id = rApp3.value;
    await C.send('adoptionLedger', 'reviewApplication', [app3Id, false, '集体宿舍不具备饲养条件，且动物仍在治疗中', ''], { from: adminAddr() });

    // 7. 公益积分
    await C.send('charityPoints', 'award', [user1(), 15, '参与周末街面巡查'], { from: adminAddr() });
    await C.send('charityPoints', 'award', [user2(), 8, '提供临时寄养'], { from: adminAddr() });

    localStorage.setItem('zz.seeded', 'v1');
    return true;
  }

  async function h(s) { return global.ZZHash.sha256Hex('seed:' + s); }

  global.ZZSeed = { ensure, POIS, ANIMALS };
})(window);
