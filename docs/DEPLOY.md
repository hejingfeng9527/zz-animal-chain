# 部署手册

本项目有两条部署线，互不依赖：

| 形态 | 说明 | 适用场景 |
| --- | --- | --- |
| **A. 静态站点** | 纯前端 + 内置模拟链，开箱即用 | GitHub Pages / Vercel / Replit 演示 |
| **B. 真实上链** | WSL2 + FISCO BCOS 3.x + 本地签名网关 | 课程作业 / 生产验证 |

---

## A. 静态站点部署

### A1. 本地预览（必须先起 HTTP 服务，不能双击打开 file://）

```bash
cd zz-animal-chain
npx serve . -l 5173          # 或 python -m http.server 5173
```
打开 <http://localhost:5173>。

> `crypto.subtle`（SHA-256）要求安全上下文，`file://` 下可能不可用，务必用 http://localhost。

### A2. GitHub Pages（推荐，免费）

#### 方式一：一键脚本（最省事）

双击项目根目录的 **`deploy-github.bat`**（Git Bash 里执行 `bash deploy-github.sh` 亦可），按提示输入 GitHub 用户名和 Token：

```
请输入 GitHub 用户名: xxx
请输入 GitHub Personal Access Token: （粘贴，不回显）
```

Token：<https://github.com/settings/tokens> → Generate new token (classic) → 勾选 `repo`、`workflow`。

脚本自动完成：校验 Token → 建仓（默认 `zz-animal-chain`）→ git 提交 → 推送 main → 开启 Pages(Actions) → 等待构建 → 打印链接。推送后会**自动擦除本地 remote 里的明文 Token**。改仓库名：`bash deploy-github.sh 你的仓库名`。

#### 方式二：手动建仓

1. 在 GitHub 新建空仓库（如 `zz-animal-rescue-chain`）
2. 本地初始化并推送：
   ```bash
   cd zz-animal-chain
   git init && git add . && git commit -m "feat: 郑州流浪动物救助链 DApp"
   git remote add origin https://github.com/<用户名>/zz-animal-rescue-chain.git
   git push -u origin main
   ```
3. 仓库 → **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
4. 推送后 `.github/workflows/pages.yml` 自动构建，约 1 分钟后可访问：
   `https://<用户名>.github.io/zz-animal-rescue-chain/`
5. 仓库名若就是 `<用户名>.github.io`，根路径直接就是 `https://<用户名>.github.io/`

> 若仓库为私有，需升级到 GitHub Pro 才能开启 Pages；公开仓库免费。

### A3. Vercel（备选）

```bash
npx vercel --prod        # 首次按提示登录，Project 类型选 Other / Static
```
或网页端 Import Git Repository → Framework Preset 选 **Other** → Build Command 留空 → Output Directory `.`。

### A4. Replit（备选）

新建 Repl → Import from GitHub → Run 命令填 `python3 -m http.server 3000` → 开放 3000 端口。

---

## B. WSL2 + FISCO BCOS 真实上链

### B1. 安装 WSL2（Windows PowerShell，管理员）

```powershell
wsl --install -d Ubuntu-22.04
```
重启后设置用户名密码，进入 Ubuntu 终端。

### B2. 搭建 FISCO BCOS 3.x 单群组四节点链

```bash
sudo apt update && sudo apt install -y curl openssl wget
cd ~
curl -#LO https://github.com/FISCO-BCOS/FISCO-BCOS/releases/download/v3.6.0/build_chain.sh
chmod +x build_chain.sh
# -p 依次为 p2p / channel / JSON-RPC 起始端口，这里 RPC = 8545
bash build_chain.sh -l 127.0.0.1:4 -o nodes -p 30300,20200,8545
bash nodes/127.0.0.1/start_all.sh
```

验证：

```bash
ps aux | grep fisco-bcos | grep -v grep | wc -l      # 应为 4
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8545
# 返回类似 {"jsonrpc":"2.0","id":1,"result":"0x1"}
```

常用命令：`bash nodes/127.0.0.1/stop_all.sh` 停止；`tail -f nodes/127.0.0.1/node0/log/*` 看日志。

> WSL2 的 localhost 转发默认开启，Windows 侧可直接访问 `http://127.0.0.1:8545`。

### B3. 编译合约

```bash
cd /mnt/c/Users/枫/WorkBuddy/2026-09-22-14-11-58/zz-animal-chain   # 或在本机 PowerShell 执行
npm i
npm run compile
```

产物：`contracts/CharityPoints.abi.json`、`*.bin` 等。

### B4. 准备签名账户

```bash
cd scripts/relayer && npm i
node -e "const {ethers}=require('ethers');const w=ethers.Wallet.createRandom();console.log(w.privateKey,w.address)"
```

- FISCO BCOS 3.x 交易需要 gas：请用控制台（或 faucet）向该地址转入少量 gas；
- 若链启用了免费 gas 模式可跳过；
- 更省事的选择：部署 **WeBASE-Front**，用其托管账户与合约 IDE。

### B5. 启动签名网关

```bash
cd scripts/relayer
PRIVATE_KEY=0x你的私钥 RPC_URL=http://127.0.0.1:8545 node server.js
# 监听 http://127.0.0.1:8787
curl http://127.0.0.1:8787/health
```

### B6. 部署合约并回填前端

```bash
cd zz-animal-chain
node scripts/deploy-chain.js --rpc http://127.0.0.1:8545 --relayer http://127.0.0.1:8787
```

脚本会自动：部署三份合约 → 建立合约间引用（`setPointsContract` / `setRescueLedger`）→ 授权救助站与领养合约 → 把地址写回 `assets/js/config.js` 并把 `driver` 改为 `fisco`。

刷新页面，右上角应显示 **FISCO BCOS · 区块 #N**。

> 若网关不可用，前端会自动回退到内置模拟链并在控制台提示，不会白屏。

---

## C. 高德地图 Key

1. 打开 <https://console.amap.com> → 应用管理 → 创建新应用
2. 添加 Key → 服务平台选 **Web端(JS API)**
3. 复制 Key 与安全密钥 jscode，填入 `assets/js/config.js`：
   ```js
   AMAP_KEY: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
   AMAP_SECURITY_CODE: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
   ```
4. 刷新页面即可（顶栏提示条消失）

未配置时自动降级为 Leaflet + 高德公开瓦片，标记 / 筛选 / 弹窗 / 一键导航功能完全一致。

---

## D. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面空白 / 控制台报 crypto 未定义 | 用 `file://` 打开 | 改用 `http://localhost` |
| 地图空白 | 未填 Key 且 CDN 被墙 | 换网络或填 Key |
| 顶栏显示「内置链」 | 未连真链 | 按 B 流程部署；不影响功能演示 |
| 部署脚本报 relayer 不可达 | 网关未启动或端口占用 | 检查 8787 端口，`curl /health` |
| 交易 revert | 身份无权限 | 切换为管理员/救助站身份再操作 |
| `Stack too deep` 编译错误 | 合约函数参数过多 | 已用结构体入参规避，勿随意拆开 |
| Pages 404 | 仓库名与路径不符 | 访问 `https://<用户名>.github.io/<仓库名>/` |
