-- V009: 人员删除权限独立化
-- 背景：删除人员是不可逆的物理删除，会连带清除身份证号、手机号、标签、
-- 家庭成员关联、残疾档案与全部变更留痕。而此前该操作只需 person:edit，
-- 比「死亡登记」（person:status，可逆且全量留痕）权限更宽——
-- 意味着任何能改资料的人都能抹掉一个人的全部档案，这在人身数据上不可接受。
--
-- 处理：新增 person:delete 权限，仅授予系统管理员；删除接口改挂该权限。
-- 已持有 person:edit 的普通用户不会自动获得删除能力（需在用户管理中显式分配），
-- 这正是本次收紧的目的。

-- 1) 新增权限。
--    不显式给 id：sys_permission.id 是 AUTO_INCREMENT，且 MySQL 不允许
--    INSERT ... VALUES ((SELECT ... FROM 目标表)) —— 即便带 ON DUPLICATE KEY
--    也会报 ER_UPDATE_TABLE_USED（1093）。依赖唯一索引 uk_perm_code 保证幂等。
INSERT INTO `sys_permission` (`code`, `name`, `type`, `sort`) VALUES
  ('person:delete', '删除人员', 'ACTION', 100)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `type` = VALUES(`type`);

-- 2) 仅授予系统管理员（幂等：INSERT IGNORE + uk_rp 唯一索引防重复）
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r, `sys_permission` p
WHERE r.code = 'SYSTEM_ADMIN' AND p.code = 'person:delete';