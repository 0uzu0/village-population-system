#!/usr/bin/env bash
# =============================================================
# 镜像更新脚本
# 用法：./update.sh v1.1.0
# 步骤：备份数据库 → 拉取新镜像 → 重启应用 → 健康检查
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
NEW_VERSION="${1:?用法: ./update.sh <版本号，如 v2.2.0>}"

# ⚠️ git 标签是 vX.Y.Z，但镜像标签是 X.Y.Z（docker/metadata-action 的
# type=semver,pattern={{version}} 会去掉 v）。这里统一去掉开头的 v 再拼镜像名，
# 否则 `./update.sh v2.2.0` 会去拉一个不存在的 ghcr.io/...:v2.2.0 而拉取失败。
# 两种写法（v2.2.0 / 2.2.0）都接受，存的永远是镜像标签形式。
IMG_VERSION="${NEW_VERSION#v}"

cd "$DEPLOY_DIR"

echo "[update] 1/4 备份数据库..."
"$SCRIPT_DIR/backup.sh" || { echo "[update] 备份失败，中止升级"; exit 1; }

echo "[update] 2/4 拉取镜像版本 ${IMG_VERSION}（git 标签 v${IMG_VERSION}）..."
VERSION="$IMG_VERSION" docker compose pull frontend backend

echo "[update] 3/4 重启应用..."
# 原地更新 .env 的 VERSION 行。不使用 sed -i.bak：备份文件会遗留明文密码
if [ -f .env ]; then
  sed "s/^VERSION=.*/VERSION=${IMG_VERSION}/" .env > .env.tmp
  grep -q '^VERSION=' .env || echo "VERSION=${IMG_VERSION}" >> .env.tmp
  mv .env.tmp .env
fi
# ⚠️ 必须带 --force-recreate。`up -d` 的判断依据是「本地有没有这个 tag 的镜像」：
# tag 没变（latest，或同一个版本号重发镜像）而 digest 变了时，它会认为无需变更、
# 原地不动，且**不报任何错**。表现就是「部署成功，但新功能一个都没上线」——
# 2026-10-29 那次就是这样：GHCR 上 latest 已指向新提交，容器还跑着一天前的镜像。
# 无条件重建的代价只是十几秒停机，比判断「该不该重建」可靠。
VERSION="$IMG_VERSION" docker compose up -d --force-recreate frontend backend

echo "[update] 4/4 等待服务就绪并健康检查..."
sleep 15
"$SCRIPT_DIR/healthcheck.sh"

# 打印两个容器的创建时间与镜像，供人工核对「两边都换过了」（README 第 3 条）
docker inspect vp-frontend --format '[update] frontend 创建于 {{.Created}}  镜像 {{.Config.Image}}' 2>/dev/null || true
docker inspect vp-backend --format '[update] backend  创建于 {{.Created}}  镜像 {{.Config.Image}}' 2>/dev/null || true

echo "[update] 升级完成。如需回滚请使用 ./rollback.sh <旧版本号>"
