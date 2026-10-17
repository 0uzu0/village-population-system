-- V017: 户籍/流动口径互斥 + 流动人口标签定义去重（v2.1.0，2026-10）
--
-- 口径定义：流动人口 = 户籍不在本村、暂住本村的人员；
-- 总人口 = 户籍人口 + 流动人口，两者**不存在交叉**。
--
-- 为此需要做三件事：
-- 1) 合并重复的「流动人口」标签定义：V002 种子里存在两个同编码定义
--    （id=14 主定义、id=16 旧「流入/流出」定义），同编码双定义会让
--    用户在打标签界面看到两个「流动人口」、且筛选/统计按 code 匹配时
--    语义重复。合并到 id=14（V016 已将其更名为主定义）。
-- 2) 存量数据修复：同时持有户籍(HUKOU_POP)/流动(FLOATING_POP)标签的人员，
--    按「户籍优先」停用其流动标签（户籍是事实属性、流动是暂态）。
--    写入侧互斥（person.ts 三处打标签入口）只保证新数据，存量要在这里清一次。
-- 3) 更新两个标签的口径描述，把「互斥」写进字典，打标签的人能看到。
--
-- 所有变更均写 tag_change_log 留痕（operator_id 为 NULL 表示系统迁移自动处理）。

-- 1a. 已持有 id=14 生效关联的人员，其 id=16 的重复关联直接停用
UPDATE person_tag a
JOIN person_tag b
  ON b.person_id = a.person_id AND b.tag_id = 14 AND b.status = 'ACTIVE'
SET a.status = 'INACTIVE', a.expire_date = CURDATE()
WHERE a.tag_id = 16 AND a.status = 'ACTIVE';

-- 1b. 剩余 id=16 生效关联留痕后并入 id=14
INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
SELECT 'PERSON', person_id, tag_id, 'REMOVE', NULL,
       '流动人口标签定义合并：重复定义(id=16)并入主定义(id=14)，等效保留'
FROM person_tag
WHERE tag_id = 16 AND status = 'ACTIVE';

UPDATE person_tag SET tag_id = 14 WHERE tag_id = 16 AND status = 'ACTIVE';

-- 1c. 删除重复定义（防御性条件：id 与 code 双重匹配，防止误删）
DELETE FROM tag_definition WHERE id = 16 AND code = 'FLOATING_POP';

-- 2. 存量互斥修复（户籍优先）：先留痕、再停用
--    多表 UPDATE + 派生表按 code 定位，不硬编码 tag_definition 主键
INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
SELECT 'PERSON', f.person_id, f.tag_id, 'REMOVE', NULL,
       '户籍/流动口径互斥修复：同一人同时持有两类标签，按户籍优先停用流动标签'
FROM person_tag f
JOIN (SELECT id FROM tag_definition WHERE code = 'FLOATING_POP') fl ON fl.id = f.tag_id
JOIN person_tag h ON h.person_id = f.person_id AND h.status = 'ACTIVE'
JOIN (SELECT id FROM tag_definition WHERE code = 'HUKOU_POP') hd ON hd.id = h.tag_id
WHERE f.status = 'ACTIVE';

UPDATE person_tag f
JOIN (SELECT id FROM tag_definition WHERE code = 'FLOATING_POP') fl ON fl.id = f.tag_id
JOIN person_tag h ON h.person_id = f.person_id AND h.status = 'ACTIVE'
JOIN (SELECT id FROM tag_definition WHERE code = 'HUKOU_POP') hd ON hd.id = h.tag_id
SET f.status = 'INACTIVE', f.expire_date = CURDATE()
WHERE f.status = 'ACTIVE';

-- 3. 口径描述更新：把「互斥」写进标签字典
UPDATE tag_definition
SET description = '户籍不在本村、暂住本村的人员（与户籍人口互斥；总人口 = 户籍人口 + 流动人口）'
WHERE code = 'FLOATING_POP';

UPDATE tag_definition
SET description = '户籍在本村的人员（与流动人口互斥；总人口 = 户籍人口 + 流动人口）'
WHERE code = 'HUKOU_POP';
