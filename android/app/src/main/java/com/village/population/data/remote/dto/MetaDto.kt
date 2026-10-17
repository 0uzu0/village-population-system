package com.village.population.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---------------------------------------------------------------------------
// 网格 / 村庄
//
// ⚠️ 这两个接口返回的是**原始 SQL 行**：后端直接 `SELECT g.*` / `SELECT COUNT(*) AS
// person_count`，没有经过 toPersonVO 那种驼峰转换，字段名就是数据库列名与 SQL 别名。
// 因此这里必须用 @SerialName 显式绑到下划线名——写成驼峰不会报错，只会静默拿到默认值
// （所有人数变成 0），因为 Json 配了 ignoreUnknownKeys。PC 端在同一个坑上踩过两次。
// ---------------------------------------------------------------------------

@Serializable
data class GridDto(
    val id: Int = 0,
    @SerialName("grid_no") val gridNo: String? = null,
    val name: String = "",
    val manager: String? = null,
    val staff: String? = null,
    val description: String? = null,
    val status: Int = 1,
    @SerialName("person_count") val personCount: Int = 0,
    @SerialName("family_count") val familyCount: Int = 0,
)

/**
 * 村庄。它是「按村名聚合出来的视图」，不是一张表——一个村可以横跨多个网格，
 * 所以列表页按村筛选和按网格筛选是两件不同的事。
 * `manager` / `phone` 来自 village_contact 表（按村名唯一），没维护过就是 null。
 *
 * 年龄类人群（老年/未成年）**不在这个接口里**——focusGroups.ts 里它们没有 countField，
 * 数字要从 /key-groups/quick 取，别在这里找 `elderly_count`（永远不存在）。
 */
@Serializable
data class VillageDto(
    val name: String = "",
    val manager: String? = null,
    val phone: String? = null,
    @SerialName("person_count") val personCount: Int = 0,
    @SerialName("family_count") val familyCount: Int = 0,
    @SerialName("grid_names") val gridNames: String? = null,
    // 重点人群分村人数：SQL 别名与 focusGroups.ts 的 countField 一一对应
    @SerialName("party_count") val partyCount: Int = 0,
    @SerialName("disabled_count") val disabledCount: Int = 0,
    @SerialName("extreme_poverty_count") val extremePovertyCount: Int = 0,
    @SerialName("low_income_count") val lowIncomeCount: Int = 0,
    @SerialName("veteran_count") val veteranCount: Int = 0,
    @SerialName("preferential_count") val preferentialCount: Int = 0,
)

// ---------------------------------------------------------------------------
// 重点人群
// ---------------------------------------------------------------------------

/**
 * 快捷分组。`byAge = true` 表示这一组是按年龄算的（老年 ≥60、未成年 <18），
 * 与是否打过标签无关——筛选时要换成 minAge/maxAge 参数，不能当成 tagIds 用。
 *
 * ⚠️ 身份类人群**不能只用 `code` 去筛**：`code` 只是族群编码，比如「党员」是
 * PARTY_MEMBER，但该人群实际由 `tagCodes` 里的全部标签构成（含预备党员）。
 * 用 code 筛会少一截人，与卡片上的数字对不上。见 FocusGroupQuery。
 */
@Serializable
data class QuickGroupDto(
    val label: String = "",
    val code: String = "",
    val tagCodes: List<String> = emptyList(),
    val count: Int = 0,
    val color: String? = null,
    val byAge: Boolean = false,
    val minAge: Int? = null,
    val maxAge: Int? = null,
)

@Serializable
data class QuickGroupData(
    val list: List<QuickGroupDto> = emptyList(),
    val note: String? = null,
)

/**
 * 标签定义。来自 GET /api/tags/definitions，同样是**原始 SQL 行**（`td.*`），
 * 所以字段名按数据库列名写。这里只需要「按 code 找 id」这一个用途，
 * 因此只声明真正会用到的列。
 */
@Serializable
data class TagDto(
    val id: Int = 0,
    val name: String = "",
    val code: String = "",
    val color: String? = null,
)

// ---------------------------------------------------------------------------
// 工作台
// ---------------------------------------------------------------------------

