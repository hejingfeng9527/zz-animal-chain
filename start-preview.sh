#!/usr/bin/env bash
# ================================================================
#  郑州流浪动物救助链上导航 DApp · 本地预览
#
#  用法（在本目录打开 Git Bash）：
#      bash start-preview.sh [端口]
#  端口省略时默认 8902
#
#  必须通过 http:// 访问，不能直接双击 index.html（file:// 下
#  crypto.subtle 的 SHA-256 存证功能会被浏览器安全策略禁用）。
# ================================================================

cd "$(dirname "$0")" || exit 1
PORT="${1:-8902}"
URL="http://127.0.0.1:${PORT}/index.html"

echo "================================================================"
echo "  郑州流浪动物救助链上导航 DApp · 本地预览"
echo "================================================================"
echo
echo "  首页   ： ${URL}"
echo "  管理台 ： http://127.0.0.1:${PORT}/pages/admin.html"
echo "  存证链 ： http://127.0.0.1:${PORT}/pages/explorer.html"
echo
echo "  右上角可切换身份：平台管理员 / 救助站 / 市民"
echo "  Ctrl + C 停止服务"
echo "================================================================"
echo

# ---------- 找一个可用的 Python ----------
PY=""
for c in python python3 py; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  for p in "/c/Users/枫/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
           "/c/Users/枫/AppData/Local/Programs/Python/Python314/python.exe"; do
    if [ -x "$p" ]; then PY="$p"; break; fi
  done
fi
if [ -z "$PY" ]; then
  echo "[ERROR] 没找到 Python，请安装 https://www.python.org/downloads/"
  echo "        或者手动执行： npx serve . -l ${PORT}"
  exit 1
fi

# ---------- 起服务后在浏览器里打开 ----------
( sleep 2; cmd.exe //c start "" "${URL}" >/dev/null 2>&1 ) &

exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
