/**
 * store.js —— 业务层：把链上数据整理成页面需要的形态
 * 所有写操作都经过 ZZChain.send，返回交易回执（txHash / blockNumber）
 */
(function (global) {
  'use strict';

  const C = () => global.ZZChain;
  const CFG = global.ZZ_CONFIG;

  function parseMeta(s) {
    if (!s) return {};
    try { const o = JSON.parse(s); return (o && typeof o === 'object') ? o : { desc: s }; }
    catch (e) { return { desc: s }; }
  }

  function decorate(a) {
    if (!a || !a.id) return null;
    const meta = parseMeta(a.metaURI);
    return Object.assign({}, a, {
      meta,
      lat: a.lat1e6 / 1e6,
      lng: a.lng1e6 / 1e6,
      statusText: CFG.STATUS[a.status] || '未知',
      severityText: CFG.SEVERITY[a.severity] || '未知',
      reporterName: global.ZZAuth.nameOf(a.reporter),
      shelterName: a.shelter && a.shelter !== '0x' + '0'.repeat(40) ? global.ZZAuth.nameOf(a.shelter) : '—',
      guardianName: a.guardian && a.guardian !== '0x' + '0'.repeat(40) ? global.ZZAuth.nameOf(a.guardian) : '—',
      timeText: fmtTs(a.createdAt)
    });
  }

  function fmtTs(sec) {
    if (!sec) return '—';
    const d = new Date(sec * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** 图片压缩为缩略图 dataURL（避免 localStorage 爆掉） */
  function thumbFile(file, maxSide) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      maxSide = maxSide || 480;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * scale);
          cv.height = Math.round(img.height * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const Store = {
    fmtTs,
    parseMeta,
    thumbFile,

    async init() {
      await C().init();
      if (CFG.chain.autoSeed) await global.ZZSeed.ensure();
      return C().stats();
    },

    /* ---------------- 动物档案 ---------------- */
    async animals() {
      const list = await C().call('rescueLedger', 'getAnimals', [0, 500]);
      return (list || []).map(decorate).filter(Boolean);
    },
    async animal(id) {
      const a = decorate(await C().call('rescueLedger', 'getAnimal', [Number(id)]));
      if (!a) return null;
      a.transfers = await C().call('rescueLedger', 'getTransfers', [Number(id)]);
      a.review = await C().call('rescueLedger', 'getReview', [Number(id)]);
      return a;
    },
    async transfers(id) { return await C().call('rescueLedger', 'getTransfers', [Number(id)]); },

    async pois() {
      const list = await C().call('rescueLedger', 'getPOIs', []);
      return (list || []).map((p) => Object.assign({}, p, {
        lat: p.lat1e6 / 1e6, lng: p.lng1e6 / 1e6,
        kindText: CFG.POI_KIND[p.kind] || '点位',
        ownerName: global.ZZAuth.nameOf(p.owner)
      }));
    },

    /** 上报线索：先算 SHA-256 存证哈希，再上链 */
    async report(form, file) {
      const me = global.ZZAuth.current();
      let photoHash = null, thumb = null;
      if (file) {
        thumb = await thumbFile(file);
        photoHash = await global.ZZHash.sha256Hex(file);
      }
      const payload = {
        species: form.species, title: form.title, addressText: form.addressText,
        lat: Number(form.lat), lng: Number(form.lng), severity: Number(form.severity),
        desc: form.desc, contact: form.contact, tags: form.tags || [], photoHash
      };
      const dataHash = await global.ZZHash.hashRecord(payload);
      const meta = {
        desc: form.desc, contact: form.contact, tags: form.tags || [],
        photoHash, thumb
      };
      const rc = await C().send('rescueLedger', 'reportAnimal', [{
        dataHash, metaURI: JSON.stringify(meta), species: form.species, title: form.title,
        lat1e6: Math.round(Number(form.lat) * 1e6), lng1e6: Math.round(Number(form.lng) * 1e6),
        addressText: form.addressText, severity: Number(form.severity)
      }], { from: me.addr });
      global.ZZNotify.fromTx(rc, { reporter: me.addr });
      return rc;
    },

    async reviewAnimal(id, approved, reason) {
      const me = global.ZZAuth.current();
      const a = await C().call('rescueLedger', 'getAnimal', [Number(id)]);
      const rc = await C().send('rescueLedger', 'reviewAnimal', [Number(id), approved, reason || ''], { from: me.addr });
      global.ZZNotify.fromTx(rc, { reporter: a && a.reporter });
      return rc;
    },

    async setStatus(id, status, note, file) {
      const me = global.ZZAuth.current();
      const evHash = file ? await global.ZZHash.sha256Hex(file)
        : await global.ZZHash.sha256Hex('status:' + id + ':' + status + ':' + (note || ''));
      const rc = await C().send('rescueLedger', 'updateStatus', [Number(id), Number(status), evHash, note || ''], { from: me.addr });
      global.ZZNotify.fromTx(rc, {});
      return rc;
    },

    async transfer(id, toAddr, status, note) {
      const me = global.ZZAuth.current();
      const evHash = await global.ZZHash.sha256Hex('transfer:' + id + ':' + toAddr + ':' + status);
      const rc = await C().send('rescueLedger', 'transferCustody', [Number(id), toAddr, Number(status), evHash, note || ''], { from: me.addr });
      global.ZZNotify.fromTx(rc, {});
      return rc;
    },

    /* ---------------- 领养 ---------------- */
    async applications() {
      const list = await C().call('adoptionLedger', 'getApplications', [0, 500]);
      const out = [];
      for (const app of (list || [])) {
        const animal = decorate(await C().call('rescueLedger', 'getAnimal', [app.animalId]));
        const visits = await C().call('adoptionLedger', 'getVisits', [app.id]);
        out.push(Object.assign({}, app, {
          stageText: CFG.STAGE[app.stage] || '未知',
          applicantName: global.ZZAuth.nameOf(app.applicant),
          animal: animal || { title: '#' + app.animalId },
          visits: visits || [],
          form: parseMeta(app.formURI),
          createdText: fmtTs(app.createdAt),
          signedText: app.signedAt ? fmtTs(app.signedAt) : '—'
        }));
      }
      return out;
    },

    async applyAdoption(animalId, form) {
      const me = global.ZZAuth.current();
      const formHash = await global.ZZHash.hashRecord(form);
      const rc = await C().send('adoptionLedger', 'applyFor', [Number(animalId), formHash, JSON.stringify(form)], { from: me.addr });
      global.ZZNotify.fromTx(rc, { applicant: me.addr });
      return rc;
    },

    async bgCheck(id, passed, note, file) {
      const me = global.ZZAuth.current();
      const hash = file ? await global.ZZHash.sha256Hex(file)
        : await global.ZZHash.sha256Hex('bg:' + id + ':' + (note || ''));
      const rc = await C().send('adoptionLedger', 'backgroundCheck', [Number(id), hash, passed, note || ''], { from: me.addr });
      const app = await C().call('adoptionLedger', 'getApplication', [Number(id)]);
      global.ZZNotify.fromTx(rc, { applicant: app && app.applicant });
      return rc;
    },

    async reviewApplication(id, approved, reason, plan) {
      const me = global.ZZAuth.current();
      const app = await C().call('adoptionLedger', 'getApplication', [Number(id)]);
      const rc = await C().send('adoptionLedger', 'reviewApplication',
        [Number(id), approved, reason || '', plan || ''], { from: me.addr });
      global.ZZNotify.fromTx(rc, { applicant: app && app.applicant });
      return rc;
    },

    async sign(id, file) {
      const me = global.ZZAuth.current();
      const app = await C().call('adoptionLedger', 'getApplication', [Number(id)]);
      const contractText = '领养协议 #' + id + ' | 动物 #' + (app ? app.animalId : '') +
        ' | 领养人 ' + (app ? app.applicant : '') + ' | 出借方 ' + me.addr;
      const hash = file ? await global.ZZHash.sha256Hex(file) : await global.ZZHash.sha256Hex(contractText);
      const rc = await C().send('adoptionLedger', 'signContract', [Number(id), hash], { from: me.addr });
      global.ZZNotify.fromTx(rc, { applicant: app && app.applicant });
      return rc;
    },

    async addVisit(id, note, passed, file) {
      const me = global.ZZAuth.current();
      const app = await C().call('adoptionLedger', 'getApplication', [Number(id)]);
      const hash = file ? await global.ZZHash.sha256Hex(file)
        : await global.ZZHash.sha256Hex('visit:' + id + ':' + Date.now());
      const rc = await C().send('adoptionLedger', 'addVisitRecord', [Number(id), hash, note || '', passed], { from: me.addr });
      global.ZZNotify.fromTx(rc, { applicant: app && app.applicant });
      return rc;
    },

    async completeAdoption(id) {
      const me = global.ZZAuth.current();
      const app = await C().call('adoptionLedger', 'getApplication', [Number(id)]);
      const rc = await C().send('adoptionLedger', 'completeAdoption', [Number(id)], { from: me.addr });
      global.ZZNotify.fromTx(rc, { applicant: app && app.applicant });
      return rc;
    },

    async flagAbandon(id, reason) {
      const me = global.ZZAuth.current();
      const app = await C().call('adoptionLedger', 'getApplication', [Number(id)]);
      const rc = await C().send('adoptionLedger', 'cancelOrFlag', [Number(id), true, reason || ''], { from: me.addr });
      global.ZZNotify.fromTx(rc, { applicant: app && app.applicant });
      return rc;
    },

    /* ---------------- 积分 ---------------- */
    async pointsOf(addr) {
      const [bal, earned, awards] = await Promise.all([
        C().call('charityPoints', 'balanceOf', [addr]),
        C().call('charityPoints', 'totalEarned', [addr]),
        C().call('charityPoints', 'awardsOf', [addr])
      ]);
      return { balance: bal || 0, earned: earned || 0, awards: awards || [] };
    },

    async leaderboard() {
      const rows = await C().call('charityPoints', 'leaderboard', [50]);
      return (rows || []).map((r, i) => Object.assign({}, r, {
        rank: i + 1, name: global.ZZAuth.nameOf(r.addr),
        awards: []
      }));
    },

    async awardPoints(addr, amount, reason) {
      const me = global.ZZAuth.current();
      const rc = await C().send('charityPoints', 'award', [addr, Number(amount), reason || '管理员发放'], { from: me.addr });
      global.ZZNotify.fromTx(rc, {});
      return rc;
    },

    /* ---------------- 存证校验 ---------------- */
    /** 用链上数据重建线索原文，重新计算哈希，比对是否被篡改 */
    async verifyAnimal(a) {
      const payload = {
        species: a.species, title: a.title, addressText: a.addressText,
        lat: Number((a.lat1e6 / 1e6).toFixed(6)), lng: Number((a.lng1e6 / 1e6).toFixed(6)),
        severity: a.severity, desc: a.meta.desc, contact: a.meta.contact,
        tags: a.meta.tags || [], photoHash: a.meta.photoHash || null
      };
      const recomputed = await global.ZZHash.hashRecord(payload);
      return { recomputed, onchain: a.dataHash, match: recomputed === a.dataHash };
    }
  };

  global.ZZStore = Store;
})(window);
