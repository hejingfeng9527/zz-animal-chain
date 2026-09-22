/**
 * map.js —— 地图引擎封装
 * 有高德 Key  → 使用高德 JS API 2.0
 * 无 Key      → 自动降级为 Leaflet + 高德公开瓦片（底图风格一致，无需 Key）
 * 一键导航始终使用高德 URI API（uri.amap.com），不需要 Key。
 */
(function (global) {
  'use strict';

  const CFG = global.ZZ_CONFIG;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let engine = null;   // 'amap' | 'leaflet'
  let map = null, infoWindow = null, layerGroup = null;
  let points = [];
  let clickHandler = null;

  /** 底图不可用时在地图上挂一条可见提示（不静默） */
  function notice(elId, msg) {
    const host = document.getElementById(elId);
    if (!host) return;
    host.style.position = host.style.position || 'relative';
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:600;' +
      'background:#fff8e6;color:#8a5a00;border:1px solid #f0c36d;border-radius:6px;' +
      'padding:4px 10px;font-size:12px;max-width:92%;text-align:center';
    bar.textContent = msg;
    host.appendChild(bar);
    setTimeout(() => bar.remove(), 10000);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('加载失败: ' + src));
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    if (document.querySelector('link[data-zz="' + href + '"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-zz', href);
    document.head.appendChild(l);
  }

  function pinHtml(p) {
    const color = p.color || '#2f855a';
    return '<div class="map-pin" style="background:' + color + '">' + (p.icon || '') + '</div>';
  }

  /** 按需加载高德 JS SDK（逆地理编码用），多页面共享同一份加载 Promise */
  let amapSdkPromise = null;
  function ensureAmapSdk() {
    if (global.AMap) return Promise.resolve();
    if (!amapSdkPromise) {
      if (CFG.AMAP_SECURITY_CODE) {
        global._AMapSecurityConfig = { securityJsCode: CFG.AMAP_SECURITY_CODE };
      }
      amapSdkPromise = loadScript('https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(CFG.AMAP_KEY))
        .catch((e) => { amapSdkPromise = null; throw e; });
    }
    return amapSdkPromise;
  }

  async function initAmap(elId, opts) {
    await ensureAmapSdk();
    map = new global.AMap.Map(elId, {
      zoom: opts.zoom || CFG.city.zoom,
      center: opts.center || CFG.city.center,
      viewMode: '2D'
    });
    map.on('click', (e) => { if (clickHandler) clickHandler(e.lnglat.getLng(), e.lnglat.getLat()); });
    infoWindow = new global.AMap.InfoWindow({ offset: new global.AMap.Pixel(0, -30), isCustom: false });

    // 关键：必须确认瓦片数据真的拉到了。高德对海外出口 IP 会拒绝下发矢量瓦片
    // （get_tile 返回 TILE_ACCESS_OVERSEA_FORBIDDEN / infocode 11000），
    // 此时 complete 事件照样触发、画布却空白、DOM 标记仍在 —— 所以不能只靠 complete 判断，
    // 必须检查是否真的发起了矢量瓦片数据请求（jsapi-data*.amap.com/tile/）。
    let painted = false;
    try { map.on('complete', () => { painted = true; }); } catch (_) { /* 忽略 */ }
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !painted) {
      painted = performance.getEntriesByType('resource')
        .some((e) => /jsapi-data\d*\.amap\.com\/tile\//.test(e.name));
      if (!painted) await wait(400);
    }
    if (!painted) {
      try { map.destroy(); } catch (_) { /* 忽略 */ }
      map = null;
      throw new Error('8s 内未拉到任何矢量瓦片（疑似 TILE_ACCESS_OVERSEA_FORBIDDEN）');
    }
    engine = 'amap';
  }

  async function initLeaflet(elId, opts) {
    loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
    map = global.L.map(elId, { zoomControl: true })
      // CFG.city.center 是 [lng, lat]（高德习惯），Leaflet 需要 [lat, lng]
      .setView([opts.center[1], opts.center[0]], opts.zoom || CFG.city.zoom);
    global.L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      { subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '&copy; 高德地图' }
    ).addTo(map);
    map.on('click', (e) => { if (clickHandler) clickHandler(e.lnglat.lng, e.latlng.lat); });
    layerGroup = global.L.layerGroup().addTo(map);
    engine = 'leaflet';
    // 容器尺寸在首帧后才会稳定（CSS 布局/字体加载），不通知 Leaflet 会导致
    // 瓦片网格只铺一行、上半屏空白 —— 必须显式 invalidateSize。
    setTimeout(() => { try { map.invalidateSize(); } catch (_) { /* 忽略 */ } }, 350);
    global.addEventListener('resize', () => { try { map.invalidateSize(); } catch (_) { /* 忽略 */ } });
  }

  const ZZMap = {
    get engine() { return engine; },

    async init(elId, opts) {
      opts = opts || {};
      // MAP_ENGINE: 'leaflet' = 高德栅格瓦片（默认，稳定出图，境内外均可）
      //            'amap'    = 高德官方 JS API 矢量底图（境内直连网络可用，需 Key）
      const preferred = CFG.MAP_ENGINE || 'leaflet';
      const wantAmap = preferred === 'amap' && !!CFG.AMAP_KEY;
      if (wantAmap) {
        try {
          await initAmap(elId, opts);
        } catch (e) {
          console.warn('[map] 高德矢量底图不可用，降级为高德栅格瓦片：', e.message);
          await initLeaflet(elId, opts);
          notice(elId, '高德矢量底图加载受限（网络出口被高德限制），已自动切换为高德栅格瓦片兼容底图，功能不受影响');
        }
      } else {
        await initLeaflet(elId, opts);
      }
      return engine;
    },

    onClick(cb) { clickHandler = cb; },

    clear() {
      points = [];
      if (!map) return;
      if (engine === 'amap') map.clearMap();
      else if (layerGroup) layerGroup.clearLayers();
    },

    add(p) {
      points.push(p);
      if (!map) return;
      if (engine === 'amap') {
        const marker = new global.AMap.Marker({
          position: [p.lng, p.lat],
          content: pinHtml(p),
          offset: new global.AMap.Pixel(-15, -15),
          title: p.title || ''
        });
        marker.on('click', () => {
          infoWindow.setContent('<div class="iw">' + (p.html || '<b>' + (p.title || '') + '</b>') + '</div>');
          infoWindow.open(map, [p.lng, p.lat]);
        });
        map.add(marker);
      } else {
        const icon = global.L.divIcon({
          className: '', html: pinHtml(p), iconSize: [30, 30], iconAnchor: [15, 15]
        });
        global.L.marker([p.lat, p.lng], { icon })
          .addTo(layerGroup)
          .bindPopup('<div class="iw">' + (p.html || '<b>' + (p.title || '') + '</b>') + '</div>');
      }
    },

    render(list) { ZZMap.clear(); (list || []).forEach((p) => ZZMap.add(p)); ZZMap.fit(); },

    fit() {
      if (!map || !points.length) return;
      if (engine === 'amap') {
        map.setFitView(null, false, [40, 40, 40, 40]);
      } else {
        try { map.invalidateSize(); } catch (_) { /* 忽略 */ }
        const b = global.L.latLngBounds(points.map((p) => [p.lat, p.lng]));
        map.fitBounds(b.pad(0.15));
      }
    },

    focus(lng, lat, zoom) {
      if (!map) return;
      if (engine === 'amap') map.setZoomAndCenter(zoom || 15, [lng, lat]);
      else map.setView([lat, lng], zoom || 15);
    },

    /** 一键导航（高德 URI API，免 Key） */
    navUrl(lng, lat, name, mode) {
      return 'https://uri.amap.com/navigation?to=' + lng + ',' + lat + ',' + encodeURIComponent(name || '目的地') +
        '&mode=' + (mode || 'car') + '&policy=1&src=zz-rescue&coordinate=gaode&callnative=1';
    },

    markerUrl(lng, lat, name) {
      return 'https://uri.amap.com/marker?position=' + lng + ',' + lat + '&name=' + encodeURIComponent(name || '') +
        '&src=zz-rescue&coordinate=gaode&callnative=1';
    },

    /** 逆地理：按需加载高德 SDK（只用它的 Geocoder，不渲染底图），失败则返回坐标 */
    async regeo(lng, lat) {
      if (CFG.AMAP_KEY) {
        try {
          await ensureAmapSdk();
          return await new Promise((resolve) => {
            global.AMap.plugin('AMap.Geocoder', () => {
              const geo = new global.AMap.Geocoder();
              geo.getAddress([lng, lat], (status, result) => {
                resolve(status === 'complete' && result.regeocode ? result.regeocode.formattedAddress : '');
              });
            });
          });
        } catch (e) { /* SDK 加载失败，落到坐标兜底 */ }
      }
      return '郑州市 (' + lng.toFixed(6) + ', ' + lat.toFixed(6) + ')';
    }
  };

  global.ZZMap = ZZMap;
})(window);
