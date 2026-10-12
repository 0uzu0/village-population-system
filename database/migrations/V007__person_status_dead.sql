-- V007: 人员状态口径调整（新增「死亡」，取消「注销」）
-- 背景：原状态枚举 NORMAL/MOVED_IN/MOVED_OUT/CANCELLED 里没有「死亡」，
-- 实际登记时只能把死亡人口记成 CANCELLED（注销），导致死亡与户籍注销/重复数据混为一谈，
-- 无法单独统计死亡人口，也不符合村级台账「死亡须留痕、不删除档案」的要求。
--
-- 口径：NORMAL/MOVED_IN 为在册（计入人口统计），MOVED_OUT/DEAD 为非在册（档案保留，不计入统计）。
-- 清理重复或错误录入的数据仍走删除接口，不再依赖 CANCELLED 状态。

-- 1) status 列注释同步（仍是 VARCHAR(20)，加值不需要改列类型）
ALTER TABLE `person`
  MODIFY COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'NORMAL' COMMENT '状态:NORMAL/MOVED_IN/MOVED_OUT/DEAD';

-- 2) 新增状态生效日期：记死亡日期 / 迁出日期，用于台账核对与追溯
ALTER TABLE `person`
  ADD COLUMN `status_date` DATE DEFAULT NULL COMMENT '状态生效日期(死亡/迁出日期)' AFTER `status`;

-- 3) 存量数据迁移：历史上用 CANCELLED 登记的基本都是死亡人口，统一转为 DEAD。
--    若其中确有重复/错误录入的数据，请改用「删除人员」清理。
UPDATE `person` SET `status` = 'DEAD' WHERE `status` = 'CANCELLED';

-- 4) 字典同步：先清掉旧值再插入，保证 uk_dict(dict_type,dict_value) 不冲突且可重复执行
DELETE FROM `sys_dict` WHERE `dict_type` = 'person_status' AND `dict_value` IN ('CANCELLED', 'DEAD');
INSERT INTO `sys_dict` (`dict_type`, `dict_label`, `dict_value`, `sort`) VALUES
  ('person_status', '死亡', 'DEAD', 4);
