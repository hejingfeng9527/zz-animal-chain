/**
 * config.js —— 全局配置
 * ---------------------------------------------------------------
 * 【高德地图 Key】申请：https://console.amap.com → 应用管理 → 创建新应用
 *   → 添加 Key → 服务平台选「Web端(JS API)」
 *   申请信息建议填写：
 *     应用名称 / Key 名称：zhengz_animal
 *     服务平台：Web端(JS API)
 *   拿到 Key 和「安全密钥 jscode」后填入下面 AMAP_KEY / AMAP_SECURITY_CODE 即可。
 *   未填写时自动降级为 Leaflet + 高德公开瓦片底图（功能一致，仅底图不同；一键导航不受影响）。
 * ---------------------------------------------------------------
 */
window.ZZ_CONFIG = {
  /* ===== 高德地图 JS API ===== */
  AMAP_KEY_NAME: 'zhengz_animal', // 高德控制台里这个 Key 的备注名称（仅作留档，不参与请求）
  AMAP_KEY: 'c70384d4c643edac99986fd0d266b808',
  AMAP_SECURITY_CODE: 'e743c0228cfb1d94f13975dea5be4cdc',

  /* ===== 底图引擎 =====
   * 'leaflet' : 高德栅格瓦片（默认推荐）。普通 <img> 加载高德瓦片，不依赖 WebGL/Key，
   *             境内外网络都能稳定出图；逆地理编码仍走高德 Key。
   * 'amap'    : 高德官方 JS API 矢量底图（效果更细腻、可 3D）。
   *             注意：高德对海外出口 IP 拒绝下发矢量瓦片（infocode 11000），
   *             若你的网络走了代理/加速器导致出口在境外，选 amap 会底图空白。 */
  MAP_ENGINE: 'leaflet',

  /* ===== 城市（郑州） ===== */
  city: {
    name: '郑州',
    center: [113.625368, 34.7466],
    zoom: 11
  },

  /* ===== 链配置 ===== */
  chain: {
    // driver: 'mock'  = 内置模拟链（开箱即用，数据存浏览器 localStorage，含区块/交易/哈希）
    // driver: 'fisco' = 连接 WSL2 中的 FISCO BCOS（需先启动 scripts/relayer 网关）
    driver: 'mock',
    rpcUrl: 'http://127.0.0.1:8545',      // FISCO BCOS 3.x JSON-RPC
    relayerUrl: 'http://127.0.0.1:8787',  // 本地签名网关
    contracts: {                          // 部署后回填合约地址
      charityPoints: '',
      rescueLedger: '',
      adoptionLedger: ''
    },
    blockTimeMs: 1200,   // 模拟链出块间隔
    autoSeed: true       // 首次访问写入郑州救助站/医院/投喂点种子数据
  },

  /* ===== 公益积分规则（与 CharityPoints.sol 保持一致） ===== */
  points: {
    REPORT_VERIFIED: 10,   // 上报线索核实通过
    SHELTER_INTAKE: 20,    // 完成收容救助
    ADOPTION_SIGNED: 50,   // 完成领养签约
    VISIT_PASSED: 5,       // 完成一次回访
    ADOPTION_COMPLETED: 30,// 回访达标领养完成
    ABANDON_PENALTY: 30    // 弃养违约扣减
  },

  /* ===== 状态枚举（与 AnimalRescueLedger.sol Status 一致） ===== */
  STATUS: ['已上报', '已核实', '已入站', '救治中', '待领养', '已领养', '已放归', '已死亡', '已驳回'],
  SEVERITY: ['健康', '受伤', '患病', '重伤/病危'],
  POI_KIND: ['发现点', '救助站', '合作宠物医院', '投喂点'],

  /* ===== 领养阶段（与 AdoptionLedger.sol Stage 一致） ===== */
  STAGE: ['已提交', '背景核验', '审核通过', '已驳回', '已签约', '已完成', '已取消'],

  /* ===== 积分事由中文映射 ===== */
  POINT_REASON: {
    REPORT_VERIFIED: '上报线索核实通过',
    SHELTER_INTAKE: '完成收容救助',
    ADOPTION_SIGNED: '完成领养签约',
    VISIT_PASSED: '完成一次领养回访',
    ADOPTION_COMPLETED: '领养回访达标，领养完成',
    ABANDON_PENALTY: '弃养违约，扣除公益积分'
  }
};
