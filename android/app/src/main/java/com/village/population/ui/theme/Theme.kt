package com.village.population.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * 设计令牌（design tokens）。
 *
 * 色值**逐项对齐** `docs/移动端设计说明.html` 的 `:root` 变量，不是另取一套。
 * 为什么不用 Material 的 `colorScheme` 直接表达：设计稿里有若干「同一个色相、不同用途」
 * 的档位（品牌正色 / 深色 / 浅底 / 极浅底，墨色三级，线条两级），Material 的
 * `primary/primaryContainer/surfaceVariant` 装不下这么多档，硬塞会把语义扯乱
 * （典型后果就是「提示用 outline 当文字色」——outline 是描边色，拿它写字只有 1.6:1 对比度）。
 *
 * 两端保持一致的方式是 `AppTokensTest`：它把这份色值跟设计说明 HTML 里的
 * `--brand: #1D6FE0;` 逐条比对。改了设计稿而没改这里，测试会红。
 */
@Immutable
data class AppTokens(
    /** 品牌正色：顶栏底、主按钮底、选中态 */
    val brand: Color,
    /** 品牌深色：浅底之上的文字（如品牌浅底标签里的字） */
    val brandStrong: Color,
    /** 品牌浅底：标签底、导航选中指示 */
    val brandLight: Color,
    /** 品牌极浅底：指标块与快捷入口的底色 */
    val brandFaint: Color,
    /** 一级墨色：正文 */
    val ink: Color,
    /** 二级墨色：次要文字、字段名 */
    val ink2: Color,
    /** 三级墨色：说明文字、时间戳 */
    val ink3: Color,
    /** 输入框占位文字（「请选择」「搜索姓名…」）：比三级墨再轻一档，但不低于 4.5:1 */
    val placeholder: Color,
    /** 描边色 */
    val line: Color,
    /** 更浅的分隔线 */
    val line2: Color,
    /** 页面底色 */
    val bg: Color,
    /** 「安静」档指标块底色（户籍/常住这类非重点数字） */
    val quiet: Color,
    val green: Color,
    val greenBg: Color,
    val amber: Color,
    val amberBg: Color,
    /** 琥珀横幅的描边，比 amberBg 深一档 */
    val amberLine: Color,
    val red: Color,
    val redBg: Color,
)

/** 设计稿 `:root` 的浅色档，逐值对应 */
val LightTokens = AppTokens(
    brand = Color(0xFF1D6FE0),
    brandStrong = Color(0xFF1557B0),
    brandLight = Color(0xFFEAF1FE),
    brandFaint = Color(0xFFF5F8FE),
    ink = Color(0xFF1B1F26),
    ink2 = Color(0xFF4A5260),
    // 2026-10-21 对比度校订：原 #7A8494 压白卡只有 3.78:1、压页面灰底 3.66:1，
    // 而它承载的是 10.5–12sp 的字段名与时间戳——正是最小、最该够黑的字。
    // 村口晒谷场上把手机斜着看的时候，这一档几乎糊成底纹。压到 #676F7C 后
    // 白卡 5.07:1、灰底 4.66:1，都过 AA；与二级墨（7.9:1）仍然分得开。
    ink3 = Color(0xFF676F7C),
    // 占位文字原 #A6AEBC 只有 2.24:1，等于「告诉用户这里该填什么」的那行字看不太见。
    // #6B7480 是白盒上 4.75:1 的最轻一档：过 AA，又明显比已填内容（ink，14.8:1）浅。
    placeholder = Color(0xFF6B7480),
    line = Color(0xFFE2E7EF),
    line2 = Color(0xFFEDF1F7),
    bg = Color(0xFFF4F6FA),
    quiet = Color(0xFFF8FAFD),
    // 同批校订：这两档是**文字**色（在册状态、成功提示、离线横幅、待办计数），
    // 原先按「点缀色」取的 #12A150 / #B26B00 压白只有 3.35:1 与 4.21:1，
    // 压自己的浅底（greenBg / amberBg）更低到 3.3 / 3.84——高亮的东西反而看不清。
    // 压深到 5.4:1 与 6.3:1 后，绿仍然是绿、琥珀仍然是琥珀，只是不再是荧光笔。
    green = Color(0xFF0D7A3C),
    greenBg = Color(0xFFE8F7EE),
    amber = Color(0xFF8A5300),
    amberBg = Color(0xFFFDF3E3),
    amberLine = Color(0xFFF0DDB8),
    red = Color(0xFFC0261B),
    redBg = Color(0xFFFDECEA),
)

/**
 * 深色档。设计稿只画了浅色，这一组是**派生**的：色相不动，
 * 亮底压暗、暗底提亮，保证夜间在村里走巷子时屏幕不刺眼、字又看得清。
 */
val DarkTokens = AppTokens(
    brand = Color(0xFF6FA8F5),
    brandStrong = Color(0xFFA8C9F7),
    brandLight = Color(0xFF1E2C42),
    brandFaint = Color(0xFF1C232D),
    ink = Color(0xFFE6EAF0),
    ink2 = Color(0xFFB6BFCB),
    ink3 = Color(0xFF8B94A3),
    placeholder = Color(0xFF8B94A3),
    line = Color(0xFF2C3441),
    line2 = Color(0xFF242B35),
    bg = Color(0xFF12161C),
    quiet = Color(0xFF1B212A),
    green = Color(0xFF6FD39A),
    greenBg = Color(0xFF14301F),
    amber = Color(0xFFF2B34C),
    amberBg = Color(0xFF38290F),
    amberLine = Color(0xFF5A431A),
    red = Color(0xFFFF8A80),
    redBg = Color(0xFF3B1412),
)

