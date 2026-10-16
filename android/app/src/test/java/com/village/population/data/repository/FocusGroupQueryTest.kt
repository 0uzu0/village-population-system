package com.village.population.data.repository

import com.village.population.data.remote.dto.QuickGroupDto
import com.village.population.data.remote.dto.TagDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「工作台点重点人群 → 人员列表」这段翻译的测试。
 *
 * 为什么值得单独测：这里出错不会有任何报错。点「低保对象 62 人」跳过去看到
 * 全村 1200 人的名单，页面一切正常，只是名单不对——而这恰恰是使用者最难察觉、
 * 也最容易据此做出错误判断（比如以为低保户很多）的一种失败。
 *
 * 顺带钉住一个口径：「党员」= 正式党员 + 预备党员，两个标签是**并集**。
 */
class FocusGroupQueryTest {

    private val tags = listOf(
        TagDto(id = 1, name = "中共党员", code = "PARTY_MEMBER", color = "#E5484D"),
        TagDto(id = 2, name = "中共预备党员", code = "PARTY_PROBATIONARY", color = "#F76B15"),
        TagDto(id = 8, name = "低保对象", code = "LOW_INCOME_PERSON", color = "#F76B15"),
        TagDto(id = 10, name = "残疾人", code = "DISABLED_PERSON", color = "#0E7C6B"),
    )

    private fun group(
        code: String,
        tagCodes: List<String> = emptyList(),
        byAge: Boolean = false,
        minAge: Int? = null,
        maxAge: Int? = null,
    ) = QuickGroupDto(
        label = code,
        code = code,
        tagCodes = tagCodes,
        byAge = byAge,
        minAge = minAge,
        maxAge = maxAge,
    )

    @Test
    fun `身份类人群按标签筛选而不是不加筛选`() {
        val q = FocusGroupQuery.build(group("LOW_INCOME_PERSON", listOf("LOW_INCOME_PERSON")), tags)
        assertEquals(listOf(8), q?.tagIds)
        assertEquals("ANY", q?.tagMode)
        assertEquals(1, q?.page)
    }

    @Test
    fun `党员要含预备党员_不能只用族群code`() {
        // 卡片上的人数 = 正式 + 预备；只按 code（PARTY_MEMBER）筛会少一截人
        val q = FocusGroupQuery.build(
            group("PARTY_MEMBER", listOf("PARTY_MEMBER", "PARTY_PROBATIONARY")),
            tags,
        )
        assertEquals(listOf(1, 2), q?.tagIds)
        assertEquals("并集语义", "ANY", q?.tagMode)
    }

    @Test
    fun `年龄类人群按年龄区间筛_与标签无关`() {
        val elder = FocusGroupQuery.build(
            group("ELDERLY", byAge = true, minAge = 60, maxAge = null),
            tags,
        )
        assertEquals(60, elder?.minAge)
        assertNull(elder?.maxAge)
        assertTrue("年龄类不该带标签条件", elder!!.tagIds.isEmpty())

        // 后端 buildAgeFilter 的 maxAge 是闭区间，接口给的 17 就是「<18 岁」，
        // 直接透传，不要再减 1
        val minor = FocusGroupQuery.build(
            group("MINOR", byAge = true, minAge = null, maxAge = 17),
            tags,
        )
        assertNull(minor?.minAge)
        assertEquals(17, minor?.maxAge)
    }

    @Test
    fun `标签字典里找不到时返回空而不是退化成不加筛选`() {
        // 比如标签被改名/删除，或本机标签字典还没同步下来
        assertNull(FocusGroupQuery.build(group("NOT_EXIST", listOf("NOT_EXIST")), tags))
        assertNull(FocusGroupQuery.build(group("VETERAN", listOf("VETERAN")), emptyList()))
    }

    @Test
    fun `后端尚未返回tagCodes时退回用code匹配`() {
        // 兼容：老版本后端只回 code。仍比「不筛」好，只是党员会少算预备党员
        val q = FocusGroupQuery.build(group("DISABLED_PERSON"), tags)
        assertEquals(listOf(10), q?.tagIds)
    }

    @Test
    fun `同族群里重复的编码只解析一次`() {
        val ids = FocusGroupQuery.tagIdsOf(
            group("PARTY_MEMBER", listOf("PARTY_MEMBER", "PARTY_MEMBER")),
            tags,
        )
        assertEquals(listOf(1), ids)
    }
}
