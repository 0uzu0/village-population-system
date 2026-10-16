#!/usr/bin/env bash
# =============================================================
# 备份脚本（数据库 + 附件，两份必须成对）
# 用法：./backup.sh
# 输出：
#   backups/village_population_YYYYMMDD_HHMMSS.sql.gz   —— 数据库
#   backups/uploads_YYYYMMDD_HHMMSS.tar.gz              —— 附件（现场照片/合同扫描件）
#
# 为什么必须一起备份：附件的**归属信息在数据库里**（file_info 的 biz_type/biz_id
# 决定这张照片是谁的）。只备份图片，恢复到别的机器上就只剩下一堆文件，
# 「这个人的现场照片」这一屏会是空的；只备份数据库，则照片文件全部丢失、找不回来。
#
# 建议通过 crontab 定期执行，并把 backups 目录同步到独立存储（另一台机器/NAS/移动硬盘）。
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${SCRIPT_DIR}/.."
BACKUP_DIR="${DEPLOY_DIR}/backups"
CONTAINER="vp-mysql"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

# 从 .env 读取数据库名、root 密码与附件目录
ENV_FILE="${DEPLOY_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi
DB_NAME="${MYSQL_DATABASE:-village_population}"
ROOT_PWD="${MYSQL_ROOT_PASSWORD:?缺少 MYSQL_ROOT_PASSWORD，请在 .env 中配置}"

# 附件目录：宿主机上的真实路径，与 docker-compose.yml 里的绑载保持一致。
# 相对路径按 deploy/ 解析（compose 的相对路径也是这个基准）。
UPLOAD_HOST_DIR="${UPLOAD_DIR_HOST:-./data/uploads}"
if [[ "$UPLOAD_HOST_DIR" != /* ]]; then
  UPLOAD_HOST_DIR="${DEPLOY_DIR}/${UPLOAD_HOST_DIR}"
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.sql.gz"
FILES_FILE="${BACKUP_DIR}/uploads_${STAMP}.tar.gz"

echo "[backup] 1/2 备份数据库 ${DB_NAME} ..."
# 通过 MYSQL_PWD 环境变量传密码，避免密码出现在进程命令行（ps 可见）
docker exec -e MYSQL_PWD="$ROOT_PWD" "$CONTAINER" \
  mysqldump -uroot --single-transaction --quick --routines --triggers "$DB_NAME" \
  | gzip > "$OUT_FILE"
echo "[backup]     完成：$OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

echo "[backup] 2/2 备份附件目录 $UPLOAD_HOST_DIR ..."
if [[ -d "$UPLOAD_HOST_DIR" ]]; then
  # -C 到父目录再打包，包里就是 uploads/ 这一层，恢复时解到哪都不会散落一地
  tar -czf "$FILES_FILE" -C "$(dirname "$UPLOAD_HOST_DIR")" "$(basename "$UPLOAD_HOST_DIR")"
  COUNT="$(find "$UPLOAD_HOST_DIR" -type f | wc -l | tr -d ' ')"
  echo "[backup]     完成：$FILES_FILE（$COUNT 个文件，$(du -h "$FILES_FILE" | cut -f1)）"
else
  echo "[backup]     跳过：目录还不存在（还没上传过附件），绑载路径：$UPLOAD_HOST_DIR"
fi

echo "[backup] 全部完成。请把以下两份一起复制到独立存储："
ls -lh "$OUT_FILE" 2>/dev/null || true
ls -lh "$FILES_FILE" 2>/dev/null || true

# 可选：保留最近 N 天的备份（数据库与附件用同一个天数，避免只剩一半）
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
echo "[backup] 已清理 ${KEEP_DAYS} 天前的旧备份（可用 BACKUP_KEEP_DAYS 调整）"
