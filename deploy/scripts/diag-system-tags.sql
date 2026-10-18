-- =============================================================
-- 标签口径诊断（**只读**，不修改任何数据）
-- =============================================================
-- 用途：排查「工作台某个数字恒为 0 / 与标签页对不上」。
-- 用法：mysql -u<user> -p<pwd> <库名> < deploy/scripts/diag-system-tags.sql
--
-- 输出 5 段结果，对照着看：
--   1. 系统标签台账      → 编码是否存在、是否被停用
--   2. 重名标签          → 「标签页有人数、工作台为 0」的根因（同名的第二个标签）
--   3. 系统标签关联数    → 到底有没有人挂、挂的是 ACTIVE 还是 INACTIVE
--   4. 同时持有户籍+流动 → 被「户籍优先」规则压制掉的人数（这部分是设计如此，不是 bug）
--   5. 工作台实际数字    → 与后端代码逐字一致的 SQL，跑出来就是页面该显示的值
-- =============================================================

SELECT '===== 1. 系统标签台账 =====' AS `section`;

SELECT id, name, code, enabled AS `启用`,
       exclusive_group AS `互斥组`, exclusive_priority AS `组内优先级`
FROM `tag_definition`
WHERE `code` IN ('HUKOU_POP','FLOATING_POP','PARTY_MEMBER','PARTY_PROBATIONARY','VETERAN',
                 'PREFERENTIAL_OBJECT','LOW_INCOME_PERSON','EXTREME_POVERTY_PERSON',
                 'DISABLED_PERSON','LOW_INCOME_FAMILY','EXTREME_POVERTY_FAMILY')
ORDER BY `code`;

SELECT '===== 2. 重名标签（有输出就说明存在「同名的第二个标签」） =====' AS `section`;

SELECT `name` AS `标签名`, `object_type` AS `对象类型`, COUNT(*) AS `副本数`,
       GROUP_CONCAT(CONCAT(`code`, ' (id=', `id`, ', enabled=', `enabled`, ')')
                    ORDER BY `id` SEPARATOR ' | ') AS `各副本编码`
FROM `tag_definition`
GROUP BY `name`, `object_type`
HAVING COUNT(*) > 1;

SELECT '===== 3. 系统标签关联数（计入统计的只有 ACTIVE） =====' AS `section`;

SELECT td.`code`,
       td.`enabled` AS `标签启用`,
       SUM(CASE WHEN pt.`status` = 'ACTIVE'   THEN 1 ELSE 0 END) AS `生效关联`,
       SUM(CASE WHEN pt.`status` = 'INACTIVE' THEN 1 ELSE 0 END) AS `已停用关联`,
       SUM(CASE WHEN pt.`status` = 'PENDING'  THEN 1 ELSE 0 END) AS `待审核`
FROM `tag_definition` td
LEFT JOIN `person_tag` pt ON pt.`tag_id` = td.`id`
WHERE td.`code` IN ('HUKOU_POP','FLOATING_POP','PARTY_MEMBER','PARTY_PROBATIONARY','VETERAN',
                    'PREFERENTIAL_OBJECT','LOW_INCOME_PERSON','EXTREME_POVERTY_PERSON',
                    'DISABLED_PERSON','LOW_INCOME_FAMILY','EXTREME_POVERTY_FAMILY')
GROUP BY td.`id`, td.`code`, td.`enabled`
ORDER BY td.`code`;

SELECT '===== 4. 同时持有户籍 + 流动的在册人员数（会被「户籍优先」压制，属设计如此） =====' AS `section`;

SELECT COUNT(DISTINCT p.`id`) AS `同时持有两类标签的人数`
FROM `person` p
WHERE p.`status` IN ('NORMAL','MOVED_IN')
  AND EXISTS (SELECT 1 FROM `person_tag` pt JOIN `tag_definition` td ON td.`id` = pt.`tag_id`
              WHERE pt.`person_id` = p.`id` AND pt.`status` = 'ACTIVE' AND td.`code` = 'HUKOU_POP')
  AND EXISTS (SELECT 1 FROM `person_tag` pt JOIN `tag_definition` td ON td.`id` = pt.`tag_id`
              WHERE pt.`person_id` = p.`id` AND pt.`status` = 'ACTIVE' AND td.`code` = 'FLOATING_POP');

