package com.village.population.data.local.queue

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

/** 队列里一条待同步的写操作 */
@Serializable
data class QueuedOp(
    val id: String = UUID.randomUUID().toString(),
    /** 见 [OpType] */
    val type: String,
    /** 与 type 对应的请求体 JSON。重放时原样发送，不在客户端做二次加工 */
    val payload: String = "{}",
    /** 展示给用户的一句话，如「新增人员 张三」「上传现场照片」 */
    val label: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val attempts: Int = 0,
    val lastError: String? = null,
    /** 待上传的本地文件绝对路径（拍照留痕）。上传成功后删除 */
    val localFile: String? = null,
    /** 关联的业务 id（如人员 id），用于上传成功后回填 */
    val refId: Int? = null,
) {
    val exhausted: Boolean get() = attempts >= MAX_ATTEMPTS

    companion object {
        /** 重试到这个次数就不再自动重试，留在列表里等用户手动处理或删除 */
        const val MAX_ATTEMPTS = 5
    }
}

/** 支持的离线操作类型。新增一种操作 = 加一个常量 + 在 SyncWorker 里加一个分支 */
object OpType {
    const val CREATE_PERSON = "CREATE_PERSON"
    const val UPDATE_PERSON = "UPDATE_PERSON"
    const val ADD_PERSON_TAG = "ADD_PERSON_TAG"
    const val CREATE_LEDGER = "CREATE_LEDGER"
    const val PENDING_IGNORE = "PENDING_IGNORE"
    const val PENDING_CONFIRM = "PENDING_CONFIRM"
    const val UPLOAD_FILE = "UPLOAD_FILE"
}

/**
 * 离线写队列（一条操作一个 JSON 文件）。
 *
 * 为什么用文件而不是数据库：队列通常只有个位数到几十条，文件读写足够，
 * 而且「一条操作一个文件」天然让「删除某条」变成一次 unlink，不需要事务。
 * 每条独立文件也意味着某一条写坏了不会拖垮整个队列。
 */
class OfflineQueue(private val dir: File, private val json: Json) {

    private val _size = MutableStateFlow(0)

    /**
     * 队列长度，供界面显示「N 条待同步」徽标。
     * 做成 StateFlow 而不是每次 count()：底栏徽标要能随入队/同步实时变化，
     * 否则用户会看到「明明存了却没提示」。
     */
    val size: StateFlow<Int> = _size.asStateFlow()

    private fun ensureDir() {
        if (!dir.exists()) dir.mkdirs()
    }

    private fun fileOf(id: String) = File(dir, "$id.json")

    /** 启动时调一次，把磁盘上的实际条数装载进 StateFlow */
    fun refreshSize() {
        _size.value = all().size
    }

    /** 按入队时间升序（先进先出）。同一条路上先采的人先入库，避免出现引用不存在的家庭 */
    fun all(): List<QueuedOp> {
        ensureDir()
        return dir.listFiles { f -> f.isFile && f.name.endsWith(".json") }
            ?.mapNotNull { file ->
                runCatching { json.decodeFromString(QueuedOp.serializer(), file.readText()) }.getOrNull()
            }
            ?.sortedBy { it.createdAt }
            ?: emptyList()
    }

    fun enqueue(op: QueuedOp) {
        ensureDir()
        fileOf(op.id).writeText(json.encodeToString(QueuedOp.serializer(), op))
        _size.value = all().size
    }

    fun update(op: QueuedOp) {
        ensureDir()
        fileOf(op.id).writeText(json.encodeToString(QueuedOp.serializer(), op))
    }

    fun remove(id: String) {
        fileOf(id).delete()
        _size.value = all().size
    }

    /** 本地暂存文件也一并删除，避免拍了几十张照片最后占满存储 */
    fun removeWithFile(op: QueuedOp) {
        op.localFile?.let { runCatching { File(it).delete() } }
        remove(op.id)
    }

    fun count(): Int = all().size

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
        _size.value = 0
    }
}
