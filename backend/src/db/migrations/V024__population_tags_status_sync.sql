-- =============================================================
-- V024 人口归属标签随人员状态联动（v2.3.0，2026-10）
-- =============================================================
-- 背景（用户反馈）：
--   某人状态是「迁出」，标签里却还挂着「户籍人口」。详情页同时显示
--   「迁出」和「户籍人口」，导出名单时一眼就是错的。
--
-- 根因不是某个接口写错，而是**两个独立开关共同决定同一个统计口径**：
--   · 统计侧 = 在册(status) ∩ 持标签 ∩ 未被互斥压制（utils/statisticsSql.ts）
--   · 状态变更只改 person / person_change_log / family_member，完全不碰标签
--   · 而「户籍人口 / 流动人口」是可自由勾选、可空的标签
-- 于是「标签还留着、人数已经不算他」这种组合必然出现。
--
-- 口径定义（改代码前先看这三条）：
--   1. 户籍人口 / 流动人口描述的是**当前归属**，不是历史身份——
--      迁出、死亡之后就不该再挂着（与党员/低保/残疾这类「经历过」的标签不同）；
--   2. 非在册（MOVED_OUT / DEAD）→ 两枚人口标签都停用；
--   3. 改回在册 → 恢复最近一次被状态联动停用的那一枚（代码侧按 tag_change_log
--      的 '状态联动：' 前缀倒查，本迁移只负责停用）。
--
-- 本迁移做两件事：
--   1) import_pending 增加 person_status 列：待核查行补录身份证后确认入库时，
--      迁出/死亡的人不能又变回「正常」（否则他会重新出现在所有人口统计里）；
--   2) 存量收口：停用非在册人员的人口标签并留痕。
--
-- ⚠️ 必须可重跑：DDL 用 information_schema 判断后动态执行（MySQL 8.0 不支持
--    ADD COLUMN IF NOT EXISTS），DML 的条件都收敛到「当前仍生效」的行。
-- ⚠️ 不用同表相关子查询（ER_UPDATE_TABLE_USED 1093）：停用改成 JOIN 写法，
--    与已验证过的 V017 / V019 / V021 同形。
-- -----------------------------------------------

-- 1. import_pending.person_status（列已存在时跳过）
SET @ddl_pending_status := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `import_pending` ADD COLUMN `person_status` VARCHAR(16) NOT NULL DEFAULT ''NORMAL''',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'import_pending'
    AND COLUMN_NAME = 'person_status'
);
PREPARE stmt_pending_status FROM @ddl_pending_status;
EXECUTE stmt_pending_status;
DEALLOCATE PREPARE stmt_pending_status;

-- 2a. 先留痕（失败也能看出本来要动哪些行）
INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
SELECT 'PERSON', pt.person_id, pt.tag_id, 'REMOVE', NULL,
       CONCAT('状态联动：存量收口（V024）停用「', td.name, '」')
FROM person_tag pt
JOIN tag_definition td ON td.id = pt.tag_id
JOIN person p ON p.id = pt.person_id
WHERE pt.status = 'ACTIVE'
  AND td.code IN ('HUKOU_POP', 'FLOATING_POP')
  AND p.status IN ('MOVED_OUT', 'DEAD');

-- 2b. 停用非在册人员的户籍 / 流动人口标签
UPDATE person_tag pt
JOIN tag_definition td ON td.id = pt.tag_id
JOIN person p ON p.id = pt.person_id
SET pt.status = 'INACTIVE', pt.expire_date = CURDATE()
WHERE pt.status = 'ACTIVE'
  AND td.code IN ('HUKOU_POP', 'FLOATING_POP')
  AND p.status IN ('MOVED_OUT', 'DEAD');

-- 3. 把联动规则写进标签字典：打标签的人看得到，不用去问开发
UPDATE tag_definition
SET description = '户籍在本村的人员（与流动人口互斥；总人口 = 户籍人口 + 流动人口）。人员迁出或死亡后自动停用，改回在册时自动恢复'
WHERE code = 'HUKOU_POP';

UPDATE tag_definition
SET description = '户籍不在本村、暂住本村的人员（与户籍人口互斥；总人口 = 户籍人口 + 流动人口）。人员迁出或死亡后自动停用，改回在册时自动恢复'
WHERE code = 'FLOATING_POP';
