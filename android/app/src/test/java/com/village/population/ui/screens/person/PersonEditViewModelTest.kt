package com.village.population.ui.screens.person

import com.village.population.data.local.JsonCache
import com.village.population.data.local.queue.OfflineQueue
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.AppJson
import com.village.population.data.repository.MetaRepository
import com.village.population.data.repository.PersonRepository
import com.village.population.data.repository.SubmitResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    /** 分发用的路径前缀。用前缀而非全等匹配，是为了容下查询串（如 villages?keyword=） */
    private companion object {
        const val PATH_VILLAGES = "/api/grids/villages"
        const val PATH_PERSON = "/api/persons/"
        /**
         * 新增是 `POST /api/persons`——**没有结尾斜杠**，与详情的 `/api/persons/{id}`
         * 是两个前缀，只按 `/api/persons/` 匹配会漏掉它（写成 404 才能看出「打错了接口」）。
         */
        const val PATH_PERSON_ROOT = "/api/persons"
        /** 「人口标签」多选项：新增/编辑都要拉一次标签定义 */
        const val PATH_TAGS = "/api/tags/definitions"
    }

    /** 后端 GET /api/persons/:id 的真实响应形状（字段名取自 toPersonVO） */
    private val detailJson = """
        {"code":0,"message":"success","data":{
          "id":7,"personNo":"P0007","name":"张三","formerName":"张小三",
          "gender":"MALE","birthDate":"1955-03-08","age":71,
          "idCard":"320102195503081232","phone":"13800000001","phoneBackup":"13900000002",
          "hukouAddress":"江苏省南京市某区某街道","liveAddress":"三组 12 号",
          "village":"某村","gridId":1,"gridName":"一网格",
          "familyId":3,"familyName":"F0003","relation":"户主",
          "status":"NORMAL","statusDate":"2026-01-01","remark":"行动不便",
          "bankAccount":"6222021234567890123","subsidyAmount":300,"familyCondition":"独居",
          "healthAssessment":"一般","dataSource":"Excel导入","updatedAt":"2026-10-01 08:00:00",
          "disability":{"type":"肢体残疾","level":"LEVEL_2","levelLabel":"二级",
                        "card":"32010219550308123243","guardianName":"张四","guardianPhone":"13700000003"},
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

    private fun json(body: String, code: Int = 200, delayMs: Long = 0) = MockResponse()
        .setResponseCode(code)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
        .apply { if (delayMs > 0) setBodyDelay(delayMs, TimeUnit.MILLISECONDS) }

    /**
     * 按**请求路径**分发响应，而不是 `enqueue()` 那种「先到先得」的队列。
     *
     * ## 为什么必须这样
     *
     * `init()` 里村庄列表与人员档案是 `async` **并发**发出的（串行会让编辑页白等两个来回），
     * 既然并发，两个请求到达 MockWebServer 的顺序就不受测试控制。
     * 用 `enqueue()` 排队，等于把「哪个请求吃到哪份响应」交给调度运气：
     * 一旦详情请求抢到了村庄那份响应（或村庄请求吃到那条 500），
     * `loadError` 就不再是预想的那条消息——同一个提交在 CI 上一会儿绿一会儿红，
     * 实测过就是这样失败的。
     *
     * 按路径分发之后，每个请求拿到什么只取决于它自己的 URL，
     * 与协程调度顺序无关，测试因此是确定的。
     */
    /** 写请求的请求体（按到达顺序）。用于断言「清空字段到底发出去了什么」 */
    private val capturedBodies = mutableListOf<String>()

    private fun respondWith(vararg routes: Pair<String, () -> MockResponse>) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path ?: return notFound("<empty>")
                // 非 GET 都留下请求体：写请求的字段值是这一组用例的重点，
                // 光看「请求发出去了」并不能说明发对了
                if (request.method != "GET") capturedBodies += request.body.readUtf8()
                for ((prefix, factory) in routes) {
                    if (p.startsWith(prefix)) return factory()
                }
                return notFound(p)
            }

            /**
             * 未预期的请求一律 404 并在消息里点名路径：
             * 「多打了一个写请求」这类回归要能被一眼看出来，而不是悄悄返回一个 200。
             */
            private fun notFound(p: String) = json(
                """{"code":404,"message":"unexpected request: $p","data":null}""",
                code = 404
            )
        }
    }

    /** init() 里的协程会真的走网络，用轮询等待结果，避免依赖测试调度器的时序 */
    private fun awaitUntil(timeoutMs: Long = 5_000, cond: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!cond() && System.currentTimeMillis() < deadline) Thread.sleep(15)
        assertTrue("等待条件超时（5 秒）", cond())
    }

    private val okVillages = {
        json(
            """{"code":0,"message":"success","data":{"list":[
             {"name":"某村","person_count":1282,"manager":"李主任","phone":"13800001111"}
           ],"total":1}}"""
        )
    }

    private fun personDetail(delayMs: Long = 0) = { json(detailJson, delayMs = delayMs) }

    /**
     * 新增成功的真实响应形状（`{ id, personNo }`）。
     * 注意用的是 `PersonSaveResult` 而不是人员对象：这个接口只回这两个字段。
     */
    private val okCreate = {
        json("""{"code":0,"message":"新增成功","data":{"id":18,"personNo":"P0018"}}""")
    }

    /**
     * 未填身份证号：后端不建正式档案，转入待核查（`{ pending, pendingId }`，**没有 id**）。
     * 这是「成功但没建档」的第三种结果，界面必须能区分。
     */
    private val okCreatePending = {
        json("""{"code":0,"message":"未填写身份证号，已转入待核查人员","data":{"pending":true,"pendingId":42}}""")
    }

    /**
     * 个人标签定义列表。
     * 其中 id=8 与 detailJson 里该人员已挂的标签一致，便于断言「编辑时回填」。
     */
    private val okTags = {
        json(
            """{"code":0,"message":"success","data":{"list":[
             {"id":8,"name":"低保对象","code":"LOW_INCOME_PERSON","color":"#F76B15"},
             {"id":9,"name":"残疾人","code":"DISABLED_PERSON","color":"#0E7C6B"}
           ],"total":2}}"""
        )
    }

    @Test
    fun `打开编辑页时表单会被既有档案填满`() {
        respondWith(PATH_VILLAGES to okVillages, PATH_PERSON to personDetail(), PATH_TAGS to okTags)

        val vm = PersonEditViewModel(personRepo, metaRepo, 7)
        assertTrue("personId>0 应判定为编辑", vm.isEdit)
        vm.init()
        awaitUntil { vm.state.value.loaded || vm.state.value.loadError != null }

        val s = vm.state.value
        assertNull("不应该有错误：${s.loadError}", s.loadError)
        assertTrue("档案应已读回", s.loaded)
        assertEquals(false, s.loading)
        assertEquals("张三", s.name)
        assertEquals("320102195503081232", s.idCard)
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
        // 标签：选项要拉全，已挂的标签要回填。
        // 「回填」这条尤其关键——tagIds 是**全量覆盖**语义，忘了回填的话
        // 用户只是改个手机号，保存时就会把该人员原有的标签全部清空。
        assertEquals(2, s.personTags.size)
        assertEquals(listOf(8), s.tagIds)
    }

    @Test
    fun `读取档案期间不给表单_读完才放开保存`() {
        // 让详情慢 1 秒，模拟村里信号很差的情况；村庄与标签仍是即时的
        respondWith(PATH_VILLAGES to okVillages, PATH_PERSON to personDetail(delayMs = 1_000), PATH_TAGS to okTags)

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
        // 详情接口挂 500，村庄列表正常返回——两件事互不干扰，靠路径区分而非排队顺序
        respondWith(
            PATH_VILLAGES to okVillages,
            PATH_TAGS to okTags,
            PATH_PERSON to {
                json("""{"code":500,"message":"数据库连接失败","data":null,"errorCode":"INTERNAL"}""", code = 500)
            }
        )

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
        assertEquals("只应发生村庄 + 标签 + 详情三个请求，不该有写请求", 3, server.requestCount)
    }

    @Test
    fun `新增人员时不去调详情接口`() {
        respondWith(PATH_VILLAGES to okVillages, PATH_TAGS to okTags)

        val vm = PersonEditViewModel(personRepo, metaRepo, 0)
        assertTrue("personId=0 是新增", !vm.isEdit)
        assertTrue("新增时表单本来就可编辑", vm.canSave)
        vm.init()
        awaitUntil { vm.state.value.villages.isNotEmpty() }

        assertEquals("", vm.state.value.name)
        // 只应发生两次请求（村庄列表 + 标签定义）；新增时多打一次详情接口说明判断写错了
        assertEquals(2, server.requestCount)
        // 新增时标签选项要拉全（否则表单里没得选），但不该有预选中的标签
        assertEquals(2, vm.state.value.personTags.size)
        assertTrue("新增时不应有预选标签", vm.state.value.tagIds.isEmpty())
    }

    /**
     * 「清空字段」是移动端曾经踩过的坑，也是本组用例存在的理由：
     *
     * 早先 `save()` 把所有空值收成 null，而 AppJson 配了 explicitNulls=false，
     * null 字段**整个不参与序列化**。后端收到的是「没有这个字段」，按「本次没提交」
     * 处理并保持原值——于是网格员删掉电话点保存，界面提示已保存，回列表电话还在。
     * 这类「假成功」比报错更坏：没人会发现数据没改。
     *
     * 后端的清空语义是收到 `''`（fieldMap 里 `=== '' ? null : v`），
     * 所以客户端必须把空串原样发出去。
     */
    @Test
    fun `编辑时清空字段要把空串发出去_而不是被 JSON 配置省掉`() {
        capturedBodies.clear()
        respondWith(PATH_VILLAGES to okVillages, PATH_PERSON to personDetail(), PATH_TAGS to okTags)

        val vm = PersonEditViewModel(personRepo, metaRepo, 7)
        vm.init()
        awaitUntil { vm.state.value.loaded }

        // 用户删掉了本人电话与备注
        vm.onField { it.copy(phone = "", remark = "") }

        var result: SubmitResult? = null
        vm.save { result = it }
        awaitUntil { result != null }

        assertTrue("应当是已入库而不是转待核查", result is SubmitResult.Sent)
        val body = Json.parseToJsonElement(capturedBodies.last()).jsonObject
        assertTrue("phone 必须出现在请求体里（省略 = 当成没改）", body.containsKey("phone"))
        assertEquals("", body["phone"]?.jsonPrimitive?.content)
        assertTrue("remark 同理", body.containsKey("remark"))
        assertEquals("", body["remark"]?.jsonPrimitive?.content)
        // 没动过的字段照原值发回，不能被空值顶掉
        assertEquals("320102195503081232", body["idCard"]?.jsonPrimitive?.content)
        // 编辑必须带乐观锁版本号（详情样本里没有该字段，故为默认 0）
        assertTrue("编辑要带 rowVersion", body.containsKey("rowVersion"))
    }

    /**
     * 未填身份证号的新增：后端**不建正式档案**，返回 `{pending:true,pendingId}`。
     *
     * 这条路径早先是「蒙对的」——用 PersonDto 去接响应，data 里没有 id，
     * 于是 `id` 落到默认值 0，界面靠 `personId == 0` 反推「转了待核查」。
     * 只要哪天后端的默认值或响应形状动一下，界面就会把它当成建档成功直接返回列表，
     * 而这个人根本不在列表里。现在改成显式的 `SubmitResult.Pending`，这里钉住它。
     */
    @Test
    fun `未填身份证号新增时_上报转待核查而不是建档成功`() {
        capturedBodies.clear()
        respondWith(PATH_VILLAGES to okVillages, PATH_TAGS to okTags, PATH_PERSON_ROOT to okCreatePending)

        val vm = PersonEditViewModel(personRepo, metaRepo, 0)
        vm.init()
        awaitUntil { vm.state.value.villages.isNotEmpty() }

        // 只填姓名（走访现场常有的「先记个名字，回头补证件」）
        vm.onField { it.copy(name = "王五") }

        var result: SubmitResult? = null
        vm.save { result = it }
        awaitUntil { result != null }

        assertTrue(
            "未填身份证号必须是 Pending，不能当成建档成功",
            result is SubmitResult.Pending
        )
        assertEquals(42, (result as SubmitResult.Pending).pendingId)

        val body = Json.parseToJsonElement(capturedBodies.last()).jsonObject
        assertEquals("王五", body["name"]?.jsonPrimitive?.content)
        assertFalse("未选性别不能发 gender 空串（后端枚举会拒）", body.containsKey("gender"))
        assertFalse("未选村庄不能发 village", body.containsKey("village"))
        assertFalse("新增不带 rowVersion", body.containsKey("rowVersion"))
        // 标签是空集合：语义是「不打标签」，要显式发，不能被省成「不动标签」
        assertTrue(body.containsKey("tagIds"))
    }

    @Test
    fun `有身份证号新增时_上报已建档并返回列表`() {
        capturedBodies.clear()
        respondWith(PATH_VILLAGES to okVillages, PATH_TAGS to okTags, PATH_PERSON_ROOT to okCreate)

        val vm = PersonEditViewModel(personRepo, metaRepo, 0)
        vm.init()
        awaitUntil { vm.state.value.villages.isNotEmpty() }

        vm.onField { it.copy(name = "王五", idCard = "320102195503081232") }

        var result: SubmitResult? = null
        vm.save { result = it }
        awaitUntil { result != null }

        assertTrue(result is SubmitResult.Sent)
        assertEquals(18, (result as SubmitResult.Sent).personId)
    }
}
