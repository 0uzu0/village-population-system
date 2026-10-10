-- V003: 人员备用手机号
-- 户籍台账中常出现一人多号（本人号 + 家属号），主号存 phone，第二号码存 phone_backup
ALTER TABLE `person`
  ADD COLUMN `phone_backup` VARCHAR(20) DEFAULT NULL COMMENT '备用手机号（家属/第二联系人）' AFTER `phone`;
