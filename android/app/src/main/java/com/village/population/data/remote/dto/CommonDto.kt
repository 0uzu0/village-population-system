package com.village.population.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * 后端统一响应信封。
 *
 * 两条必须知道的约定：
 *  1. `code == 0` 才是成功。后端 fail() 会把 HTTP 状态码写进 code（如 401/403/500），
 *     所以不能只看 HTTP 200 就认为业务成功。
 *  2. `message` 是给用户看的中文提示，异常时直接展示它，不要自己编文案——
 *     「身份证号码校验位错误」这种话前端编不出来。
 */
@Serializable
data class ApiEnvelope<T>(
    val code: Int = 0,
    val message: String = "success",
    val errorCode: String? = null,
    val data: T? = null,
)

/**
 * 无返回体的接口（改密码、批量忽略、打标签…）用它。
 *
 * 不写成 `ApiEnvelope<Unit>`：泛型里塞 Unit 的序列化行为在各版本上不一致，
 * 而这些接口本来也不关心 data，多一个字段只会多一个出错点。
 * Json 配了 ignoreUnknownKeys，响应里多出来的 data 会被直接跳过。
 */
@Serializable
data class VoidEnvelope(
    val code: Int = 0,
    val message: String = "success",
    val errorCode: String? = null,
)

/**
 * 分页体。
 *
 * 注意不是所有列表接口都带 page/pageSize——`/grids/villages` 只返回 `{ list, total }`，
 * 所以这里给默认值，缺字段不会解析失败。
 */
@Serializable
data class PageData<T>(
    val list: List<T> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val pageSize: Int = 20,
)

/** 村庄列表接口返回的结构（没有 page/pageSize） */
@Serializable
data class SimpleListData<T>(
    val list: List<T> = emptyList(),
    val total: Int = 0,
)
