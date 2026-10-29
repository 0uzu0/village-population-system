-- V028 「与户主关系」收敛为受控枚举
--
-- 背景：Excel 导入只把「户主」换成 HEAD，其余中文（妻 / 长女 / 儿媳 / 其他非亲属…）
-- 原样入库；而网页下拉只产出枚举码。2026-10-29 抽样 1200 人：HEAD 42.5%、中文 56%，
-- 共 24 种写法。后果：① 前端按枚举渲染时中文只能原样透出；② 户主判定
-- relation='HEAD' 会漏掉「本人」；③ person 与 family_member 两表口径不一。
--
-- 处理分两步：
--   1. 字典补三个码（儿媳女婿 / 孙辈 / 兄弟姐妹），把实际存在的亲缘关系装进去，
--      不再把约 6% 的人粗暴并进「其他」；
--   2. 历史数据按语义归一。中文映射表与 backend/src/utils/relation.ts 的 ALIASES
--      完全一致，relation.test.ts 会逐条比对，任何一边改了另一边没改都会报红。
--
-- 为什么不用一条大 CASE：130 个 WHEN 的 CASE 一旦少个逗号就是语法错误，
-- 而这条迁移在容器启动时自动跑，语法错会让后端反复重启（V009 踩过）。
-- 拆成「一个码一条 IN 语句 + 一条兜底」，每条都能单独看懂，出错面小。
--
-- 幂等：目标值已经是合法码的行不会再被任何语句命中，跑第二遍零更新。
-- 纯 DML：不含 DDL，迁移器事务回滚有效。
-- 空串：person.relation 可空 → 归 NULL（「没填」就是没填）；
--       family_member.relation 是 NOT NULL → 兜底语句把它归 OTHER。
-- 未识别的写法统一落 OTHER（不保留原文），保证这一列从此只有受控值。

-- ---------- 1. 字典补齐 ----------
INSERT INTO `sys_dict` (`dict_type`, `dict_label`, `dict_value`, `sort`) VALUES
  ('relation', '儿媳女婿', 'CHILD_IN_LAW', 4),
  ('relation', '孙辈', 'GRANDCHILD', 5),
  ('relation', '兄弟姐妹', 'SIBLING', 7)
ON DUPLICATE KEY UPDATE `dict_label` = VALUES(`dict_label`), `sort` = VALUES(`sort`), `enabled` = 1;

-- 「其他」永远排最后；已有项的 sort 一并校正，避免新插入的码夹在中间
UPDATE `sys_dict`
   SET `sort` = CASE `dict_value`
     WHEN 'HEAD' THEN 1
     WHEN 'SPOUSE' THEN 2
     WHEN 'CHILD' THEN 3
     WHEN 'CHILD_IN_LAW' THEN 4
     WHEN 'GRANDCHILD' THEN 5
     WHEN 'PARENT' THEN 6
     WHEN 'SIBLING' THEN 7
     WHEN 'OTHER' THEN 9
     ELSE `sort`
   END
 WHERE `dict_type` = 'relation';

-- ---------- 2. 人员档案：先按语义映射 ----------
UPDATE `person` SET `relation` = 'HEAD' WHERE TRIM(`relation`) IN ('户主', '本人', '户主本人');
UPDATE `person` SET `relation` = 'SPOUSE' WHERE TRIM(`relation`) IN ('配偶', '妻', '夫', '妻子', '丈夫', '爱人');
UPDATE `person` SET `relation` = 'CHILD' WHERE TRIM(`relation`) IN ('子', '女', '儿子', '女儿', '长子', '次子', '三子', '四子', '长女', '次女', '二女', '三女', '四女', '子女', '养子', '养女', '继子', '继女', '养子或继子', '养女或继女', '独生子', '独生女');
UPDATE `person` SET `relation` = 'CHILD_IN_LAW' WHERE TRIM(`relation`) IN ('儿媳', '儿媳妇', '媳妇', '女婿');
UPDATE `person` SET `relation` = 'GRANDCHILD' WHERE TRIM(`relation`) IN ('孙', '孙子', '孙女', '外孙', '外孙子', '外孙女');
UPDATE `person` SET `relation` = 'PARENT' WHERE TRIM(`relation`) IN ('父', '母', '父亲', '母亲', '父母', '岳父', '岳母', '公公', '婆婆');
UPDATE `person` SET `relation` = 'SIBLING' WHERE TRIM(`relation`) IN ('兄', '弟', '姐', '妹', '哥哥', '弟弟', '姐姐', '妹妹', '兄弟', '姐妹');
UPDATE `person` SET `relation` = 'OTHER' WHERE TRIM(`relation`) IN ('其他', '其它', '其他非亲属', '非亲属');

-- 空串在人员档案里没有意义，归 NULL
UPDATE `person` SET `relation` = NULL WHERE `relation` IS NOT NULL AND TRIM(`relation`) = '';

-- 兜底：既不是合法码、也不在映射表里的写法 → OTHER
UPDATE `person` SET `relation` = 'OTHER'
 WHERE `relation` IS NOT NULL
   AND TRIM(`relation`) <> ''
   AND UPPER(TRIM(`relation`)) NOT IN ('HEAD','SPOUSE','CHILD','CHILD_IN_LAW','GRANDCHILD','PARENT','SIBLING','OTHER');

-- ---------- 3. 家庭成员关联（NOT NULL，空串由兜底语句归 OTHER）----------
UPDATE `family_member` SET `relation` = 'HEAD' WHERE TRIM(`relation`) IN ('户主', '本人', '户主本人');
UPDATE `family_member` SET `relation` = 'SPOUSE' WHERE TRIM(`relation`) IN ('配偶', '妻', '夫', '妻子', '丈夫', '爱人');
UPDATE `family_member` SET `relation` = 'CHILD' WHERE TRIM(`relation`) IN ('子', '女', '儿子', '女儿', '长子', '次子', '三子', '四子', '长女', '次女', '二女', '三女', '四女', '子女', '养子', '养女', '继子', '继女', '养子或继子', '养女或继女', '独生子', '独生女');
UPDATE `family_member` SET `relation` = 'CHILD_IN_LAW' WHERE TRIM(`relation`) IN ('儿媳', '儿媳妇', '媳妇', '女婿');
UPDATE `family_member` SET `relation` = 'GRANDCHILD' WHERE TRIM(`relation`) IN ('孙', '孙子', '孙女', '外孙', '外孙子', '外孙女');
UPDATE `family_member` SET `relation` = 'PARENT' WHERE TRIM(`relation`) IN ('父', '母', '父亲', '母亲', '父母', '岳父', '岳母', '公公', '婆婆');
UPDATE `family_member` SET `relation` = 'SIBLING' WHERE TRIM(`relation`) IN ('兄', '弟', '姐', '妹', '哥哥', '弟弟', '姐姐', '妹妹', '兄弟', '姐妹');
UPDATE `family_member` SET `relation` = 'OTHER' WHERE TRIM(`relation`) IN ('其他', '其它', '其他非亲属', '非亲属');

UPDATE `family_member` SET `relation` = 'OTHER'
 WHERE UPPER(TRIM(`relation`)) NOT IN ('HEAD','SPOUSE','CHILD','CHILD_IN_LAW','GRANDCHILD','PARENT','SIBLING','OTHER');
