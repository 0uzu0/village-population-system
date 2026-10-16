package com.village.population.di

import android.content.Context
import com.village.population.data.local.JsonCache
import com.village.population.data.local.SessionState
import com.village.population.data.local.SettingsStore
import com.village.population.data.local.queue.OfflineQueue
import com.village.population.data.remote.ApiClient
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.AppJson
import com.village.population.data.repository.AuthRepository
import com.village.population.data.repository.FileRepository
import com.village.population.data.repository.MetaRepository
import com.village.population.data.repository.PersonRepository
import com.village.population.data.repository.UpdateRepository
import com.village.population.data.sync.SyncEngine
import com.village.population.data.sync.SyncManager
import com.village.population.data.sync.SyncReplayer
import com.village.population.ui.update.UpdateController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import java.io.File

/**
 * 全应用唯一的依赖容器。
 *
 * 刻意用手写装配代替 Hilt/Koin：本应用只有十来条依赖、没有多模块、
 * 也没有需要按生命周期创建的组件，引入注解处理器换来的只是更长的构建时间和
 * 一层看不见的魔法。手写的好处是「谁依赖谁」一眼能看完——这份清单就是架构图。
 */
class AppContainer(context: Context) {

    private val appContext: Context = context.applicationContext

    val json: Json = AppJson

    // ---------------- 基础 ----------------

    val settings = SettingsStore(appContext)

    val session = SessionState(settings)

    private val apiClient = ApiClient(
        // OkHttp 拦截器是同步的，只能读内存镜像（见 SessionState / SettingsStore 的说明）
        tokenProvider = { session.token() },
        baseUrlProvider = { settings.baseUrlInMemory },
    )

    val api: ApiService = apiClient.service

    /** 任意接口返回 401 都会走到这里，交由 UI 统一提示并回到登录页 */
    val executor = ApiExecutor(json) { reason -> session.notifyExpired(reason) }

    /**
     * 缓存与离线队列分两个目录，这一点很重要：
     * 「清空缓存」只删 cache 目录，绝不能把还没上传的走访数据一起删掉。
     */
    private val cacheDir = File(appContext.filesDir, "cache")

    val offlineDir = File(appContext.filesDir, "offline")

    val cache = JsonCache(cacheDir, json)

    val queue = OfflineQueue(File(offlineDir, "queue"), json)

    /**
     * 跨页面传递筛选条件。
     * 「工作台点老年人 → 人员列表」这类跳转带的是一个组合筛选（minAge/tagIds/…），
     * 塞进导航参数会失控，而这个值是一次性的——列表消费掉就清空。
     */
    val personFilterBus = com.village.population.ui.PersonFilterBus()

    // ---------------- 仓库 ----------------

    val authRepository = AuthRepository(api, executor, session)

    val personRepository = PersonRepository(api, executor, cache, queue, json)

    val metaRepository = MetaRepository(api, executor, cache, queue, json)

    val fileRepository = FileRepository(api, executor, File(appContext.cacheDir, "photos"))

    // ---------------- 更新 ----------------

    /**
     * 检查更新 / 下载安装 APK。
     * 独立于上面那套 api 的 OkHttp/Retrofit：GitHub 请求不能带 BaseUrlInterceptor
     * （它会把 host 改写成村级服务器）也不能带 AuthInterceptor（Bearer 头）。
     */
    val updateRepository = UpdateRepository(appContext)

    /**
     * 更新流程的**唯一**控制器。
     * AppRoot（启动静默检查 + 全局弹窗）与「我的」页（手动检查）共用这一个实例，
     * 保证只有一个 state 源、不会出现两个弹窗同时叠在屏幕上。
     */
    val updateController = UpdateController(
        CoroutineScope(SupervisorJob() + Dispatchers.Main),
        updateRepository,
    )

    // ---------------- 同步 ----------------

    private val replayer = SyncReplayer(api, executor, fileRepository, json)

    val syncEngine = SyncEngine(queue, replayer, session::token)

    val syncManager = SyncManager(appContext)

    /**
     * 冷启动一次性初始化。
     * 必须在渲染界面之前完成：拦截器要读内存里的服务器地址与 token，
     * 否则首屏那几个请求会打到占位地址上、全部失败。
     */
    suspend fun bootstrap() {
        settings.refreshCache()
        session.restore()
        queue.refreshSize()
    }

    /** 登出：清登录态与缓存，但**保留离线队列**——那是走访时采到的数据，不能因为换了个人登录就丢 */
    suspend fun logout() {
        session.clear()
        cache.clear()
    }
}
