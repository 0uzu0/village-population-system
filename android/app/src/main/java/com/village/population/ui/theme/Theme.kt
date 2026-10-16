package com.village.population.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// 主色沿用 PC 端的品牌蓝（frontend/src/styles/tokens.css 的 --color-primary #3978F6），
// 但刻意调深一档：#3978F6 上放白字对比度只有 3.5:1，达不到 WCAG AA 的 4.5:1；
// 手机多在户外强光下看，按钮上的字必须更实。色相不变，两端仍然是同一个品牌色。
private val BrandBlue = Color(0xFF1D6FE0)
private val BrandBlueDark = Color(0xFF8FB8F5)
private val Green = Color(0xFF12A150)
private val Amber = Color(0xFFE08A00)
private val Red = Color(0xFFD93025)

private val LightColors = lightColorScheme(
    primary = BrandBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDCE8FF),
    onPrimaryContainer = Color(0xFF0A2A5E),
    secondary = Green,
    onSecondary = Color.White,
    tertiary = Amber,
    background = Color(0xFFF4F6FA),
    onBackground = Color(0xFF1B1F26),
    surface = Color.White,
    onSurface = Color(0xFF1B1F26),
    surfaceVariant = Color(0xFFEDF1F7),
    onSurfaceVariant = Color(0xFF4A5260),
    outline = Color(0xFFC6CDD8),
    error = Red,
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = BrandBlueDark,
    onPrimary = Color(0xFF0A2A5E),
    primaryContainer = Color(0xFF1B3E75),
    onPrimaryContainer = Color(0xFFDCE8FF),
    secondary = Color(0xFF6FD39A),
    onSecondary = Color(0xFF06301A),
    tertiary = Color(0xFFF2B34C),
    background = Color(0xFF12161C),
    onBackground = Color(0xFFE6EAF0),
    surface = Color(0xFF1A1F27),
    onSurface = Color(0xFFE6EAF0),
    surfaceVariant = Color(0xFF262C36),
    onSurfaceVariant = Color(0xFFB6BFCB),
    outline = Color(0xFF3C4450),
    error = Color(0xFFFF8A80),
    onError = Color(0xFF3B0907),
)

/**
 * 字号整体比 Material 默认大一号。
 * 使用者是村干部和网格员，相当一部分人戴老花镜——把「看起来精致」让位给「看得清」，
 * 是本应用在排版上唯一的一条硬规则。
 */
private val AppTypography = androidx.compose.material3.Typography(
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, lineHeight = 30.sp),
    titleMedium = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Medium, lineHeight = 26.sp),
    bodyLarge = TextStyle(fontSize = 17.sp, lineHeight = 25.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    labelLarge = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun VillageTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = AppTypography,
        content = content,
    )
}
