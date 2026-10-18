#!/usr/bin/env bash
# =============================================================
# 版本回滚脚本
# 用法：./rollback.sh v1.0.0
# 说明：应用镜像可回滚；数据库结构迁移若已执行，无法通过回滚镜像撤销，
#       需从备份恢复（见部署文档「更新与回滚」章节）
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_VERSION="${1:?用法: ./rollback.sh <旧版本号，如 v2.1.1>}"

# 同 update.sh：git 标签带 v、镜像标签不带 v，统一按镜像标签形式处理
IMG_VERSION="${TARGET_VERSION#v}"

cd "$DEPLOY_DIR"

echo "[rollback] 将应用回滚到版本 ${IMG_VERSION}（git 标签 v${IMG_VERSION}）..."
# 原地更新 .env 的 VERSION 行。不使用 sed -i.bak：备份文件会遗留明文密码
if [ -f .env ]; then
  sed "s/^VERSION=.*/VERSION=${IMG_VERSION}/" .env > .env.tmp
  grep -q '^VERSION=' .env || echo "VERSION=${IMG_VERSION}" >> .env.tmp
  mv .env.tmp .env
fi

VERSION="$IMG_VERSION" docker compose up -d frontend backend

echo "[rollback] 等待服务就绪..."
sleep 15
"$SCRIPT_DIR/healthcheck.sh"

echo "[rollback] 回滚完成。若数据库结构已迁移，请确认应用与数据库版本兼容，必要时从备份恢复。"
