package com.village.population.data.local.queue

import com.village.population.data.remote.AppJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

class OfflineQueueTest {

    private lateinit var dir: File
    private lateinit var queue: OfflineQueue

    @Before
    fun setUp() {
        dir = Files.createTempDirectory("offline-queue-test").toFile()
        queue = OfflineQueue(dir, AppJson)
    }

    private fun op(label: String, createdAt: Long, type: String = OpType.CREATE_PERSON) =
        QueuedOp(
            id = "op-$label",
            type = type,
            payload = """{"name":"$label"}""",
            label = label,
            createdAt = createdAt,
        )

    @Test
    fun `入队后可读回并按入队时间先进先出`() {
        queue.enqueue(op("c", 3000))
        queue.enqueue(op("a", 1000))
        queue.enqueue(op("b", 2000))

        // 先进先出很重要：同一条走访路线上先采的人要先入库，
        // 否则后建的人可能引用到还没创建的家庭
        assertEquals(listOf("a", "b", "c"), queue.all().map { it.label })
    }

    @Test
    fun `队列长度StateFlow随入队与移除变化`() {
        queue.refreshSize()
        assertEquals(0, queue.size.value)

        queue.enqueue(op("a", 1000))
        queue.enqueue(op("b", 2000))
        assertEquals(2, queue.size.value)

        queue.remove("op-a")
        assertEquals(1, queue.size.value)

        queue.clear()
        assertEquals(0, queue.size.value)
    }

    @Test
    fun `重试计数与错误信息会被持久化`() {
        val original = op("a", 1000)
        queue.enqueue(original)
        queue.update(original.copy(attempts = 3, lastError = "身份证号码校验位错误"))

        val reloaded = queue.all().single()
        assertEquals(3, reloaded.attempts)
        assertEquals("身份证号码校验位错误", reloaded.lastError)
    }

    @Test
    fun `重试到上限即视为到底_不再自动重试`() {
        val op = op("a", 1000)
        assertTrue(!op.copy(attempts = QueuedOp.MAX_ATTEMPTS - 1).exhausted)
        assertTrue(op.copy(attempts = QueuedOp.MAX_ATTEMPTS).exhausted)
    }

    @Test
    fun `删除时会连带清掉本地暂存文件`() {
        val photo = File(dir, "photo.jpg").apply { writeText("fake-image") }
        val op = op("a", 1000).copy(localFile = photo.absolutePath, type = OpType.UPLOAD_FILE)
        queue.enqueue(op)

        queue.removeWithFile(op)

        assertEquals(0, queue.all().size)
        assertTrue("照片文件应被一并删除，否则会占满存储", !photo.exists())
    }

    @Test
    fun `损坏的队列文件被跳过而不是让整个队列读不出来`() {
        queue.enqueue(op("good", 1000))
        File(dir, "broken.json").writeText("{ 这不是合法 JSON")

        val all = queue.all()
        assertEquals(1, all.size)
        assertEquals("good", all.single().label)
    }

    @Test
    fun `未知类型的操作仍可入队_由重放层决定如何处理`() {
        val op = op("x", 1000, type = "SOMETHING_FROM_THE_FUTURE")
        queue.enqueue(op)
        val reloaded = queue.all().single()
        assertEquals("SOMETHING_FROM_THE_FUTURE", reloaded.type)
        assertNull(reloaded.lastError)
    }
}
