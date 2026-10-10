#!/usr/bin/env bash
# =============================================================
# 镜像更新脚本
# 用法：./update.sh v1.1.0
# 步骤：备份数据库 → 拉取新镜像 → 重启应用 → 健康检查
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
NEW_VERSION="${1:?用法: ./update.sh <版本号，如 v1.1.0>}"

cd "$DEPLOY_DIR"

echo "[update] 1/4 备份数据库..."
"$SCRIPT_DIR/backup.sh" || { echo "[update] 备份失败，中止升级"; exit 1; }

echo "[update] 2/4 拉取镜像版本 ${NEW_VERSION}..."
VERSION="$NEW_VERSION" docker compose pull frontend backend

echo "[update] 3/4 重启应用..."
# 写入版本号并启动
sed -i.bak "s/^VERSION=.*/VERSION=${NEW_VERSION}/" .env 2>/dev/null || true
VERSION="$NEW_VERSION" docker compose up -d frontend backend

echo "[update] 4/4 等待服务就绪并健康检查..."
sleep 15
"$SCRIPT_DIR/healthcheck.sh"

echo "[update] 升级完成。如需回滚请使用 ./rollback.sh <旧版本号>"
