package com.village.population.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 家庭详情。
 *
 * ⚠️ 字段命名**不统一**，这是后端的既有事实，不是笔误：
 *  - 户自身的列（`family_no` / `head_person_id` / `grid_name`）是 `SELECT f.*` 出来的
 *    **下划线**原始行，所以这里必须写 @SerialName；
 *  - `members` 里每一项是后端手工重组的对象，键是**驼峰**（memberId / isHouseholder）。
 *
 * 两者混在一起最容易出的事故是「界面上一片 —」：字段名对不上时
 * AppJson 有 ignoreUnknownKeys + 默认值，解析不会报错，只是悄悄给默认值。
 */
@Serializable
data class FamilyDetailDto(
    val id: Int = 0,
    @SerialName("family_no") val familyNo: String? = null,
    val address: String? = null,
    @SerialName("grid_id") val gridId: Int? = null,
    @SerialName("grid_name") val gridName: String? = null,
    @SerialName("head_person_id") val headPersonId: Int? = null,
    @SerialName("head_name") val headName: String? = null,
    // 下面两个是后端算出后塞进去的驼峰字段（activeMemberCount / dissolved）
    val activeMemberCount: Int = 0,
    val dissolved: Boolean = false,
    val members: List<FamilyMemberDto> = emptyList(),
)

/** 在户成员。`relation` 是关系码（HEAD/SPOUSE/…），中文转换在前端做 */
@Serializable
data class FamilyMemberDto(
    val memberId: Int? = null,
    val relation: String? = null,
    val isHouseholder: Boolean = false,
    val joinDate: String? = null,
    val person: FamilyMemberPersonDto = FamilyMemberPersonDto(),
)

/**
 * 同户成员的「最小人员信息」。
 *
 * 这是后端为家庭接口单独裁过的字段集，比 [PersonDto] 少很多（没有标签、没有残疾、
 * 没有家庭 id）——所以别想着复用它去渲染人员列表，字段不够。
 */
@Serializable
data class FamilyMemberPersonDto(
    val id: Int = 0,
    val name: String = "",
    val gender: String? = null,
    val birthDate: String? = null,
    val personNo: String? = null,
    val idCard: String? = null,
    val phone: String? = null,
    val phoneBackup: String? = null,
    val status: String = "NORMAL",
)
