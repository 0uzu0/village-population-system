-- =============================================================
-- V002 种子数据：角色、权限、字典、标签体系、演示数据
-- 说明：默认管理员账号由后端首次启动时自动创建（密码取自环境变量
--       ADMIN_INIT_PASSWORD，默认 Admin@123456），不在此硬编码哈希。
-- =============================================================

SET NAMES utf8mb4;

-- -------------------------------------------------------------
-- 角色
-- -------------------------------------------------------------
INSERT INTO `sys_role` (`id`,`code`,`name`,`data_scope`,`remark`) VALUES
  (1,'SYSTEM_ADMIN','系统管理员','ALL','拥有全部权限'),
  (2,'USER','普通用户','ALL','拥有全部业务权限（不含用户与系统管理）');

-- -------------------------------------------------------------
-- 权限
-- -------------------------------------------------------------
INSERT INTO `sys_permission` (`id`,`code`,`name`,`type`,`sort`) VALUES
  (1,'dashboard:view','工作台查看','MENU',1),
  (2,'person:view','人口档案查看','MENU',2),
  (3,'person:create','新增人员','ACTION',3),
  (4,'person:edit','编辑人员','ACTION',4),
  (5,'person:status','人员状态变更','ACTION',5),
  (6,'person:export','导出人员','ACTION',6),
  (7,'family:view','家庭查看','MENU',7),
  (8,'family:manage','家庭管理','ACTION',8),
  (9,'grid:view','网格查看','MENU',9),
  (10,'grid:manage','网格管理','ACTION',10),
  (11,'tag:view','标签查看','MENU',11),
  (12,'tag:manage','标签管理','ACTION',12),
  (13,'keygroup:view','重点人群查看','MENU',13),
  (14,'keygroup:export','重点人群导出','ACTION',14),
  (15,'statistics:view','数据统计查看','MENU',15),
  (16,'excel:import','Excel导入','ACTION',16),
  (17,'excel:export','Excel导出','ACTION',17),
  (18,'user:view','用户查看','MENU',18),
  (19,'user:manage','用户与权限管理','ACTION',19),
  (20,'audit:view','审计日志查看','MENU',20),
  (21,'system:view','系统设置查看','MENU',21),
  (22,'system:manage','系统设置管理','ACTION',22);

-- -------------------------------------------------------------
-- 角色-权限
-- -------------------------------------------------------------
-- 系统管理员：全部权限
INSERT INTO `sys_role_permission` (`role_id`,`permission_id`) SELECT 1,id FROM `sys_permission`;
-- 普通用户：全部业务权限（不含用户管理、系统设置、审计）
INSERT INTO `sys_role_permission` (`role_id`,`permission_id`)
SELECT 2,id FROM `sys_permission`
WHERE `code` NOT IN ('user:view','user:manage','system:view','system:manage','audit:view');

-- -------------------------------------------------------------
-- 系统字典
-- -------------------------------------------------------------
INSERT INTO `sys_dict` (`dict_type`,`dict_label`,`dict_value`,`sort`) VALUES
  ('gender','男','MALE',1),
  ('gender','女','FEMALE',2),
  ('person_status','正常','NORMAL',1),
  ('person_status','迁入','MOVED_IN',2),
  ('person_status','迁出','MOVED_OUT',3),
  ('person_status','注销','CANCELLED',4),
  ('relation','户主','HEAD',1),
  ('relation','配偶','SPOUSE',2),
  ('relation','子女','CHILD',3),
  ('relation','父母','PARENT',4),
  ('relation','其他','OTHER',5),
  ('data_source','手工录入','MANUAL',1),
  ('data_source','Excel导入','EXCEL_IMPORT',2),
  ('tag_object_type','个人','PERSON',1),
  ('tag_object_type','家庭','FAMILY',2),
  ('tag_link_status','有效','ACTIVE',1),
  ('tag_link_status','失效','INACTIVE',2),
  ('tag_link_status','待审核','PENDING',3),
  ('import_status','待处理','PENDING',1),
  ('import_status','处理中','RUNNING',2),
  ('import_status','成功','SUCCESS',3),
  ('import_status','失败','FAILED',4),
  ('import_status','部分成功','PARTIAL',5);

-- -------------------------------------------------------------
-- 标签分类
-- -------------------------------------------------------------
INSERT INTO `tag_category` (`id`,`code`,`name`,`sort`) VALUES
  (1,'POLITICAL','政治面貌',1),
  (2,'VETERAN','退役军人相关',2),
  (3,'PREFERENTIAL','优抚保障',3),
  (4,'SOCIAL_SECURITY','社会保障',4),
  (5,'DISABLED','残疾人服务',5),
  (6,'AGE_CARE','年龄及关怀',6),
  (7,'POPULATION','人口管理',7);

