-- =============================================================
-- V025 家庭成员关联随人员状态收口（v2.4.0，2026-10）
-- =============================================================
-- 背景（用户反馈）：
--   1) 人员登记死亡后，家庭里仍把这个人当成「在户成员」；
--   2) 独居老人死亡后，他那一户还挂在「家庭总数」上，只增不减。
--
-- 根因：
--   · family_member.status 只有「在户/离开」两态，且离开时 leave_date 写的是
--     CURDATE()（补登往年死亡时会记成今天）；
--   · 家庭数只按 family.status = 1 统计，而全项目没有任何代码把 status 置 0；
--   · 导入/待核查建档一律以 status = 1 插入家庭成员关联，不看人员状态。
--
-- 本次口径（代码侧已同步，改代码前先读这三条）：
--   1. 「家庭在册」= 家庭未停用 且 至少有一名在册成员（utils/familySql.ts 现算，
--      **不落库**——落库就有第二个真值，漏更新一条路径就再次对不上）；
--   2. 人员在家庭里的去向由人员状态现算（死亡 / 迁出 / 手工移出），
--      不新增 leave_reason 列；
--   3. leave_date 记**状态生效日期**，没有才退回当天。
--
-- 本迁移只做一件事：把历史上「人员已迁出/死亡、成员关联却仍是 1」的行收口。
-- 这类数据主要来自旧版导入（一律 status = 1）与状态变更上线前的档案。
--
-- ⚠️ 可重跑：条件收敛到 fm.status = 1，第二次执行影响 0 行。
-- ⚠️ 用 JOIN 而非同表相关子查询（ER_UPDATE_TABLE_USED 1093）。
-- -----------------------------------------------

-- 1. 已迁出/死亡的成员，关联标记离开；离户日期尽量取人员档案上的状态日期
UPDATE family_member fm
JOIN person p ON p.id = fm.person_id
SET fm.status = 0,
    fm.leave_date = COALESCE(fm.leave_date, p.status_date)
WHERE fm.status = 1
  AND p.status IN ('MOVED_OUT', 'DEAD');

-- 2. 反向收口：人员已是「在册」、关联却停在 0 的行（例如先迁出又迁回，
--    但当时状态变更代码只做单向标记）。
--
-- ⚠️ 必须带 `p.family_id IS NOT NULL`：家庭页的「移除成员」也会把关联置 0，
--    那是有意解除归属，重新翻出来等于把用户删掉的人又塞回去。
--    两者的区别正好在这里——手工移除会同时清空 person.family_id，
--    而状态联动不会动 person.family_id。
UPDATE family_member fm
JOIN person p ON p.id = fm.person_id
SET fm.status = 1,
    fm.leave_date = NULL
WHERE fm.status = 0
  AND p.family_id IS NOT NULL
  AND p.status IN ('NORMAL', 'MOVED_IN');
