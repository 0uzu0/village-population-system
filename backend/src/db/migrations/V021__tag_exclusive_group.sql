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
ALTER TABLE `tag_definition`
  ADD COLUMN `exclusive_group` VARCHAR(32) DEFAULT NULL
    COMMENT '互斥组：同一人在同组内只能保留一个标签；NULL 表示不互斥',
  ADD COLUMN `exclusive_priority` INT NOT NULL DEFAULT 100
    COMMENT '组内优先级（越小越优先）：冲突时保留优先级最高的那个';

-- 户籍优先：户籍是事实属性、流动是暂态，冲突时保留事实。
-- 这也是 v2.1.0 以来一直沿用的裁决规则，此处只是把它从代码搬到数据。
UPDATE `tag_definition` SET `exclusive_group` = 'HUKOU_FLOATING', `exclusive_priority` = 10
 WHERE `code` = 'HUKOU_POP';
UPDATE `tag_definition` SET `exclusive_group` = 'HUKOU_FLOATING', `exclusive_priority` = 20
 WHERE `code` = 'FLOATING_POP';

-- 存量一次性收口：同组内有多枚生效标签的人员，只保留优先级最高的那枚。
-- 与 V017 同样的口径：先留痕、再停用，operator_id 为 NULL 表示系统迁移自动处理。
-- 幂等——数据本来就干净时两条语句都影响 0 行。
INSERT INTO `tag_change_log` (object_type, object_id, tag_id, action, operator_id, remark)
SELECT 'PERSON', pt.person_id, pt.tag_id, 'REMOVE', NULL,
       '标签互斥组修复：同一人在同组内存在更高优先级的标签，按优先级停用本条'
FROM `person_tag` pt
JOIN `tag_definition` td ON td.id = pt.tag_id
WHERE pt.status = 'ACTIVE'
  AND td.exclusive_group IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `person_tag` ptb
    JOIN `tag_definition` tdb ON tdb.id = ptb.tag_id
    WHERE ptb.person_id = pt.person_id
      AND ptb.status = 'ACTIVE'
      AND tdb.exclusive_group = td.exclusive_group
      AND tdb.exclusive_priority < td.exclusive_priority
  );

UPDATE `person_tag` pt
JOIN `tag_definition` td ON td.id = pt.tag_id
SET pt.status = 'INACTIVE', pt.expire_date = CURDATE()
WHERE pt.status = 'ACTIVE'
  AND td.exclusive_group IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `person_tag` ptb
    JOIN `tag_definition` tdb ON tdb.id = ptb.tag_id
    WHERE ptb.person_id = pt.person_id
      AND ptb.status = 'ACTIVE'
      AND tdb.exclusive_group = td.exclusive_group
      AND tdb.exclusive_priority < td.exclusive_priority
  );
