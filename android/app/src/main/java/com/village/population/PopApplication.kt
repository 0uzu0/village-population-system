package com.village.population

import android.app.Application
import com.village.population.di.AppContainer

class PopApplication : Application() {

    /** 全应用唯一的依赖容器，Worker 里也通过它取依赖 */
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        // 注册周期性兜底同步：真正的触发点是登录后与手动点击，这里只兜住
        // 「装上之后再没打开过」的情况
        container.syncManager.schedulePeriodic()
    }
}
