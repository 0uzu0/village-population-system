-- V008: 重点人群精细化字段（补贴发放 / 走访评估 / 残疾档案 / 特困供养方式）
-- 背景：村级台账里重点人群的服务台账需要逐人记录——银行账号、发放金额、
-- 家庭情况、身体评估。残疾人另有专属信息（类别/等级/证号/监护人），
-- 属少数人数据，不宜塞进 person 主表（会让绝大多数行多出 5 个空列）。
-- 特困供养按「集中供养 / 分散供养」区分，走人口标签维度，便于筛选与统计。

-- -------------------------------------------------------------
-- 1) person 表新增补贴发放与走访评估字段
--    金额用 DECIMAL(10,2)：补贴金额需精确到分，不能用浮点
-- -------------------------------------------------------------
ALTER TABLE `person`
  ADD COLUMN `bank_account` VARCHAR(32) DEFAULT NULL COMMENT '银行账号' AFTER `live_address`,
  ADD COLUMN `subsidy_amount` DECIMAL(10,2) DEFAULT NULL COMMENT '当前应发金额(元/月)' AFTER `bank_account`,
  ADD COLUMN `family_condition` VARCHAR(1000) DEFAULT NULL COMMENT '家庭情况描述' AFTER `remark`,
  ADD COLUMN `health_assessment` VARCHAR(1000) DEFAULT NULL COMMENT '身体评估结果' AFTER `family_condition`;

-- 发放金额区间筛选需要排序/范围扫描
CREATE INDEX `idx_person_subsidy` ON `person` (`subsidy_amount`);

-- -------------------------------------------------------------
-- 2) 残疾人专属档案（一人一行，与 person 一对一）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `person_disability` (
  `id`                BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `person_id`         BIGINT       NOT NULL COMMENT '人员ID',
  `disability_type`   VARCHAR(64)  DEFAULT NULL COMMENT '残疾类别(视力/听力/言语/肢体/智力/精神/多重)',
  `disability_level`  VARCHAR(16)  DEFAULT NULL COMMENT '残疾等级:LEVEL_1/LEVEL_2/LEVEL_3/LEVEL_4',
  `disability_card`   VARCHAR(64)  DEFAULT NULL COMMENT '残疾人证号',
  `guardian_name`     VARCHAR(64)  DEFAULT NULL COMMENT '监护人姓名',
  `guardian_phone`    VARCHAR(20)  DEFAULT NULL COMMENT '监护人手机号',
  `remark`            VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pd_person` (`person_id`),
  KEY `idx_pd_level` (`disability_level`),
  KEY `idx_pd_guardian` (`guardian_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='残疾人专项档案表(与人员一对一)';

-- -------------------------------------------------------------
-- 3) 特困供养方式：新增两个子标签，与既有「特困供养对象」并存
--    集中供养=机构集中照料，分散供养=居家分散供养（政策口径分类）
--    用标签而非字段：可在标签定义页自行维护，且重点人群筛选器天然支持
-- -------------------------------------------------------------
INSERT INTO `tag_definition`
(`category_id`,`name`,`code`,`alias`,`color`,`description`,`object_type`,`allow_duplicate`,`is_sensitive`,`need_audit`,`enabled`) VALUES
  (4,'集中供养特困人员','EXTREME_POVERTY_CENTRALIZED','集中供养','#C2410C','特困人员中由供养机构集中照料供养','PERSON',0,1,1,1),
  (4,'分散供养特困人员','EXTREME_POVERTY_DISPERSED','分散供养','#F76B15','特困人员中居家分散供养','PERSON',0,1,1,1)
  ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`);

-- -------------------------------------------------------------
-- 4) 字典：残疾等级、特困供养方式（先删后插，可重复执行）
-- -------------------------------------------------------------
DELETE FROM `sys_dict` WHERE `dict_type` IN ('disability_level', 'extreme_poverty_mode');
INSERT INTO `sys_dict` (`dict_type`,`dict_label`,`dict_value`,`sort`) VALUES
  ('disability_level','一级（极重度）','LEVEL_1',1),
  ('disability_level','二级（重度）','LEVEL_2',2),
  ('disability_level','三级（中度）','LEVEL_3',3),
  ('disability_level','四级（轻度）','LEVEL_4',4),
  ('extreme_poverty_mode','集中供养','CENTRALIZED',1),
  ('extreme_poverty_mode','分散供养','DISPERSED',2);