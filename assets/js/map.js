/**
 * map.js —— 地图引擎封装
 * 有高德 Key  → 使用高德 JS API 2.0
 * 无 Key      → 自动降级为 Leaflet + 高德公开瓦片（底图风格一致，无需 Key）
 * 一键导航始终使用高德 URI API（uri.amap.com），不需要 Key。
 */
(function (global) {
  'use strict';

  const CFG = global.ZZ_CONFIG;
  let engine = null;   // 'amap' | 'leaflet'
  let map = null, infoWindow = null, layerGroup = null;
  let points = [];
  let clickHandler = null;

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

  async function initAmap(elId, opts) {
    if (CFG.AMAP_SECURITY_CODE) {
      global._AMapSecurityConfig = { securityJsCode: CFG.AMAP_SECURITY_CODE };
    }
    await loadScript('https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(CFG.AMAP_KEY));
    map = new global.AMap.Map(elId, {
      zoom: opts.zoom || CFG.city.zoom,
      center: opts.center || CFG.city.center,
      viewMode: '2D'
    });
    map.on('click', (e) => { if (clickHandler) clickHandler(e.lnglat.getLng(), e.lnglat.getLat()); });
    infoWindow = new global.AMap.InfoWindow({ offset: new global.AMap.Pixel(0, -30), isCustom: false });
    engine = 'amap';
  }

  async function initLeaflet(elId, opts) {
    loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
    map = global.L.map(elId, { zoomControl: true }).setView(opts.center || CFG.city.center, opts.zoom || CFG.city.zoom);
    global.L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      { subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '&copy; 高德地图' }
    ).addTo(map);
    map.on('click', (e) => { if (clickHandler) clickHandler(e.lnglat.lng, e.latlng.lat); });
    layerGroup = global.L.layerGroup().addTo(map);
    engine = 'leaflet';
  }

  const ZZMap = {
    get engine() { return engine; },

    async init(elId, opts) {
      opts = opts || {};
      if (CFG.AMAP_KEY) {
        try { await initAmap(elId, opts); }
        catch (e) {
          console.warn('[map] 高德加载失败，降级 Leaflet：', e.message);
          await initLeaflet(elId, opts);
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

    /** 逆地理：高德需要 Key，降级直接返回坐标 */
    async regeo(lng, lat) {
      if (CFG.AMAP_KEY && global.AMap) {
        return new Promise((resolve) => {
          global.AMap.plugin('AMap.Geocoder', () => {
            const geo = new global.AMap.Geocoder();
            geo.getAddress([lng, lat], (status, result) => {
              resolve(status === 'complete' && result.regeocode ? result.regeocode.formattedAddress : '');
            });
          });
        });
      }
      return '郑州市 (' + lng.toFixed(6) + ', ' + lat.toFixed(6) + ')';
    }
  };

  global.ZZMap = ZZMap;
})(window);
