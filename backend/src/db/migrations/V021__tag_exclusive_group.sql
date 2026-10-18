-- =============================================================
-- V021 标签互斥组（数据驱动）
-- =============================================================
-- 背景：户籍人口 / 流动人口「只能留一个」这条规则，此前在三个地方各写了一遍——
-- 后端 SQL 判定、PC 建档表单、APP 的标签 chip——而且都硬编码了
-- HUKOU_POP / FLOATING_POP 两个编码。将来再加一组互斥（例如低保户与特困供养）
-- 就要三端各改一次代码、各发一次版，任何一端漏改就会出现「前端拦住了、
-- 后端没拦」或「两屏数字对不上」。
--
-- 改成数据：标签自己声明属于哪个互斥组、组内优先级（越小越优先），
-- 判定逻辑统一读这两列。以后加互斥只要一条 UPDATE。
--
-- 默认值说明：exclusive_priority 默认 100，新增组内标签时不用显式赋值就排在
-- 已有标签之后，符合「新加的口径优先级低」的直觉；确需插队时再调小。
--
-- ⚠️ 本文件必须可重跑（2026-10-18 事故教训）
-- 迁移执行器把整个文件包在一个事务里，但 MySQL 的 DDL 会**隐式提交**：
-- 只要 ALTER 成功、后面任意一条语句失败，rollback 救不回已经加上去的列，
-- 而版本号又没写进 schema_migrations，重启后第一条 ALTER 直接报
-- `Duplicate column name`，服务进入无限崩溃循环（线上 v2.2.0 首发即如此）。
-- MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS，所以这里用 information_schema
-- 判断后动态执行：列已存在就跳过。
--
-- 同时，存量收口改成 V017/V019 用过的**自连接**写法，不再用
-- `UPDATE person_tag ... WHERE EXISTS (SELECT ... FROM person_tag)` 这种
-- 同表相关子查询——MySQL 会报 ER_UPDATE_TABLE_USED(1093)。
-- （推测首发失败就是这条；改成自连接后与已验证过的 V017/V019 同形。）

-- 1a. 加列 exclusive_group（列已存在时跳过）
SET @ddl_group := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `tag_definition` ADD COLUMN `exclusive_group` VARCHAR(32) DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tag_definition'
    AND COLUMN_NAME = 'exclusive_group'
);
PREPARE stmt_group FROM @ddl_group;
EXECUTE stmt_group;
DEALLOCATE PREPARE stmt_group;

-- 1b. 加列 exclusive_priority（列已存在时跳过）
SET @ddl_priority := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `tag_definition` ADD COLUMN `exclusive_priority` INT NOT NULL DEFAULT 100',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tag_definition'
    AND COLUMN_NAME = 'exclusive_priority'
);
PREPARE stmt_priority FROM @ddl_priority;
EXECUTE stmt_priority;
DEALLOCATE PREPARE stmt_priority;

-- 1c. 补列注释。MODIFY 对已存在的列是幂等的，所以这一步可以无条件执行——
-- 好处是「新建库」和「事故后重跑」两种路径最终得到的表结构（含注释）完全一致。
ALTER TABLE `tag_definition`
  MODIFY COLUMN `exclusive_group` VARCHAR(32) DEFAULT NULL
    COMMENT '互斥组：同一人在同组内只能保留一个标签；NULL 表示不互斥';
ALTER TABLE `tag_definition`
  MODIFY COLUMN `exclusive_priority` INT NOT NULL DEFAULT 100
    COMMENT '组内优先级（越小越优先）：冲突时保留优先级最高的那个';

-- 2. 户籍优先：户籍是事实属性、流动是暂态，冲突时保留事实。
-- 这也是 v2.1.0 以来一直沿用的裁决规则，此处只是把它从代码搬到数据。
UPDATE `tag_definition` SET `exclusive_group` = 'HUKOU_FLOATING', `exclusive_priority` = 10
 WHERE `code` = 'HUKOU_POP';
UPDATE `tag_definition` SET `exclusive_group` = 'HUKOU_FLOATING', `exclusive_priority` = 20
 WHERE `code` = 'FLOATING_POP';

-- 3. 存量一次性收口：同组内有多枚生效标签的人员，只保留优先级最高的那枚。
-- 与 V017/V019 同样的口径：先留痕、再停用，operator_id 为 NULL 表示系统迁移自动处理。
-- 自连接会因「同一个人有多个更高优先级标签」而出现重复行，用 GROUP BY 主键去重；
-- pt_lose.id 是主键，MySQL 的 ONLY_FULL_GROUP_BY 认可这种函数依赖，不用把列都塞进 GROUP BY。
INSERT INTO `tag_change_log` (object_type, object_id, tag_id, action, operator_id, remark)
SELECT 'PERSON', pt_lose.person_id, pt_lose.tag_id, 'REMOVE', NULL,
       '标签互斥组修复：同一人在同组内存在更高优先级的标签，按优先级停用本条'
FROM `person_tag` pt_lose
JOIN `tag_definition` td_lose ON td_lose.id = pt_lose.tag_id
JOIN `person_tag` pt_keep
  ON pt_keep.person_id = pt_lose.person_id AND pt_keep.status = 'ACTIVE'
JOIN `tag_definition` td_keep
  ON td_keep.id = pt_keep.tag_id
 AND td_keep.exclusive_group = td_lose.exclusive_group
 AND td_keep.exclusive_priority < td_lose.exclusive_priority
WHERE pt_lose.status = 'ACTIVE'
  AND td_lose.exclusive_group IS NOT NULL
GROUP BY pt_lose.id;

UPDATE `person_tag` pt_lose
JOIN `tag_definition` td_lose ON td_lose.id = pt_lose.tag_id
JOIN `person_tag` pt_keep
  ON pt_keep.person_id = pt_lose.person_id AND pt_keep.status = 'ACTIVE'
JOIN `tag_definition` td_keep
  ON td_keep.id = pt_keep.tag_id
 AND td_keep.exclusive_group = td_lose.exclusive_group
 AND td_keep.exclusive_priority < td_lose.exclusive_priority
SET pt_lose.status = 'INACTIVE', pt_lose.expire_date = CURDATE()
WHERE pt_lose.status = 'ACTIVE'
  AND td_lose.exclusive_group IS NOT NULL;
