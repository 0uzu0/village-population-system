-- V013: 已有档案的出生日期按身份证号校正
-- 背景：出生日期此前以「表格填写值」优先，身份证号只作兜底。结果是改了身份证号的人
--       出生日期（年龄）仍停留在旧值；导入时若「出生日期」列填错也会一直错下去。
--       现统一口径：**身份证号是出生日期（年龄）的权威来源**。
--
-- 本迁移做一次性回填：把已入库人员中「身份证可解析出合法出生日期、且与当前 birth_date 不一致」
-- 的记录纠正过来。纯 DML、可重复执行（第二次执行不再匹配任何行），失败回滚无残留。
--
-- 安全性：
-- 1. 只处理 18 位规范号（15 位旧版在入库时已升位为 18 位），且校验字符集；
-- 2. 年/月/日都做范围判断，并用 STR_TO_DATE(...) IS NOT NULL 兜住 02-30 这类不存在的日期
--    ——保证 SET 的值永远不是 NULL，不会把原有出生日期抹掉；
-- 3. birth_date 可空（V001 定义为 DATE DEFAULT NULL），故无 NOT NULL 冲突。
-- 注：不校正 gender（可能有人工核对过的值），性别在保存时按身份证派生即可。

UPDATE `person`
   SET `birth_date` = STR_TO_DATE(
         CONCAT(SUBSTRING(`id_card`, 7, 4), '-', SUBSTRING(`id_card`, 11, 2), '-', SUBSTRING(`id_card`, 13, 2)),
         '%Y-%m-%d')
 WHERE `id_card` IS NOT NULL
   AND CHAR_LENGTH(TRIM(`id_card`)) = 18
   AND TRIM(`id_card`) REGEXP '^[0-9]{17}[0-9Xx]$'
   AND SUBSTRING(`id_card`, 7, 4) BETWEEN '1900' AND '2100'
   AND SUBSTRING(`id_card`, 11, 2) BETWEEN '01' AND '12'
   AND SUBSTRING(`id_card`, 13, 2) BETWEEN '01' AND '31'
   AND STR_TO_DATE(
         CONCAT(SUBSTRING(`id_card`, 7, 4), '-', SUBSTRING(`id_card`, 11, 2), '-', SUBSTRING(`id_card`, 13, 2)),
         '%Y-%m-%d') IS NOT NULL
   AND (`birth_date` IS NULL
        OR `birth_date` <> STR_TO_DATE(
             CONCAT(SUBSTRING(`id_card`, 7, 4), '-', SUBSTRING(`id_card`, 11, 2), '-', SUBSTRING(`id_card`, 13, 2)),
             '%Y-%m-%d'));
