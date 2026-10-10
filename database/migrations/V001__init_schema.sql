-- =============================================================
-- 村级人口与重点人群精细化管理系统 - 数据库初始化脚本
-- 数据库：MySQL 8.x   字符集：utf8mb4
-- 说明：本脚本为版本化迁移 V001，由后端迁移器自动执行，
--       也可通过 deploy/mysql/init 或 mysql 命令行手动导入。
-- =============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------------
-- 1. 系统用户表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_user` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `username`      VARCHAR(64)  NOT NULL COMMENT '登录账号',
  `password_hash` VARCHAR(100) NOT NULL COMMENT '密码哈希(bcrypt)',
  `real_name`     VARCHAR(64)  NOT NULL COMMENT '姓名',
  `phone`         VARCHAR(20)  DEFAULT NULL COMMENT '手机号',
  `email`         VARCHAR(128) DEFAULT NULL COMMENT '邮箱',
  `avatar`        VARCHAR(255) DEFAULT NULL COMMENT '头像',
  `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '状态:1启用 0停用',
  `is_admin`      TINYINT      NOT NULL DEFAULT 0 COMMENT '是否超级管理员',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统用户表';

-- -------------------------------------------------------------
-- 2. 角色表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_role` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(64)  NOT NULL COMMENT '角色编码',
  `name`        VARCHAR(64)  NOT NULL COMMENT '角色名称',
  `data_scope`  VARCHAR(32)  NOT NULL DEFAULT 'SELF' COMMENT '数据范围:ALL/GRID/SELF',
  `remark`      VARCHAR(255) DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色表';

-- -------------------------------------------------------------
-- 3. 用户角色关联表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_user_role` (
  `id`      BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `role_id` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_role` (`user_id`,`role_id`),
  KEY `idx_ur_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户角色关联表';

-- -------------------------------------------------------------
-- 4. 权限表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_permission` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(128) NOT NULL COMMENT '权限编码(如 person:export)',
  `name`       VARCHAR(128) NOT NULL COMMENT '权限名称',
  `type`       VARCHAR(32)  NOT NULL DEFAULT 'ACTION' COMMENT '类型:MENU/ACTION',
  `parent_id`  BIGINT       DEFAULT NULL COMMENT '上级权限(菜单)',
  `sort`       INT          NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_perm_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='权限表';

-- -------------------------------------------------------------
-- 5. 角色权限关联表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_role_permission` (
  `id`            BIGINT NOT NULL AUTO_INCREMENT,
  `role_id`       BIGINT NOT NULL,
  `permission_id` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rp` (`role_id`,`permission_id`),
  KEY `idx_rp_perm` (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色权限关联表';

-- -------------------------------------------------------------
-- 6. 网格表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `grid` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `grid_no`     VARCHAR(64)  NOT NULL COMMENT '网格编号',
  `name`        VARCHAR(128) NOT NULL COMMENT '网格名称',
  `manager`     VARCHAR(64)  DEFAULT NULL COMMENT '网格负责人',
  `staff`       VARCHAR(255) DEFAULT NULL COMMENT '网格员(逗号分隔姓名)',
  `description` VARCHAR(500) DEFAULT NULL COMMENT '网格描述',
  `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '状态:1启用 0停用',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_grid_no` (`grid_no`),
  KEY `idx_grid_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='网格表';

-- -------------------------------------------------------------
-- 8. 家庭表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `family` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `family_no`      VARCHAR(64)  NOT NULL COMMENT '家庭编号',
  `head_person_id` BIGINT       DEFAULT NULL COMMENT '户主人员ID',
  `address`        VARCHAR(255) DEFAULT NULL COMMENT '家庭地址',
  `grid_id`        BIGINT       DEFAULT NULL COMMENT '所属网格',
  `status`         TINYINT      NOT NULL DEFAULT 1 COMMENT '状态:1正常 0解散',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_family_no` (`family_no`),
  KEY `idx_family_grid` (`grid_id`),
  KEY `idx_family_head` (`head_person_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭表';

-- -------------------------------------------------------------
-- 9. 人员档案表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `person` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT COMMENT '人员ID',
  `person_no`        VARCHAR(64)  NOT NULL COMMENT '内部人员编号',
  `name`             VARCHAR(64)  NOT NULL COMMENT '姓名',
  `former_name`      VARCHAR(64)  DEFAULT NULL COMMENT '曾用名',
  `gender`           VARCHAR(16)  NOT NULL COMMENT '性别:MALE/FEMALE',
  `birth_date`       DATE         DEFAULT NULL COMMENT '出生日期',
  `id_card`          VARCHAR(18)  DEFAULT NULL COMMENT '身份证号',
  `phone`            VARCHAR(20)  DEFAULT NULL COMMENT '手机号',
  `hukou_address`    VARCHAR(255) DEFAULT NULL COMMENT '户籍地址',
  `live_address`     VARCHAR(255) DEFAULT NULL COMMENT '实际居住地址',
  `village`          VARCHAR(128) DEFAULT NULL COMMENT '所属村庄',
  `grid_id`          BIGINT       DEFAULT NULL COMMENT '所属网格',
  `family_id`        BIGINT       DEFAULT NULL COMMENT '所属家庭(当前)',
  `relation`         VARCHAR(32)  DEFAULT NULL COMMENT '与户主关系',
  `status`           VARCHAR(20)  NOT NULL DEFAULT 'NORMAL' COMMENT '状态:NORMAL/MOVED_IN/MOVED_OUT/CANCELLED',
  `remark`           VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `data_source`      VARCHAR(32)  NOT NULL DEFAULT 'MANUAL' COMMENT '数据来源:MANUAL/EXCEL_IMPORT',
  `change_reason`    VARCHAR(255) DEFAULT NULL COMMENT '最近变更原因',
  `created_by`       BIGINT       DEFAULT NULL COMMENT '创建人',
  `updated_by`       BIGINT       DEFAULT NULL COMMENT '更新人',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_person_no` (`person_no`),
  UNIQUE KEY `uk_person_idcard` (`id_card`),
  KEY `idx_person_name` (`name`),
  KEY `idx_person_grid` (`grid_id`),
  KEY `idx_person_family` (`family_id`),
  KEY `idx_person_status` (`status`),
  KEY `idx_person_birth` (`birth_date`),
  KEY `idx_person_gender` (`gender`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人员档案表';

-- -------------------------------------------------------------
-- 10. 家庭成员关联表（权威关系）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `family_member` (
  `id`             BIGINT      NOT NULL AUTO_INCREMENT,
  `family_id`      BIGINT      NOT NULL,
  `person_id`      BIGINT      NOT NULL,
  `relation`       VARCHAR(32) NOT NULL COMMENT '与户主关系',
  `is_householder` TINYINT     NOT NULL DEFAULT 0 COMMENT '是否户主',
  `join_date`      DATE        DEFAULT NULL COMMENT '加入日期',
  `leave_date`     DATE        DEFAULT NULL COMMENT '迁出/离开日期',
  `status`         TINYINT     NOT NULL DEFAULT 1 COMMENT '状态:1在户 0已迁出',
  `created_at`     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fm` (`family_id`,`person_id`),
  KEY `idx_fm_person` (`person_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭成员关联表';

-- -------------------------------------------------------------
-- 11. 标签分类表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tag_category` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(64)  NOT NULL COMMENT '分类编码',
  `name`       VARCHAR(64)  NOT NULL COMMENT '分类名称',
  `sort`       INT          NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tc_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签分类表';

-- -------------------------------------------------------------
-- 12. 标签定义表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tag_definition` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `category_id`   BIGINT       NOT NULL COMMENT '所属分类',
  `name`          VARCHAR(64)  NOT NULL COMMENT '标签名称',
  `code`          VARCHAR(64)  NOT NULL COMMENT '标签编码',
  `alias`         VARCHAR(255) DEFAULT NULL COMMENT '别名(如 五保户)',
  `color`         VARCHAR(16)  NOT NULL DEFAULT '#3978F6' COMMENT '标签颜色',
  `description`   VARCHAR(500) DEFAULT NULL COMMENT '标签说明',
  `object_type`   VARCHAR(16)  NOT NULL DEFAULT 'PERSON' COMMENT '适用对象:PERSON/FAMILY',
  `allow_duplicate` TINYINT    NOT NULL DEFAULT 0 COMMENT '是否允许重复关联',
  `is_sensitive`  TINYINT      NOT NULL DEFAULT 0 COMMENT '是否敏感标签',
  `need_audit`    TINYINT      NOT NULL DEFAULT 0 COMMENT '是否需要审核',
  `enabled`       TINYINT      NOT NULL DEFAULT 1 COMMENT '是否启用',
  `created_by`    BIGINT       DEFAULT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_td_code` (`code`),
  KEY `idx_td_category` (`category_id`),
  KEY `idx_td_object` (`object_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签定义表';

-- -------------------------------------------------------------
-- 13. 人员标签关联表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `person_tag` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `person_id`    BIGINT       NOT NULL,
  `tag_id`       BIGINT       NOT NULL,
  `effect_date`  DATE         DEFAULT NULL COMMENT '生效日期',
  `expire_date`  DATE         DEFAULT NULL COMMENT '失效日期',
  `status`       VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE' COMMENT '状态:ACTIVE/INACTIVE/PENDING',
  `basis`        VARCHAR(500) DEFAULT NULL COMMENT '关联依据/业务备注',
  `created_by`   BIGINT       DEFAULT NULL COMMENT '录入人',
  `audited_by`   BIGINT       DEFAULT NULL COMMENT '审核人',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pt_person` (`person_id`),
  KEY `idx_pt_tag` (`tag_id`),
  KEY `idx_pt_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人员标签关联表';

-- -------------------------------------------------------------
-- 14. 家庭标签关联表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `family_tag` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `family_id`   BIGINT       NOT NULL,
  `tag_id`      BIGINT       NOT NULL,
  `effect_date` DATE         DEFAULT NULL,
  `expire_date` DATE         DEFAULT NULL,
  `status`      VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
  `basis`       VARCHAR(500) DEFAULT NULL,
  `created_by`  BIGINT       DEFAULT NULL,
  `audited_by`  BIGINT       DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ft_family` (`family_id`),
  KEY `idx_ft_tag` (`tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭标签关联表';

-- -------------------------------------------------------------
-- 15. 人员变更记录表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `person_change_log` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `person_id`   BIGINT       NOT NULL,
  `field_name`  VARCHAR(64)  DEFAULT NULL COMMENT '变更字段',
  `old_value`   TEXT         DEFAULT NULL COMMENT '旧值',
  `new_value`   TEXT         DEFAULT NULL COMMENT '新值',
  `change_type` VARCHAR(32)  NOT NULL DEFAULT 'UPDATE' COMMENT 'CREATE/UPDATE/STATUS_CHANGE/TAG',
  `reason`      VARCHAR(255) DEFAULT NULL COMMENT '变更原因',
  `operator_id` BIGINT       DEFAULT NULL COMMENT '操作人',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pcl_person` (`person_id`),
  KEY `idx_pcl_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人员变更记录表';

-- -------------------------------------------------------------
-- 16. 标签变更记录表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tag_change_log` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `object_type` VARCHAR(16)  NOT NULL COMMENT 'PERSON/FAMILY',
  `object_id`   BIGINT       NOT NULL COMMENT '对象ID',
  `tag_id`      BIGINT       NOT NULL,
  `action`      VARCHAR(16)  NOT NULL COMMENT 'ADD/REMOVE/DISABLE/ENABLE',
  `operator_id` BIGINT       DEFAULT NULL,
  `remark`      VARCHAR(255) DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tcl_object` (`object_type`,`object_id`),
  KEY `idx_tcl_tag` (`tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签变更记录表';

-- -------------------------------------------------------------
-- 17. Excel 导入任务表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `excel_import_task` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `file_id`       BIGINT       DEFAULT NULL COMMENT '文件ID',
  `batch_no`      VARCHAR(64)  NOT NULL COMMENT '批次号(幂等)',
  `status`        VARCHAR(20)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/RUNNING/SUCCESS/FAILED/PARTIAL',
  `total_rows`    INT          NOT NULL DEFAULT 0 COMMENT '总行数',
  `success_count` INT          NOT NULL DEFAULT 0 COMMENT '成功数量',
  `fail_count`    INT          NOT NULL DEFAULT 0 COMMENT '失败数量',
  `created_by`    BIGINT       DEFAULT NULL COMMENT '导入人',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at`   DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_eit_batch` (`batch_no`),
  KEY `idx_eit_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Excel导入任务表';

-- -------------------------------------------------------------
-- 18. Excel 导入错误记录表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `excel_import_error` (
  `id`        BIGINT       NOT NULL AUTO_INCREMENT,
  `task_id`   BIGINT       NOT NULL,
  `row_no`    INT          NOT NULL COMMENT 'Excel行号',
  `field_name` VARCHAR(64) DEFAULT NULL,
  `message`   VARCHAR(500) NOT NULL COMMENT '错误信息',
  `raw_data`  TEXT         DEFAULT NULL COMMENT '原始行数据',
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_eie_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Excel导入错误记录表';

-- -------------------------------------------------------------
-- 19. 导出任务表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `export_task` (
  `id`         BIGINT      NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(128) DEFAULT NULL COMMENT '任务名称',
  `status`     VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/RUNNING/SUCCESS/FAILED',
  `file_id`    BIGINT      DEFAULT NULL COMMENT '结果文件ID',
  `params`     TEXT        DEFAULT NULL COMMENT '筛选参数(JSON)',
  `created_by` BIGINT      DEFAULT NULL,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` DATETIME   DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_et_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='导出任务表';

-- -------------------------------------------------------------
-- 20. 文件信息表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `file_info` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `file_name`   VARCHAR(255) NOT NULL COMMENT '原始文件名',
  `storage_name` VARCHAR(255) NOT NULL COMMENT '存储名',
  `file_type`   VARCHAR(32)  DEFAULT NULL COMMENT '文件类型',
  `file_size`   BIGINT       NOT NULL DEFAULT 0,
  `storage_path` VARCHAR(500) DEFAULT NULL COMMENT '存储路径',
  `content_type` VARCHAR(128) DEFAULT NULL,
  `created_by`  BIGINT       DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件信息表';

-- -------------------------------------------------------------
-- 21. 操作审计日志表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT       DEFAULT NULL,
  `username`    VARCHAR(64)  DEFAULT NULL,
  `action`      VARCHAR(128) NOT NULL COMMENT '操作动作',
  `module`      VARCHAR(64)  DEFAULT NULL COMMENT '模块',
  `method`      VARCHAR(16)  DEFAULT NULL COMMENT 'HTTP方法',
  `path`        VARCHAR(255) DEFAULT NULL COMMENT '请求路径',
  `request`     TEXT         DEFAULT NULL COMMENT '请求参数',
  `result`      VARCHAR(16)  DEFAULT NULL COMMENT 'SUCCESS/FAIL',
  `ip`          VARCHAR(64)  DEFAULT NULL,
  `duration_ms` BIGINT       DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_user` (`user_id`),
  KEY `idx_audit_time` (`created_at`),
  KEY `idx_audit_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作审计日志表';

-- -------------------------------------------------------------
-- 22. 系统字典表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_dict` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `dict_type`  VARCHAR(64)  NOT NULL COMMENT '字典类型',
  `dict_label` VARCHAR(128) NOT NULL COMMENT '字典标签',
  `dict_value` VARCHAR(64)  NOT NULL COMMENT '字典值',
  `sort`       INT          NOT NULL DEFAULT 0,
  `enabled`    TINYINT      NOT NULL DEFAULT 1,
  `remark`     VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dict` (`dict_type`,`dict_value`),
  KEY `idx_dict_type` (`dict_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统字典表';

-- -------------------------------------------------------------
-- 23. 迁移版本表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version`    VARCHAR(64)  NOT NULL COMMENT '迁移版本号',
  `applied_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据库迁移版本表';

SET FOREIGN_KEY_CHECKS = 1;
