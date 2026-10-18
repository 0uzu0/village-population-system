-- =============================================================
-- V023 标签编码归一：把「同名但编码不同」的自定义标签收编到系统编码
-- =============================================================
-- 背景（2026-10-18 线上问题复盘）：
-- 用户反馈「工作台流动人口一直不显示」。追下去发现两条原因叠在一起：
--
--   1. 系统内建的「流动人口」（FLOATING_POP）在标签管理页看不到，
--      用户以为系统没有这个标签，于是自己建了一个同名的，编码填成 FLOATING_PERSON；
--   2. 人员标签挂在这个自建标签上。而工作台是按 td.code = 'FLOATING_POP' 取数的，
--      认不出 FLOATING_PERSON —— 于是标签页显示 N 人、工作台恒为 0，全程不报错。
--
-- 本迁移覆盖两种现场：
--   A. 系统标签还在（哪怕被停用）→ 把自定义标签上的人员关联合并过去
--   B. 系统标签已被物理删除（所以页面上才看不到）→ 把同名自定义标签的编码扶正
--
-- 为什么用临时表而不是相关子查询：
--   v2.2.0 的 V021 用了 `UPDATE person_tag ... WHERE EXISTS (SELECT ... FROM person_tag)`，
--   MySQL 直接报 ER_UPDATE_TABLE_USED(1093)，DDL 又已隐式提交，导致服务无限崩溃重启。
--   这里把所有「需要先算出来、再拿去更新」的集合都落到临时表（连接级、不引起隐式提交），
--   UPDATE 只 JOIN 临时表，绝不会命中 1093。
--
-- ⚠️ 必须可重跑：临时表每次先 DROP 再建；所有 UPDATE 都把条件收敛到「当前仍需处理的行」，
--    重跑时前一次已处理完的数据影响 0 行。
-- ⚠️ 下面硬编码的系统编码清单必须与 backend/src/utils/systemTags.ts 的 SYSTEM_TAG_CODES
--    保持一致（test/systemTags.test.ts 有断言，漂移会直接失败）。
-- -----------------------------------------------

-- 1. 映射表：待合并的自定义标签 -> 目标系统标签
--    连 keep_code 一起存下来：第 6 步要往 description 里写目标编码，
--    如果在那里写 `(SELECT code FROM tag_definition WHERE id = keep_id)`，
--    就变成「UPDATE tag_definition 时子查询查 tag_definition」，照样 1093。
DROP TEMPORARY TABLE IF EXISTS `tmp_tag_merge`;
CREATE TEMPORARY TABLE `tmp_tag_merge` (
  `lose_id` BIGINT NOT NULL,
  `keep_id` BIGINT NOT NULL,
  `keep_code` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`lose_id`)
);

-- 情况 A：系统标签存在。匹配条件为「同名」，或「编码是已知别名」。
-- COALESCE：历史上 tag_definition.object_type 存在 NULL，等值比较会把这些行漏掉。
INSERT IGNORE INTO `tmp_tag_merge` (`lose_id`, `keep_id`, `keep_code`)
SELECT l.`id`, k.`id`, k.`code`
FROM `tag_definition` l
JOIN `tag_definition` k
  ON COALESCE(k.`object_type`, 'PERSON') = COALESCE(l.`object_type`, 'PERSON')
 AND k.`code` IN ('HUKOU_POP','FLOATING_POP','PARTY_MEMBER','PARTY_PROBATIONARY','VETERAN',
                  'PREFERENTIAL_OBJECT','LOW_INCOME_PERSON','EXTREME_POVERTY_PERSON',
                  'DISABLED_PERSON','LOW_INCOME_FAMILY','EXTREME_POVERTY_FAMILY')
 AND (k.`name` = l.`name`
      OR (l.`code` = 'FLOATING_PERSON' AND k.`code` = 'FLOATING_POP')
      OR (l.`code` = 'HUKOU_PERSON'    AND k.`code` = 'HUKOU_POP')
      OR (l.`code` = 'RESIDENT_POP'    AND k.`code` = 'FLOATING_POP'))
 AND k.`id` <> l.`id`
WHERE l.`code` NOT IN ('HUKOU_POP','FLOATING_POP','PARTY_MEMBER','PARTY_PROBATIONARY','VETERAN',
                       'PREFERENTIAL_OBJECT','LOW_INCOME_PERSON','EXTREME_POVERTY_PERSON',
                       'DISABLED_PERSON','LOW_INCOME_FAMILY','EXTREME_POVERTY_FAMILY');

