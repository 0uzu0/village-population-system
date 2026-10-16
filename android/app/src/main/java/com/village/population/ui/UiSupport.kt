package com.village.population.ui

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.Composable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.village.population.data.repository.PersonQuery
import com.village.population.di.AppContainer

/** 依赖容器通过 CompositionLocal 下发，避免每个屏幕一路透传参数 */
val LocalAppContainer = compositionLocalOf<AppContainer> {
    error("AppContainer 未提供：请在 AppRoot 里用 CompositionLocalProvider 包住内容")
}

/**
 * 最小可用的 ViewModel 工厂。
 * 不引 Hilt，所以需要一个把容器依赖注入构造函数的入口——就这么点事，
 * 一个类足够，不需要注解处理器。
 */
@Suppress("UNCHECKED_CAST")
class SimpleViewModelFactory<T : ViewModel>(private val builder: () -> T) : ViewModelProvider.Factory {
    override fun <VM : ViewModel> create(modelClass: Class<VM>): VM = builder() as VM
}

@Composable
inline fun <reified VM : ViewModel> containerViewModel(noinline builder: (AppContainer) -> VM): VM {
    val container = LocalAppContainer.current
    return viewModel(factory = SimpleViewModelFactory { builder(container) })
}

/**
 * 跨页面传递「待应用的筛选条件」。
 *
 * 为什么用单例而不是导航参数：工作台点「老年人」要跳到人员列表并带上
 * minAge=60，跳「低保户」要带上 tagIds=[..]。把这类组合条件塞进 URL 查询串
 * 会迅速失控（十来个可选参数），而这个值是**一次性的**——列表消费掉就该清空，
 * 也正好符合「从详情页返回时不该重新套用筛选」的预期。
 *
 * `label` 是人话版的来源说明（如「低保对象」）。列表页要把它显示出来：
 * 一个被筛过、却看不出被筛过的列表，用户只会以为「怎么少人了」。
 */
data class PendingFilter(val query: PersonQuery, val label: String? = null)

class PersonFilterBus {
    var pending: PendingFilter? = null
        private set

    fun post(query: PersonQuery, label: String? = null) {
        pending = PendingFilter(query, label)
    }

    fun consume(): PendingFilter? {
        val value = pending
        pending = null
        return value
    }
}
