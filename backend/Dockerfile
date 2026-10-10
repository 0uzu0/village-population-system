# ============ 构建阶段 ============
FROM node:22-alpine AS builder
WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存
COPY package*.json ./
RUN npm ci || npm install

# 复制源码并构建
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# ============ 运行阶段 ============
FROM node:22-alpine AS runner
WORKDIR /app

# 以非 root 用户运行（alpine node 镜像内置 node 用户）
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512"

# 仅复制生产依赖与构建产物
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=builder /app/dist ./dist

# 数据目录（上传文件）权限
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 8080

# 健康检查接口由应用内 /api/health 提供
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "dist/index.js"]
