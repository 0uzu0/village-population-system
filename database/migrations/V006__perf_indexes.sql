-- V006: 查询性能索引优化
-- 背景：重点人群筛查、人口档案筛选都以 person_tag 的 EXISTS 子查询为主路径，
-- 而原表仅建了 person_id / tag_id / status 三个单列索引，MySQL 只能命中其中一个
-- 再回表过滤，万级数据下筛选明显变慢。这里补齐实际查询用到的复合索引。
--
-- 说明：仅新增索引，不改动任何已有索引与列定义，可安全在存量库上执行。

-- 1) person：村庄维度统计与「按更新时间排序」
--    - 村庄概览页按 p.village 分组统计人口/家庭/重点人群
--    - 列表支持 village + status 组合筛选，复合索引同时覆盖 village 单列前缀
ALTER TABLE `person`
  ADD KEY `idx_person_village_status` (`village`, `status`),
  ADD KEY `idx_person_updated` (`updated_at`);

-- 2) person_tag：标签筛选主路径
--    EXISTS (SELECT 1 FROM person_tag WHERE person_id = ? AND tag_id = ? AND status = 'ACTIVE')
--    三列复合索引可让该子查询走覆盖索引，无需回表
ALTER TABLE `person_tag`
  ADD KEY `idx_pt_person_tag_status` (`person_id`, `tag_id`, `status`);

-- 3) excel_import_task：列表按类型过滤 + 孤儿任务收敛扫描
--    - /import-tasks?taskType=PERSON|KEY_GROUP 按类型过滤后按时间倒序
--    - markStaleImportTasks 扫描 status='RUNNING' 且创建时间超阈值的任务
ALTER TABLE `excel_import_task`
  ADD KEY `idx_eit_type_time` (`task_type`, `created_at`),
  ADD KEY `idx_eit_status_time` (`status`, `created_at`);

-- 4) import_pending：待核查列表默认按 status 过滤并按创建时间倒序
ALTER TABLE `import_pending`
  ADD KEY `idx_ip_status_created` (`status`, `created_at`);
