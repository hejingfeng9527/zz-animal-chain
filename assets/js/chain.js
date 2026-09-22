/**
 * chain.js —— 链抽象层
 * 提供与 Solidity 合约一一对应的调用接口：
 *   ZZChain.send(contract, method, args, opts) -> receipt {txHash, blockNumber, status, logs}
 *   ZZChain.call(contract, method, args)       -> 返回值
 *
 * driver = 'mock'  : 内置模拟链，完整复刻合约逻辑，含区块 / 交易 / 事件日志 / SHA-256 存证
 * driver = 'fisco' : 通过本地 relayer 网关（scripts/relayer/server.js）连接 WSL2 中的 FISCO BCOS
 */
(function (global) {
  'use strict';

  const CFG = global.ZZ_CONFIG;
  const LS_KEY = 'zz.chain.v2'; // v2: 修复种子数据经纬度写反的问题，强制重新播种
  const ADDR0 = '0x' + '0'.repeat(40);
  const OWNER = global.ZZHash.addressOf('admin');

  const CONTRACT_KEY = { charityPoints: 'charity', rescueLedger: 'rescue', adoptionLedger: 'adoption' };

  let state = null;
  let driver = CFG.chain.driver || 'mock';

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function emptyState() {
    return {
      height: 0,
      blocks: [],
      txs: [],
      contracts: {
        charity: {
          address: global.ZZHash.addressOf('Contract.CharityPoints'),
          storage: {
            owner: OWNER, minters: { [OWNER]: true }, balances: {}, totalEarned: {},
            awards: [], awardIndex: {}, totalSupply: 0, awardCount: 0
          }
        },
        rescue: {
          address: global.ZZHash.addressOf('Contract.AnimalRescueLedger'),
          storage: {
            owner: OWNER, admins: { [OWNER]: true }, shelters: {},
            animalCount: 0, animals: {}, reviewOf: {}, transfers: {},
            poiCount: 0, pois: {}, urgentIndex: {}, pointsLinked: false
          }
        },
        adoption: {
          address: global.ZZHash.addressOf('Contract.AdoptionLedger'),
          storage: {
            owner: OWNER, admins: { [OWNER]: true }, shelters: {},
            appCount: 0, apps: {}, visits: {}, appsOfAnimal: {}, appsOfApplicant: {},
            rescueLinked: false
          }
        }
      }
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
  }

  // ---------------------------------------------------------------- 事件/积分内部工具

  function emit(logs, contract, event, args) { logs.push({ contract, event, args }); }

  function awardInternal(to, amount, reason, operator, ts, logs) {
    if (!to || to === ADDR0 || !amount) return;
    const c = state.contracts.charity.storage;
    c.balances[to] = (c.balances[to] || 0) + amount;
    c.totalEarned[to] = (c.totalEarned[to] || 0) + amount;
    c.totalSupply += amount;
    (c.awardIndex[to] = c.awardIndex[to] || []).push(c.awards.length);
    c.awards.push({ amount, reason, operator, ts });
    c.awardCount += 1;
    emit(logs, 'charity', 'PointsAwarded', { to, amount, reason, operator, ts });
  }

  function deductInternal(from, amount, reason, operator, ts, logs) {
    const c = state.contracts.charity.storage;
    const bal = c.balances[from] || 0;
    const real = Math.min(bal, amount);
    if (real === 0) return;
    c.balances[from] = bal - real;
    c.totalSupply -= real;
    (c.awardIndex[from] = c.awardIndex[from] || []).push(c.awards.length);
    c.awards.push({ amount: -real, reason, operator, ts });
    c.awardCount += 1;
    emit(logs, 'charity', 'PointsDeducted', { from, amount: real, reason, operator, ts });
  }

  // ---------------------------------------------------------------- 合约实现

  function toAnimal(a) {
    if (!a) return { id: 0, exists: false };
    return {
      id: a.id, dataHash: a.dataHash, metaURI: a.metaURI, species: a.species, title: a.title,
      lat1e6: a.lat1e6, lng1e6: a.lng1e6, addressText: a.addressText, severity: a.severity,
      urgent: a.urgent, status: a.status, reporter: a.reporter, shelter: a.shelter,
      guardian: a.guardian, reviewed: a.reviewed, createdAt: a.createdAt, updatedAt: a.updatedAt,
      exists: true
    };
  }

  const impl = {
    /* ===================== CharityPoints ===================== */
    charity: {
      owner(s) { return s.owner; },
      totalSupply(s) { return s.totalSupply; },
      awardCount(s) { return s.awardCount; },
      balanceOf(s, addr) { return s.balances[addr] || 0; },
      totalEarned(s, addr) { return s.totalEarned[addr] || 0; },
      awardsOf(s, addr) {
        const idx = s.awardIndex[addr] || [];
        return idx.map((i) => s.awards[i]);
      },
      setMinter(s, account, enabled, ctx) {
        require(ctx.from === s.owner, 'not owner');
        s.minters[account] = enabled;
        emit(ctx.logs, 'charity', 'MinterUpdated', { account, enabled });
        return null;
      },
      award(s, to, amount, reason, ctx) {
        require(s.minters[ctx.from] || ctx.from === s.owner, 'not minter');
        require(to !== ADDR0 && amount > 0, 'bad args');
        awardInternal(to, amount, reason, ctx.from, ctx.ts, ctx.logs);
        return null;
      },
      awardBatch(s, accounts, amounts, reason, ctx) {
        require(s.minters[ctx.from] || ctx.from === s.owner, 'not minter');
        accounts.forEach((a, i) => awardInternal(a, amounts[i], reason, ctx.from, ctx.ts, ctx.logs));
        return null;
      },
      deduct(s, from, amount, reason, ctx) {
        require(s.minters[ctx.from] || ctx.from === s.owner, 'not minter');
        deductInternal(from, amount, reason, ctx.from, ctx.ts, ctx.logs);
        return null;
      },
      leaderboard(s, limit) {
        const rows = Object.keys(s.totalEarned).map((addr) => ({
          addr, points: s.balances[addr] || 0, earned: s.totalEarned[addr] || 0
        }));
        rows.sort((a, b) => b.points - a.points || b.earned - a.earned);
        return rows.slice(0, limit || 50);
      }
    },

    /* ===================== AnimalRescueLedger ===================== */
    rescue: {
      owner(s) { return s.owner; },
      animalCount(s) { return s.animalCount; },
      poiCount(s) { return s.poiCount; },
      getAnimal(s, id) { return toAnimal(s.animals[id]); },
      getAnimals(s, offset, limit) {
        const out = [];
        for (let i = offset + 1; i <= Math.min(offset + limit, s.animalCount); i++) {
          if (s.animals[i]) out.push(toAnimal(s.animals[i]));
        }
        return out;
      },
      getReview(s, id) { return s.reviewOf[id] || null; },
      getTransfers(s, id) { return s.transfers[id] || []; },
      getPOI(s, id) { return s.pois[id] || null; },
      getPOIs(s) { return Object.keys(s.pois).map((k) => s.pois[k]); },

      setAdmin(s, account, enabled, ctx) {
        require(ctx.from === s.owner, 'not owner');
        s.admins[account] = enabled;
        emit(ctx.logs, 'rescue', 'AdminUpdated', { account, enabled });
        return null;
      },
      setShelter(s, account, enabled, ctx) {
        require(ctx.from === s.owner, 'not owner');
        s.shelters[account] = enabled;
        emit(ctx.logs, 'rescue', 'ShelterUpdated', { account, enabled });
        return null;
      },
      setPointsContract(s, _addr, ctx) {
        require(ctx.from === s.owner, 'not owner');
        s.pointsLinked = true;
        return null;
      },

      registerPOI(s, kind, name, addressText, lat1e6, lng1e6, contact, ctx) {
        const id = ++s.poiCount;
        s.pois[id] = {
          id, kind, name, addressText, lat1e6, lng1e6, contact,
          owner: ctx.from, active: true, ts: ctx.ts
        };
        emit(ctx.logs, 'rescue', 'POIRegistered', { id, kind, name, owner: ctx.from, ts: ctx.ts });
        return id;
      },
      setPOIActive(s, id, active, ctx) {
        requireAdmin(s, ctx.from);
        if (s.pois[id]) s.pois[id].active = active;
        return null;
      },

      reportAnimal(s, input, ctx) {
        require(input && input.dataHash && input.dataHash !== '0x' + '0'.repeat(64), 'empty hash');
        require(input && input.title, 'empty title');
        const id = ++s.animalCount;
        const urgent = Number(input.severity) >= 3;
        s.animals[id] = {
          id: id, dataHash: input.dataHash, metaURI: input.metaURI || '', species: input.species || '其他',
          title: input.title, lat1e6: input.lat1e6, lng1e6: input.lng1e6,
          addressText: input.addressText || '', severity: Number(input.severity) || 0,
          urgent: urgent, status: 0, reporter: ctx.from, shelter: ADDR0, guardian: ADDR0,
          reviewed: false, createdAt: ctx.ts, updatedAt: ctx.ts
        };
        if (urgent) s.urgentIndex[id] = id;
        emit(ctx.logs, 'rescue', 'AnimalReported',
          { id, reporter: ctx.from, dataHash: input.dataHash, severity: Number(input.severity) || 0, urgent, ts: ctx.ts });
        return id;
      },

      reviewAnimal(s, id, approved, reason, ctx) {
        requireAdmin(s, ctx.from);
        const a = s.animals[id];
        require(a, 'not exist');
        require(!a.reviewed, 'already reviewed');
        a.reviewed = true;
        a.status = approved ? 1 : 8;
        a.updatedAt = ctx.ts;
        s.reviewOf[id] = { reviewer: ctx.from, approved: !!approved, reason: reason || '', dataHash: a.dataHash, ts: ctx.ts };
        if (approved && s.pointsLinked) {
          awardInternal(a.reporter, CFG.points.REPORT_VERIFIED, 'REPORT_VERIFIED', ctx.from, ctx.ts, ctx.logs);
        }
        emit(ctx.logs, 'rescue', 'AnimalReviewed', { id, reviewer: ctx.from, approved: !!approved, reason: reason || '', ts: ctx.ts });
        return null;
      },

      updateStatus(s, id, newStatus, evidenceHash, note, ctx) {
        requirePrivileged(s, ctx.from);
        const a = s.animals[id];
        require(a, 'not exist');
        require(a.reviewed, 'not reviewed');
        const old = a.status;
        a.status = Number(newStatus);
        a.updatedAt = ctx.ts;
        if (Number(newStatus) === 2 && (!a.shelter || a.shelter === ADDR0)) {
          a.shelter = ctx.from;
          if (s.pointsLinked) awardInternal(ctx.from, CFG.points.SHELTER_INTAKE, 'SHELTER_INTAKE', ctx.from, ctx.ts, ctx.logs);
        }
        pushTransfer(s, id, ADDR0, ADDR0, old, a.status, evidenceHash, note, ctx);
        emit(ctx.logs, 'rescue', 'AnimalStatusUpdated',
          { id, fromStatus: old, toStatus: a.status, operator: ctx.from, evidenceHash, note, ts: ctx.ts });
        return null;
      },

      transferCustody(s, id, to, newStatus, evidenceHash, note, ctx) {
        requirePrivileged(s, ctx.from);
        const a = s.animals[id];
        require(a, 'not exist');
        require(to && to !== ADDR0, 'zero addr');
        const old = a.status;
        let from = a.guardian && a.guardian !== ADDR0 ? a.guardian : (a.shelter && a.shelter !== ADDR0 ? a.shelter : ctx.from);
        a.status = Number(newStatus);
        a.updatedAt = ctx.ts;
        if (Number(newStatus) === 5) a.guardian = to; else a.shelter = to;
        pushTransfer(s, id, from, to, old, a.status, evidenceHash, note, ctx);
        emit(ctx.logs, 'rescue', 'CustodyTransferred', { id, from, to, evidenceHash, ts: ctx.ts });
        return null;
      },

      markAdopted(s, id, guardian, contractHash, ctx) {
        requireAdmin(s, ctx.from);
        const a = s.animals[id];
        require(a, 'not exist');
        const old = a.status;
        a.status = 5;
        a.guardian = guardian;
        a.updatedAt = ctx.ts;
        pushTransfer(s, id, a.shelter, guardian, old, 5, contractHash, 'ADOPTION_SIGNED_CUSTODY_TRANSFER', ctx);
        emit(ctx.logs, 'rescue', 'CustodyTransferred', { id, from: a.shelter, to: guardian, evidenceHash: contractHash, ts: ctx.ts });
        if (s.pointsLinked) awardInternal(guardian, CFG.points.ADOPTION_SIGNED, 'ADOPTION_SIGNED', ctx.from, ctx.ts, ctx.logs);
        return null;
      }
    },

    /* ===================== AdoptionLedger ===================== */
    adoption: {
      owner(s) { return s.owner; },
      appCount(s) { return s.appCount; },
      getApplication(s, id) { return s.apps[id] || null; },
      getVisits(s, id) { return s.visits[id] || []; },
      visitCount(s, id) { return (s.visits[id] || []).length; },
      applicationsOfAnimal(s, animalId) { return s.appsOfAnimal[animalId] || []; },
      applicationsOfApplicant(s, addr) { return s.appsOfApplicant[addr] || []; },
      getApplications(s, offset, limit) {
        const out = [];
        for (let i = offset + 1; i <= Math.min(offset + limit, s.appCount); i++) {
          if (s.apps[i]) out.push(s.apps[i]);
        }
        return out;
      },
      setAdmin(s, account, enabled, ctx) {
        require(ctx.from === s.owner, 'not owner');
        s.admins[account] = enabled; return null;
      },
      setShelter(s, account, enabled, ctx) {
        require(ctx.from === s.owner, 'not owner');
        s.shelters[account] = enabled; return null;
      },
      setPointsContract(s, _a, ctx) { require(ctx.from === s.owner, 'not owner'); return null; },
      setRescueLedger(s, _a, ctx) {
        require(ctx.from === s.owner, 'not owner');
        s.rescueLinked = true; return null;
      },

      applyFor(s, animalId, formHash, formURI, ctx) {
        require(formHash && formHash !== '0x' + '0'.repeat(64), 'empty form hash');
        const id = ++s.appCount;
        s.apps[id] = {
          id, animalId: Number(animalId), applicant: ctx.from, formHash, formURI: formURI || '',
          bgCheckHash: null, bgPassed: false, bgNote: '', stage: 0, reviewer: ADDR0,
          rejectReason: '', visitPlan: '', contractHash: null, shelter: ADDR0,
          createdAt: ctx.ts, updatedAt: ctx.ts, signedAt: 0, completedAt: 0, exists: true
        };
        (s.appsOfAnimal[animalId] = s.appsOfAnimal[animalId] || []).push(id);
        (s.appsOfApplicant[ctx.from] = s.appsOfApplicant[ctx.from] || []).push(id);
        emit(ctx.logs, 'adoption', 'ApplicationSubmitted', { id, animalId: Number(animalId), applicant: ctx.from, formHash, ts: ctx.ts });
        return id;
      },

      backgroundCheck(s, id, bgCheckHash, passed, note, ctx) {
        requireAdmin(s, ctx.from);
        const a = s.apps[id];
        require(a, 'not exist');
        require(a.stage === 0 || a.stage === 1, 'bad stage');
        a.bgCheckHash = bgCheckHash;
        a.bgPassed = !!passed;
        a.bgNote = note || '';
        a.stage = 1;
        a.updatedAt = ctx.ts;
        emit(ctx.logs, 'adoption', 'BackgroundChecked', { id, operator: ctx.from, passed: !!passed, bgCheckHash, note, ts: ctx.ts });
        return null;
      },

      reviewApplication(s, id, approved, reason, visitPlan, ctx) {
        requireAdmin(s, ctx.from);
        const a = s.apps[id];
        require(a, 'not exist');
        require(a.stage === 0 || a.stage === 1, 'bad stage');
        a.reviewer = ctx.from;
        a.updatedAt = ctx.ts;
        if (approved) {
          a.stage = 2; a.visitPlan = visitPlan || '';
        } else {
          require(reason, 'reject reason required');
          a.stage = 3; a.rejectReason = reason;
        }
        emit(ctx.logs, 'adoption', 'ApplicationReviewed',
          { id, reviewer: ctx.from, approved: !!approved, reason: reason || '', visitPlan: visitPlan || '', ts: ctx.ts });
        return null;
      },

      signContract(s, id, contractHash, ctx) {
        requirePrivileged(s, ctx.from);
        const a = s.apps[id];
        require(a, 'not exist');
        require(a.stage === 2, 'not approved');
        require(contractHash, 'empty contract hash');
        a.stage = 4;
        a.contractHash = contractHash;
        a.signedAt = ctx.ts;
        a.updatedAt = ctx.ts;
        a.shelter = ctx.from;
        const rescue = state.contracts.rescue.storage;
        const an = rescue.animals[a.animalId];
        if (an) {
          const old = an.status;
          an.status = 5; an.guardian = a.applicant; an.updatedAt = ctx.ts;
          pushTransfer(rescue, a.animalId, an.shelter, a.applicant, old, 5, contractHash, 'ADOPTION_SIGNED_CUSTODY_TRANSFER', ctx);
          emit(ctx.logs, 'rescue', 'CustodyTransferred', { id: a.animalId, from: an.shelter, to: a.applicant, evidenceHash: contractHash, ts: ctx.ts });
          if (rescue.pointsLinked) awardInternal(a.applicant, CFG.points.ADOPTION_SIGNED, 'ADOPTION_SIGNED', ctx.from, ctx.ts, ctx.logs);
        }
        emit(ctx.logs, 'adoption', 'AdoptionSigned', { id, animalId: a.animalId, applicant: a.applicant, contractHash, ts: ctx.ts });
        return null;
      },

      addVisitRecord(s, id, evidenceHash, note, passed, ctx) {
        requirePrivileged(s, ctx.from);
        const a = s.apps[id];
        require(a, 'not exist');
        require(a.stage === 4, 'not signed');
        const round = (s.visits[id] || []).length + 1;
        (s.visits[id] = s.visits[id] || []).push({
          appId: id, recorder: ctx.from, evidenceHash, note: note || '',
          passed: !!passed, round, ts: ctx.ts
        });
        a.updatedAt = ctx.ts;
        if (passed) awardInternal(a.applicant, CFG.points.VISIT_PASSED, 'VISIT_PASSED', ctx.from, ctx.ts, ctx.logs);
        emit(ctx.logs, 'adoption', 'VisitRecorded', { id, recorder: ctx.from, round, evidenceHash, passed: !!passed, ts: ctx.ts });
        return null;
      },

      completeAdoption(s, id, ctx) {
        requireAdmin(s, ctx.from);
        const a = s.apps[id];
        require(a, 'not exist');
        require(a.stage === 4, 'not signed');
        require((s.visits[id] || []).length >= 3, 'visits not enough');
        a.stage = 5; a.completedAt = ctx.ts; a.updatedAt = ctx.ts;
        awardInternal(a.applicant, CFG.points.ADOPTION_COMPLETED, 'ADOPTION_COMPLETED', ctx.from, ctx.ts, ctx.logs);
        emit(ctx.logs, 'adoption', 'AdoptionCompleted', { id, applicant: a.applicant, ts: ctx.ts });
        return null;
      },

      cancelOrFlag(s, id, isAbandon, reason, ctx) {
        requireAdmin(s, ctx.from);
        const a = s.apps[id];
        require(a, 'not exist');
        require(a.stage === 4 || a.stage === 5, 'not active');
        a.stage = 6; a.rejectReason = reason || ''; a.updatedAt = ctx.ts;
        if (isAbandon) {
          deductInternal(a.applicant, CFG.points.ABANDON_PENALTY, 'ABANDON_PENALTY', ctx.from, ctx.ts, ctx.logs);
          const rescue = state.contracts.rescue.storage;
          const an = rescue.animals[a.animalId];
          if (an) {
            const old = an.status;
            an.status = 4; an.guardian = ADDR0; an.updatedAt = ctx.ts;
            pushTransfer(rescue, a.animalId, a.applicant, an.shelter, old, 4, null, 'ABANDON_RECOVER_TO_ADOPTABLE', ctx);
            emit(ctx.logs, 'rescue', 'AnimalStatusUpdated',
              { id: a.animalId, fromStatus: old, toStatus: 4, operator: ctx.from, evidenceHash: null, note: 'ABANDON_RECOVER_TO_ADOPTABLE', ts: ctx.ts });
          }
          emit(ctx.logs, 'adoption', 'AbandonFlagged', { id, applicant: a.applicant, reason: reason || '', ts: ctx.ts });
        }
        emit(ctx.logs, 'adoption', 'AdoptionCancelled', { id, applicant: a.applicant, reason: reason || '', ts: ctx.ts });
        return null;
      }
    }
  };

  function require(cond, msg) { if (!cond) throw new Error('revert: ' + msg); }
  function requireAdmin(s, from) { require(s.admins[from] || from === s.owner, 'not admin'); }
  function requirePrivileged(s, from) {
    require(s.admins[from] || s.shelters[from] || from === s.owner, 'not privileged');
  }
  function pushTransfer(s, id, from, to, fromStatus, toStatus, evidenceHash, note, ctx) {
    (s.transfers[id] = s.transfers[id] || []).push({
      from, to, fromStatus, toStatus, evidenceHash: evidenceHash || null,
      note: note || '', operator: ctx.from, ts: ctx.ts
    });
  }

  // ---------------------------------------------------------------- 执行引擎

  function isView(method) {
    return /^(get|balanceOf|totalEarned|totalSupply|awardCount|animalCount|poiCount|owner|applicationsOf|visitCount|leaderboard|awardsOf)/.test(method);
  }

  async function execute(contractKey, method, args, from) {
    const c = state.contracts[contractKey];
    const fn = impl[contractKey][method];
    if (!fn) throw new Error('unknown method: ' + contractKey + '.' + method);
    const ctx = { from: from || OWNER, ts: nowSec(), logs: [] };
    const value = fn(c.storage, ...(args || []), ctx);
    return { value: value === undefined ? null : value, logs: ctx.logs, ts: ctx.ts };
  }

  async function send(contract, method, args, opts) {
    opts = opts || {};
    const key = CONTRACT_KEY[contract] || contract;
    if (driver === 'fisco') {
      try { return await remoteSend(contract, method, args, opts); }
      catch (e) {
        console.warn('[chain] fisco 调用失败，回退 mock：', e.message);
        driver = 'mock';
      }
    }
    const from = opts.from || OWNER;
    const res = await execute(key, method, args, from);
    const block = await mine([{ contract: key, method, args, from, logs: res.logs, ts: res.ts }]);
    const tx = block.txs[0];
    persist();
    return {
      txHash: tx.hash, blockNumber: block.height, status: tx.status,
      logs: res.logs, ts: res.ts, gasUsed: tx.gasUsed, value: res.value
    };
  }

  async function call(contract, method, args, from) {
    const key = CONTRACT_KEY[contract] || contract;
    if (driver === 'fisco') {
      try { return await remoteCall(contract, method, args); }
      catch (e) {
        console.warn('[chain] fisco 读取失败，回退 mock：', e.message);
        driver = 'mock';
      }
    }
    const snapshot = JSON.stringify(state.contracts);
    const res = await execute(key, method, args, from || OWNER);
    state.contracts = JSON.parse(snapshot); // 只读调用：回滚状态
    return res.value;
  }

  /** 打包出块 */
  async function mine(entries) {
    const parent = state.blocks.length ? state.blocks[state.blocks.length - 1].hash : '0x' + '0'.repeat(64);
    const height = state.height + 1;
    const ts = nowSec();
    const txs = [];
    for (const e of entries) {
      const payload = global.ZZHash.canonical({
        h: height, p: parent, c: e.contract, m: e.method, a: e.args, f: e.from, t: e.ts
      });
      const hash = await global.ZZHash.sha256Hex(payload + ':' + txs.length);
      txs.push({
        hash, from: e.from, to: state.contracts[e.contract].address, contract: e.contract,
        method: e.method, args: e.args || [], blockNumber: height, ts: e.ts,
        status: 1, gasUsed: 21000 + ((global.ZZHash.syncHex(hash).charCodeAt(0) % 40) * 1000), logs: e.logs || []
      });
    }
    const blockHash = await global.ZZHash.sha256Hex(
      global.ZZHash.canonical({ height, parent, ts, txHashes: txs.map((t) => t.hash) })
    );
    const block = { height, hash: blockHash, parentHash: parent, ts, txCount: txs.length, txs, size: JSON.stringify(txs).length };
    state.height = height;
    state.blocks.push(block);
    state.txs.push(...txs);
    if (state.blocks.length > 500) state.blocks = state.blocks.slice(-500);
    if (state.txs.length > 2000) state.txs = state.txs.slice(-2000);
    return block;
  }

  /** 创世块 */
  async function ensureGenesis() {
    if (state.blocks.length) return;
    const genesis = await global.ZZHash.sha256Hex('ZZ-Rescue-Genesis-Zhengzhou');
    state.blocks.push({
      height: 0, hash: genesis, parentHash: '0x' + '0'.repeat(64), ts: nowSec(),
      txCount: 0, txs: [], size: 0
    });
    state.height = 0;
  }

  // ---------------------------------------------------------------- FISCO relayer

  async function remoteCall(contract, method, args) {
    const r = await fetch(CFG.chain.relayerUrl + '/call', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract, method, args: args || [] })
    });
    if (!r.ok) throw new Error('relayer ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  }

  async function remoteSend(contract, method, args, opts) {
    const r = await fetch(CFG.chain.relayerUrl + '/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract, method, args: args || [], from: (opts || {}).from })
    });
    if (!r.ok) throw new Error('relayer ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  }

  // ---------------------------------------------------------------- 对外 API

  const ZZChain = {
    get driver() { return driver; },

    async init() {
      state = load();
      if (!state) { state = emptyState(); await ensureGenesis(); persist(); }
      if (driver === 'fisco') {
        try {
          const r = await fetch(CFG.chain.relayerUrl + '/health');
          if (!r.ok) throw new Error('bad');
          const j = await r.json();
          console.log('[chain] 已连接 FISCO BCOS:', j);
        } catch (e) {
          console.warn('[chain] relayer 不可用，使用内置模拟链');
          driver = 'mock';
        }
      }
      // 跨合约引用（等价于 setPointsContract / setRescueLedger）
      if (!state.contracts.rescue.storage.pointsLinked) {
        state.contracts.rescue.storage.pointsLinked = true; persist();
      }
      return driver;
    },

    send, call,

    /** 批量发送（一次交易内多笔写操作，仅 mock 模式支持） */
    async sendBatch(ops, opts) {
      if (driver === 'fisco') {
        for (const op of ops) await send(op.contract, op.method, op.args, opts);
        return true;
      }
      const from = (opts && opts.from) || OWNER;
      const ts = nowSec();
      const entries = [];
      for (const op of ops) {
        const key = CONTRACT_KEY[op.contract] || op.contract;
        const res = await execute(key, op.method, op.args, from);
        entries.push({ contract: key, method: op.method, args: op.args, from, logs: res.logs, ts });
      }
      await mine(entries);
      persist();
      return true;
    },

    blocks(limit) {
      const b = state.blocks.slice().reverse();
      return (limit ? b.slice(0, limit) : b);
    },
    blockAt(height) { return state.blocks.find((b) => b.height === Number(height)) || null; },
    tx(hash) { return state.txs.find((t) => t.hash === hash) || null; },
    txsOf(address) {
      return state.txs.filter((t) => t.from === address).reverse();
    },
    recentTxs(limit) {
      return state.txs.slice().reverse().slice(0, limit || 20);
    },
    stats() {
      const addrs = new Set();
      state.txs.forEach((t) => addrs.add(t.from));
      return {
        height: state.height,
        txCount: state.txs.length,
        addressCount: addrs.size,
        animalCount: state.contracts.rescue.storage.animalCount,
        poiCount: state.contracts.rescue.storage.poiCount,
        appCount: state.contracts.adoption.storage.appCount,
        pointsSupply: state.contracts.charity.storage.totalSupply,
        driver
      };
    },
    addresses() {
      return {
        charity: state.contracts.charity.address,
        rescue: state.contracts.rescue.address,
        adoption: state.contracts.adoption.address
      };
    },
    owner: OWNER,
    /** 直接读写内部状态（仅初始化种子数据使用） */
    _state() { return state; },
    _persist: persist,
    async reset() {
      state = emptyState();
      await ensureGenesis();
      persist();
    }
  };

  global.ZZChain = ZZChain;
})(window);
