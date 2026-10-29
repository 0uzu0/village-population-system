# 村级人口与重点人群精细化管理系统

以村民人口档案为基础、以家庭关系和网格管理为组织结构、以人口标签体系为业务核心、以数据筛选统计和 Excel 导入导出为主要工作方式的村级人口管理系统，服务约 10,000 名村民规模。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 · TypeScript · Vite · Element Plus · Pinia · Vue Router · ECharts · Axios |
| 移动端 | Kotlin · Jetpack Compose · Retrofit · OkHttp · kotlinx.serialization · WorkManager |
| 后端 | Node.js · Express · mysql2 · JWT · zod · exceljs（模块化单体） |
| 数据库 | MySQL 8 |
| 部署 | Docker · Docker Compose · Nginx · GitHub Actions · GHCR（linux/amd64） |

## 目录结构

```
├── frontend/                 # 前端（Vue 3 + TS）
├── android/                  # 安卓移动端（Kotlin + Compose，网格员外勤用）
├── backend/                  # 后端（Node.js + Express）
│   └── src/db/migrations/    # 数据库版本化迁移脚本（唯一来源，启动时自动执行）
├── deploy/                   # 生产部署（compose、脚本、.env.example）
├── docs/                     # 部署/回滚/数据库说明、架构规范、移动端设计稿
│   └── archive/              # 历史快照（代码审计报告、优化建议），只读
└── .github/workflows/        # CI/CD（docker-publish.yml、android.yml）
```

## 核心功能

- **人口档案**：多条件筛选、标签检索、分页、变更历史、批量操作。
- **家庭 / 网格**：家庭关系维护、户主变更与改选、跨网格转移；户主死亡/迁出时会提示改选并给出建议人选。
- **标签体系**：分类/定义/个人标签、历史追溯、交集/并集筛选、重点人群；仅个人级口径（家庭级标签已下线）。
- **统计**：真实 API 驱动的统计卡片与图表，明确统计口径，标签交叉计数不虚加。
- **Excel**：模板导入、校验、错误行下载、批次记录、按字段导出、审计。
- **专项台账**：水利/民政/卫健条口的日常工作量录入、附件留痕与统计。
- **权限安全**：管理员/普通用户两态权限、审计日志。
- **移动端（外勤）**：查人、上门登记、改状态、打标签、拍照留痕、台账速记、待核查处理；
  支持离线暂存（断网时写操作排队，联网自动重传）与本地缓存兜底。

## MCP 接入（让 AI 客户端直接查这套数据）

后端同时暴露一个标准的 MCP 服务端点，Claude Desktop / Cursor 等客户端配好即可直接查人、查统计、
加标签、导名单，不需要另建一套接口。

- **端点**：`POST /api/mcp`（无状态 JSON-RPC 2.0，未引入 SDK）；工具清单 `GET /api/mcp/manifest`。
- **56 个工具**：38 个只读 + 18 个写入。工具只做声明、不写 SQL，用**调用者自己的身份**
  回请求既有 REST 接口，因此权限校验、数据范围、审计与网页端完全一致。
- **鉴权两条通道**：网页登录的 JWT，或长期令牌（`vpm_` 前缀，sha256 入库、明文只显示一次、
  可单独吊销/设过期，且**只对 `/api/mcp` 有效**）。在「系统设置 → AI 接入」页生成与管理。
- **写操作三层闸门**：工具 `scope`（read/write/danger）× `MCP_WRITE_LEVEL`（off/basic/full）×
  `MCP_ALLOW_DESTRUCTIVE`。默认 `off`——写工具**不会出现在工具列表里**，而不只是被拒绝。
- **脱敏**：身份证保留前 6 后 4、手机保留前 3 后 4；需要原值再设 `MCP_PII_MODE=full`。
  每次调用的口径（在册/含死亡等）随结果下发在 `_meta.caliber` 里。

```json
{
  "mcpServers": {
    "village-population": {
      "type": "http",
      "url": "https://<你的域名>/api/mcp",
      "headers": { "Authorization": "Bearer vpm_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

改完配置可用内置脚本自检（逐个实调全部工具，输出 OK/FAIL/SKIP）：

```bash
cd backend
MCP_URL=https://<你的域名>/api/mcp MCP_TOKEN=vpm_xxx npm run mcp:smoke
```

## 移动端（安卓 App）

面向村级网格员的外勤作业端，复用同一套后端接口与权限体系，**未新增任何服务端接口**。

```bash
cd android
./gradlew assembleDebug                 # 产物：app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest             # 单元测试（身份证解析、年龄、离线队列、主题令牌对比度）
```

打包时注入默认服务器地址（装到手机后仍可在「我的 → 服务器地址」修改，因此同一个包可分发给多个村）：

```bash
./gradlew assembleRelease -PapiBaseUrl=http://192.168.1.100:8080/ -PversionName=1.0.0
```

自动打包见 `.github/workflows/android.yml`：push 到 `main`（改动涉及 `android/**`）会同时产出
`app-debug` 与 `app-release` 两个安装包（只有 PR 不出 release，省 CI）；打 `v*` 标签还会把
release 包挂到 GitHub Release，附件名为 `village-app-<版本>.apk`。
文件名用 ASCII 是必须的：GitHub 会把 Release 附件名里的中文字符直接删掉
（`掌上村务-1.0.0.apk` 会变成 `-1.0.0.apk`），所以中文只出现在 Release 说明文字里。
正式签名需要把 4 个 `ANDROID_KEYSTORE_*` / `ANDROID_KEY_*`
密钥全部配齐，缺任意一项会自动降级为 debug 签名（能装、不能上架）。设计说明见
[docs/移动端设计说明.html](docs/移动端设计说明.html)，**视觉基准**以
[docs/移动端改版设计稿.html](docs/移动端改版设计稿.html)（v4）为准。

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

首次部署照上面即可。**升级必须带 `--force-recreate`**（或直接用 `./scripts/update.sh <版本>`）：
`up -d` 只按镜像 tag 名判断要不要重建，同 tag 重发、或用 `VERSION=latest` 时它认为「无需变更」，
拉到了新镜像也不会重建，表现为「部署完了但功能没变」。

## 测试

```bash
cd backend  && npm test                    # 47 个测试文件
cd frontend && npm test && npm run build   # 单测 + 类型检查 + 生产构建
cd android  && ./gradlew testDebugUnitTest # 14 个测试文件
```

后端以 vitest 为主，除了纯函数（身份证、年龄、关系归一），还有大量**静态守卫**：
路由与 MCP 工具路径必须真实存在、迁移文件必须可重入、`MCP_PII_MODE` 读取必须先归一化、
前端仓库里不许出现 `vite.config.js`（会静默遮蔽 `.ts` 配置）等。
这类断言的价值是「改错了立刻报红」，而不是验证某段业务逻辑的返回值——新增功能时别只写 happy path。

CI 门禁统一为 `lint → test → build`，任一步失败不发布镜像。

## 安全声明

本项目代码中不含任何真实村民信息，演示数据均为虚构。密码使用 bcrypt 哈希，生产环境必须启用 HTTPS。

> 例外说明：安卓端在网络安全配置中放行了明文 HTTP。原因是后端常部署在村委内网 NAS 上、
> 拿不到可用的 HTTPS 证书，若强制 HTTPS 则 App 无法连接。这在**内网**场景下是可接受的折中，
> 但**不适用于公网部署**——若要上公网，后端必须先上 HTTPS，届时应同步收紧该配置。
