-- =============================================================
-- V027 MCP 长期访问令牌
-- =============================================================
-- 背景：MCP 端点是 POST /api/mcp，鉴权完全复用网页登录的 JWT（7 天有效）。
-- 这对「偶尔用 AI 查一次」没问题，但对真实用法（Claude Desktop / Cherry Studio
-- 这类客户端把配置存成 JSON 常驻）很别扭：每 7 天要去改一次配置文件里的
-- token，改密码会让所有客户端静默失效，而且没地方单独吊销某一台设备。
--
-- 做法：单开一张表存长期令牌，与 JWT 并存（不是替换）。
--   - JWT：给人用，短命，跟着浏览器会话走
--   - mcp_token：给机器用，长命，可单独吊销，可限定只读
--
-- 四个安全决定（每一个都是刻意的，改动前先看这里）：
-- 1. **库中不存明文**，只存 sha256。明文仅在创建响应里返回一次，之后任何接口
--    都拿不回来。库被拖走也不能直接冒充 AI 客户端。
-- 2. **不绑邮箱手机号之类的身份，强制绑 user_id**：每次调用按 user_id 重新加载
--    权限集合，所以管理员在网页上给某人降权，那台设备的令牌下一次调用就降权了，
--    不需要吊销重发。
-- 3. **绑签发时的 token_version**：改密码 / 停用账号会把 sys_user.token_version +1，
--    所有令牌随之失效（与 JWT 同一套失效语义）。「长期」指的是不像 JWT 那样
--    固定 7 天到期，而不是「改密码也杀不掉」——否则手机丢了改密码会发现 AI 还能用。
-- 4. **scope 默认 read**：长期令牌泄露的代价远大于短命 JWT，默认只给只读；
--    要写入必须显式创建 write 令牌，且仍受 MCP_WRITE_LEVEL 全局开关约束
--    （两个开关取更严的那个）。
--
-- 无外键（全库统一约定）。本系统不提供删除用户的接口，停用账号会把
-- sys_user.token_version +1，名下令牌随之全部失效，所以不存在「孤儿令牌」。
-- CREATE TABLE IF NOT EXISTS，本文件可重跑。

CREATE TABLE IF NOT EXISTS `mcp_token` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id` INT UNSIGNED NOT NULL COMMENT '归属用户；每次调用按此 id 重新加载权限',
  `name` VARCHAR(64) NOT NULL COMMENT '备注名，如「Claude Desktop」「运维巡检」',
  `token_hash` CHAR(64) NOT NULL COMMENT 'sha256 十六进制；明文只在创建时返回一次',
  `token_prefix` VARCHAR(16) NOT NULL COMMENT '令牌前 12 位，列表展示用于区分是哪一枚',
  `scope` VARCHAR(8) NOT NULL DEFAULT 'read' COMMENT 'read 只读 / write 继承用户权限并受 MCP_WRITE_LEVEL 约束',
  `token_version` INT NOT NULL DEFAULT 0 COMMENT '签发时 sys_user.token_version；改密码后自动失效',
  `expires_at` DATETIME NULL DEFAULT NULL COMMENT 'NULL 表示长期有效',
  `last_used_at` DATETIME NULL DEFAULT NULL COMMENT '最近使用时间（节流更新，误差约 1 分钟）',
  `last_used_ip` VARCHAR(64) NULL DEFAULT NULL COMMENT '最近使用来源 IP',
  `revoked_at` DATETIME NULL DEFAULT NULL COMMENT '吊销时间；不物理删除，保留追溯',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mcp_token_hash` (`token_hash`),
  KEY `idx_mcp_token_user` (`user_id`, `revoked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='MCP 长期访问令牌';
