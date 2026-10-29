-- V029 「人员档案 ↔ 家庭成员」两表对账修复
--
-- 背景：person.relation / person.family_id 与 family_member 是同一事实的两份存储。
-- 现在六条写入路径（新建人员、编辑人员、建户、并户、导入归户、移出成员）都会同时
-- 维护两张表，但那是逐步收口的；更早的导入批次只写了 person，家庭成员表是后来
-- 批量归户补出来的。于是库里会留下“人员列表说他在 A 户、家庭页说他在 B 户”这类
-- 错位，且不会抛任何异常，只会让家庭人数、按户筛选、导出名单三者互相对不上。
--
-- 本迁移只做**无歧义**的两类，方向固定：
--   family_member 是权威，person 是它的冗余副本（与 family.ts / person.ts 现有的
--   写同步方向一致：先写关联表，再回写人员表）。
--
-- 不修的（对账接口 GET /api/families/reconcile 会列出来）：
--   有归属却无在户记录、两表指向不同家庭、一人在多户、户主数不是 1、
--   已迁出却仍标记在户。这五类无论怎么改都是“猜”，猜错会造出更难看的数据，
--   必须由人确认。
--
-- 幂等：两条 UPDATE 的条件都收在“还没对齐”的状态上，第二次执行影响 0 行。
-- 纯 DML：不含 DDL，迁移器事务回滚有效。
-- 判定条件必须与 services/familyReconcile.ts 的 relation_diff / member_without_family
-- 保持一致，familyReconcile.test.ts 会逐条比对——只改一边，对账接口报的和迁移修的就
-- 不是同一批人。

-- ---------- 1. 关系值不一致：以家庭成员表回写人员档案 ----------
-- 覆盖“person 有值但不同”与“person 为 NULL 而关联表有值”两种，
-- 用 <=> 做 NULL 安全比较，普通 <> 会把 NULL 那半漏掉。
UPDATE `person` p
  JOIN `family_member` fm ON fm.`person_id` = p.`id` AND fm.`status` = 1
  JOIN `family` f ON f.`id` = fm.`family_id`
   SET p.`relation` = fm.`relation`
 WHERE p.`family_id` = fm.`family_id`
   AND NOT (p.`relation` <=> fm.`relation`);

-- ---------- 2. 在户却没有家庭归属：补 family_id 与 relation ----------
-- 只处理“恰好只在一个家庭在户”的人。一人在多户属于歧义（对账接口的
-- multi_family 会列出来），自动挑一户等于替人做主，这里不做。
UPDATE `person` p
  JOIN (
    SELECT fm.`person_id` AS person_id,
           MIN(fm.`family_id`) AS family_id,
           MIN(fm.`relation`) AS relation,
           COUNT(*) AS n
      FROM `family_member` fm
      JOIN `family` f ON f.`id` = fm.`family_id` AND f.`status` = 1
     WHERE fm.`status` = 1
     GROUP BY fm.`person_id`
  ) x ON x.`person_id` = p.`id` AND x.n = 1
   SET p.`family_id` = x.`family_id`,
       p.`relation`  = x.`relation`
 WHERE p.`family_id` IS NULL;