-- 2. 扶正表：系统标签已经被物理删除时，把同名自定义标签的编码改成系统编码
--    只处理户籍 / 流动两枚：它们是唯一「一对互斥、都要在工作台单独展示」的编码，
--    也是这次事故的现场。其余系统标签缺失由启动自检打 WARN，不在这里猜着补。
DROP TEMPORARY TABLE IF EXISTS `tmp_tag_promote`;
CREATE TEMPORARY TABLE `tmp_tag_promote` (
  `id` BIGINT NOT NULL,
  `target_code` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`)
);

-- 流动人口：仅当 FLOATING_POP 不存在时，取 id 最小的同名标签扶正
-- （`l.id = (SELECT MIN(...))` 是为了「存在两个同名自定义标签」时只改一个，
--   否则两行都会被改成同一个编码，撞唯一索引 uk_td_code）
INSERT IGNORE INTO `tmp_tag_promote` (`id`, `target_code`)
SELECT l.`id`, 'FLOATING_POP'
FROM `tag_definition` l
WHERE l.`name` = '流动人口'
  AND COALESCE(l.`object_type`, 'PERSON') = 'PERSON'
  AND l.`code` <> 'FLOATING_POP'
  AND NOT EXISTS (SELECT 1 FROM `tag_definition` k WHERE k.`code` = 'FLOATING_POP')
  AND l.`id` = (
    SELECT MIN(x.`id`) FROM `tag_definition` x
    WHERE x.`name` = '流动人口'
      AND COALESCE(x.`object_type`, 'PERSON') = 'PERSON'
      AND x.`code` <> 'FLOATING_POP'
  );

-- 户籍人口：同上
INSERT IGNORE INTO `tmp_tag_promote` (`id`, `target_code`)
SELECT l.`id`, 'HUKOU_POP'
FROM `tag_definition` l
WHERE l.`name` = '户籍人口'
  AND COALESCE(l.`object_type`, 'PERSON') = 'PERSON'
  AND l.`code` <> 'HUKOU_POP'
  AND NOT EXISTS (SELECT 1 FROM `tag_definition` k WHERE k.`code` = 'HUKOU_POP')
  AND l.`id` = (
    SELECT MIN(x.`id`) FROM `tag_definition` x
    WHERE x.`name` = '户籍人口'
      AND COALESCE(x.`object_type`, 'PERSON') = 'PERSON'
      AND x.`code` <> 'HUKOU_POP'
  );

UPDATE `tag_definition` td
JOIN `tmp_tag_promote` p ON p.`id` = td.`id`
SET td.`code` = p.`target_code`;

-- 3. 留痕：同一人已持有系统标签，其自定义标签关联将要停用（否则同一人被数两次）
INSERT INTO `tag_change_log` (object_type, object_id, tag_id, action, operator_id, remark)
SELECT DISTINCT 'PERSON', pt_lose.`person_id`, pt_lose.`tag_id`, 'REMOVE', NULL,
       '标签编码合并：与系统内建标签同名的自定义标签，本人已持有系统标签，停用本条避免重复计数'
FROM `person_tag` pt_lose
JOIN `tmp_tag_merge` m ON m.`lose_id` = pt_lose.`tag_id`
JOIN `person_tag` pt_keep
  ON pt_keep.`person_id` = pt_lose.`person_id`
 AND pt_keep.`tag_id` = m.`keep_id`
 AND pt_keep.`status` = 'ACTIVE'
WHERE pt_lose.`status` = 'ACTIVE';

-- 4. 停用上述重复关联（person_tag 没有 (person_id, tag_id) 唯一索引，必须显式停用）
UPDATE `person_tag` pt_lose
JOIN `tmp_tag_merge` m ON m.`lose_id` = pt_lose.`tag_id`
JOIN `person_tag` pt_keep
  ON pt_keep.`person_id` = pt_lose.`person_id`
 AND pt_keep.`tag_id` = m.`keep_id`
 AND pt_keep.`status` = 'ACTIVE'
SET pt_lose.`status` = 'INACTIVE', pt_lose.`expire_date` = CURDATE()
WHERE pt_lose.`status` = 'ACTIVE';

-- 5. 留痕 + 把剩余生效关联改指向系统标签（人还是那个人，标签换成规范的）
INSERT INTO `tag_change_log` (object_type, object_id, tag_id, action, operator_id, remark)
SELECT DISTINCT 'PERSON', pt_lose.`person_id`, m.`keep_id`, 'ADD', NULL,
       '标签编码合并：原自定义标签关联改指向系统内建标签（编码口径归一）'
FROM `person_tag` pt_lose
JOIN `tmp_tag_merge` m ON m.`lose_id` = pt_lose.`tag_id`
WHERE pt_lose.`status` = 'ACTIVE';

UPDATE `person_tag` pt_lose
JOIN `tmp_tag_merge` m ON m.`lose_id` = pt_lose.`tag_id`
SET pt_lose.`tag_id` = m.`keep_id`
WHERE pt_lose.`status` = 'ACTIVE';

-- 6. 停用被合并掉的自定义标签定义（保留行：历史流水仍能看出它原本叫什么）
UPDATE `tag_definition` td
JOIN `tmp_tag_merge` m ON m.`lose_id` = td.`id`
SET td.`enabled` = 0,
    td.`description` = CONCAT(COALESCE(td.`description`, ''), '（已合并到编码 ', m.`keep_code`, '，本标签停用）')
WHERE td.`enabled` = 1;

-- 7. 兜底去重：同一人对同一枚系统标签出现多条生效关联时，只保留 id 最小的一条。
--    为什么需要：person_tag **没有** (person_id, tag_id) 唯一索引，「不允许重复」是靠
--    写入侧代码保证的（person.ts 里查 allow_duplicate）。第 5 步直接改 tag_id 绕开了那层
--    检查——一个人若同时挂着两个同名的自定义标签，改完就会变成同一系统标签的两条 ACTIVE
--    关联，统计按关联条数 COUNT 会把他数成两个人。
--    自连接写法与 V017/V019 一致（已验证不会触发 1093）；只处理 allow_duplicate = 0。
INSERT INTO `tag_change_log` (object_type, object_id, tag_id, action, operator_id, remark)
SELECT DISTINCT 'PERSON', pt_dup.`person_id`, pt_dup.`tag_id`, 'REMOVE', NULL,
       '标签编码合并兜底：同一人对同一系统标签存在多条生效关联，保留最早一条，停用本条'
FROM `person_tag` pt_dup
JOIN `person_tag` pt_keep
  ON pt_keep.`person_id` = pt_dup.`person_id`
 AND pt_keep.`tag_id` = pt_dup.`tag_id`
 AND pt_keep.`status` = 'ACTIVE'
 AND pt_keep.`id` < pt_dup.`id`
JOIN `tag_definition` k
  ON k.`id` = pt_dup.`tag_id`
 AND k.`allow_duplicate` = 0
 AND k.`code` IN ('HUKOU_POP','FLOATING_POP','PARTY_MEMBER','PARTY_PROBATIONARY','VETERAN',
                  'PREFERENTIAL_OBJECT','LOW_INCOME_PERSON','EXTREME_POVERTY_PERSON',
                  'DISABLED_PERSON','LOW_INCOME_FAMILY','EXTREME_POVERTY_FAMILY')
WHERE pt_dup.`status` = 'ACTIVE';

UPDATE `person_tag` pt_dup
JOIN `person_tag` pt_keep
  ON pt_keep.`person_id` = pt_dup.`person_id`
 AND pt_keep.`tag_id` = pt_dup.`tag_id`
 AND pt_keep.`status` = 'ACTIVE'
 AND pt_keep.`id` < pt_dup.`id`
JOIN `tag_definition` k
  ON k.`id` = pt_dup.`tag_id`
 AND k.`allow_duplicate` = 0
 AND k.`code` IN ('HUKOU_POP','FLOATING_POP','PARTY_MEMBER','PARTY_PROBATIONARY','VETERAN',
                  'PREFERENTIAL_OBJECT','LOW_INCOME_PERSON','EXTREME_POVERTY_PERSON',
                  'DISABLED_PERSON','LOW_INCOME_FAMILY','EXTREME_POVERTY_FAMILY')
SET pt_dup.`status` = 'INACTIVE', pt_dup.`expire_date` = CURDATE()
WHERE pt_dup.`status` = 'ACTIVE';

-- 8. 清理临时表（TEMPORARY 表本就会随连接关闭自动删除，这里显式收尾便于重跑）
DROP TEMPORARY TABLE IF EXISTS `tmp_tag_merge`;
DROP TEMPORARY TABLE IF EXISTS `tmp_tag_promote`;
