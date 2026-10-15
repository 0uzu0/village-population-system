-- V012: 村庄负责人 / 联系方式
-- 背景：网格管理「按小村庄」维度的村庄取自 person.village（导入时由户籍地址推导），
--       grid 表只有网格负责人（无手机号），村庄本身没有任何负责人数据。
--       原先该信息只存在浏览器 localStorage，换设备/清缓存即丢失、也无法多人共享，
--       现改为落库，按村庄名维护一份联系方式。
--
-- 设计取舍：
-- 1. 单独一张窄表 village_contact，不往 person 上挂（联系人是村庄级、不是人级），
--    也不改 grid 表（村庄与网格是多对多：一个村可能跨多个网格）。
-- 2. 村庄名即业务主键（uk_vc_village 唯一索引），配合 INSERT ... ON DUPLICATE KEY UPDATE
--    做幂等 upsert；不显式给 id（AUTO_INCREMENT），迁移可重复执行。
-- 3. 权限复用已有 grid:manage，不新增权限项。

CREATE TABLE IF NOT EXISTS `village_contact` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `village_name` VARCHAR(128) NOT NULL                COMMENT '村庄名（取自 person.village）',
  `manager`      VARCHAR(64)  DEFAULT NULL            COMMENT '负责人',
  `phone`        VARCHAR(20)  DEFAULT NULL            COMMENT '负责人手机号',
  `created_by`   BIGINT       DEFAULT NULL            COMMENT '创建人',
  `updated_by`   BIGINT       DEFAULT NULL            COMMENT '最后修改人',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vc_village` (`village_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='村庄负责人/联系方式';