/**
 * 工作台指标。人口类指标的口径是「在册」（正常/迁入），已死亡/迁出不计入；
 * 各重点人群之间存在交叉，不能相加。
 *
 * ⚠️ 只放 /statistics/dashboard 真正会返回的字段。**老年/未成年不在这里**——
 * focusGroups.ts 里这两个年龄类人群没有 dashboardField，首页那两行数字取自
 * /key-groups/quick 的快捷分组。在这里加 `elderlyCount` 只会永远拿到 0。
 */
@Serializable
data class DashboardDto(
    val totalPopulation: Int = 0,
    val familyCount: Int = 0,
    val gridCount: Int = 0,
    val hukouCount: Int = 0,
    /** 流动人口（2026-10 口径调整：原「常住人口」residentCount 更名而来） */
    val floatingCount: Int = 0,
    // 身份类重点人群：字段名 = focusGroups.ts 的 dashboardField
    val partyCount: Int = 0,
    val disabledCount: Int = 0,
    val extremePovertyCount: Int = 0,
    /** 注意不是 lowIncomeCount——后端的 dashboardField 叫 lowIncomePersonCount */
    val lowIncomePersonCount: Int = 0,
    val veteranCount: Int = 0,
    val preferentialCount: Int = 0,
    /** 低保家庭：认定对象是家庭，走 family_tag，与「低保对象（人）」不是一回事 */
    val lowIncomeFamilyCount: Int = 0,
)

// ---------------------------------------------------------------------------
// 待核查人员
// ---------------------------------------------------------------------------

/**
 * 待核查人员。同样是 import_pending 的原始行（下划线字段名），必须显式绑定——
 * 其中 `idCard` 是这一屏最关键的字段：原因码 ID_CARD_INVALID 的行要靠它
 * 人工核对原号码，绑错就整列空白。
 */
@Serializable
data class PendingDto(
    val id: Int = 0,
    @SerialName("batch_no") val batchNo: String? = null,
    @SerialName("row_no") val rowNo: Int? = null,
    val reason: String? = null,
    @SerialName("reason_text") val reasonText: String? = null,
    val name: String? = null,
    val gender: String? = null,
    @SerialName("birth_date") val birthDate: String? = null,
    @SerialName("id_card") val idCard: String? = null,
    val phone: String? = null,
    @SerialName("phone_backup") val phoneBackup: String? = null,
    @SerialName("hukou_address") val hukouAddress: String? = null,
    @SerialName("live_address") val liveAddress: String? = null,
    val village: String? = null,
    @SerialName("grid_no") val gridNo: String? = null,
    @SerialName("family_no") val familyNo: String? = null,
    val relation: String? = null,
    val status: String? = null,
    @SerialName("handle_note") val handleNote: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

/** 汇总：total 是总数，byStatus/byReason 是按状态、原因的分组计数 */
@Serializable
data class PendingSummaryDto(
    val total: Int = 0,
    val byStatus: Map<String, Int> = emptyMap(),
    val byReason: Map<String, Int> = emptyMap(),
)

@Serializable
data class BatchIdsRequest(
    val ids: List<Int>,
)

// ---------------------------------------------------------------------------
// 附件
// ---------------------------------------------------------------------------

/**
 * 附件。移动端只做一件事：把现场照片挂到人身上再读回来。
 *
 * `fileName` 由后端按**拍照时间**生成（形如 `20261016-193012-张三-P000123.jpg`），
 * 所以列表里直接显示它就能看出「哪天拍的、拍的是谁」，不需要额外字段。
 *
 * 注意这里**没有 url**：预览接口要 Bearer 头，直链一定 401，
 * 必须先 download(id) 取回字节再交给图片框架（见 FileRepository.download）。
 */
@Serializable
data class FileDto(
    val id: Int = 0,
    val fileName: String? = null,
    val contentType: String? = null,
    val size: Long? = null,
    val bizType: String? = null,
    val bizId: Int? = null,
    /** 拍摄/取证时间。PC 传的合同/发票没有这个值（为 null） */
    val capturedAt: String? = null,
    val createdAt: String? = null,
)
