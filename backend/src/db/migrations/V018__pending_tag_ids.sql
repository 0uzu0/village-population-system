-- V018: 待核查记录保留建档时选择的标签（v2.1.1，2026-10）
--
-- 背景：v2.0.2 起「新增人口未填身份证 → 转入待核查」，但该分支只写
-- import_pending，表单里选择的标签（tagIds）被整体丢弃——确认入库后
-- 档案上没有任何标签，工作台/列表里「流动人口」等标签随之消失。
--
-- 改法：import_pending 增加 tag_ids 列（逗号分隔的 tag_definition.id），
-- 转待核查时保存、确认入库时用 syncPersonTags 回挂（自带户籍/流动互斥）。
-- Excel 导入的行不选标签，该列为 NULL，行为不变。

ALTER TABLE `import_pending`
  ADD COLUMN `tag_ids` VARCHAR(255) DEFAULT NULL
    COMMENT '建档时选择的标签id列表（逗号分隔），确认入库时回挂到人员档案' AFTER `relation`;
