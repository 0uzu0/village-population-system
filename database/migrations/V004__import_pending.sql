-- V004: 导入待核查人员
-- Excel 导入时「身份证号为空」或「身份证号非法」的行不进入 person 正式档案，
-- 单独落入 import_pending 待核查表，供人工补录、确认入库或忽略。

CREATE TABLE IF NOT EXISTS `import_pending` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `batch_no`      VARCHAR(64)  DEFAULT NULL COMMENT '导入批次号',
  `row_no`        INT          DEFAULT NULL COMMENT '源 Excel 行号',
  `reason`        VARCHAR(32)  NOT NULL DEFAULT 'ID_CARD_MISSING' COMMENT '待核查原因: ID_CARD_MISSING / ID_CARD_INVALID',
  `reason_text`   VARCHAR(255) DEFAULT NULL COMMENT '原因说明',
  `name`          VARCHAR(64)  DEFAULT NULL COMMENT '姓名',
  `gender`        VARCHAR(16)  DEFAULT NULL COMMENT '性别原文(男/女)',
  `birth_date`    DATE         DEFAULT NULL COMMENT '出生日期',
  `id_card`       VARCHAR(32)  DEFAULT NULL COMMENT '身份证号原样（可能为空或非法）',
  `phone`         VARCHAR(20)  DEFAULT NULL COMMENT '手机号',
  `phone_backup`  VARCHAR(20)  DEFAULT NULL COMMENT '备用手机号',
  `hukou_address` VARCHAR(255) DEFAULT NULL COMMENT '户籍地址',
  `live_address`  VARCHAR(255) DEFAULT NULL COMMENT '实际居住地址',
  `village`       VARCHAR(128) DEFAULT NULL COMMENT '所属村庄',
  `grid_no`       VARCHAR(64)  DEFAULT NULL COMMENT '网格编号原样',
  `family_no`     VARCHAR(64)  DEFAULT NULL COMMENT '家庭编号原样',
  `relation`      VARCHAR(32)  DEFAULT NULL COMMENT '与户主关系原样',
  `raw_data`      TEXT         COMMENT '整行原始数据 JSON',
  `status`        VARCHAR(20)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING 待核查 / RESOLVED 已入库 / IGNORED 已忽略',
  `handle_note`   VARCHAR(255) DEFAULT NULL COMMENT '处理备注',
  `handled_by`    BIGINT       DEFAULT NULL COMMENT '处理人',
  `handled_at`    DATETIME     DEFAULT NULL COMMENT '处理时间',
  `created_by`    BIGINT       DEFAULT NULL COMMENT '导入人',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ip_batch` (`batch_no`),
  KEY `idx_ip_status` (`status`),
  KEY `idx_ip_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='导入待核查人员';

-- 导入任务增加待核查行数统计
ALTER TABLE `excel_import_task`
  ADD COLUMN `pending_count` INT NOT NULL DEFAULT 0 COMMENT '待核查行数（身份证缺失/非法）' AFTER `fail_count`;
