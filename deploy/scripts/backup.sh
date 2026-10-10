#!/usr/bin/env bash
# =============================================================
# 数据库备份脚本
# 用法：./backup.sh
# 输出：backups/village_YYYYMMDD_HHMMSS.sql.gz
# 建议通过 crontab 定期执行，并将 backups 目录同步到独立存储
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../backups"
CONTAINER="vp-mysql"

# 从 .env 读取数据库名与 root 密码
ENV_FILE="${SCRIPT_DIR}/../.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi
DB_NAME="${MYSQL_DATABASE:-village_population}"
ROOT_PWD="${MYSQL_ROOT_PASSWORD:?缺少 MYSQL_ROOT_PASSWORD，请在 .env 中配置}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.sql.gz"

echo "[backup] 开始备份数据库 ${DB_NAME} ..."
# 通过 MYSQL_PWD 环境变量传密码，避免密码出现在进程命令行（ps 可见）
docker exec -e MYSQL_PWD="$ROOT_PWD" "$CONTAINER" \
  mysqldump -uroot --single-transaction --quick --routines --triggers "$DB_NAME" \
  | gzip > "$OUT_FILE"

echo "[backup] 备份完成：$OUT_FILE"
ls -lh "$OUT_FILE"

# 可选：保留最近 30 份备份
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +30 -delete 2>/dev/null || true
echo "[backup] 已清理 30 天前的旧备份"
