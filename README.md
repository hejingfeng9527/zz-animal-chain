# 🐾 郑州流浪动物救助链 · Zhengzhou Stray Animal Rescue Chain

> 基于区块链的郑州本地流浪动物**救助导航 DApp**：线索上报哈希存证 → 管理员审核 → 救助站收容 → 领养签约 → 回访记录，**动物从救助站到领养人的完整流转永久留存，防止弃养与二次流浪**。

- **在线演示**：部署后填写（GitHub Pages）
- **技术栈**：Solidity 0.8.11（FISCO BCOS 3.x）+ 原生 HTML/CSS/JS + 高德地图 JS API 2.0 + WSL2 + FISCO BCOS
- **不含**：代币发行、资金转账、任何金融属性

---

## 一、功能对照

| 需求 | 实现 | 位置 |
| --- | --- | --- |
| 用户浏览 / 上传动物信息上链 | 线索上报，原文生成 SHA-256 存证哈希写入链上 | `pages/report.html` |
| 管理员审核 | 通过 / 驳回（必填理由），紧急线索优先 | `pages/admin.html` |
| 管理员也可上传与浏览 | 管理员身份同样可上报、可维护全部档案 | `pages/report.html` / `animals.html` |
| 领养申请提交 | 申请表内容哈希上链 | `pages/adoption.html` |
| 背景核验 | 核验材料哈希 + 结论上链 | `pages/admin.html` |
| 领养签约 | 协议哈希上链，托管权自动移交 | `pages/admin.html` |
| 回访记录 | 每次回访凭证哈希上链，≥3 次方可完成领养 | `pages/admin.html` |
| 完整流转记录永久留存 | 每次状态变更 / 托管转移写入 `TransferRecord` | `pages/animals.html` |
| 防止弃养二次流浪 | 标记弃养 → 扣积分 + 动物自动回到「待领养」 | `pages/admin.html` |
| 地图点位标记 | 发现点 / 救助站 / 宠物医院 / 投喂点 | `index.html` |
| 筛选 | 受伤动物、待领养、紧急求助 | `index.html` |
| 一键导航 | 高德 URI API（免 Key） | 全部页面 |
| 紧急求助 + 优先审核 | severity=3 自动置 `urgent`，置顶并推送管理员 | `pages/admin.html` |
| 站内消息通知 | 审核结果、领养进度、回访提醒、积分变动 | `pages/messages.html` |
| 公益积分 | 发放 / 扣减 / 排行榜 / 流水 | `pages/points.html` |
| 链上存证浏览器 | 区块、交易、事件日志、哈希校验 | `pages/explorer.html` |

## 二、快速开始（无需任何后端）

```bash
cd zz-animal-chain
# 任意静态服务器均可（推荐，避免 file:// 下 Web Crypto 受限）
npx serve . -l 5173
# 或 python -m http.server 5173
```

打开 <http://localhost:5173> 即可，首次访问会自动写入郑州本地种子数据（6 条动物档案、9 个地图点位、3 条领养申请）。

> 默认使用**内置模拟链**（完整复刻合约逻辑，含区块 / 交易 / 事件 / SHA-256 存证，数据存浏览器 localStorage），开箱即用；
> 连接真实 FISCO BCOS 见 [docs/DEPLOY.md](docs/DEPLOY.md)。

### 二·补 一键部署到 GitHub Pages（拿到可访问链接）

仓库根目录自带了部署脚本，**双击 `deploy-github.bat`**（或在 Git Bash 里 `bash deploy-github.sh`）即可：

```
跟着提示输入：GitHub 用户名 + Personal Access Token
```

Token 申请：<https://github.com/settings/tokens> → **Generate new token (classic)** → 勾选 `repo`、`workflow` → 生成并复制。

脚本会自动完成：校验 Token → 建公开仓库 → 本地 git 提交 → 推送 main → 开启 Pages（Actions 方式）→ 等待构建 → 打印链接。约 1 分钟后得到：

```
https://<你的用户名>.github.io/<仓库名>/
```

默认仓库名 `zz-animal-chain`，想改就 `bash deploy-github.sh my-repo-name`。

## 三、演示剧本（切换右上角身份）

内置 5 个身份：**平台管理员 / 2 个救助站 / 2 位市民**。

1. **市民 · 小林** → 「上报线索」：填表 + 地图选点 + 上传照片，右侧实时显示 SHA-256 存证哈希 → 提交上链
2. 切到 **平台管理员** → 「管理后台 → 线索审核」：看到刚提交的线索（重伤的会标红置顶）→ 审核通过 / 驳回填理由
3. 管理员 → 「动物档案」：更新状态为「已入站 / 救治中 / 待领养」，每次流转都会生成一条带凭证哈希的链上记录
4. 切回 **市民** → 「领养中心」：对一只待领养动物提交申请表（表单哈希上链）
5. 切到 **管理员** → 「领养审核」：录入背景核验 → 审核通过并填写回访计划（或驳回填理由）→ 签约 → 录入 3 次回访 → 完成领养
6. 任意身份 → 「链上存证」：查看区块 / 交易 / 事件日志，或在「存证校验」里上传照片验证哈希是否匹配
7. 「公益积分」：查看排行榜与自己的积分流水；管理员可在后台发放积分
8. 进阶：在「领养审核」对已签约申请点「标记弃养违约」→ 积分被扣减，动物自动回到「待领养」，形成防二次流浪闭环

