package com.village.population.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 界面脱敏口径。
 *
 * 这组用例是照着 `docs/移动端设计说明.html` 里的示例串写的
 * （列表页 `XXXXXX1948****0026`、详情页手机号 `138****6021`），
 * 目的是把「哪几位露出来」钉死：这几位是网格员核人的依据，
 * 被谁顺手改一位都会让现场核对失去抓手。
 */
class MaskTest {

    @Test
    fun `身份证号保留出生年与后四位`() {
        // 110105 1949 1231 002X → 前 6 位抹掉，10~13 位（月日）抹掉
        assertEquals("XXXXXX1949****002X", Mask.idCard("11010519491231002X"))
    }

    @Test
    fun `设计稿示例串复现`() {
        assertEquals("XXXXXX1948****0026", Mask.idCard("320102194802140026"))
    }

    @Test
    fun `14位脱敏号原样返回`() {
        // 户籍导出表里常见的 14 位脱敏号：不是完整号，按位切只会切出四不像
        assertEquals("32010219480214", Mask.idCard("32010219480214"))
    }

    @Test
    fun `空值与短值不崩且原样返回`() {
        assertEquals("", Mask.idCard(null))
        assertEquals("", Mask.idCard("   "))
        assertEquals("123", Mask.idCard("123"))
        assertEquals("", Mask.phone(null))
    }

    @Test
    fun `手机号保留前三位与后四位`() {
        assertEquals("138****6021", Mask.phone("13812346021"))
    }

    @Test
    fun `座机与短号原样返回`() {
        assertEquals("0512-12345678", Mask.phone("0512-12345678"))
        assertEquals("12345", Mask.phone("12345"))
    }
}
