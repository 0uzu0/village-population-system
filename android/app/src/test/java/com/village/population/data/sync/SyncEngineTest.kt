package com.village.population.data.sync

import com.village.population.data.local.queue.OfflineQueue
import com.village.population.data.local.queue.OpType
import com.village.population.data.local.queue.QueuedOp
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.AppJson
import com.village.population.data.remote.dto.PersonCreateRequest
import com.village.population.data.repository.FileRepository
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.File
import java.nio.file.Files

/**
 * 离线队列的重放逻辑（真实 Retrofit + MockWebServer）。
 *
 * 这条路径平时不会走，只在「村里没信号」时才生效——也正因为如此，
 * 它一旦有 bug，用户是在最不方便的时候发现数据没上去。所以失败策略必须被测试钉住：
 *  · 网络不通 → 保留重试次数、立刻中止整轮（不要逐条重试到底，白耗电）；
 *  · 业务性失败（身份证重复/校验位错）→ 一次到位标记「到底」，不再自动重试；
 *  · 401 → 停止并交给 UI 重新登录；
 *  · 成功 → 连同本地暂存文件一起删除。
 */
class SyncEngineTest {

    private lateinit var server: MockWebServer
    private lateinit var queue: OfflineQueue
    private lateinit var engine: SyncEngine

    private var token: String? = "test-token"

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()

        val dir = Files.createTempDirectory("sync-engine-test").toFile()
        queue = OfflineQueue(dir, AppJson)