-- -------------------------------------------------------------
-- 标签定义
-- -------------------------------------------------------------
INSERT INTO `tag_definition`
(`id`,`category_id`,`name`,`code`,`alias`,`color`,`description`,`object_type`,`allow_duplicate`,`is_sensitive`,`need_audit`,`enabled`) VALUES
(1,1,'中共党员','PARTY_MEMBER',NULL,'#E5484D','中国共产党正式党员','PERSON',0,0,0,1),
(2,1,'中共预备党员','PARTY_PROBATIONARY',NULL,'#F76B15','中国共产党预备党员','PERSON',0,0,0,1),
(3,1,'共青团员','LEAGUE_MEMBER',NULL,'#3978F6','中国共产主义青年团团员','PERSON',0,0,0,1),
(4,1,'群众','MASSES',NULL,'#8A8F98','群众','PERSON',0,0,0,1),
(5,1,'其他','POLITICAL_OTHER',NULL,'#8A8F98','其他政治面貌','PERSON',0,0,0,1),
(6,2,'退役军人','VETERAN',NULL,'#5B5BD6','退役军人','PERSON',0,0,0,1),
(7,3,'优抚对象','PREFERENTIAL_OBJECT',NULL,'#0E7C6B','享受国家抚恤补助的优抚对象','PERSON',0,1,1,1),
(8,4,'低保对象','LOW_INCOME_PERSON',NULL,'#F76B15','个人享受最低生活保障','PERSON',0,1,1,1),
(9,4,'特困供养对象','EXTREME_POVERTY_PERSON','五保户','#C2410C','特困人员供养（历史名称：五保户）','PERSON',0,1,1,1),
(10,5,'残疾人','DISABLED_PERSON',NULL,'#0E7C6B','持证残疾人','PERSON',0,1,0,1),
(11,6,'老年人','ELDERLY',NULL,'#3978F6','60周岁及以上老年人','PERSON',0,0,0,1),
(12,6,'高龄老人','SENIOR_ELDERLY',NULL,'#5B5BD6','80周岁及以上高龄老人','PERSON',0,0,0,1),
(13,6,'未成年人','MINOR',NULL,'#2F9E44','未满18周岁','PERSON',0,0,0,1),
(14,7,'流动人口','FLOATING_POP',NULL,'#3978F6','本村流动人口（总人口口径=户籍人口+流动人口）','PERSON',0,0,0,1),
(15,7,'户籍人口','HUKOU_POP',NULL,'#0E7C6B','本村户籍人口','PERSON',0,0,0,1),
(16,7,'流动人口','FLOATING_POP',NULL,'#8A8F98','流入/流出流动人口','PERSON',0,0,0,1),
(17,7,'迁入人员','MOVED_IN_PERSON',NULL,'#F76B15','近期迁入人员','PERSON',0,0,0,1),
(18,7,'迁出人员','MOVED_OUT_PERSON',NULL,'#8A8F98','近期迁出人员','PERSON',0,0,0,1),
(19,4,'低保家庭','LOW_INCOME_FAMILY',NULL,'#F76B15','家庭被认定为低保家庭','FAMILY',0,1,1,1),
(20,4,'特困供养家庭','EXTREME_POVERTY_FAMILY',NULL,'#C2410C','家庭被认定为特困供养家庭','FAMILY',0,1,1,1);

-- -------------------------------------------------------------
-- 演示网格
-- -------------------------------------------------------------
INSERT INTO `grid` (`id`,`grid_no`,`name`,`manager`,`staff`,`description`) VALUES
  (1,'G001','第一网格','张伟','张伟,李强','村东片区'),
  (2,'G002','第二网格','王芳','王芳','村西片区');

-- -------------------------------------------------------------
-- 演示家庭
-- -------------------------------------------------------------
INSERT INTO `family` (`id`,`family_no`,`head_person_id`,`address`,`grid_id`) VALUES
  (1,'F001',1,'村东一巷12号',1),
  (2,'F002',4,'村东二巷8号',1),
  (3,'F003',7,'村西大路3号',2);

