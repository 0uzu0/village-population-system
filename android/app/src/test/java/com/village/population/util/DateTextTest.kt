package com.village.population.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.TimeZone

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

    /**
     * 文件名时间戳。
     *
     * 守的是两件事：
     *  1. **必须与后端 `file.ts` 的 stampOf 同形**（`yyyy-MM-dd-HH-mm-ss`）。
     *     本机暂存名与服务器落盘名能不能对上，是排查「这张照片到底哪天拍的」时唯一
     *     肉眼可用的线索——少一段多一段都会让两者对不上。
     *  2. **必须是北京时间**，且与设备时区无关。后端固定 +08:00，
     *     手机若按当地时间命名，同一张照片在两台机器上就是两个名字。
     *
     * 这一组断言刻意不依赖运行环境的时区：跑在 UTC 的 CI 上也必须给出 13 点。
     */
    @Test
    fun `文件名时间戳是北京时间且与后端同形`() {
        // UTC 05:00 = 北京 13:00
        assertEquals("2026-10-16-13-00-05", DateText.fileStamp(atBeijing(2026, 10, 16, 13, 0, 5)))
    }

    @Test
    fun `文件名时间戳跨零点按北京时间换日`() {
        // UTC 2026-10-16T17:30:45Z = 北京 2026-10-17 01:30:45
        assertEquals("2026-10-17-01-30-45", DateText.fileStamp(atBeijing(2026, 10, 17, 1, 30, 45)))
    }

    @Test
    fun `文件名时间戳不随设备时区变化`() {
        val original = TimeZone.getDefault()
        try {
            // 换成纽约：同一时刻若按当地时间命名会得到 2026-10-16-01-00-05 这种值
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
            assertEquals("2026-10-16-13-00-05", DateText.fileStamp(atBeijing(2026, 10, 16, 13, 0, 5)))
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test
    fun `文件名不含冒号_Windows上也能打开`() {
        // 早期版本用 `:` 分隔时刻，在 NTFS 上是非法字符，
        // 从服务器拷下来的照片在村委的办公机上打不开
        assertEquals(false, DateText.fileStamp(atBeijing(2026, 10, 16, 13, 0, 5)).contains(":"))
    }

    @Test
    fun `文件名按时间字典序排序等价于按时间先后排序`() {
        val early = DateText.fileStamp(atBeijing(2026, 10, 16, 9, 5, 0))
        val late = DateText.fileStamp(atBeijing(2026, 10, 16, 13, 0, 5))
        assertEquals(true, early < late)
        // 固定 19 位（年-月-日-时-分-秒，每段都补零）：长度一致字典序才等价于时间序
        assertEquals(19, early.length)
    }

    /** 北京时间某一刻对应的毫秒值（用 +08:00 偏移构造，与运行环境无关） */
    private fun atBeijing(y: Int, m: Int, d: Int, h: Int, min: Int, s: Int): Long {
        val cal = java.util.Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"))
        cal.clear()
        cal.set(y, m - 1, d, h, min, s)
        return cal.timeInMillis
    }
}
