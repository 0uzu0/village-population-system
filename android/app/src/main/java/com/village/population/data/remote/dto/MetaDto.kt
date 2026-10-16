package com.village.population.data.remote.dto

import kotlinx.serialization.Serializable

// ---------------------------------------------------------------------------
// 网格 / 村庄
// ---------------------------------------------------------------------------

@Serializable
data class GridDto(
    val id: Int = 0,
    val name: String = "",
    val gridNo: String? = null,
    val manager: String? = null,
    val phone: String? = null,
    val personCount: Int = 0,
)

/**
 * 村庄。它是「按村名聚合出来的视图」，不是一张表——一个村可以横跨多个网格，
 * 所以列表页按村筛选和按网格筛选是两件不同的事。
 * `manager` / `phone` 来自 village_contact 表（按村名唯一），没维护过就是 null。
 */
@Serializable
data class VillageDto(
    val name: String = "",
    val manager: String? = null,
    val phone: String? = null,
    val personCount: Int = 0,
    val familyCount: Int = 0,
    val gridNames: String? = null,
    // 重点人群分村人数：字段名与 focusGroups.ts 的 countField 一一对应
    val partyCount: Int = 0,
    val disabledCount: Int = 0,
    val extremePovertyCount: Int = 0,
    val lowIncomeCount: Int = 0,
    val veteranCount: Int = 0,
    val preferentialCount: Int = 0,
    val elderlyCount: Int = 0,
    val minorCount: Int = 0,
)

// ---------------------------------------------------------------------------
// 重点人群
// ---------------------------------------------------------------------------

/**
 * 快捷分组。`byAge = true` 表示这一组是按年龄算的（老年 ≥60、未成年 <18），
 * 与是否打过标签无关——筛选时要换成 minAge/maxAge 参数，不能当成 tagIds 用。
 */
@Serializable
data class QuickGroupDto(
    val label: String = "",
    val code: String = "",
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

// ---------------------------------------------------------------------------
// 工作台
// ---------------------------------------------------------------------------

/**
 * 工作台指标。人口类指标的口径是「在册」（正常/迁入），已死亡/迁出不计入；
 * 各重点人群之间存在交叉，不能相加。
 */
@Serializable
data class DashboardDto(
    val totalPopulation: Int = 0,
    val familyCount: Int = 0,
    val gridCount: Int = 0,
    val hukouCount: Int = 0,
    val residentCount: Int = 0,
    val partyMemberCount: Int = 0,
    val disabledCount: Int = 0,
    val extremePovertyCount: Int = 0,
    val lowIncomeCount: Int = 0,
    val veteranCount: Int = 0,
    val preferentialCount: Int = 0,
    val elderlyCount: Int = 0,
    val minorCount: Int = 0,
    val lowIncomeFamilyCount: Int = 0,
)

// ---------------------------------------------------------------------------
// 待核查人员
// ---------------------------------------------------------------------------

@Serializable
data class PendingDto(
    val id: Int = 0,
    val name: String? = null,
    val idCard: String? = null,
    val gender: String? = null,
    val birthDate: String? = null,
    val phone: String? = null,
    val village: String? = null,
    val address: String? = null,
    val reason: String? = null,
    val status: String? = null,
    val sourceFile: String? = null,
    val remark: String? = null,
    val createdAt: String? = null,
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
// 专项台账
// ---------------------------------------------------------------------------

@Serializable
data class LedgerWorkTypeDto(
    val code: String = "",
    val name: String = "",
)

/**
 * 条口配置。这部分是「配置写在代码里」的：数据库只存编码（WATER / RIVER_MOWING），
 * 中文名由后端 utils/ledger.ts 统一映射，移动端下拉框直接从 /ledgers/meta 取，
 * 不要在客户端再写一份中文名。
 */
@Serializable
data class LedgerCategoryDto(
    val code: String = "",
    val name: String = "",
    val workTypes: List<LedgerWorkTypeDto> = emptyList(),
)

@Serializable
data class LedgerRecordDto(
    val id: Int = 0,
    val category: String = "",
    val workType: String? = null,
    val recordDate: String? = null,
    val laborCost: Double? = null,
    val invoiceCost: Double? = null,
    val invoiceNo: String? = null,
    val responsible: String? = null,
    val location: String? = null,
    val title: String? = null,
    val detail: String? = null,
    val remark: String? = null,
    val attachmentCount: Int = 0,
    val attachments: List<FileDto> = emptyList(),
    val categoryName: String? = null,
    val workTypeName: String? = null,
    val createdAt: String? = null,
)

/**
 * 台账速记请求。
 * `laborCost` / `invoiceCost` 是 DECIMAL(10,2)（元），机械费已在 V011 去掉，不要再加回来。
 */
@Serializable
data class LedgerRecordCreateRequest(
    val category: String,
    val workType: String? = null,
    val recordDate: String? = null,
    val laborCost: Double? = null,
    val invoiceCost: Double? = null,
    val invoiceNo: String? = null,
    val responsible: String? = null,
    val location: String? = null,
    val title: String? = null,
    val detail: String? = null,
    val remark: String? = null,
)

// ---------------------------------------------------------------------------
// 附件
// ---------------------------------------------------------------------------

@Serializable
data class FileDto(
    val id: Int = 0,
    val fileName: String? = null,
    val contentType: String? = null,
    val size: Long? = null,
    val url: String? = null,
    val createdAt: String? = null,
)
