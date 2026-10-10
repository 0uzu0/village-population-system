# ============ 构建阶段 ============
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install

COPY . .
RUN npm run build

# ============ 运行阶段 ============
FROM nginx:1.27-alpine AS runner

# 自定义 Nginx 配置（含 history 回退与 API 反向代理）
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 静态资源
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
