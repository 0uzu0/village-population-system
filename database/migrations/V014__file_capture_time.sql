-- V014: 附件拍摄时间（拍照留痕）
--
-- 背景：现场照片原先只落「上传时间」（file_info.created_at）。离线补传时两者可能差好几天
--       （村里没信号是常态），于是后台既没法按拍摄时间查找，文件名也只能拿上传时刻去编，
--       同一批照片看起来会是同一个时间点。
--
-- 做法：新增可空列 captured_at（客户端上报的拍摄时刻，毫秒时间戳或 ISO 字符串都能解析），
--       并把「命名」改为以它为准：文件名 = <拍摄时间>-<人员标识>.jpg，按名字排序即按拍摄时间排序。
--       为 NULL 表示未知——PC 端上传的合同/发票本来就没有拍摄时间，它保持原始文件名不变。
--
-- 索引不新增：V010 已建 idx_file_biz(biz_type, biz_id)，「按人 / 按台账列附件」正是走它。

ALTER TABLE `file_info`
  ADD COLUMN `captured_at` DATETIME DEFAULT NULL COMMENT '拍摄/取证时间（客户端上报；NULL=未知）' AFTER `biz_id`;
