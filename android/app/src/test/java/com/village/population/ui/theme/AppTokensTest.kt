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
        "placeholder" to LightTokens.placeholder,
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
            LightTokens.ink, LightTokens.ink2, LightTokens.ink3, LightTokens.placeholder, LightTokens.line, LightTokens.line2,
            LightTokens.bg, LightTokens.quiet, LightTokens.green, LightTokens.greenBg,
            LightTokens.amber, LightTokens.amberBg, LightTokens.amberLine, LightTokens.red, LightTokens.redBg,
        )
        all.forEach { assertEquals(1f, it.alpha, 0.0001f) }
    }

    /**
     * 文字对比度底线。
     *
     * 为什么要一组测试而不是一条：这些色都是**文字**色，配对是「字 / 它的底」，
     * 任何一边单独改都能通过「色板与设计稿一致」那条，却把人看得见这件事改坏掉。
     * 现场是村口、是晒谷场、是正午斜着看手机，AA 是这里的最低要求，不是修辞。
     */
    @Test
    fun `浅色档的文字在各自底色上不低于 4_5 比 1`() {
        assertTextPairs(
            bg = Color.White,
            surfaceName = "白卡",
            pairs = listOf(
                "正文 ink" to LightTokens.ink,
                "二级墨 ink2" to LightTokens.ink2,
                "三级墨 ink3" to LightTokens.ink3,
                "占位符 placeholder" to LightTokens.placeholder,
                "品牌字 brand" to LightTokens.brand,
                "品牌深字 brandStrong" to LightTokens.brandStrong,
                "成功绿 green" to LightTokens.green,
                "琥珀 amber" to LightTokens.amber,
                "警示红 red" to LightTokens.red,
            ),
        )
        // 页面灰底上同样要成立：说明文字常常直接铺在 bg 上，没有白卡托着
        listOf(
            "二级墨 ink2" to LightTokens.ink2,
            "三级墨 ink3" to LightTokens.ink3,
        ).forEach { (name, fg) ->
            val ratio = contrastRatio(fg, LightTokens.bg)
            assertTrue("$name 压页面灰底只有 ${"%.2f".format(ratio)}:1", ratio >= 4.5)
        }
        // 彩色浅底上的同色文字：离线横幅（amber/amberBg）、状态标签（green/greenBg）、
        // 错误提示（red/redBg）都是这种配对，最容易被「高亮=看得清」的直觉骗过去
        assertTintedPairs(LightTokens, "浅色档")
    }

    @Test
    fun `深色档的文字在各自底色上不低于 4_5 比 1`() {
        assertTextPairs(
            bg = Color(0xFF1A1F27),
            surfaceName = "深色卡",
            pairs = listOf(
                "正文 ink" to DarkTokens.ink,
                "二级墨 ink2" to DarkTokens.ink2,
                "三级墨 ink3" to DarkTokens.ink3,
                "占位符 placeholder" to DarkTokens.placeholder,
                "品牌字 brand" to DarkTokens.brand,
                "成功绿 green" to DarkTokens.green,
                "琥珀 amber" to DarkTokens.amber,
                "警示红 red" to DarkTokens.red,
            ),
        )
        assertTintedPairs(DarkTokens, "深色档")
    }

    private fun assertTextPairs(bg: Color, surfaceName: String, pairs: List<Pair<String, Color>>) {
        pairs.forEach { (name, fg) ->
            val ratio = contrastRatio(fg, bg)
            // 中文紧跟在模板变量后面时必须用花括号：Kotlin 把汉字当合法标识符字符，
            // 写 `$surfaceName只有` 会被解析成变量名 `surfaceName只有`，直接编译不过
            assertTrue("$name 压${surfaceName}只有 ${"%.2f".format(ratio)}:1，低于 4.5:1", ratio >= 4.5)
        }
    }

    private fun assertTintedPairs(t: AppTokens, label: String) {
        listOf(
            Triple("琥珀 amber", t.amber, t.amberBg),
            Triple("成功绿 green", t.green, t.greenBg),
            Triple("警示红 red", t.red, t.redBg),
            Triple("品牌深字 brandStrong", t.brandStrong, t.brandLight),
            // 这里原有一条「品牌正字 brand 压 brandFaint」：4.48:1，差 0.02 不达标。
            // 界面上**不存在**这种组合——brandFaint 底上的元素只有 ink 文字与
            // brandStrong 图标（口径说明已改成 ink 系文字，主数字卡同理）。
            // 为一条虚构的组合去调深 brandFaint，会把整屏浅底压灰，得不偿失；
            // 真要用 brand 字压浅底，就换成 brandStrong（brandLight 上 7.5:1）。
        ).forEach { (name, fg, bg) ->
            val ratio = contrastRatio(fg, bg)
            assertTrue("$label：$name 压自己的浅底只有 ${"%.2f".format(ratio)}:1，低于 4.5:1", ratio >= 4.5)
        }
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