-- -------------------------------------------------------------
-- 演示人员（虚构数据，身份证/手机号为演示占位，不包含真实信息）
-- -------------------------------------------------------------
INSERT INTO `person`
(`id`,`person_no`,`name`,`gender`,`birth_date`,`id_card`,`phone`,`hukou_address`,`live_address`,`village`,`grid_id`,`family_id`,`relation`,`status`,`data_source`,`change_reason`) VALUES
(1,'P0001','张三','MALE','1960-05-12','320101196005120011','13800000001','本村','本村','幸福村',1,1,'HEAD','NORMAL','MANUAL',NULL),
(2,'P0002','李四','FEMALE','1962-03-08','320101196203080022','13800000002','本村','本村','幸福村',1,1,'SPOUSE','NORMAL','MANUAL',NULL),
(3,'P0003','张小明','MALE','1990-01-15','320101199001150033','13800000003','本村','本村','幸福村',1,1,'CHILD','NORMAL','MANUAL',NULL),
(4,'P0004','王五','MALE','1985-07-20','320101198507200044','13800000004','本村','本村','幸福村',1,2,'HEAD','NORMAL','MANUAL',NULL),
(5,'P0005','赵六','FEMALE','1987-09-30','320101198709300055','13800000005','本村','本村','幸福村',1,2,'SPOUSE','NORMAL','MANUAL',NULL),
(6,'P0006','王小宝','MALE','2018-04-05','320101201804050066','13800000006','本村','本村','幸福村',1,2,'CHILD','NORMAL','MANUAL',NULL),
(7,'P0007','刘七','MALE','1952-11-01','320101195211010077','13800000007','本村','本村','幸福村',2,3,'HEAD','NORMAL','MANUAL',NULL),
(8,'P0008','陈八','FEMALE','1955-02-14','320101195502140088','13800000008','本村','本村','幸福村',2,3,'SPOUSE','NORMAL','MANUAL',NULL);

-- -------------------------------------------------------------
-- 演示家庭成员关联
-- -------------------------------------------------------------
INSERT INTO `family_member` (`family_id`,`person_id`,`relation`,`is_householder`,`join_date`) VALUES
  (1,1,'HEAD',1,'2000-01-01'),
  (1,2,'SPOUSE',0,'2000-01-01'),
  (1,3,'CHILD',0,'2000-01-01'),
  (2,4,'HEAD',1,'2010-01-01'),
  (2,5,'SPOUSE',0,'2010-01-01'),
  (2,6,'CHILD',0,'2018-04-05'),
  (3,7,'HEAD',1,'1990-01-01'),
  (3,8,'SPOUSE',0,'1990-01-01');

-- -------------------------------------------------------------
-- 演示人员标签
-- -------------------------------------------------------------
INSERT INTO `person_tag` (`person_id`,`tag_id`,`effect_date`,`status`,`basis`,`created_by`) VALUES
  (1,1,'2020-01-01','ACTIVE','组织关系在本村',1),
  (1,6,'2020-01-01','ACTIVE','退役军人事务部门登记',1),
  (1,11,'2020-01-01','ACTIVE','年龄达到60周岁',1),
  (1,14,'2020-01-01','ACTIVE',NULL,1),
  (1,15,'2020-01-01','ACTIVE',NULL,1),
  (2,4,'2020-01-01','ACTIVE',NULL,1),
  (2,11,'2022-01-01','ACTIVE','年龄达到60周岁',1),
  (2,15,'2020-01-01','ACTIVE',NULL,1),
  (3,3,'2020-01-01','ACTIVE','团组织关系在本村',1),
  (3,14,'2020-01-01','ACTIVE',NULL,1),
  (3,15,'2020-01-01','ACTIVE',NULL,1),
  (4,4,'2020-01-01','ACTIVE',NULL,1),
  (4,8,'2023-06-01','ACTIVE','民政部门认定',1),
  (4,10,'2015-01-01','ACTIVE','残疾人证',1),
  (4,15,'2020-01-01','ACTIVE',NULL,1),
  (5,4,'2020-01-01','ACTIVE',NULL,1),
  (5,8,'2023-06-01','ACTIVE','民政部门认定',1),
  (5,15,'2020-01-01','ACTIVE',NULL,1),
  (6,13,'2018-04-05','ACTIVE','未满18周岁',1),
  (6,15,'2018-04-05','ACTIVE',NULL,1),
  (7,1,'1990-01-01','ACTIVE','组织关系在本村',1),
  (7,7,'2005-01-01','ACTIVE','退役军人事务部门登记',1),
  (7,12,'2012-01-01','ACTIVE','年龄达到80周岁',1),
  (7,15,'1990-01-01','ACTIVE',NULL,1),
  (8,4,'1990-01-01','ACTIVE',NULL,1),
  (8,11,'2015-01-01','ACTIVE','年龄达到60周岁',1),
  (8,15,'1990-01-01','ACTIVE',NULL,1);

-- -------------------------------------------------------------
-- 演示家庭标签（低保家庭为家庭级认定，区别于个人低保对象）
-- -------------------------------------------------------------
INSERT INTO `family_tag` (`family_id`,`tag_id`,`effect_date`,`status`,`basis`,`created_by`) VALUES
  (2,19,'2023-06-01','ACTIVE','家庭被认定为低保家庭',1);
