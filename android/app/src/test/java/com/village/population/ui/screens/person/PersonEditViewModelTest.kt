package com.village.population.ui.screens.person

import com.village.population.data.local.JsonCache
import com.village.population.data.local.queue.OfflineQueue
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.AppJson
import com.village.population.data.repository.MetaRepository
import com.village.population.data.repository.PersonRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.File
import java.nio.file.Files

/**
 * 「编辑人员」表单取数测试。
 *
 * 存在的原因：编辑页最基础也最致命的失败方式是**一片空白**——
 * 用户以为档案没数据，只好从头重填，而重填会覆盖掉原有记录。
 * 这里用真实 Retrofit + 真实 JSON 跑通「打开编辑页 → 表单被填满」这条链路，
 * 把「接口返回的字段名改了 / 绑错字段 / 忘了调详情接口」这类问题挡在提交之前。
 *
 * 同时也钉住新增（personId=0）时**不该**去调详情接口。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PersonEditViewModelTest {

    private lateinit var server: MockWebServer
    private lateinit var api: ApiService
    private lateinit var personRepo: PersonRepository
    private lateinit var metaRepo: MetaRepository

    /** 后端 GET /api/persons/:id 的真实响应形状（字段名取自 toPersonVO） */
    private val detailJson = """
        {"code":0,"message":"success","data":{
          "id":7,"personNo":"P0007","name":"张三","formerName":"张小三",
          "gender":"MALE","birthDate":"1955-03-08","age":71,
          "idCard":"320102195503081234","phone":"13800000001","phoneBackup":"13900000002",
          "hukouAddress":"江苏省南京市某区某街道","liveAddress":"三组 12 号",
          "village":"某村","gridId":1,"gridName":"一网格",
          "familyId":3,"familyName":"F0003","relation":"户主",
          "status":"NORMAL","statusDate":"2026-01-01","remark":"行动不便",
          "bankAccount":"6222021234567890123","subsidyAmount":300,"familyCondition":"独居",
          "healthAssessment":"一般","dataSource":"Excel导入","updatedAt":"2026-10-01 08:00:00",
          "disability":{"type":"肢体残疾","level":"LEVEL_2","levelLabel":"二级",
                        "card":"32010219550308123443","guardianName":"张四","guardianPhone":"13700000003"},
          "tags":[{"id":8,"linkId":21,"name":"低保对象","code":"LOW_INCOME_PERSON","color":"#F76B15"}],
          "changes":[{"field_name":"phone","old_value":"138","new_value":"139","change_type":"UPDATE"}]}}
    """.trimIndent()

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()
        api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)

        val root = Files.createTempDirectory("edit-vm-test").toFile()
        val json = AppJson
        val exec = ApiExecutor(json) { }
        val cache = JsonCache(File(root, "cache"), json)
        val queue = OfflineQueue(File(root, "offline"), json)
        personRepo = PersonRepository(api, exec, cache, queue, json)
        metaRepo = MetaRepository(api, exec, cache, queue, json)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
    }

    private fun enqueue(body: String, code: Int = 200) {
        server.enqueue(
            MockResponse()
                .setResponseCode(code)
                .setHeader("Content-Type", "application/json")
                .setBody(body)
        )
    }

    /** init() 里的协程会真的走网络，用轮询等待结果，避免依赖测试调度器的时序 */
    private fun awaitUntil(timeoutMs: Long = 5_000, cond: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!cond() && System.currentTimeMillis() < deadline) Thread.sleep(15)
        assertTrue("等待条件超时（5 秒）", cond())
    }

    private fun villages() = enqueue(
        """{"code":0,"message":"success","data":{"list":[
             {"name":"某村","person_count":1282,"manager":"李主任","phone":"13800001111"}
           ],"total":1}}"""
    )

    @Test
    fun `打开编辑页时表单会被既有档案填满`() {
        villages()
        enqueue(detailJson)

        val vm = PersonEditViewModel(personRepo, metaRepo, 7)
        assertTrue("personId>0 应判定为编辑", vm.isEdit)
        vm.init()
        awaitUntil { vm.state.value.loaded || vm.state.value.loadError != null }

        val s = vm.state.value
        assertNull("不应该有错误：${s.loadError}", s.loadError)
        assertTrue("档案应已读回", s.loaded)
        assertEquals(false, s.loading)
        assertEquals("张三", s.name)
        assertEquals("320102195503081234", s.idCard)
        assertEquals("MALE", s.gender)
        assertEquals("1955-03-08", s.birthDate)
        assertEquals("13800000001", s.phone)
        assertEquals("13900000002", s.phoneBackup)
        assertEquals("某村", s.village)
        assertEquals("江苏省南京市某区某街道", s.hukouAddress)
        assertEquals("三组 12 号", s.liveAddress)
        assertEquals("户主", s.relation)
        assertEquals("行动不便", s.remark)
        assertEquals(1, s.villages.size)
    }

    @Test
    fun `读取档案期间不给表单_读完才放开保存`() {
        // 让网络卡住，模拟村里信号很差的情况
        val delayed = MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(detailJson)
            .setBodyDelay(1, java.util.concurrent.TimeUnit.SECONDS)
        villages()
        server.enqueue(delayed)

        val vm = PersonEditViewModel(personRepo, metaRepo, 7)
        vm.init()

        // 刚打开的这一瞬间：正在加载，**不能**是可以编辑的空表单
        assertTrue("加载中应置 loading", vm.state.value.loading)
        assertTrue("加载中不允许保存", !vm.canSave)

        awaitUntil { vm.state.value.loaded }
        assertTrue("读完后才允许保存", vm.canSave)
    }

    @Test
    fun `读取档案失败时明确报错并禁止保存_而不是给一张空表单`() {
        villages()
        enqueue("""{"code":500,"message":"数据库连接失败","data":null,"errorCode":"INTERNAL"}""", code = 500)

        val vm = PersonEditViewModel(personRepo, metaRepo, 7)
        vm.init()
        awaitUntil { vm.state.value.loadError != null || vm.state.value.loaded }

        val s = vm.state.value
        assertEquals("数据库连接失败", s.loadError)
        assertTrue("没读到档案就不能算已加载", !s.loaded)
        assertTrue("此时必须禁止保存，否则空表单会把原档案覆盖掉", !vm.canSave)

        // 即使绕过 UI 直接调用 save()，也不能发出写请求
        var saved = false
        vm.save { saved = true }
        assertTrue("不应提交", !saved)
        assertTrue(vm.state.value.error != null)
        assertEquals("只应发生村庄 + 详情两个请求，不该有写请求", 2, server.requestCount)
    }

    @Test
    fun `新增人员时不去调详情接口`() {
        villages()

        val vm = PersonEditViewModel(personRepo, metaRepo, 0)
        assertTrue("personId=0 是新增", !vm.isEdit)
        assertTrue("新增时表单本来就可编辑", vm.canSave)
        vm.init()
        awaitUntil { vm.state.value.villages.isNotEmpty() }

        assertEquals("", vm.state.value.name)
        // 只应发生一次请求（村庄列表）；新增时多打一次详情接口说明判断写错了
        assertEquals(1, server.requestCount)
    }
}