private val LocalTokens = staticCompositionLocalOf { LightTokens }

/** 取设计令牌：`AppTheme.tokens.brand`。比 `MaterialTheme.colorScheme` 更贴近设计稿 */
object AppTheme {
    val tokens: AppTokens
        @Composable
        @ReadOnlyComposable
        get() = LocalTokens.current
}

/**
 * colorScheme 由令牌**派生**，不另写一套色值。
 * 这样「改令牌」与「改组件配色」是同一个动作，不会出现两边色号对不上的情况。
 */
private fun schemeFrom(t: AppTokens, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val cardSurface = if (dark) Color(0xFF1A1F27) else Color.White
    val onBrand = if (dark) Color(0xFF08192E) else Color.White
    return base.copy(
        primary = t.brand,
        onPrimary = onBrand,
        primaryContainer = t.brandLight,
        onPrimaryContainer = t.brandStrong,
        secondary = t.green,
        onSecondary = if (dark) Color(0xFF06301A) else Color.White,
        secondaryContainer = t.greenBg,
        onSecondaryContainer = t.green,
        tertiary = t.amber,
        onTertiary = if (dark) Color(0xFF2A1C00) else Color.White,
        tertiaryContainer = t.amberBg,
        onTertiaryContainer = t.amber,
        background = t.bg,
        onBackground = t.ink,
        surface = cardSurface,
        onSurface = t.ink,
        surfaceVariant = t.line2,
        onSurfaceVariant = t.ink2,
        outline = t.line,
        outlineVariant = t.line2,
        error = t.red,
        onError = if (dark) Color(0xFF3B0907) else Color.White,
        errorContainer = t.redBg,
        onErrorContainer = t.red,
        surfaceTint = t.brand,

        // ── 浮层与容器档 ────────────────────────────────────────────────
        // M3 的 `lightColorScheme()` 默认值全部带一层紫调（surfaceContainerHigh
        // 是 #ECE6F0 一类）。本应用是中性灰白世界，只要漏掉这几个槽位，弹窗、
        // 菜单、Snackbar、底部抽屉就会从品牌蓝体系里「跳出去」——实际症状是
        // 「发现新版本」这种对话框看着像另一个应用。
        // 这里把浮层统一收到 `surface`（白卡 / 深色卡）：对话框在本应用里
        // 就是「浮起来的一张卡」，与页面上的卡片同一种材质。
        surfaceContainerLowest = cardSurface,
        surfaceContainerLow = cardSurface,
        surfaceContainer = cardSurface,
        surfaceContainerHigh = cardSurface,
        surfaceContainerHighest = t.quiet,
        surfaceBright = cardSurface,
        surfaceDim = t.bg,
        // Snackbar 用反色系：深底浅字（浅色档）／浅底深字（深色档）
        inverseSurface = t.ink,
        inverseOnSurface = cardSurface,
        scrim = Color.Black,
    )
}

/**
 * 字号阶梯（2026-10-17 改版校订）。
 *
 * 旧规则是「17sp/22sp 锁死不动，为老花镜村干部不因好看调小」。改版评审时删除该
 * 硬规则，改为按「阅读舒适度」校订层级——原阶梯的问题不是不够大，而是**层级
 * 没拉开**：标题 22 与正文 17 只差 5sp，卡片标题与正文只差 3sp，屏幕上分不清
 * 谁是谁；而真正该小的辅助信息（说明、时间戳）又和正文一样大，一屏全是重点。
 *
 * 校订方向：层级拉开、正文守住可读下限（17sp 不动）、辅助信息允许更小
 * （13 → 12），指标数字按设计稿抬到 23sp。整体比 Material 默认仍然大一号——
 * 「看得清」这条底线没有放弃，只是不再用它当「不许动」的理由。
 */
private val AppTypography = androidx.compose.material3.Typography(
    /**
     * 主数字档（40sp）。全应用只有一处用：工作台的「在册人口」。
     *
     * 这一档存在的理由不是「再大一点好看」，而是回答一个具体的场景问题：
     * 村干部开周会报数字时，手机摊在桌上、人隔着半米看屏幕。此时 23sp 的指标数字
     * 与旁边的标签在余光里是同一团灰块，必须凑近才知道读的是哪个数。
     * 40sp 让「1286」在半米外就是一个可读的形状。
     *
     * 其他数字**不许**用这一档：一屏里出现两个 40sp，谁也不比谁重要，
     * 主数字的意义就没了。层级靠「只有一个」维持，不靠字号本身。
     */
    displaySmall = TextStyle(
        fontSize = 40.sp,
        fontWeight = FontWeight.ExtraBold,
        lineHeight = 44.sp,
        // 大字号默认字距会显松，收 -2% 让数字聚成一团（接近设计稿 letter-spacing:-.02em）
        letterSpacing = (-0.8).sp,
    ),
    /** 页面主标题、指标数字（23sp：设计稿指标格取值，比旧 22 再抬一档） */
    titleLarge = TextStyle(fontSize = 23.sp, fontWeight = FontWeight.SemiBold, lineHeight = 31.sp),
    /** 卡片标题、人员姓名、问候语（18 → 20sp，与正文拉开到 3sp 以上） */
    titleMedium = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp),
    bodyLarge = TextStyle(fontSize = 17.sp, lineHeight = 25.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    /** 辅助说明、时间戳（13 → 12sp：给正文让位，不再一屏全是重点） */
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun VillageTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val tokens = if (darkTheme) DarkTokens else LightTokens
    CompositionLocalProvider(LocalTokens provides tokens) {
        MaterialTheme(
            colorScheme = schemeFrom(tokens, darkTheme),
            typography = AppTypography,
            content = content,
        )
    }
}
