package com.village.population.util

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 崩溃报告格式化。只测纯函数部分——真机上的「未捕获异常处理器」行为
 * 靠这段文本被正确生成来保证，格式错了等于白记。
 */
class CrashLoggerTest {

    private class Boom(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

    @Test
    fun `报告包含版本、设备、线程与异常信息`() {
        val report = CrashLogger.buildReport(
            thread = Thread.currentThread(),
            error = Boom("模拟崩溃"),
            versionName = "2.3.2",
            versionCode = 60,
            device = "Xiaomi M2007J3SC / Android 12 (API 31)",
            time = "2026-10-20 17:30:00",
        )
        assertTrue(report.contains("2026-10-20 17:30:00"))
        assertTrue(report.contains("2.3.2"))
        assertTrue(report.contains("60"))
        assertTrue(report.contains("Xiaomi"))
        assertTrue(report.contains(Thread.currentThread().name))
        assertTrue(report.contains("模拟崩溃"))
        assertTrue(report.contains("---- 堆栈 ----"))
    }

    @Test
    fun `异常链的根因也出现在报告里`() {
        val root = IllegalArgumentException("根因：空指针")
        val report = CrashLogger.buildReport(
            thread = Thread.currentThread(),
            error = Boom("外层失败", root),
        )
        assertTrue(report.contains("外层失败"))
        // stackTraceToString 会打印 Caused by 链，否则只有最外层一句，等于没线索
        assertTrue(report.contains("根因：空指针"))
    }

    @Test
    fun `超长异常链被截断，不会把存储写爆`() {
        // 构造一个 message 极大的异常（模拟异常信息里塞了大 JSON / SQL）
        val huge = Boom("x".repeat(200_000))
        val report = CrashLogger.buildReport(thread = Thread.currentThread(), error = huge)
        assertTrue(report.length <= 60_100)
        assertTrue(report.contains("已截断"))
    }

    @Test
    fun `消息为空时不会拼出 null 字符串`() {
        val report = CrashLogger.buildReport(
            thread = Thread.currentThread(),
            error = Boom(""),
        )
        assertFalse(report.contains("消息：null"))
    }
}
