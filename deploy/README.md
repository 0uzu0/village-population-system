# deploy 部署目录

本目录包含生产部署所需的全部文件。详细步骤见项目根目录 `docs/部署文档.md`。

## 目录结构

```
deploy/
├── docker-compose.yml      # 生产编排（frontend + backend + mysql）
├── .env.example            # 环境变量示例（复制为 .env 后填写）
├── scripts/
│   ├── backup.sh           # 数据库备份
│   ├── restore.sh          # 数据库恢复
│   ├── healthcheck.sh      # 健康检查
│   ├── update.sh           # 镜像升级
│   └── rollback.sh         # 版本回滚
└── README.md
```

## 快速开始

```bash
cd deploy
cp .env.example .env        # 编辑 .env，填写密码、镜像地址与版本
docker compose up -d        # 启动（首次会自动建库、跑迁移、创建管理员）
docker compose ps           # 查看状态
./scripts/healthcheck.sh    # 健康检查
```

## 重要说明

- **数据库初始化**：由后端服务在启动时通过版本化迁移脚本（`backend/src/db/migrations`）自动完成，无需手动导入 SQL。
- **持久化**：`mysql_data` 与 `uploads_data` 两个命名卷持久化数据，升级镜像**不会**清空数据。
- **镜像版本**：生产环境请在 `.env` 中将 `VERSION` 固定为具体版本号（如 `v1.0.0`），不要长期使用 `latest`。
- **备份**：请用 `scripts/backup.sh` 定期备份，并将 `backups/` 同步到独立存储。

## 升级后「功能没变 / 某个页面不见了」怎么查

前端（nginx 镜像）与后端是两个独立镜像，**都更新到同一版本才算升级成功**。
只更新了一半，或者浏览器 / 中间层缓存了旧的 index.html，看到的就是旧界面——
此时「功能没做」通常是误判，按下面顺序先排除缓存，再怀疑镜像：

1. **看侧边栏左下角的构建标识**（形如 `v1.0.0 · 2026-10-16 15:20`）。
   与刚构建那一版对不上，手里就是旧包。
2. **硬刷新**：`Ctrl+Shift+R`，或开无痕窗口再看一次。只有硬刷新后才变新，就是浏览器缓存。
3. **对比两个容器的创建时间**——这一步最能直接命中「只更新了一半」：
   ```bash
   docker inspect vp-frontend --format 'frontend 创建于 {{.Created}}  镜像 {{.Config.Image}}'
   docker inspect vp-backend  --format 'backend  创建于 {{.Created}}  镜像 {{.Config.Image}}'
   ```
   两边都应该是本次升级时间。**frontend 明显早于 backend，就是前端容器没被重建**
   （典型症状：后端接口报「接口不存在」，同时某个前端页面看起来「不见了」）。
4. **强制重新拉取并重建容器**。注意 `docker compose up -d` 默认只在本地缺少镜像时才拉取，
   等价于「不更新」：
   ```bash
   VERSION=v1.0.0 docker compose pull frontend backend
   VERSION=v1.0.0 docker compose up -d --force-recreate frontend backend
   ```
5. **直接问服务端要的是哪一版**（哈希变了就说明入口 HTML 换了）：
   ```bash
   curl -s "http://127.0.0.1:${HTTP_PORT:-80}/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
   # 与 frontend/dist/index.html 里的哈希比对，一致即为最新
   ```
6. **改过 `frontend/nginx.conf` 的话**：它在构建期被 `COPY` 进镜像，
   必须**重新构建 frontend 镜像**，`up -d` 不会让配置生效。
   入口 HTML 的缓存策略就在这个文件里：`/index.html` 强制每次校验，
   `/assets/*` 长缓存（文件名带内容哈希，不会取到旧内容）。
