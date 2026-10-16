package com.village.population.data.remote

import com.village.population.data.remote.dto.ApiEnvelope
import com.village.population.data.remote.dto.LoginRequest
import com.village.population.data.remote.dto.LoginResponse
import com.village.population.data.remote.dto.PageData
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.remote.dto.VoidEnvelope
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * 网络层契约测试（真实 Retrofit + 真实 JSON 解析 + 真实 HTTP 服务端）。
 *
 * 这组用例存在的首要原因，是钉住一个**编译期看不出来**的风险点：
 * 用泛型信封 `ApiEnvelope<T>` 接响应，依赖 kotlinx.serialization 在运行时
 * 解析 `ApiEnvelope<PageData<PersonDto>>` 这种嵌套泛型的 serializer。
 * 如果它需要 kotlin-reflect 而运行时又不具备，代码照样编译通过，
 * 只在真机上第一次请求时炸掉。这里用 MockWebServer 跑通整条链路来排除这种可能。
 *
 * 其次是钉住后端的两条实际行为：
 *  · 业务失败是 HTTP 200 + code != 0（不能只看 HTTP 状态码）；
 *  · 真正的 HTTP 错误体里也有 message，要把它解出来给用户看。
 */
class ApiEnvelopeTest {

    private lateinit var server: MockWebServer
    private lateinit var api: ApiService
    private val json = AppJson

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)
    }

    @After
    fun tearDown() {
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

    @Test
    fun `嵌套泛型信封能被正确解析`() = runTest {
        enqueue(
            """
            {"code":0,"message":"success","data":{
              "list":[{"id":7,"name":"张三","gender":"MALE","age":61,"status":"NORMAL",
                        "personNo":"P0007","gridName":"一网格",
                        "tags":[{"id":3,"name":"低保户","code":"LOW_INCOME_PERSON","color":"#E08A00"}]}],
              "total":1,"page":1,"pageSize":20}}
            """.trimIndent()
        )

        val response = api.persons(page = 1, pageSize = 20)
        assertEquals(0, response.code)
        val page = response.data
        assertNotNull(page)
        assertEquals(1, page!!.total)
        val person = page.list.first()
        assertEquals("张三", person.name)
        assertEquals("一网格", person.gridName)
        assertEquals(1, person.tags.size)
        assertEquals("低保户", person.tags.first().name)
    }

    @Test
    fun `多出来的未知字段不会导致解析失败`() = runTest {
        // 详情接口返回的字段比列表多（disability/changes 等），模型里没有也必须能解析
        enqueue(
            """
            {"code":0,"message":"success","data":{"id":1,"name":"李四",
              "disability":{"type":"肢体残疾","level":"LEVEL_2","levelLabel":"二级"},
              "changes":[{"fieldName":"phone","oldValue":"1","newValue":"2"}],
              "某个将来才加的字段":"随便什么值"}}
            """.trimIndent()
        )
        val person = api.person(1).data
        assertNotNull(person)
        assertEquals("肢体残疾", person!!.disability?.type)
        assertEquals(1, person.changes.size)
    }

    @Test
    fun `登录返回的token与用户信息可解析`() = runTest {
        enqueue(
            """
            {"code":0,"message":"success","data":{
              "token":"abc.def.ghi",
              "user":{"id":2,"username":"wgy01","realName":"王网格","isAdmin":false,
                      "roles":["网格员"],"permissions":["person:view","ledger:manage"]}}}
            """.trimIndent()
        )
        val result = api.login(LoginRequest("wgy01", "secret")).data
        assertEquals("abc.def.ghi", result!!.token)
        assertEquals("王网格", result.user.realName)
        // 权限判断的口径：管理员默认全通过，普通用户看列表
        assertTrue(result.user.can("ledger:manage"))
        assertTrue(!result.user.can("user:manage"))
    }

    @Test
    fun `业务失败是200包着非0的code_执行器要抛异常并带上后端原话`() = runTest {
        enqueue("""{"code":401,"message":"账号或密码错误","data":null,"errorCode":"INVALID_CREDENTIALS"}""")

        var unauthorizedNotified = false
        val exec = ApiExecutor(json) { unauthorizedNotified = true }
        val error = runCatching {
            exec.data { api.login(LoginRequest("a", "b")) }
        }.exceptionOrNull()

        assertTrue(error is ApiException)
        error as ApiException
        assertEquals("账号或密码错误", error.message)
        assertEquals("INVALID_CREDENTIALS", error.errorCode)
        assertTrue("401 应触发统一登出", unauthorizedNotified)
    }

    @Test
    fun `真正的HTTP错误要把响应体里的中文提示解出来`() = runTest {
        enqueue("""{"code":500,"message":"数据库连接失败","data":null,"errorCode":"INTERNAL"}""", code = 500)

        val exec = ApiExecutor(json) { }
        val error = runCatching { exec.page { api.persons(1, 20) } }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals("数据库连接失败", (error as ApiException).message)
        assertEquals(500, error.httpStatus)
    }

    @Test
    fun `无返回体的接口用VoidEnvelope接_多出来的data字段被忽略`() = runTest {
        enqueue("""{"code":0,"message":"标签已添加","data":null}""")
        api.addPersonTag(1, com.village.population.data.remote.dto.AddTagRequest(tagId = 5))
        val request = server.takeRequest()
        assertEquals("/api/persons/1/tags", request.path)
        assertTrue(request.body.readUtf8().contains("\"tagId\":5"))
    }

    @Test
    fun `activeOnly以字符串形式出现在查询串里`() = runTest {
        enqueue("""{"code":0,"message":"success","data":{"list":[],"total":0,"page":1,"pageSize":20}}""")
        api.persons(page = 1, pageSize = 20, activeOnly = "false", tagIds = "3,7", tagMode = "ALL")
        val path = server.takeRequest().path!!
        assertTrue("实际路径：$path", path.contains("activeOnly=false"))
        assertTrue("实际路径：$path", path.contains("tagIds=3%2C7"))
        assertTrue("实际路径：$path", path.contains("tagMode=ALL"))
    }

    @Test
    fun `未传的可选参数不会出现在查询串里`() = runTest {
        enqueue("""{"code":0,"message":"success","data":{"list":[],"total":0,"page":1,"pageSize":20}}""")
        api.persons(page = 1, pageSize = 20)
        val path = server.takeRequest().path!!
        assertTrue("不应出现 keyword：$path", !path.contains("keyword"))
        assertTrue("不应出现 village：$path", !path.contains("village"))
    }
}
