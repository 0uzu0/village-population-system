-- V005：导入任务区分类型（人口档案 / 重点人群名单）
ALTER TABLE `excel_import_task`
  ADD COLUMN `task_type` VARCHAR(20) NOT NULL DEFAULT 'PERSON' COMMENT '导入类型：PERSON 人口档案 / KEY_GROUP 重点人群名单' AFTER `batch_no`;

-- 历史任务全部视为人口档案导入
UPDATE `excel_import_task` SET `task_type` = 'PERSON' WHERE `task_type` IS NULL OR `task_type` = '';
