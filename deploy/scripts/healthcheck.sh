#!/usr/bin/env bash
# =============================================================
# 健康检查脚本
# 用法：./healthcheck.sh
# 检查 frontend、backend、mysql 三个容器健康状态 + HTTP 探测
# HTTP 端口自动取 .env 中的 HTTP_PORT（默认 80）
# =============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$DEPLOY_DIR/.env"

# 读取 HTTP_PORT（与 docker-compose.yml 的端口映射保持一致）
HTTP_PORT="80"
if [ -f "$ENV_FILE" ]; then
  HTTP_PORT="$(grep -E '^HTTP_PORT=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  HTTP_PORT="${HTTP_PORT:-80}"
fi

DC=(docker compose -f "$DEPLOY_DIR/docker-compose.yml")
[ -f "$ENV_FILE" ] && DC+=(--env-file "$ENV_FILE")

echo "===== 容器状态 ====="
"${DC[@]}" ps

echo ""
echo "===== 健康检查 ====="
check_container() {
  local name="$1"
  local status
  status="$(docker inspect --format='{{.State.Health.Status}}' "$name" 2>/dev/null || echo 'not-found')"
  printf "%-16s : %s\n" "$name" "$status"
  if [[ "$status" == "healthy" ]]; then return 0; else return 1; fi
}

ok=0
for c in vp-frontend vp-backend vp-mysql; do
  check_container "$c" || ok=1
done

echo ""
echo "===== HTTP 探测（端口 ${HTTP_PORT}）====="
if command -v curl >/dev/null 2>&1; then
  echo "前端: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HTTP_PORT}/" 2>/dev/null || echo '无法访问')"
  echo "后端健康接口: $(curl -s "http://127.0.0.1:${HTTP_PORT}/api/health" 2>/dev/null || echo '无法访问')"
else
  echo "未安装 curl，跳过 HTTP 探测"
fi

if [[ "$ok" -eq 0 ]]; then
  echo ""
  echo "✅ 全部服务健康"
else
  echo ""
  echo "⚠️  存在不健康服务，请检查 docker compose logs"
  exit 1
fi