## 四、目录结构

```
zz-animal-chain/
├── index.html                 # 地图导航首页（高德 + 点位 + 筛选 + 一键导航）
├── pages/
│   ├── report.html            # 线索上报（SHA-256 存证预览）
│   ├── animals.html           # 动物档案 + 流转时间线 + 存证校验
│   ├── adoption.html          # 领养中心（申请 / 我的申请 / 回访记录）
│   ├── admin.html             # 管理后台（审核 / 紧急 / 领养 / 积分）
│   ├── messages.html          # 站内消息中心
│   ├── points.html            # 公益积分排行与流水
│   └── explorer.html          # 链上存证浏览器 + 哈希校验
├── assets/
│   ├── css/style.css
│   └── js/
│       ├── config.js          # 高德 Key / 链配置 / 积分规则（★ 只需改这里）
│       ├── hash.js            # SHA-256 存证工具
│       ├── chain.js           # 链抽象层（内置模拟链 ↔ FISCO BCOS）
│       ├── store.js           # 业务层（所有写操作都经链）
│       ├── notify.js          # 消息通知（由链上事件驱动）
│       ├── auth.js / seed.js / map.js / layout.js
├── contracts/
│   ├── CharityPoints.sol      # 公益积分
│   ├── AnimalRescueLedger.sol # 线索存证 + 审核 + 流转 + 托管权转移
│   └── AdoptionLedger.sol     # 领养全流程（申请/核验/审核/签约/回访）
├── scripts/
│   ├── compile.js             # solc 编译，产出 ABI / bytecode
│   ├── smoke-test.js          # 无浏览器跑通全链路（node scripts/smoke-test.js）
│   ├── deploy-chain.js        # 部署到 FISCO BCOS 并回填前端地址
│   └── relayer/server.js      # 本地签名网关（静态页 ↔ FISCO BCOS）
└── docs/DEPLOY.md             # WSL2 + FISCO BCOS + GitHub Pages 部署手册
```

## 五、链上数据模型

| 合约 | 核心结构 | 关键事件 |
| --- | --- | --- |
| `AnimalRescueLedger` | `Animal`（`dataHash` 存证、坐标、severity、urgent、status、reporter/shelter/guardian）、`ReviewRecord`、`TransferRecord`、`POI` | `AnimalReported`、`AnimalReviewed`、`AnimalStatusUpdated`、`CustodyTransferred`、`POIRegistered` |
| `AdoptionLedger` | `Application`（`formHash`、`bgCheckHash`、`contractHash`、stage、visitPlan、rejectReason）、`VisitRecord` | `ApplicationSubmitted`、`BackgroundChecked`、`ApplicationReviewed`、`AdoptionSigned`、`VisitRecorded`、`AdoptionCompleted`、`AbandonFlagged` |
| `CharityPoints` | `balanceOf`、`totalEarned`、`Award[]` | `PointsAwarded`、`PointsDeducted` |

**积分规则**：线索核实 +10 · 收容救助 +20 · 领养签约 +50 · 每次回访 +5 · 领养完成 +30 · 弃养违约 -30。

## 六、连接真实 FISCO BCOS

```bash
npm i                        # 安装 solc
npm run compile              # 编译合约 → contracts/*.abi.json / *.bin
npm test                     # 冒烟测试（验证内置链逻辑与合约一致）
# WSL2 中起链后：
cd scripts/relayer && npm i && PRIVATE_KEY=0x... node server.js
node scripts/deploy-chain.js # 部署三合约 + 建立引用 + 自动回填 config.js
```

详见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 七、高德地图 Key

打开 `assets/js/config.js`，填写：

```js
AMAP_KEY: '你的 Web端 JS API Key',
AMAP_SECURITY_CODE: '你的安全密钥 jscode',
```

未填写时自动降级为 Leaflet + 高德公开瓦片（底图与标记、筛选、弹窗功能完全一致，**一键导航不受影响**，因为它走 `uri.amap.com` 免 Key 接口）。

## 八、常见问题

**Q：数据存在哪？** 默认存在浏览器 localStorage（模拟链）。清缓存会重置；连接 FISCO BCOS 后数据真实上链。

**Q：为什么页面提示未连接真链？** 右上角链状态显示「内置链 · 区块 #N」即为模拟链模式，功能完全一致；按第六节接入 FISCO BCOS 后显示「FISCO BCOS」。

**Q：图片会不会上传？** 不会。图片仅在本地压缩为缩略图，**链上只写入 SHA-256 哈希**，可在「存证校验」中验证照片是否被替换。

**Q：涉及代币或转账吗？** 不涉及。`CharityPoints` 只是公益贡献记分，无转账、无代币、无交易对。
