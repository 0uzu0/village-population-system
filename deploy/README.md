# deploy 部署目录

本目录包含生产部署所需的全部文件。详细步骤见项目根目录 `docs/部署文档.md`。

## 目录结构

```
deploy/
├── docker-compose.yml      # 生产编排（frontend + backend + mysql）
├── .env.example            # 环境变量示例（复制为 .env 后填写）
├── data/uploads/           # 附件（现场照片 / 合同扫描件）—— 绑载到宿主机的真实目录
├── backups/                # 备份产物（数据库 .sql.gz + 附件 .tar.gz，两份成对）
├── scripts/
│   ├── backup.sh           # 数据库 + 附件备份
│   ├── restore.sh          # 数据库恢复
│   ├── healthcheck.sh      # 健康检查
│   ├── update.sh           # 镜像升级
│   └── rollback.sh         # 版本回滚
└── README.md
```

## 附件（现场照片 / 合同扫描件）存在哪里

**存在宿主机上，就是一个普通目录**，默认 `deploy/data/uploads/`，
由 `.env` 的 `UPLOAD_DIR_HOST` 决定（容器内的 `/app/uploads` 绑到这里）：

```bash
ls -lh data/uploads | head            # 直接翻目录就能看到照片
docker exec vp-backend ls /app/uploads | head   # 容器里看是同一批文件
```

文件名就是**拍照时间 + 谁 + 人员编号**（例：`20261016-193012-张三-P000123.jpg`），
所以即使不查数据库，光看文件名也能对上是哪天去谁家拍的。
`file_name`（给人看的名字）存在数据库 `file_info` 表里，
`storage_name`（落盘名，全 ASCII）就是上面这个文件名。

### 为什么绑宿主机目录而不是 docker named volume

附件是这套系统里**唯一无法靠重新部署恢复的东西**：数据库有迁移脚本与备份，
代码有镜像，照片丢了就是丢了。named volume 的文件藏在
`/var/lib/docker/volumes/<项目>_uploads_data/_data` 下面（root 权限、哈希目录名），
想用文件管理器看一眼、或 `rsync` 到 NAS，都得先绕一圈找路径；
绑到宿主机目录后，备份就是复制一个普通文件夹。

### 从 named volume 迁到宿主机目录（老部署升级用）

老版本用 `uploads_data` 命名卷，升级后容器会去看新的绑载目录，
**不搬一次的话，原来的照片会「全部消失」**（文件还在卷里，只是没人再看它）。

```bash
cd deploy
docker compose down                        # 先停，避免迁移途中还在写
mkdir -p data/uploads
docker run --rm \
  -v village-population_uploads_data:/from \
  -v "$PWD/data/uploads":/to \
  alpine sh -c "cp -av /from/. /to/"
ls -l data/uploads | head                   # 核对文件数对不对
docker compose up -d
```

`village-population` 是 compose 里的项目名（`docker-compose.yml` 的 `name:`），
若不确定卷名，用 `docker volume ls | grep uploads` 查一下。
确认无误后再删旧卷：`docker volume rm village-population_uploads_data`。

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
- **持久化**：数据库在 `mysql_data` 命名卷里；**附件在宿主机目录 `data/uploads/`**（见上一节）。升级镜像**不会**清空数据。
- **镜像版本**：生产环境请在 `.env` 中将 `VERSION` 固定为具体版本号（如 `v1.0.1`），不要长期使用 `latest`。
- **备份**：`scripts/backup.sh` 会同时备份**数据库与附件**，两份必须成对保存、成对恢复
  （附件的归属关系在数据库里，缺一份都会导致照片找不到主人或彻底丢失）。
  请把 `backups/` 同步到独立存储（另一台机器 / NAS / 移动硬盘）。

## 备份与恢复附件

```bash
./scripts/backup.sh
# backups/village_population_20261016_201500.sql.gz   ← 数据库
# backups/uploads_20261016_201500.tar.gz              ← 附件

# 恢复数据库（会覆盖现有数据，需输入 yes 确认）
./scripts/restore.sh backups/village_population_20261016_201500.sql.gz

# 恢复附件：绑载目录就是个普通文件夹，直接解包即可（用同一时间戳的那一份）
mkdir -p data/uploads
tar -xzf backups/uploads_20261016_201500.tar.gz -C data
```

只想单独拿走一批照片（例如交给村里存档）时，直接从宿主机目录拷就行：

```bash
cp -r data/uploads ~/照片存档_$(date +%Y%m%d)
# 或者按时间筛：2026 年 10 月 16 日拍的那些（文件名以拍照时间开头）
find data/uploads -name '20261016-*' -exec cp {} ~/照片存档/ \;
```

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
