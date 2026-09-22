#!/usr/bin/env bash
# ================================================================
#  郑州流浪动物救助链上导航 DApp  ——  一键部署到 GitHub Pages
#
#  用法（在本目录打开 Git Bash）：
#      bash deploy-github.sh [仓库名]
#  仓库名省略时默认 zz-animal-chain
#
#  脚本会依次完成：
#    1. 校验 Token
#    2. 在你的账号下创建公开仓库（已存在则跳过）
#    3. 本地 git 初始化并提交
#    4. 推送到 main
#    5. 开启 GitHub Pages（GitHub Actions 方式）
#    6. 等待构建完成并给出访问链接
# ================================================================

REPO_NAME="${1:-zz-animal-chain}"

echo "================================================================"
echo "  郑州流浪动物救助链上导航 DApp · GitHub Pages 一键部署"
echo "================================================================"
echo

# ---------- 0. 收集凭据 ----------
read -rp "请输入 GitHub 用户名: " GH_USER
if [ -z "$GH_USER" ]; then echo "用户名不能为空"; exit 1; fi

echo
echo "Token 申请地址： https://github.com/settings/tokens"
echo "  → Generate new token (classic)"
echo "  → 勾选 repo（全部）、workflow"
echo "  → 生成后复制，粘贴到下面（输入时不会显示）"
echo
read -rsp "请输入 GitHub Personal Access Token: " GH_TOKEN
echo
if [ -z "$GH_TOKEN" ]; then echo "Token 不能为空"; exit 1; fi

API="https://api.github.com"
AUTH=(-H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

# ---------- HTTP 工具函数 ----------
req() {           # req <method> <url> [datafile] ; body 输出到 stdout，状态码写入 HTTP_CODE
  local method="$1" url="$2" datafile="${3:-}"
  local tmp; tmp="$(mktemp)"
  if [ -n "$datafile" ]; then
    HTTP_CODE=$(curl -s -o "$tmp" -w "%{http_code}" -X "$method" "${AUTH[@]}" "$url" -d @"$datafile")
  else
    HTTP_CODE=$(curl -s -o "$tmp" -w "%{http_code}" -X "$method" "${AUTH[@]}" "$url")
  fi
  cat "$tmp"; rm -f "$tmp"
}
jsonfield() {     # jsonfield <json文本> <字段名>
  printf '%s' "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//'
}

# ---------- 1. 校验 Token ----------
echo
echo "[1/6] 校验 Token ..."
BODY=$(req GET "$API/user")
if [ "$HTTP_CODE" != "200" ]; then
  echo "  ✗ Token 校验失败（HTTP $HTTP_CODE）。请确认 Token 有效且已勾选 repo 权限。"
  exit 1
fi
LOGIN=$(jsonfield "$BODY" login)
echo "  ✓ 登录身份：${LOGIN}"
if [ "$LOGIN" != "$GH_USER" ]; then
  echo "  ! 注意：Token 属于「${LOGIN}」，与你输入的用户名「${GH_USER}」不一致，将使用 ${LOGIN}"
  GH_USER="$LOGIN"
fi

# ---------- 2. 创建仓库 ----------
echo
echo "[2/6] 创建仓库 ${GH_USER}/${REPO_NAME} ..."
PAYLOAD="$(mktemp)"
printf '{"name":"%s","description":"郑州流浪动物救助链上导航 DApp · Solidity + 高德地图 + FISCO BCOS","private":false,"auto_init":false,"has_issues":true}' "$REPO_NAME" > "$PAYLOAD"
BODY=$(req POST "$API/user/repos" "$PAYLOAD")
rm -f "$PAYLOAD"
case "$HTTP_CODE" in
  201) echo "  ✓ 仓库创建成功" ;;
  422) echo "  · 仓库已存在，跳过创建" ;;
  401|403) echo "  ✗ 无权限创建仓库（HTTP $HTTP_CODE），请确认 Token 勾选了 repo"; exit 1 ;;
  *)   echo "  ! 创建返回 HTTP $HTTP_CODE ：$(printf '%s' "$BODY" | head -c 300)" ;;
esac

# ---------- 3. 本地 git 提交 ----------
echo
echo "[3/6] 本地 git 初始化并提交 ..."
if [ ! -d .git ]; then
  git init -q
  echo "  · git init 完成"
