package com.village.population.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 年龄计算。
 *
 * 口径与后端 `utils/age.ts` 的 calcAge 一致：按年月日三元组比较，
 * 而不是「今年减出生年」——后者会把 12 月生日的人在次年 1 月就算大一岁，
 * 而「老年人 ≥60 岁」这条线一旦算错，重点人群人数就错了。
 */
class DateTextTest {

    @Test
    fun `生日已过_按当年减出生年`() {
        assertEquals(60, DateText.ageOf("1966-03-01", 2026, 10, 16))
    }

    @Test
    fun `生日未到_减一岁`() {
        // 11 月的生日还没到，2026 年 10 月时应当还是 59 岁
        assertEquals(59, DateText.ageOf("1966-11-20", 2026, 10, 16))
    }

    @Test
    fun `生日当天算已满`() {
        assertEquals(60, DateText.ageOf("1966-10-16", 2026, 10, 16))
    }

    @Test
    fun `生日前一天仍是上一岁`() {
        assertEquals(59, DateText.ageOf("1966-10-17", 2026, 10, 16))
    }

    @Test
    fun `同月不同日也要区分`() {
        assertEquals(59, DateText.ageOf("1966-10-31", 2026, 10, 16))
        assertEquals(60, DateText.ageOf("1966-10-01", 2026, 10, 16))
    }

    @Test
    fun `非法出生日期返回空而不是猜一个值`() {
        assertNull(DateText.ageOf(null, 2026, 10, 16))
        assertNull(DateText.ageOf("", 2026, 10, 16))
        assertNull(DateText.ageOf("1966/03/01", 2026, 10, 16))
        assertNull(DateText.ageOf("1966-13-01", 2026, 10, 16))
        assertNull(DateText.ageOf("1866-03-01", 2026, 10, 16))
    }

    @Test
    fun `刚出生未满周岁为0岁`() {
        assertEquals(0, DateText.ageOf("2026-03-01", 2026, 10, 16))
    }

    @Test
    fun `相对时间描述用于离线提示`() {
        val now = System.currentTimeMillis()
        assertEquals("刚刚", DateText.describeAge(now))
        assertEquals("59 分钟前", DateText.describeAge(now - 59 * 60_000))
        assertEquals("2 小时前", DateText.describeAge(now - 2 * 3_600_000))
        assertEquals("3 天前", DateText.describeAge(now - 3 * 86_400_000L))
        assertEquals("未知", DateText.describeAge(0L))
    }
}