SELECT '===== 5. 工作台实际会显示的两个数字（与后端代码逐字一致） =====' AS `section`;

-- 下面这段与 backend/src/utils/statisticsSql.ts 生成的 SQL 完全相同，
-- 跑出来就是页面「户籍人口 / 流动人口」两张卡片应有的值。
-- 如果这里算出的数 > 0 而页面显示 0，说明是接口/前端问题（看工作台顶部有没有红色告警条）。
SELECT
  (SELECT COUNT(*) FROM person p
    WHERE p.status IN ('NORMAL','MOVED_IN')
      AND EXISTS (SELECT 1 FROM person_tag pt
        JOIN tag_definition td ON td.id = pt.tag_id
        WHERE pt.person_id = p.id AND pt.status = 'ACTIVE' AND td.code = 'HUKOU_POP')
      AND NOT EXISTS (
        SELECT 1 FROM person_tag pt_g
        JOIN tag_definition td_g ON td_g.id = pt_g.tag_id
        JOIN tag_definition td_self ON td_self.code = 'HUKOU_POP'
        WHERE pt_g.person_id = p.id
          AND pt_g.status = 'ACTIVE'
          AND td_g.exclusive_group IS NOT NULL
          AND td_g.exclusive_group = td_self.exclusive_group
          AND td_g.exclusive_priority < td_self.exclusive_priority
      )) AS `hukou_count`,
  (SELECT COUNT(*) FROM person p
    WHERE p.status IN ('NORMAL','MOVED_IN')
      AND EXISTS (SELECT 1 FROM person_tag pt
        JOIN tag_definition td ON td.id = pt.tag_id
        WHERE pt.person_id = p.id AND pt.status = 'ACTIVE' AND td.code = 'FLOATING_POP')
      AND NOT EXISTS (
        SELECT 1 FROM person_tag pt_g
        JOIN tag_definition td_g ON td_g.id = pt_g.tag_id
        JOIN tag_definition td_self ON td_self.code = 'FLOATING_POP'
        WHERE pt_g.person_id = p.id
          AND pt_g.status = 'ACTIVE'
          AND td_g.exclusive_group IS NOT NULL
          AND td_g.exclusive_group = td_self.exclusive_group
          AND td_g.exclusive_priority < td_self.exclusive_priority
      )) AS `floating_count`;

SELECT '===== 6. 标签总数（超过 50 说明列表可能分页，内建标签会被挤到下一页） =====' AS `section`;

SELECT COUNT(*) AS `标签总数`,
       SUM(CASE WHEN `enabled` = 1 THEN 1 ELSE 0 END) AS `启用中`
FROM `tag_definition`;

-- =============================================================
-- 附：手工修法（**先看诊断结果再决定是否执行**）
-- =============================================================
-- A. 系统标签存在，但人员挂在自己的同名标签上（最常见）
--    → 升级到 v2.2.2 后由 V023 迁移自动合并，无需手工操作。
--
-- B. 系统标签被物理删除（第 1 段查询里查不到 FLOATING_POP，第 3 段也没这行）
--    → V023 会自动把「名称相同、编码不同」的那枚标签的编码扶正为 FLOATING_POP，
--      人员关联天然保留，也不用手工操作。
--      若迁移后仍未扶正（例如名称被改成「流动人员」之类），手工执行：
--      UPDATE `tag_definition` SET `code` = 'FLOATING_POP'
--       WHERE `name` = '流动人口' AND `code` = 'FLOATING_PERSON';
--    ⚠️ 执行前确认 FLOATING_POP 确实不存在，否则会撞唯一索引 uk_td_code。
--
-- C. 系统标签被停用（enabled = 0）
--    → 统计仍然会计入已有的人员关联，工作台能显示；
--      但界面上没法再给人打这个标签。需要的话打开开关：
--      UPDATE `tag_definition` SET `enabled` = 1 WHERE `code` = 'FLOATING_POP';
--
-- D. 标签定义列表里「看不见」但这个查询查得到
--    → 不是数据问题，是页面筛选：默认每页 50 条、按分类排序，
--      如果标签总数超过 50（看第 6 段），内建标签可能落在第二页；
--      另外点了某个「分类」快捷筛选时，只会显示该分类下的标签。点「全部」再看。
-- =============================================================
