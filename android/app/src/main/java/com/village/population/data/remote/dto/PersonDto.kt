package com.village.population.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * 人员对象。
 *
 * 全部字段都给默认值并允许为空，原因有二：
 *  - 列表接口与详情接口返回的字段并不一致（详情多出 `disability`、`changes`）；
 *  - 后端是手写 SQL + 动态 SELECT，某列没取到就是缺失字段，模型不该因此整条解析失败。
 *
 * 字段名严格用驼峰：后端 toPersonVO() 已经把 snake_case 转过了，
 * 用下划线（如 person_no）会静默拿到 null —— 这个坑在 PC 端已经踩过两次。
 */
@Serializable
data class PersonDto(
    val id: Int = 0,
    val personNo: String? = null,
    val name: String = "",
    val formerName: String? = null,
    val gender: String? = null,
    val birthDate: String? = null,
    val age: Int? = null,
    val idCard: String? = null,
    val phone: String? = null,
    val phoneBackup: String? = null,
    val hukouAddress: String? = null,
    val liveAddress: String? = null,
    val village: String? = null,
    val gridId: Int? = null,
    val gridName: String? = null,
    val familyId: Int? = null,
    val familyName: String? = null,
    val relation: String? = null,
    val status: String = "NORMAL",
    val statusDate: String? = null,
    val remark: String? = null,

    // 重点人群服务台账
    val bankAccount: String? = null,
    val subsidyAmount: Double? = null,
    val familyCondition: String? = null,
    val healthAssessment: String? = null,

    // 残疾专项档案：只有建档过的才有对象，没建档是 null
    val disability: DisabilityDto? = null,

    val dataSource: String? = null,
    val updatedAt: String? = null,
    /** 乐观锁版本号：编辑提交时原样带回，防止覆盖他人刚做的修改 */
    val rowVersion: Int = 0,
    val tags: List<PersonTagDto> = emptyList(),
    val changes: List<PersonChangeDto> = emptyList(),
)

/**
 * 标签。列表接口返回 `{ id, name, code, color }`，
 * 详情接口多出 `linkId`（解除标签时要用）与生效/失效日期。
 */
@Serializable
data class PersonTagDto(
    val id: Int = 0,
    val linkId: Int? = null,
    val name: String = "",
    val code: String? = null,
    val color: String? = null,
    val effectDate: String? = null,
    val expireDate: String? = null,
    val status: String? = null,
    val basis: String? = null,
    val createdAt: String? = null,
)

/** 残疾档案。pd.remark 与 person.remark 同名，后端已取别名 disability_remark 并包成该对象 */
@Serializable
data class DisabilityDto(
    val type: String? = null,
    val level: String? = null,
    val levelLabel: String? = null,
    val card: String? = null,
    val guardianName: String? = null,
    val guardianPhone: String? = null,
    val remark: String? = null,
)

/** 人员变更历史（字段级留痕） */
@Serializable
data class PersonChangeDto(
    val fieldName: String? = null,
    val oldValue: String? = null,
    val newValue: String? = null,
    val changeType: String? = null,
    val reason: String? = null,
    val createdAt: String? = null,
)

/**
 * 新增人员请求。
 *
 * 只列出移动端采集表单真正会填的字段；其余字段不传，后端按 optional 处理。
 * 关键：`gender` 后端是 `z.enum(['MALE','FEMALE']).optional()`——**不接受 null**，
 * 因此 Json 配了 explicitNulls=false，null 字段直接不序列化。
 *
 * 另一个关键：出生日期与性别不由用户填，而是从身份证提取后带上（与后端
 * 「身份证是出生日期/性别的权威来源」口径一致）。服务端还会再算一次并覆盖，
 * 这里带上只是为了让离线队列里的数据自洽。
 *
 * 第三个关键（v2.3.1 修）：**空值分两种，不能一律传 null**。
 *  - 文本字段（电话/地址/备注…）用户清空后要传 `""`，后端把 `''` 落成 NULL，
 *    这才是「清空」；传 null 会被 explicitNulls=false 直接省掉，后端视为「未提交」，
 *    于是界面上删掉的电话在保存后又变回原值（假成功）。
 *  - `gender` 这类枚举例外：null/未选就不序列化，绝不能发 `""`
 *    （后端 zod 枚举会拒掉空串）。
 */
@Serializable
data class PersonCreateRequest(
    val name: String,
    val gender: String? = null,
    val birthDate: String? = null,
    val idCard: String? = null,
    val phone: String? = null,
    val phoneBackup: String? = null,
    val hukouAddress: String? = null,
    val liveAddress: String? = null,
    val village: String? = null,
    val gridId: Int? = null,
    val familyId: Int? = null,
    val relation: String? = null,
    val remark: String? = null,
    /**
     * 建档/编辑时一并维护的标签 id 列表。
     *
     * 语义是**全量覆盖**：传空列表表示清空标签，字段整体不传才表示不动标签。
     * 这里给它默认值 null，序列化时会连同 null 一起发出（后端按 null 处理），
     * 与后端的「未传 = 不动标签」口径一致；要清空就传 emptyList()。
     */
    val tagIds: List<Int>? = null,
    /**
     * 乐观锁版本号（V022）：编辑时必带，新增时为 null（不校验）。
     * 服务端比对不一致返回 409，避免把别人刚保存的改动静默覆盖。
     */
    val rowVersion: Int? = null,
)

/**
 * 新增 / 编辑人员的**响应体**（不是人员对象）。
 *
 * 这两个接口的 data 形状并不相同，早先用 `PersonDto` 去接，靠「字段缺失 →
 * 默认值 0」蒙对了「转待核查」这条分支：
 *  - 有身份证建档：`{ id, personNo, message }`
 *  - 无身份证建档：`{ pending: true, pendingId }` —— **没有 id**
 *
 * 蒙对的前提是 ignoreUnknownKeys=true 且 id 有默认值，一旦哪天默认值改了，
 * 或后端给这条分支补一个 `id`，界面就会把「已转入待核查」当成「建档成功」
 * 直接返回列表，人却找不到。所以这里显式建模。
 */
@Serializable
data class PersonSaveResult(
    val id: Int = 0,
    val personNo: String? = null,
    /** true = 未填身份证号，已转入待核查人员，没有生成正式档案 */
    val pending: Boolean = false,
    /** 转待核查后的记录 id（import_pending.id），仅 pending=true 时有值 */
    val pendingId: Int? = null,
)

/**
 * 给人员打标签。
 * 注意后端一次只接受**一个** tagId（不是数组）——批量打标是另一个接口
 * `/persons/batch-tags`，且要求先选中若干人员。移动端按「一次点一个标签」来做，
 * 与后端的 `allow_duplicate` 校验（已关联则返回 409 DUPLICATE_TAG）也就对得上了。
 */
@Serializable
data class AddTagRequest(
    val tagId: Int,
    val effectDate: String? = null,
    val expireDate: String? = null,
    val basis: String? = null,
)

@Serializable
data class ChangeStatusRequest(
    val status: String,
    val statusDate: String? = null,
    val reason: String? = null,
)
