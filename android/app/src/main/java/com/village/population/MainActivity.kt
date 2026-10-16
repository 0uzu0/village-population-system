package com.village.population

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.navigation.AppRoot

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 目标 SDK 35 在 Android 15 上强制边到边显示，必须显式声明，
        // 否则内容会顶到状态栏下面（旧系统上则是白边）
        enableEdgeToEdge()

        val container = (application as PopApplication).container

        setContent {
            CompositionLocalProvider(LocalAppContainer provides container) {
                AppRoot()
            }
        }
    }
}
