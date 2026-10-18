-- V019: 户籍/流动口径二次收口（v2.1.2，2026-10）
--
-- 为什么 V017 之后还要再来一次：
-- V017 清理了存量数据、person.ts 三处打标签入口也做了互斥，但**Excel 导入**
-- 有两条路径是按文件内容直接 INSERT person_tag，绕过了互斥逻辑：
--   · 重点人群名单导入（importKeyGroup.ts）
--   · 专项台账导入（importSpecial.ts）
-- 只要导入文件里同一个人既标了「户籍人口」又标了「流动人口」，双标签就会
-- 重新出现。而读数据侧的口径不一致（工作台按户籍优先排除、标签页人数不排除）
-- 会让同一个「流动人口」在两个屏上显示两个数——这正是用户反馈的「对不上」。
--
-- 本次做两件事：
-- 1) 幂等收口存量：同时持有两类生效标签的，按户籍优先停用流动标签并留痕
--    （数据本来就干净时影响 0 行，可安全重复执行）；
-- 2) 口径描述回填，保证标签字典里看到的就是最终定义。
--
-- 写入侧已在同一版本补上「导入后收口」（utils/hukouFloating.ts 的
-- repairHukouFloatingExclusive），正常不会再有新脏数据。

-- 1a. 留痕（先记后改，失败也能看出本来要动哪些行）
INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
SELECT 'PERSON', f.person_id, f.tag_id, 'REMOVE', NULL,
       '户籍/流动口径互斥修复（V019）：同一人同时持有两类标签，按户籍优先停用流动标签'
FROM person_tag f
JOIN (SELECT id FROM tag_definition WHERE code = 'FLOATING_POP') fl ON fl.id = f.tag_id
JOIN person_tag h ON h.person_id = f.person_id AND h.status = 'ACTIVE'
JOIN (SELECT id FROM tag_definition WHERE code = 'HUKOU_POP') hd ON hd.id = h.tag_id
WHERE f.status = 'ACTIVE';

-- 1b. 停用流动标签（多表 UPDATE + 派生表按 code 定位，不硬编码主键）
UPDATE person_tag f
JOIN (SELECT id FROM tag_definition WHERE code = 'FLOATING_POP') fl ON fl.id = f.tag_id
JOIN person_tag h ON h.person_id = f.person_id AND h.status = 'ACTIVE'
JOIN (SELECT id FROM tag_definition WHERE code = 'HUKOU_POP') hd ON hd.id = h.tag_id
SET f.status = 'INACTIVE', f.expire_date = CURDATE()
WHERE f.status = 'ACTIVE';

-- 2. 口径描述回填（V017 已写过一次，这里再确认一次，防中途手工改乱）
UPDATE tag_definition
SET description = '户籍不在本村、暂住本村的人员（与户籍人口互斥；总人口 = 户籍人口 + 流动人口）'
WHERE code = 'FLOATING_POP';

UPDATE tag_definition
SET description = '户籍在本村的人员（与流动人口互斥；总人口 = 户籍人口 + 流动人口）'
WHERE code = 'HUKOU_POP';
