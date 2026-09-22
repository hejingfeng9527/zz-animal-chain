/**
 * layout.js —— 页面框架：顶栏 / 导航 / 账户切换 / 提示条 / 统一启动流程
 */
(function (global) {
  'use strict';

  function base() {
    return /\/pages\//.test(location.pathname) ? '../' : '';
  }

  const NAV = [
    { k: 'index', href: 'index.html', text: '地图导航' },
    { k: 'report', href: 'pages/report.html', text: '上报线索' },
    { k: 'animals', href: 'pages/animals.html', text: '动物档案' },
    { k: 'adoption', href: 'pages/adoption.html', text: '领养中心' },
    { k: 'admin', href: 'pages/admin.html', text: '管理后台' },
    { k: 'points', href: 'pages/points.html', text: '公益积分' },
    { k: 'explorer', href: 'pages/explorer.html', text: '链上存证' }
  ];

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderHeader(active) {
    const b = base();
    const me = global.ZZAuth.current();
    const opts = global.ZZAuth.accounts.map((a) =>
      '<option value="' + a.id + '"' + (a.id === me.id ? ' selected' : '') + '>' + esc(a.name) + '（' +
      (a.role === 'admin' ? '管理员' : a.role === 'shelter' ? '救助站' : '用户') + '）</option>').join('');
    const navHtml = NAV.map((n) => {
      const href = n.k === 'index' ? b + n.href : b + n.href;
      return '<a class="nav-link' + (n.k === active ? ' active' : '') + '" href="' + href + '">' + n.text + '</a>';
    }).join('');

    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML =
      '<div class="topbar-inner">' +
        '<a class="brand" href="' + b + 'index.html"><span class="logo">🐾</span>' +
          '<span class="brand-text"><b>郑州流浪动物救助链</b><em>Blockchain Rescue Navigator · Zhengzhou</em></span></a>' +
        '<nav class="nav">' + navHtml +
          '<a class="nav-link" href="' + b + 'pages/messages.html">消息<span class="badge" id="msgBadge">0</span></a>' +
        '</nav>' +
        '<div class="account">' +
          '<span class="chain-chip" id="chainChip">链未连接</span>' +
          '<select id="accountSel" title="切换演示身份">' + opts + '</select>' +
        '</div>' +
      '</div>';
    document.body.insertBefore(header, document.body.firstChild);

    document.getElementById('accountSel').addEventListener('change', (e) => {
      global.ZZAuth.set(e.target.value);
      location.reload();
    });
  }

  function renderFooter() {
    const f = document.createElement('footer');
    f.className = 'footer';
    f.innerHTML = '<div class="footer-inner">' +
      '<span>🐾 郑州流浪动物救助导航 · 基于区块链的公益存证系统</span>' +
      '<span class="footer-links">' +
        '<a href="' + base() + 'pages/explorer.html">链上存证</a>' +
        '<a href="' + base() + 'pages/messages.html">消息中心</a>' +
        '<a href="' + base() + 'README.md">项目说明</a>' +
      '</span></div>';
    document.body.appendChild(f);
  }

  function toast(msg, type) {
    let box = document.getElementById('toastBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toastBox'; box.className = 'toast-box';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); }, 3200);
    setTimeout(() => { el.remove(); }, 3800);
  }

  function amapTip() {
    if (global.ZZ_CONFIG.AMAP_KEY) return;
    const b = base();
    const tip = document.createElement('div');
    tip.className = 'notice';
    tip.innerHTML = '⚠️ 未检测到高德地图 Key，当前使用降级底图（高德公开瓦片，功能完整）。' +
      '在 <code>' + b + 'assets/js/config.js</code> 中填入 <code>AMAP_KEY</code> 后刷新即可切换高德 JS API。' +
      '<a href="https://console.amap.com" target="_blank" rel="noopener">去申请 →</a>';
    const main = document.querySelector('main') || document.body;
    main.insertBefore(tip, main.firstChild);
  }

  const Layout = {
    base, esc, toast, NAV,

    async boot(opts) {
      opts = opts || {};
      renderHeader(opts.active);
      renderFooter();
      let stats;
      try {
        stats = await global.ZZStore.init();
      } catch (e) {
        console.error(e);
        toast('链初始化失败：' + e.message, 'err');
      }
      const chip = document.getElementById('chainChip');
      if (chip && stats) {
        chip.textContent = (stats.driver === 'fisco' ? 'FISCO BCOS' : '内置链') + ' · 区块 #' + stats.height;
        chip.classList.add(stats.driver === 'fisco' ? 'on-real' : 'on-mock');
      }
      global.ZZNotify.refreshBadge();
      if (opts.map) amapTip();
      document.title = (opts.title ? opts.title + ' · ' : '') + '郑州流浪动物救助链';
      if (typeof global.PAGE_INIT === 'function') {
        try { await global.PAGE_INIT(); }
        catch (e) { console.error(e); toast('页面初始化失败：' + e.message, 'err'); }
      }
    },

    /** 生成「一键导航」按钮 HTML */
    navBtn(lng, lat, name) {
      const url = global.ZZMap.navUrl(lng, lat, name);
      return '<a class="btn btn-nav" href="' + url + '" target="_blank" rel="noopener">🧭 一键导航</a>';
    },

    /** 生成哈希展示（可点击复制） */
    hashRow(label, hash) {
      if (!hash) return '';
      return '<div class="hash-row"><span class="hk">' + label + '</span>' +
        '<code class="hv" title="点击复制" onclick="navigator.clipboard&&navigator.clipboard.writeText(\'' + hash + '\')">' +
        esc(hash) + '</code></div>';
    },

    async confirm(msg) {
      return confirm(msg);
    },

    async prompt(msg, def) {
      return prompt(msg, def || '');
    }
  };

  global.ZZLayout = Layout;
})(window);
