-- V010: 专项条口台账 + 通用附件归属
-- 背景：新增「专项条口台账」业务（水利/民政/… 各条口的工作记录与人工/机械/发票费用），
--       以及一套「通用附件」能力（合同 PDF、发票图片等可挂到任意业务记录上）。
--
-- 设计取舍：
-- 1. 台账用一张宽表 ledger_record 表达，费用固定为 人工费/机械费/发票费 三列，
--    汇总统计直接 GROUP BY + SUM，最简单也最好维护；条口/工作类型用代码存储，
--    中文名由后端 LEDGER_CATEGORIES 配置映射（新增条口只改 TS 配置，与导入类型同一套路）。
-- 2. 附件归属复用已有 file_info 表，仅加 biz_type/biz_id 两个可空列作为通用锚点，
--    任何模块（台账/人员/家庭）都能挂附件，无需额外关联表。

-- =============================================================
-- 1. 专项条口台账记录表
-- =============================================================
CREATE TABLE IF NOT EXISTS `ledger_record` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `category`       VARCHAR(32)  NOT NULL COMMENT '条口编码(如 WATER)',
  `work_type`      VARCHAR(32)  NOT NULL COMMENT '工作类型编码(如 RIVER_MOWING)',
  `record_date`    DATE         NOT NULL COMMENT '工作日期',
  `location`       VARCHAR(255) DEFAULT NULL COMMENT '地点/河段/泵站名',
  `grid_id`        BIGINT       DEFAULT NULL COMMENT '关联网格(可选)',
  `title`          VARCHAR(255) NOT NULL COMMENT '事项标题',
  `detail`         TEXT         DEFAULT NULL COMMENT '工作内容/明细',
  `labor_cost`     DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '人工费(元)',
  `machinery_cost` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '机械费(元)',
  `invoice_cost`   DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '发票费用(元)',
  `invoice_no`     VARCHAR(64)  DEFAULT NULL COMMENT '发票号',
  `responsible`    VARCHAR(64)  DEFAULT NULL COMMENT '负责人/经办人',
  `remark`         VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `created_by`     BIGINT       DEFAULT NULL COMMENT '创建人',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lr_cat_wt` (`category`,`work_type`),
  KEY `idx_lr_date` (`record_date`),
  KEY `idx_lr_grid` (`grid_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='专项条口台账记录';

-- =============================================================
-- 2. file_info 扩展通用归属字段
-- =============================================================
ALTER TABLE `file_info`
  ADD COLUMN `biz_type` VARCHAR(32) DEFAULT NULL COMMENT '业务归属类型(LEDGER/PERSON/...)' AFTER `content_type`,
  ADD COLUMN `biz_id`   BIGINT       DEFAULT NULL COMMENT '业务归属记录ID' AFTER `biz_type`,
  ADD KEY `idx_file_biz` (`biz_type`,`biz_id`);

-- =============================================================
-- 3. 权限：台账查看(菜单) 与 台账管理(增删改/配置)
--    不显式给 id：依赖唯一索引 uk_perm_code 保证幂等（同 V009）。
-- =============================================================
INSERT INTO `sys_permission` (`code`, `name`, `type`, `sort`) VALUES
  ('ledger:view',  '专项台账', 'MENU',   90),
  ('ledger:manage','台账管理', 'ACTION', 91)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `type` = VALUES(`type`);

-- 仅授予系统管理员（幂等：INSERT IGNORE + uk_rp 唯一索引防重复）
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r, `sys_permission` p
WHERE r.code = 'SYSTEM_ADMIN' AND p.code IN ('ledger:view', 'ledger:manage');
