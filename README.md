# 村级人口与重点人群精细化管理系统

以村民人口档案为基础、以家庭关系和网格管理为组织结构、以人口标签体系为业务核心、以数据筛选统计和 Excel 导入导出为主要工作方式的村级人口管理系统，服务约 10,000 名村民规模。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 · TypeScript · Vite · Element Plus · Pinia · Vue Router · ECharts · Axios |
| 后端 | Node.js · Express · mysql2 · JWT · zod · exceljs（模块化单体） |
| 数据库 | MySQL 8 |
| 部署 | Docker · Docker Compose · Nginx · GitHub Actions · GHCR（linux/amd64） |

## 目录结构

```
├── frontend/                 # 前端（Vue 3 + TS）
├── backend/                  # 后端（Node.js + Express）
│   └── src/db/migrations/    # 数据库版本化迁移脚本
├── database/migrations/      # 迁移脚本镜像（参考）
├── deploy/                   # 生产部署（compose、脚本、.env.example）
├── docs/                     # 部署文档、测试报告、更新回滚说明
└── .github/workflows/        # CI/CD（docker-publish.yml）
```

## 核心功能

- **人口档案**：多条件筛选、标签检索、分页、变更历史、批量操作。
- **家庭 / 网格**：家庭关系维护、户主变更、跨网格转移。
- **标签体系**：分类/定义/个人标签/家庭标签、历史追溯、交集/并集筛选、重点人群。
- **统计**：真实 API 驱动的统计卡片与图表，明确统计口径，标签交叉计数不虚加。
- **Excel**：模板导入、校验、错误行下载、批次记录、按字段导出、审计。
- **权限安全**：管理员/普通用户两态权限、审计日志。

## 快速开始（本地开发）

```bash
# 后端
cd backend
cp .env.example .env        # 配置数据库连接
npm install
npm run dev                 # 启动后自动执行数据库迁移

# 前端
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

默认账号：`admin` / `Admin@123456`（由后端首次启动自动创建，密码可在 `.env` 配置）。

## 部署

详见 [docs/部署文档.md](docs/部署文档.md)、[docs/更新与回滚说明.md](docs/更新与回滚说明.md)。

```bash
cd deploy
cp .env.example .env
docker compose up -d
```

## 测试

```bash
cd backend && npm test      # 单元测试（身份校验、年龄、标签筛选 SQL）
cd frontend && npm run build # 类型检查 + 生产构建
```

## 安全声明

本项目代码中不含任何真实村民信息，演示数据均为虚构。密码使用 bcrypt 哈希，生产环境必须启用 HTTPS。
