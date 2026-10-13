-- V011: 专项台账去除「机械费」与「所属网格」
-- 背景：需求调整——专项台账不再记录机械费，也不再关联网格
--       （网格维度在人口主表 person 已体现，台账无需重复）。
-- 依赖：V010 已建表并含这两列；DROP 列时会自动移除仅作用于该列之上的 idx_lr_grid 索引。
-- 幂等：本迁移在 V010 之后执行，列必已存在；若将来全新部署，V010 建列后本迁移随即删列，最终一致。

ALTER TABLE `ledger_record` DROP COLUMN `machinery_cost`;
ALTER TABLE `ledger_record` DROP COLUMN `grid_id`;
