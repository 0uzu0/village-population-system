-- V016: 统计口径调整——「常住人口」改为「流动人口」
-- 总人口口径 = 户籍人口 + 流动人口（原口径里的「常住人口」整体更名）。
--
-- 「常住人口」标签(RESIDENT_POP)更名为「流动人口」(FLOATING_POP)：
-- person_tag 按 tag_id 引用，改名/改编码不影响已有的人员-标签关联，
-- 统计（statistics.ts）、列表筛选、Excel 导出按新编码取数。

UPDATE `tag_definition`
SET `name`        = '流动人口',
    `code`        = 'FLOATING_POP',
    `description` = '本村流动人口（总人口口径 = 户籍人口 + 流动人口）'
WHERE `code` = 'RESIDENT_POP';
