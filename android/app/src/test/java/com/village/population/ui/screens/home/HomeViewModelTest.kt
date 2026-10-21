package com.village.population.ui.screens.home

import com.village.population.data.local.JsonCache
import com.village.population.data.local.queue.OfflineQueue
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.AppJson
import com.village.population.data.repository.MetaRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.File
import java.nio.file.Files
import java.util.concurrent.TimeUnit

/**
 * 工作台取数测试。
 *
 * ## 这组用例存在的真实原因
 *
 * v2.4.2 发出去后用户反馈「APK 闪退，一进就退」。抓 logcat 得到的栈是：
 *
 * ```
 * FATAL EXCEPTION: main
 * com.village.population.data.remote.ApiException: 请求失败（HTTP 502）
 *     at ...ApiExecutor.guarded(ApiExecutor.kt:75)
 * ```
 *
 * 根因在 `HomeViewModel.load()`：四路请求用 `async` 并发发出，但只有第一路
 * `await()` 有外层 `try/catch`。第一路抛异常被接住之后，**其余几路还在跑**；
 * 它们随后失败时已经没人 `await`，异常顺着 Job 冒泡到 `viewModelScope`。
 * `viewModelScope` 没配 `CoroutineExceptionHandler`，异常最终交给线程默认处理器，
 * 进程被直接杀掉——表现就是冷启动进工作台瞬间闪退。
 *
 * 这种 bug 在开发机上一次都复现不了：网络正常时四路全成功，那条路径永远走不到。
 * 只有**服务端报错 / 断网**时才触发，也就是村里最常见的情况。
 *
 * 因此这里用「全部接口都挂」的极端响应来钉住它：修好之后，失败必须变成一个
 * 可见的错误页（`state.error != null`），而不是让异常逃出协程。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {

    private lateinit var server: MockWebServer
    private lateinit var metaRepo: MetaRepository

    private companion object {
        const val PATH_DASHBOARD = "/api/statistics/dashboard"
        const val PATH_QUICK_GROUPS = "/api/key-groups/quick"
        const val PATH_PENDING = "/api/pending/summary"
        const val PATH_TAGS = "/api/tags/definitions"
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()

        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)

        val root = Files.createTempDirectory("home-vm-test").toFile()
        val exec = ApiExecutor(AppJson) { }
        metaRepo = MetaRepository(
            api,
            exec,
            JsonCache(File(root, "cache"), AppJson),
            OfflineQueue(File(root, "offline"), AppJson),
            AppJson,
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
    }

    private fun json(body: String, code: Int = 200, delayMs: Long = 0) = MockResponse()
        .setResponseCode(code)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
        .apply { if (delayMs > 0) setBodyDelay(delayMs, TimeUnit.MILLISECONDS) }

    /** 服务端故障的真实形态：网关 502 + 业务 500 混着来 */
    private val gatewayError = {
        json("""{"code":502,"message":"网关错误","data":null}""", code = 502)
    }

    private val internalError = {
        json("""{"code":500,"message":"数据库连接失败","data":null}""", code = 500)
    }

    private val okDashboard = {
        json(
            """{"code":0,"message":"success","data":{
              "totalPopulation":1282,"familyCount":536,"gridCount":4,
              "hukouCount":1100,"floatingCount":182,
              "partyCount":46,"disabledCount":37,"extremePovertyCount":5,
              "lowIncomePersonCount":61,"veteranCount":23,"preferentialCount":12}}"""
        )
    }

    private val okQuickGroups = {
        json(
            """{"code":0,"message":"success","data":{"list":[
              {"label":"老年人","code":"ELDERLY","tagCodes":[],"count":214,"byAge":true,"minAge":60},
              {"label":"低保对象","code":"LOW_INCOME_PERSON","tagCodes":["LOW_INCOME_PERSON"],"count":61}
            ],"note":null}}"""
        )
    }

    private val okPending = {
        json("""{"code":0,"message":"success","data":{"total":3,"byStatus":{},"byReason":{}}}""")
    }

    private val okTags = {
        json(
            """{"code":0,"message":"success","data":{"list":[
              {"id":8,"name":"低保对象","code":"LOW_INCOME_PERSON","color":"#F76B15"}
            ],"total":1}}"""
        )
    }

    private fun respondWith(vararg routes: Pair<String, () -> MockResponse>) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path ?: return gatewayError()
                for ((prefix, factory) in routes) {
                    if (p.startsWith(prefix)) return factory()
                }
                return gatewayError()
            }
        }
    }

    private fun awaitUntil(timeoutMs: Long = 5_000, cond: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!cond() && System.currentTimeMillis() < deadline) Thread.sleep(15)
        assertTrue("等待条件超时（5 秒）", cond())
    }

    /**
     * 四路全挂（服务端宕机 / 村里完全没网）——必须落到错误页。
     *
     * 这条用例在修复前会让异常逃出协程，测试直接失败；
     * 它保护的就是「不要再写回『只有第一路有 try/catch』那种写法」。
     */
    @Test
    fun `四个接口全挂时给出错误页而不是让异常逃出协程`() {
        respondWith(
            PATH_DASHBOARD to gatewayError,
            PATH_QUICK_GROUPS to gatewayError,
            PATH_PENDING to internalError,
            PATH_TAGS to internalError,
        )

        val vm = HomeViewModel(metaRepo)
        vm.load()
        awaitUntil { !vm.state.value.loading }

        val s = vm.state.value
        assertNotNull("失败必须变成可见的错误，而不是空白页或闪退", s.error)
        assertFalse("不能一直停在加载中", s.loading)
        assertNull("主口径没取到就不该有数据", s.dashboard)
        assertTrue("重点人群应为空而不是残缺列表", s.groups.isEmpty())
    }

    /**
     * 只有「待核查角标」这一路失败：主数字必须照常显示。
     *
     * 待核查数字是角标性质的次要信息，拿不到不该把整个工作台变成错误页——
     * 否则村里网络抖一下，网格员就什么都看不到。
     */
    @Test
    fun `待核查统计挂掉不影响主数字显示`() {
        respondWith(
            PATH_DASHBOARD to okDashboard,
            PATH_QUICK_GROUPS to okQuickGroups,
            PATH_PENDING to internalError,
            PATH_TAGS to okTags,
        )

        val vm = HomeViewModel(metaRepo)
        vm.load()
        awaitUntil { !vm.state.value.loading }

        val s = vm.state.value
        assertNull("次要块失败不该变成整页错误：${s.error}", s.error)
        assertEquals(1282, s.dashboard?.totalPopulation)
        assertEquals(2, s.groups.size)
        assertNull("拿不到就留空，界面不显示角标", s.pending)
        assertEquals(1, s.tags.size)
    }

    /** 正常路径：四路都成功时数字、族群、角标、标签字典要全部落到状态里 */
    @Test
    fun `四路都正常时工作台数据完整`() {
        respondWith(
            PATH_DASHBOARD to okDashboard,
            PATH_QUICK_GROUPS to okQuickGroups,
            PATH_PENDING to okPending,
            PATH_TAGS to okTags,
        )

        val vm = HomeViewModel(metaRepo)
        vm.load()
        awaitUntil { !vm.state.value.loading }

        val s = vm.state.value
        assertNull(s.error)
        assertEquals(1282, s.dashboard?.totalPopulation)
        assertEquals(536, s.dashboard?.familyCount)
        assertEquals(2, s.groups.size)
        assertEquals("老年人", s.groups.first().label)
        assertTrue("按年龄的族群要保留 byAge 标记", s.groups.first().byAge)
        assertEquals(3, s.pending?.total)
        assertEquals("LOW_INCOME_PERSON", s.tags.first().code)
    }
}
