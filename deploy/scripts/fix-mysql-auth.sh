#!/usr/bin/env bash
# =============================================================
# 修复后端启动报错：
#   Error: Access denied for user 'village'@'172.x.x.x' (using password: YES)
#   code: 'ER_ACCESS_DENIED_ERROR', errno: 1045
#
# 根因（最常见）：
#   MySQL 只在数据目录为空时（首次启动）才根据 MYSQL_USER / MYSQL_PASSWORD
#   创建应用账号。数据卷 mysql_data 一旦初始化完成，之后修改 deploy/.env
#   里的 MYSQL_PASSWORD 不会同步到已存在的账号，于是后端用新密码连接被拒。
#
# 处理策略（不丢数据）：
#   用 root 进入 MySQL，按当前 .env 重建应用账号密码并授权，再重启后端。
#   全程只操作账号与权限，不删除任何业务数据。
#
# 用法（在服务器的 deploy 目录执行）：
#   bash scripts/fix-mysql-auth.sh              # 默认读 deploy/.env
#   bash scripts/fix-mysql-auth.sh /opt/vp/.env # 指定 env 文件
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
cd "$DEPLOY_DIR"

ENV_FILE="${1:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ 找不到环境变量文件：$DEPLOY_DIR/$ENV_FILE"
  exit 1
fi

# 读取 .env（原样读入，避免密码里的 $ # 等字符被二次展开）
set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

MYSQL_DATABASE="${MYSQL_DATABASE:-village_population}"
MYSQL_USER="${MYSQL_USER:-village}"
COMPOSE_FILE="docker-compose.yml"

if [ -z "${MYSQL_ROOT_PASSWORD:-}" ]; then
  echo "✗ $ENV_FILE 中未设置 MYSQL_ROOT_PASSWORD"
  exit 1
fi
if [ -z "${MYSQL_PASSWORD:-}" ]; then
  echo "✗ $ENV_FILE 中未设置 MYSQL_PASSWORD"
  exit 1
fi

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

echo "部署目录 : $DEPLOY_DIR"
echo "环境变量 : $ENV_FILE"
echo "数据库   : $MYSQL_DATABASE"
echo "应用账号 : $MYSQL_USER"
echo

echo "== 1) 后端容器实际读到的 DB 配置（密码只显示长度）=="
"${DC[@]}" exec -T backend \
  sh -c 'echo "DB_HOST=$DB_HOST DB_PORT=$DB_PORT DB_NAME=$DB_NAME DB_USER=$DB_USER DB_PASSWORD_LEN=${#DB_PASSWORD}"' \
  || echo "（后端容器未就绪，跳过）"
echo

echo "== 2) MySQL 中已存在的同名账号（为空说明首次初始化未生效）=="
"${DC[@]}" exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysql -uroot -N -B \
  -e "SELECT CONCAT(user,'@',host,'  plugin=',plugin) FROM mysql.user WHERE user='${MYSQL_USER}';" \
  || echo "（查询失败，请核对 MYSQL_ROOT_PASSWORD）"
echo

echo "== 3) 按当前 .env 重建应用账号密码并授权 =="
# 转义密码中的单引号，避免破坏 SQL 语法
ESC_PW="${MYSQL_PASSWORD//\'/\'\'}"
"${DC[@]}" exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysql -uroot -e "
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'%' IDENTIFIED BY '${ESC_PW}';
ALTER USER '${MYSQL_USER}'@'%' IDENTIFIED BY '${ESC_PW}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SELECT user, host, plugin FROM mysql.user WHERE user='${MYSQL_USER}';
"
echo

echo "== 4) 用应用账号自测连接 =="
if "${DC[@]}" exec -T -e MYSQL_PWD="$MYSQL_PASSWORD" mysql \
  mysql -u"$MYSQL_USER" -h 127.0.0.1 \
  -e "SELECT 'DB_OK' AS status;" ; then
  echo "✓ 应用账号连接成功"
else
  echo "✗ 应用账号仍无法连接，请核对上面的账号与密码"
  exit 1
fi
echo

echo "== 5) 重启后端使新连接生效 =="
"${DC[@]}" restart backend
sleep 10
"${DC[@]}" ps
echo
echo "完成。若后端仍报错，查看日志："
echo "  ${DC[*]} logs --tail=100 backend"
