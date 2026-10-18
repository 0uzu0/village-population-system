package com.village.population.data.repository

import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.AppJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.File

/**
 * 现场照片取图链路（真实 Retrofit + 真实 HTTP 服务端 + 真实磁盘）。
 *
 * 这组用例钉的是**在真机上闹过事的四个行为**，都不是编译期能看出来的：
 *
 *  1. 下载必须落盘、且内容逐字节一致。原来先 `bytes()` 读成数组再写文件，
 *     现在改成边下边写——写错一个字节就是「照片打不开」，而现场照片是
 *     入户核查的证据，不能靠肉眼觉得「好像能显示」。
 *  2. 同一张并发请求只能发一次。详情页进页面就同时铺开所有缩略图，
 *     放大查看又来一次；重复下载在村里就是成倍的等待和流量。
 *  3. **不落盘的失败要真的不留痕**。断网、或服务端回了个 HTML 错误页
 *     （状态码 200、内容不是图），如果被当成图片缓存下来，
 *     「命中缓存就直接返回」会让这张照片永远打不开，且永远不再重下。
 *     这里连「失败之后能不能重试成功」一起断言。
 *  4. 空响应体不能当成图片存起来（0 字节文件只会让 Coil 一直解码失败）。
 */
class FileRepositoryTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var repo: FileRepository

    /** 最小的合法 JPEG 头，够让内容校验通过（不解析整张图） */
    private val jpegBytes = byteArrayOf(
        0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(),
        0x00.toByte(), 0x10.toByte(), 0x4A.toByte(), 0x46.toByte(),
        0x49.toByte(), 0x46.toByte(), 0x00.toByte(), 0x01.toByte(),
        0x01.toByte(), 0x02.toByte(), 0x03.toByte(), 0x04.toByte(),
    )

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        cacheDir = tmp.newFolder("photos")
        val api: ApiService = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)
        repo = FileRepository(api, ApiExecutor(AppJson) { }, cacheDir)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun enqueueBytes(bytes: ByteArray, contentType: String = "image/jpeg") {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", contentType)
                .setBody(Buffer().write(bytes))
        )
    }

    @Test
    fun `下载后落盘且内容逐字节一致`() = runTest {
        enqueueBytes(jpegBytes)

        val file = repo.imageFile(7)

        assertTrue("缓存文件应存在", file.exists())
        assertEquals("缓存文件名按 id 固定", "file-7.jpg", file.name)
        assertArrayEquals(jpegBytes, file.readBytes())
    }

    @Test
    fun `第二次调用命中缓存不再发请求`() = runTest {
        enqueueBytes(jpegBytes)

        val first = repo.imageFile(7)
        val second = repo.imageFile(7)

        assertEquals("同一张图只应下载一次", 1, server.requestCount)
        assertEquals(first.absolutePath, second.absolutePath)
    }

    @Test
    fun `同一张照片并发请求只发一次`() = runTest {
        // 备两份响应：万一去重失效真的发了第二个请求，让它拿到响应而不是一直挂着，
        // 这样失败会落在下面的 requestCount 断言上，而不是把用例拖到超时
        enqueueBytes(jpegBytes)
        enqueueBytes(jpegBytes)
        val files = coroutineScope {
            (1..5).map { async(Dispatchers.Default) { repo.imageFile(11) } }.awaitAll()
        }

        assertEquals("并发取同一张只应发一次请求", 1, server.requestCount)
        assertTrue("五个调用方拿到同一个缓存文件", files.all { it == files.first() })
        assertArrayEquals(jpegBytes, files.first().readBytes())
    }

    @Test
    fun `返回的不是图片时不留缓存_并且之后能重试成功`() = runTest {
        // 服务端 200 但回了个 HTML 错误页（nginx 502 兜底页就长这样）
        enqueueBytes("<html><body>502 Bad Gateway</body></html>".toByteArray(), "text/html")
        var failed = false
        try {
            repo.imageFile(12)
        } catch (e: Exception) {
            failed = true
        }

        assertTrue("非图片内容必须当失败抛出", failed)
        assertFalse("不能留下一个永远打不开的缓存文件", File(cacheDir, "file-12.jpg").exists())
        assertEquals("也不能留下 .part 残骸", 0, cacheDir.listFiles()?.size ?: 0)

        // 关键：失败不能把这个 id 弄成「永久坏掉」，下一次必须还能正常取到
        enqueueBytes(jpegBytes)
        val retried = repo.imageFile(12)
        assertArrayEquals(jpegBytes, retried.readBytes())
    }

    @Test
    fun `空响应体不写缓存`() = runTest {
        enqueueBytes(ByteArray(0))

        var failed = false
        try {
            repo.imageFile(13)
        } catch (e: Exception) {
            failed = true
        }

        assertTrue("空内容必须是失败，不能被当成 0 字节图片", failed)
        assertEquals("空响应不能留下文件", 0, cacheDir.listFiles()?.size ?: 0)
    }

    @Test
    fun `缓存已存在时零请求`() = runTest {
        val cached = File(cacheDir, "file-21.jpg")
        cached.writeBytes(jpegBytes)

        val file = repo.imageFile(21)

        assertEquals("命中缓存不该发请求", 0, server.requestCount)
        assertEquals(cached.absolutePath, file.absolutePath)
    }

    @Test
    fun `缓存里是坏文件时自动丢弃并重下`() = runTest {
        // 模拟旧版本留下的残骸：中途断网写了一半、或把服务端错误页存成了 .jpg。
        // 这种文件 Coil 永远解不出来，而「命中缓存就返回」会让它再也不会被重下，
        // 现象就是用户说的「这张照片永远打不开」。
        File(cacheDir, "file-22.jpg").writeText("<html>502 Bad Gateway</html>")
        enqueueBytes(jpegBytes)

        val file = repo.imageFile(22)

        assertEquals("坏缓存应触发一次重新下载", 1, server.requestCount)
        assertArrayEquals("重下后内容必须是真图", jpegBytes, file.readBytes())
    }

    @Test
    fun `无效 id 直接失败且不发请求`() = runTest {
        var failed = false
        try {
            repo.imageFile(0)
        } catch (e: Exception) {
            failed = true
        }

        assertTrue("id <= 0 应直接失败", failed)
        assertEquals("不发无意义的请求", 0, server.requestCount)
    }

    @Test
    fun `大图流式落盘不截断`() = runTest {
        // 4MB：流式写盘一旦把缓冲区当成整份内容，这里就会短一截
        val big = ByteArray(4 * 1024 * 1024)
        jpegBytes.copyInto(big)
        enqueueBytes(big)

        val file = repo.imageFile(31)

        assertEquals("落盘长度必须与响应体一致", big.size.toLong(), file.length())
    }

    @Test
    fun `内容校验只认白名单格式`() {
        val cases = mapOf(
            "jpeg" to byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0, 0, 0, 0),
            "png" to byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A),
            "webp" to "RIFF1234WEBPVP8 ".toByteArray(),
            "html" to "<html><body>404</body></html>".toByteArray(),
            "json" to """{"code":500,"message":"服务器内部错误"}""".toByteArray(),
        )
        for ((name, bytes) in cases) {
            val f = tmp.newFile("probe-$name.bin")
            f.writeBytes(bytes)
            val expected = name in setOf("jpeg", "png", "webp")
            assertEquals("$name 的识别结果", expected, FileRepository.looksLikeImage(f))
        }
        // 不足 4 字节的一律不认
        val tiny = tmp.newFile("tiny.bin")
        tiny.writeBytes(byteArrayOf(0xFF.toByte(), 0xD8.toByte()))
        assertFalse("过短的内容不认", FileRepository.looksLikeImage(tiny))
    }

    @Test
    fun `没有缓存目录时退回临时文件`() = runTest {
        val api: ApiService = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)
        val noCacheRepo = FileRepository(api, ApiExecutor(AppJson) { }, null)
        enqueueBytes(jpegBytes)

        val file = noCacheRepo.imageFile(41)

        assertNotNull(file)
        assertTrue(file.exists())
        assertArrayEquals(jpegBytes, file.readBytes())
        file.delete()
    }
}
