#!/usr/bin/env bash
# =============================================================
# 数据库恢复脚本
# 用法：./restore.sh <备份文件路径>
# 示例：./restore.sh ../backups/village_population_20260101_000000.sql.gz
# 警告：恢复会覆盖当前数据库数据，请先确认已备份
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="vp-mysql"

ENV_FILE="${SCRIPT_DIR}/../.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi
DB_NAME="${MYSQL_DATABASE:-village_population}"
ROOT_PWD="${MYSQL_ROOT_PASSWORD:?缺少 MYSQL_ROOT_PASSWORD}"

BACKUP_FILE="${1:?用法: ./restore.sh <备份文件路径>}"
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[restore] 备份文件不存在：$BACKUP_FILE" >&2
  exit 1
fi

echo "[restore] 即将从 $BACKUP_FILE 恢复到数据库 ${DB_NAME}（覆盖现有数据）"
read -r -p "确认继续？(输入 yes 继续): " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "[restore] 已取消"
  exit 0
fi

echo "[restore] 开始恢复..."
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" sh -c "mysql -uroot -p'${ROOT_PWD}' ${DB_NAME}"
else
  docker exec -i "$CONTAINER" sh -c "mysql -uroot -p'${ROOT_PWD}' ${DB_NAME}" < "$BACKUP_FILE"
fi

echo "[restore] 恢复完成，请检查数据并验证核心功能"
