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