        val api: ApiService = Retrofit.Builder()
            .baseUrl(server.url("/"))
            // 生产环境的 Authorization 头来自 OkHttp 拦截器（读内存里的 token 镜像），
            // 而不是由 SyncEngine 逐条拼装。测试里必须把它补上，
            // 否则「重放时带着 Bearer 令牌」这条断言会因为测试环境缺拦截器而假失败。
            .client(
                OkHttpClient.Builder()
                    .addInterceptor { chain ->
                        val t = token
                        val request =
                            if (t.isNullOrBlank()) chain.request()
                            else chain.request().newBuilder()
                                .header("Authorization", "Bearer $t")
                                .build()
                        chain.proceed(request)
                    }
                    .build()
            )
            .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)

        val exec = ApiExecutor(AppJson) { }
        val files = FileRepository(api, exec)
        val replayer = SyncReplayer(api, exec, files, AppJson)

        engine = SyncEngine(queue, replayer) { token }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun enqueueResponse(body: String, code: Int = 200) {
        server.enqueue(
            MockResponse()
                .setResponseCode(code)
                .setHeader("Content-Type", "application/json")
                .setBody(body)
        )
    }

    private fun enqueuePersonOp(name: String, id: String = "op-1") {
        val payload = AppJson.encodeToString(
            PersonCreateRequest.serializer(),
            PersonCreateRequest(name = name, idCard = "11010519491231002X"),
        )
        queue.enqueue(QueuedOp(id = id, type = OpType.CREATE_PERSON, payload = payload, label = "新增人员 $name"))
    }

    @Test
    fun `没有登录态时不做任何处理`() = runTest {
        token = null
        enqueuePersonOp("张三")

        val outcome = engine.run()

        assertTrue(outcome is SyncOutcome.NotSignedIn)
        assertEquals("不应丢掉队列", 1, queue.all().size)
    }

    @Test
    fun `队列为空时直接返回`() = runTest {
        assertTrue(engine.run() is SyncOutcome.NothingToDo)
    }

    @Test
    fun `重放成功后从队列移除`() = runTest {
        enqueuePersonOp("张三")
        enqueueResponse("""{"code":0,"message":"success","data":{"id":11,"name":"张三"}}""")

        val outcome = engine.run()

        assertTrue(outcome is SyncOutcome.Done)
        assertEquals(1, (outcome as SyncOutcome.Done).sent)
        assertEquals(0, queue.all().size)
        assertEquals("/api/persons", server.takeRequest().path)
    }

    @Test
    fun `可重试的5xx失败会保留记录并累加重试次数`() = runTest {
        enqueuePersonOp("张三")
        enqueueResponse("""{"code":500,"message":"服务器内部错误","data":null}""", code = 500)

        engine.run()

        val op = queue.all().single()
        assertEquals(1, op.attempts)
        assertEquals("服务器内部错误", op.lastError)
        assertTrue("不应被标记为到底", !op.exhausted)
    }

    @Test
    fun `业务性失败一次到位标记到底_不再反复重试`() = runTest {
        enqueuePersonOp("张三")
        // 400 + 业务错误码：身份证重复，重试一万次结果都一样
        enqueueResponse(
            """{"code":400,"message":"身份证号已存在","data":null,"errorCode":"DUPLICATE_ID_CARD"}""",
            code = 400,
        )

        engine.run()

        val op = queue.all().single()
        assertEquals(QueuedOp.MAX_ATTEMPTS, op.attempts)
        assertEquals("身份证号已存在", op.lastError)
        assertTrue(op.exhausted)
    }

    @Test
    fun `网络不通时中止整轮而不是逐条重试到底`() = runTest {
        enqueuePersonOp("张三", "op-1")
        enqueuePersonOp("李四", "op-2")
        server.shutdown() // 服务端不可达

        val outcome = engine.run()

        assertTrue(outcome is SyncOutcome.NetworkDown)
        // 两条都还在；只有「真的发过请求、真的失败」的那条被记一次重试次数。
        // 后面那条压根没被尝试过，不能跟着扣次数——否则在同一条路线上信号时断时续，
        // 排在后面的记录会「一次都没试过就到头了」，只能靠人工介入。
        val ops = queue.all()
        assertEquals(2, ops.size)
        assertEquals(listOf(1, 0), ops.map { it.attempts })
        assertEquals("只应发出一次请求就中止", 1, ops.count { it.attempts > 0 })
    }

    @Test
    fun `401时停止并上报登录态失效`() = runTest {
        enqueuePersonOp("张三")
        enqueueResponse(
            """{"code":401,"message":"登录已过期","data":null,"errorCode":"UNAUTHORIZED"}""",
            code = 401,
        )

        val outcome = engine.run()

        assertTrue(outcome is SyncOutcome.SessionExpired)
        assertTrue("失败记录应保留，重新登录后可继续同步", queue.all().isNotEmpty())
    }

    @Test
    fun `未知类型的操作被当作处理完_不能卡住后面的记录`() = runTest {
        queue.enqueue(QueuedOp(id = "op-x", type = "OP_FROM_THE_FUTURE", payload = "{}", label = "未来类型"))
        enqueuePersonOp("张三", "op-1")
        enqueueResponse("""{"code":0,"message":"success","data":{"id":12,"name":"张三"}}""")

        val outcome = engine.run()

        assertTrue(outcome is SyncOutcome.Done)
        assertEquals("两条都应处理掉", 0, queue.all().size)
    }

    @Test
    fun `到底的记录不再参与重放_避免每次都白跑一轮`() = runTest {
        val payload = AppJson.encodeToString(PersonCreateRequest.serializer(), PersonCreateRequest(name = "张三"))
        queue.enqueue(
            QueuedOp(
                id = "op-dead",
                type = OpType.CREATE_PERSON,
                payload = payload,
                label = "已失败的记录",
                attempts = QueuedOp.MAX_ATTEMPTS,
                lastError = "身份证号已存在",
            )
        )

        val outcome = engine.run()

        assertTrue(outcome is SyncOutcome.Done)
        assertEquals(0, server.requestCount)
        assertTrue("仍保留在队列里等用户处理", queue.all().isNotEmpty())
    }

    @Test
    fun `排队顺序按入队时间_先采的人先入库`() = runTest {
        enqueuePersonOp("先采的", "op-1")
        enqueuePersonOp("后采的", "op-2")
        queue.update(queue.all().first { it.id == "op-1" }.copy(createdAt = 1000))
        queue.update(queue.all().first { it.id == "op-2" }.copy(createdAt = 2000))

        enqueueResponse("""{"code":0,"message":"success","data":{"id":1,"name":"a"}}""")
        enqueueResponse("""{"code":0,"message":"success","data":{"id":2,"name":"b"}}""")

        engine.run()

        val first = server.takeRequest().body.readUtf8()
        assertTrue("先入队的应当先发出，实际：$first", first.contains("先采的"))
    }

    @Test
    fun `重放时要带上Bearer令牌`() = runTest {
        token = "abc.def.ghi"
        enqueuePersonOp("张三")
        enqueueResponse("""{"code":0,"message":"success","data":{"id":1,"name":"张三"}}""")

        engine.run()

        assertEquals("Bearer abc.def.ghi", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `本地文件已被清理的上传任务按完成处理_避免队列永远清不空`() = runTest {
        queue.enqueue(
            QueuedOp(
                id = "op-file",
                type = OpType.UPLOAD_FILE,
                label = "上传照片",
                localFile = File("/definitely/not/exists/photo.jpg").absolutePath,
            )
        )

        val outcome = engine.run()

        assertTrue(outcome is SyncOutcome.Done)
        assertEquals("文件没了就该当它完成，否则会一直卡在队列里", 0, queue.all().size)
    }

    /**
     * 回归用例：**断网时拍的照片，联网补传后必须仍然挂在同一个人身上。**
     *
     * 修之前这里是 `files.upload(file)`，bizType / bizId / capturedAt 全丢：
     * 补传成功的照片在后台变成没有归属的孤儿附件，前台按人一张都查不到；
     * 时间戳也变成补传时刻，「哪天去谁家拍的」这条线索一并消失。
     * 这类 bug 只在「没信号」时出现，靠手工试很难复现，必须由这条用例钉住。
     */
    @Test
    fun `断网拍的照片补传时带着归属与拍照时间_不会变成孤儿附件`() = runTest {
        val capturedAt = 1_792_000_000_000L
        val photo = File(Files.createTempDirectory("capture-test").toFile(), "IMG_20261016.jpg")
        photo.writeText("fake-jpeg-bytes")

        queue.enqueue(
            QueuedOp(
                id = "op-photo",
                type = OpType.UPLOAD_FILE,
                label = "上传现场照片",
                localFile = photo.absolutePath,
                refId = 42,
                bizType = "PERSON",
                capturedAt = capturedAt,
            )
        )
        enqueueResponse("""{"code":0,"message":"success","data":{"id":1,"fileName":"2026-10-16-19-30-12-张三-P000123.jpg"}}""")

        val outcome = engine.run()

        assertTrue(outcome is SyncOutcome.Done)
        val request = server.takeRequest()
        assertEquals("/api/files/upload", request.path)
        val body = request.body.readUtf8()
        assertTrue("必须带上归属类型，实际：$body", body.contains("name=\"bizType\"") && body.contains("PERSON"))
        assertTrue("必须带上人员 id，实际：$body", body.contains("name=\"bizId\"") && body.contains("42"))
        assertTrue(
            "必须带上拍照时间，否则后台会按补传时刻命名：$body",
            body.contains("name=\"capturedAt\"") && body.contains(capturedAt.toString())
        )
    }

    /**
     * 旧版本 APK 留下的队列文件里没有 bizType / capturedAt 这两个字段，
     * 升级后必须还能读出来（缺省为 null），而不是整条反序列化失败、把队列清空掉。
     */
    @Test
    fun `旧版本队列文件缺少归属字段时仍可解析`() {
        val legacy = """{"id":"old-1","type":"UPLOAD_FILE","payload":"{}","label":"上传照片",""" +
            """"createdAt":1700000000000,"attempts":0,"localFile":"/tmp/a.jpg","refId":7}"""
        val op = AppJson.decodeFromString(QueuedOp.serializer(), legacy)

        assertEquals("old-1", op.id)
        assertEquals(7, op.refId)
        assertEquals(null, op.bizType)
        assertEquals(null, op.capturedAt)
    }
}
