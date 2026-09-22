/**
 * notify.js —— 站内消息通知（审核结果 / 紧急求助推送 / 领养回访提醒）
 * 说明：消息体存本地，触发源为链上事件（tx.logs），链上留痕、站内提醒。
 */
(function (global) {
  'use strict';

  const KEY = 'zz.notify.v1';

  function all() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

  const TYPE = {
    review: { label: '审核结果', icon: '✅' },
    urgent: { label: '紧急求助', icon: '🚨' },
    adoption: { label: '领养进度', icon: '🐾' },
    visit: { label: '回访提醒', icon: '📅' },
    points: { label: '公益积分', icon: '⭐' },
    system: { label: '系统', icon: '🔔' }
  };

  const Notify = {
    TYPE,

    /** to 为空表示广播给管理员 */
    push(to, type, title, body, link) {
      const list = all();
      list.unshift({
        id: 'm' + Date.now() + Math.random().toString(16).slice(2, 6),
        to: to || 'ADMIN',
        type, title, body: body || '', link: link || '',
        ts: Date.now(), read: false
      });
      save(list.slice(0, 300));
      Notify.refreshBadge();
    },

    listFor(addr) {
      const me = global.ZZAuth.current();
      const isAdmin = me.role === 'admin' || me.role === 'shelter';
      return all().filter((m) => m.to === addr || (isAdmin && m.to === 'ADMIN') || m.to === 'ALL');
    },

    unreadCount(addr) {
      return Notify.listFor(addr).filter((m) => !m.read).length;
    },

    markRead(id) {
      const list = all();
      const m = list.find((x) => x.id === id);
      if (m) { m.read = true; save(list); Notify.refreshBadge(); }
    },

    markAllRead(addr) {
      const list = all();
      list.forEach((m) => { if (m.to === addr || m.to === 'ADMIN' || m.to === 'ALL') m.read = true; });
      save(list);
      Notify.refreshBadge();
    },

    clear(addr) {
      const me = global.ZZAuth.current();
      const isAdmin = me.role === 'admin' || me.role === 'shelter';
      save(all().filter((m) => !(m.to === addr || (isAdmin && m.to === 'ADMIN') || m.to === 'ALL')));
      Notify.refreshBadge();
    },

    refreshBadge() {
      const el = document.getElementById('msgBadge');
      if (!el) return;
      const n = Notify.unreadCount(global.ZZAuth.current().addr);
      el.textContent = n > 99 ? '99+' : n;
      el.style.display = n > 0 ? 'inline-flex' : 'none';
    },

    /** 把一次交易的事件翻译成站内消息 */
    fromTx(rc, ctx) {
      (rc.logs || []).forEach((log) => {
        if (log.event === 'AnimalReported') {
          const a = log.args;
          if (a.urgent) {
            Notify.push('ADMIN', 'urgent', '【紧急】重伤/病危动物待审核 #' + a.id,
              '有用户上报了重伤病危流浪动物，请优先审核并派单。', 'admin.html#review');
          } else {
            Notify.push('ADMIN', 'review', '新线索待审核 #' + a.id,
              '有新的流浪动物线索等待核实。', 'admin.html#review');
          }
        }
        if (log.event === 'AnimalReviewed') {
          const a = log.args;
          Notify.push(ctx && ctx.reporter, 'review',
            a.approved ? '线索 #' + a.id + ' 审核通过' : '线索 #' + a.id + ' 审核未通过',
            a.approved ? '感谢你提供的线索，已核实通过，公益积分 +10。' : ('原因：' + (a.reason || '未说明')),
            'animals.html?id=' + a.id);
        }
        if (log.event === 'ApplicationSubmitted') {
          Notify.push('ADMIN', 'adoption', '新的领养申请 #' + log.args.id,
            '有用户提交了领养申请，请进行背景核验与审核。', 'admin.html#adoption');
        }
        if (log.event === 'BackgroundChecked') {
          Notify.push('ADMIN', 'adoption', '领养申请 #' + log.args.id + ' 背景核验完成',
            (log.args.passed ? '核验通过：' : '核验未通过：') + (log.args.note || ''), 'admin.html#adoption');
        }
        if (log.event === 'ApplicationReviewed') {
          const a = log.args;
          Notify.push(ctx && ctx.applicant, 'adoption',
            a.approved ? '领养申请 #' + a.id + ' 审核通过' : '领养申请 #' + a.id + ' 被驳回',
            a.approved ? ('回访计划：' + (a.visitPlan || '—') + '。请尽快前往签约。')
              : ('驳回理由：' + (a.reason || '未说明')),
            'adoption.html#mine');
        }
        if (log.event === 'AdoptionSigned') {
          Notify.push(ctx && ctx.applicant, 'adoption', '领养协议已签约 #' + log.args.id,
            '托管权已移交，协议哈希已上链。请按回访计划配合回访。', 'adoption.html#mine');
          Notify.push('ADMIN', 'visit', '待安排回访：申请 #' + log.args.id,
            '领养已签约，请在回访计划周期内录入回访记录。', 'admin.html#adoption');
        }
        if (log.event === 'VisitRecorded') {
          Notify.push(ctx && ctx.applicant, 'visit', '第 ' + log.args.round + ' 次回访已记录',
            log.args.passed ? '回访通过，公益积分 +5。' : '回访发现问题，请配合整改。', 'adoption.html#mine');
        }
        if (log.event === 'AdoptionCompleted') {
          Notify.push(ctx && ctx.applicant, 'adoption', '领养完成 #' + log.args.id,
            '回访全部达标，领养流程完成，公益积分 +30。', 'points.html');
        }
        if (log.event === 'PointsAwarded') {
          Notify.push(log.args.to, 'points', '公益积分 +' + log.args.amount,
            (global.ZZ_CONFIG.POINT_REASON[log.args.reason] || log.args.reason), 'points.html');
        }
        if (log.event === 'PointsDeducted') {
          Notify.push(log.args.from, 'points', '公益积分 -' + log.args.amount,
            '违约记录已上链：' + (global.ZZ_CONFIG.POINT_REASON[log.args.reason] || log.args.reason), 'points.html');
        }
      });
    }
  };

  global.ZZNotify = Notify;
})(window);
