#!/usr/bin/env bash
set -euo pipefail

# package.json は Node 24 以上 / pnpm 11 (packageManager) を要求する。
# 既定イメージの `node` (exec-daemon 同梱) は v22 のため、nvm で Node 24 を用意する。
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

nvm install 24
nvm alias default 24
nvm use default

# package.json の packageManager に合わせて pnpm を有効化する。
corepack enable
corepack prepare pnpm@11.13.1 --activate

# エージェントのコマンドは非ログインシェルで実行され、PATH 先頭に exec-daemon 同梱の
# node(v22) が来るため、bare `node` が v22 に解決されてしまう。exec-daemon より前に
# 位置する書き込み可能な dir (/usr/local/cargo/bin) に Node 24 の実体へのシンボリック
# リンクを置き、`node`/`npx` などが常に v24 を指すようにする。詳細は README を参照。
NODE_BIN_DIR="$NVM_DIR/versions/node/$(nvm version default)/bin"
OVERRIDE_DIR="/usr/local/cargo/bin"
if [ -d "$OVERRIDE_DIR" ] && [ -w "$OVERRIDE_DIR" ]; then
  for bin in node npm npx corepack pnpm; do
    if [ -x "$NODE_BIN_DIR/$bin" ]; then
      ln -sf "$NODE_BIN_DIR/$bin" "$OVERRIDE_DIR/$bin"
    fi
  done
fi

pnpm install --frozen-lockfile

node --version
pnpm --version
