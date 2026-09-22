/**
 * auth.js —— 角色与账户（演示用内置账户，真实环境替换为钱包地址）
 */
(function (global) {
  'use strict';
  const H = global.ZZHash;

  const ACCOUNTS = [
    { id: 'admin',    name: '平台管理员 · 郑州救助管理站', role: 'admin',   addr: H.addressOf('admin'),    tag: '审核 / 流转 / 积分发放' },
    { id: 'shelter1', name: '郑州市小动物保护协会',        role: 'shelter', addr: H.addressOf('shelter1'), tag: '救助站 · 惠济区' },
    { id: 'shelter2', name: '二七区毛毛雨救助小院',        role: 'shelter', addr: H.addressOf('shelter2'), tag: '救助站 · 二七区' },
    { id: 'user1',    name: '志愿者 · 小林',               role: 'user',    addr: H.addressOf('user1'),    tag: '金水区' },
    { id: 'user2',    name: '市民 · 张先生',               role: 'user',    addr: H.addressOf('user2'),    tag: '中原区' }
  ];

  const KEY = 'zz.auth';

  const Auth = {
    accounts: ACCOUNTS,
    current() {
      const id = localStorage.getItem(KEY) || 'user1';
      return ACCOUNTS.find((a) => a.id === id) || ACCOUNTS[3];
    },
    set(id) {
      localStorage.setItem(KEY, id);
      if (global.ZZNotify) global.ZZNotify.refreshBadge();
    },
    byAddr(addr) { return ACCOUNTS.find((a) => a.addr === addr) || null; },
    nameOf(addr) {
      const a = Auth.byAddr(addr);
      return a ? a.name : (addr ? addr.slice(0, 8) + '…' : '—');
    },
    isAdmin() { return Auth.current().role === 'admin'; },
    isShelter() { return Auth.current().role === 'shelter'; },
    isUser() { return Auth.current().role === 'user'; },
    canReview() { return ['admin', 'shelter'].indexOf(Auth.current().role) >= 0; }
  };

  global.ZZAuth = Auth;
})(window);
