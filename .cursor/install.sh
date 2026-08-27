#!/usr/bin/env bash
set -euo pipefail

# Node 24 以上 / pnpm 11 が要件 (package.json の engines と packageManager)。
# 既定イメージの node は要件を満たさないため、nvm で Node 24 を用意する。
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

nvm install 24
nvm alias default 24
nvm use 24

# package.json の packageManager に合わせて pnpm を有効化する。
corepack enable
corepack prepare pnpm@11.13.1 --activate

pnpm install --frozen-lockfile
