package com.village.population.data.repository

import com.village.population.data.remote.dto.PageData
import kotlinx.serialization.Serializable

/**
 * 人员列表查询条件。
 *
 * 抽成一个可序列化的数据类有四个好处：
 *  1. 缓存键由它统一算出来（[cacheKey]），不会出现「换个入口拼出的条件顺序不同 → 缓存命中不了」；
 *  2. 状态可以直接存进 SavedState，横竖屏切换、从详情页返回都能复原；
 *  3. 它是一个**纯函数式的对象**，可以直接写单元测试；
 *  4. 请求参数拼接集中在 [toQueryParams] 一处，避免某个筛选条件忘了传（PC 端因为漏传
 *     导致「筛完导出导出的是另一批」，已经踩过两次）。
 */
@Serializable
data class PersonQuery(
    val page: Int = 1,
    val pageSize: Int = 20,
    val keyword: String = "",
    val village: String? = null,
    val gridId: Int? = null,
    val gender: String? = null,
    val status: String? = null,
    val activeOnly: Boolean = true,
    val tagIds: List<Int> = emptyList(),
    val tagMode: String = "ANY",
    val minAge: Int? = null,
    val maxAge: Int? = null,
) {

    /**
     * activeOnly 是**字符串**不是布尔：后端 schema 是 z.enum(['true','false'])，
     * 传布尔会被 zod 拒掉，而且报错信息（Invalid enum value）完全看不出问题出在哪。
     */
    val activeOnlyParam: String get() = if (activeOnly) "true" else "false"

    val tagIdsParam: String? get() = tagIds.takeIf { it.isNotEmpty() }?.joinToString(",")

    val hasFilter: Boolean
        get() = keyword.isNotBlank() || !village.isNullOrBlank() || gridId != null ||
            !gender.isNullOrBlank() || !status.isNullOrBlank() || !activeOnly ||
            tagIds.isNotEmpty() || minAge != null || maxAge != null

    /** 缓存键：把参与筛选的字段按固定顺序拼起来，顺序即语义 */
    val cacheKey: String
        get() = buildString {
            append("persons")
            append('|').append(page)
            append('|').append(pageSize)
            append('|').append(keyword.trim())
            append('|').append(village.orEmpty())
            append('|').append(gridId ?: 0)
            append('|').append(gender.orEmpty())
            append('|').append(status.orEmpty())
            append('|').append(if (activeOnly) 1 else 0)
            append('|').append(tagIds.joinToString("-"))
            append('|').append(tagMode)
            append('|').append(minAge ?: -1)
            append('|').append(maxAge ?: -1)
        }

    fun pageOf(page: Int): PersonQuery = copy(page = page)

    companion object {
        fun ofVillage(village: String): PersonQuery = PersonQuery(village = village, page = 1)

        fun ofGrid(gridId: Int): PersonQuery = PersonQuery(gridId = gridId, page = 1)

        /** 老年人：≥60 岁。与后端 utils/age.ts 的 ELDERLY_MIN_AGE 一致 */
        fun elderly(): PersonQuery = PersonQuery(minAge = 60, page = 1)

        /**
         * 未成年人：<18 岁。
         * 注意后端 buildAgeFilter 的 maxAge 是**闭区间**，「18 岁以下」要传 17 而不是 18，
         * 传 18 会把正好 18 岁的人也捞进来。
         */
        fun minor(): PersonQuery = PersonQuery(maxAge = 17, page = 1)
    }
}

/** 带缓存来源标记的返回值。UI 据此显示「离线数据，截至 …」 */
data class Cached<T>(
    val value: T,
    val fromCache: Boolean = false,
    val savedAt: Long = 0L,
)

/** 提交结果：要么已经入库，要么进了离线队列 */
sealed interface SubmitResult {
    data class Sent(val personId: Int? = null) : SubmitResult
    data class Queued(val label: String) : SubmitResult
}

/** 分页结果的小工具：判断还有没有下一页 */
val <T> PageData<T>.hasMore: Boolean
    get() = page * pageSize < total && list.isNotEmpty()