fi
if [ -z "$(git config user.name)" ]; then
  git config user.name "${GH_USER}"
fi
if [ -z "$(git config user.email)" ]; then
  git config user.email "${GH_USER}@users.noreply.github.com"
fi
git add -A
if git diff --cached --quiet; then
  echo "  · 无新增改动"
else
  git commit -q -m "feat: 郑州流浪动物救助链上导航 DApp（线索存证 / 地图导航 / 领养上链 / 公益积分）"
  echo "  ✓ 提交完成"
fi
git branch -M main 2>/dev/null || true

# ---------- 4. 推送 ----------
echo
echo "[4/6] 推送到 GitHub ..."
git remote remove origin 2>/dev/null || true
git remote add origin "https://${GH_USER}:${GH_TOKEN}@github.com/${GH_USER}/${REPO_NAME}.git"
if git push -u origin main >/dev/null 2>&1; then
  echo "  ✓ 推送成功"
else
  echo "  ✗ 推送失败，下面是原始错误信息："
  git push -u origin main
  exit 1
fi
# 抹掉 remote 里的明文 Token
git remote set-url origin "https://github.com/${GH_USER}/${REPO_NAME}.git"
echo "  · 已清理本地 remote 中的 Token"

# ---------- 5. 开启 GitHub Pages ----------
echo
echo "[5/6] 开启 GitHub Pages（Actions 方式）..."
PAGES_JSON="$(mktemp)"
printf '{"build_type":"workflow","source":{"branch":"main","path":"/"}}' > "$PAGES_JSON"
BODY=$(req POST "$API/repos/${GH_USER}/${REPO_NAME}/pages" "$PAGES_JSON")
case "$HTTP_CODE" in
  201) echo "  ✓ Pages 已开启" ;;
  204) echo "  ✓ Pages 已开启" ;;
  409) echo "  · Pages 站点已存在，更新为 Actions 方式"
       BODY=$(req PUT "$API/repos/${GH_USER}/${REPO_NAME}/pages" "$PAGES_JSON")
       echo "  · 更新返回 HTTP $HTTP_CODE" ;;
  403) echo "  ! 无法通过 API 开启 Pages（HTTP 403）。"
       echo "    请手动打开 https://github.com/${GH_USER}/${REPO_NAME}/settings/pages"
       echo "    → Build and deployment → Source 选 GitHub Actions" ;;
  *)   echo "  ! Pages 接口返回 HTTP $HTTP_CODE ：$(printf '%s' "$BODY" | head -c 300)" ;;
esac
rm -f "$PAGES_JSON"

# ---------- 6. 等待构建 ----------
echo
echo "[6/6] 等待 Pages 构建（通常 30~90 秒）..."
SITE="https://${GH_USER}.github.io/${REPO_NAME}/"
for i in $(seq 1 40); do
  BODY=$(req GET "$API/repos/${GH_USER}/${REPO_NAME}/pages")
  CODE="$HTTP_CODE"
  STATUS=$(jsonfield "$BODY" status)
  if [ "$CODE" = "200" ] && [ "$STATUS" = "built" ]; then
    SITE_URL=$(jsonfield "$BODY" html_url)
    [ -n "$SITE_URL" ] && SITE="${SITE_URL}"
    CODE_SITE=$(curl -s -o /dev/null -w "%{http_code}" -L "$SITE")
    if [ "$CODE_SITE" = "200" ]; then
      echo "  ✓ 构建完成，站点可访问"
      break
    fi
  fi
  printf "  · 第 %s 次检查，当前状态：%s\n" "$i" "${STATUS:-等待中}"
  sleep 5
done

echo
echo "================================================================"
echo "  部署完成！"
echo
echo "  仓库地址： https://github.com/${GH_USER}/${REPO_NAME}"
echo "  在线站点： ${SITE}"
echo "  Actions  ： https://github.com/${GH_USER}/${REPO_NAME}/actions"
echo
echo "  —— 高德地图 Key ——"
echo "  申请时请把应用/Key 名称填为：zhengz_animal"
echo "  拿到 Key 后编辑 assets/js/config.js 填入 AMAP_KEY 与 AMAP_SECURITY_CODE，"
echo "  保存后重新推送即可生效（未填也能正常跑，会自动降级为Leaflet+高德瓦片底图）。"
echo "================================================================"
