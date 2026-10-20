package com.village.population

import android.app.Application
import com.village.population.di.AppContainer
import com.village.population.util.CrashLogger

class PopApplication : Application() {

    /** 全应用唯一的依赖容器，Worker 里也通过它取依赖 */
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        // 最先装崩溃日志：任何后续初始化（含依赖装配）出错都能落地堆栈
        CrashLogger.install(this)

        container = AppContainer(this)

        // 注册周期性兜底同步：真正的触发点是登录后与手动点击，这里只兜住
        // 「装上之后再没打开过」的情况。
        // 包一层：WorkManager 在少数机型/系统上初始化异常（如被厂商管家禁用、
        // 直接启动模式）会抛 IllegalStateException，不能因此让应用起不来——
        // 同步是后台增强功能，不该成为启动的前置条件。
        runCatching { container.syncManager.schedulePeriodic() }
    }
}
