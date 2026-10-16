package com.village.population.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import kotlin.math.pow

/**
 * 设计契约：安卓端色板必须与 `docs/移动端设计说明.html` 的 `:root` 变量逐项一致。
 *
 * 为什么要用测试来钉这件事：设计稿和实现是两份文件，靠人眼对色号是保不住的
 * ——改稿的人只会改 HTML，改代码的人只会看代码，漂移往往要等到有人把两个屏幕
 * 摆在一起才发现。这里直接读设计说明的原文比对，改任何一边而没改另一边都会红。
 */
class AppTokensTest {

    private val doc: File? by lazy {
        listOf(
            File("../../docs/移动端设计说明.html"),
            File("../docs/移动端设计说明.html"),
            File("docs/移动端设计说明.html"),
        ).firstOrNull { it.isFile }
    }

    /** 从 HTML 的 `:root { … }` 里抠出 `--xxx: #RRGGBB;` */
    private fun docHexVars(): Map<String, Color> {
        val file = doc
        assumeTrue("设计说明文件不在当前工作目录下，跳过比对", file != null)
        val css = file!!.readText()
        val regex = Regex("--([a-z0-9-]+)\\s*:\\s*#([0-9A-Fa-f]{6})")
        return regex.findAll(css).associate { m ->
            m.groupValues[1] to Color(0xFF000000L or m.groupValues[2].toLong(16))
        }
    }

    /** 设计变量名 → 令牌字段。这里只有「一一对应」的关系，没有换算 */
    private fun lightTokensByName(): Map<String, Color> = mapOf(
        "brand" to LightTokens.brand,
        "brand-strong" to LightTokens.brandStrong,
        "brand-light" to LightTokens.brandLight,
        "brand-faint" to LightTokens.brandFaint,
        "ink" to LightTokens.ink,
        "ink-2" to LightTokens.ink2,
        "ink-3" to LightTokens.ink3,
        "line" to LightTokens.line,
        "line-2" to LightTokens.line2,
        "bg" to LightTokens.bg,
        "green" to LightTokens.green,
        "green-bg" to LightTokens.greenBg,
        "amber" to LightTokens.amber,
        "amber-bg" to LightTokens.amberBg,
        "red" to LightTokens.red,
        "red-bg" to LightTokens.redBg,
    )

    @Test
    fun `浅色令牌与设计说明的根变量逐项一致`() {
        val vars = docHexVars()
        val tokens = lightTokensByName()
        // 设计稿里出现的颜色，我们这一侧一个都不能少
        val missing = vars.keys - tokens.keys - setOf("code-bg")
        assertTrue("设计稿里有而令牌里没有的颜色：$missing", missing.isEmpty())
        tokens.forEach { (name, color) ->
            val expected = vars[name] ?: return@forEach
            assertEquals("--$name 与 LightTokens.$name 不一致", expected, color)
        }
    }

    @Test
    fun `设计稿的关键色值确实被取到了`() {
        // 反向兜底：如果正则哪天抠不到东西，上一个用例会因为「missing 为空」而假绿
        val vars = docHexVars()
        assertTrue("没能从设计说明里解析出色值，正则可能失效了", vars.size >= 16)
        assertEquals(Color(0xFF1D6FE0), vars["brand"])
    }

    @Test
    fun `深色令牌与浅色是两套而不是复制品`() {
        // 深色档是派生的（设计稿只画了浅色），但必须真的压暗/提亮过，
        // 否则夜间模式会原样用浅色底，一眼白得刺眼
        assertTrue(DarkTokens.bg != LightTokens.bg)
        assertTrue(DarkTokens.brandFaint != LightTokens.brandFaint)
        assertTrue(DarkTokens.ink != LightTokens.ink)
    }

    @Test
    fun `所有令牌都是不透明色`() {
        // 带透明度的色值落在卡片底上会透出下层内容，视觉上像渲染错误
        val all = listOf(
            LightTokens.brand, LightTokens.brandStrong, LightTokens.brandLight, LightTokens.brandFaint,
            LightTokens.ink, LightTokens.ink2, LightTokens.ink3, LightTokens.line, LightTokens.line2,
            LightTokens.bg, LightTokens.quiet, LightTokens.green, LightTokens.greenBg,
            LightTokens.amber, LightTokens.amberBg, LightTokens.amberLine, LightTokens.red, LightTokens.redBg,
        )
        all.forEach { assertEquals(1f, it.alpha, 0.0001f) }
    }

    @Test
    fun `品牌底上的白字达到无障碍对比度下限`() {
        // 这正是没用 PC 端 #3978F6 的原因：那个色上压白字只有 3.5:1。
        // 手机多在户外强光下看，顶栏标题必须够实。
        val ratio = contrastRatio(Color.White, LightTokens.brand)
        assertTrue("白字压品牌色只有 ${"%.2f".format(ratio)}:1，低于 4.5:1", ratio >= 4.5)
    }

    /** WCAG 相对亮度对比度 */
    private fun contrastRatio(a: Color, b: Color): Double {
        val la = relativeLuminance(a)
        val lb = relativeLuminance(b)
        val hi = maxOf(la, lb)
        val lo = minOf(la, lb)
        return (hi + 0.05) / (lo + 0.05)
    }

    private fun relativeLuminance(c: Color): Double {
        fun channel(v: Float): Double {
            val s = v.toDouble()
            return if (s <= 0.03928) s / 12.92 else ((s + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * channel(c.red) + 0.7152 * channel(c.green) + 0.0722 * channel(c.blue)
    }
}
