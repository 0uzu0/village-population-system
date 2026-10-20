package com.village.population

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.navigation.AppRoot
import com.village.population.ui.theme.VillageTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 目标 SDK 35 在 Android 15 上强制边到边显示，必须显式声明，
        // 否则内容会顶到状态栏下面（旧系统上则是白边）
        enableEdgeToEdge()

        val container = (application as PopApplication).container

        setContent {
            CompositionLocalProvider(LocalAppContainer provides container) {
                // ⚠️ 这一层是必须的，缺了它整套设计系统都不会生效：
                //  · `AppTheme.tokens` 的默认值是 staticCompositionLocalOf { LightTokens }，
                //    没有 Provider 就等于**永远是浅色调**，深色模式形同虚设；
                //  · `MaterialTheme.colorScheme` 会退回 M3 默认的紫色板 —— 弹窗、菜单、
                //    Snackbar、TextField 全是紫调，跟品牌蓝没有关系；
                //  · `MaterialTheme.typography` 会退回 M3 默认的 14sp 正文，设计稿
                //    校订过的 17/20/23sp 阶梯全部落空。
                // 症状是「局部看着像另一个应用」，而不是某个具体的错。
                VillageTheme {
                    AppRoot()
                }
            }
        }
    }
}
