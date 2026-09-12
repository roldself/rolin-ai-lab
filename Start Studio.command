#!/bin/zsh
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  printf '请先安装 Node.js，再重新打开工作台。\n'
  read -r '?按回车关闭'
  exit 1
fi
if [ ! -d node_modules ]; then
  npm ci || exit 1
fi
npm run studio
