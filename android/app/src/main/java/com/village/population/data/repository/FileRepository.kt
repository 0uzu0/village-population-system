package com.village.population.data.repository

import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.dto.FileDto
import com.village.population.data.remote.dto.PageData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * 附件仓库。
 *
 * 三个后端约束必须记住：
 *  1. 类型白名单只有 .pdf/.jpg/.jpeg/.png/.webp —— 客户端先挡一道，别让用户白等一次上传；
 *  2. 大小**不限制**（nginx 与后端都已放开），所以不要在这里加大小校验，
 *     否则就会出现「电脑能传、手机说太大」这种说不清的问题；
 *  3. 归属（bizType/bizId）与拍照时间（capturedAt）是**三个必填语义字段**，
 *     现场照片少了它们就等于没挂到人身上（见 upload 注释）。
 */
class FileRepository(
    private val api: ApiService,
    private val exec: ApiExecutor,
    /** 图片预览落盘目录。传 null 时 imageFile 退回临时文件 */
    private val imageCacheDir: File? = null,
) {

    /**
     * 进行中的下载，按附件 id 去重。
     *
     * 详情页的缩略图是 FlowRow（不是懒加载），进页面就会把这一屏的照片同时铺开；
     * 放大查看又会对同一张再要一次。没有这张表，同一张图会被重复拉两遍，
     * 在只有一两格信号的村里，这就是用户要多等的几十秒和双份流量。
     */
    private val inflight = ConcurrentHashMap<Int, Deferred<File>>()

    /**
     * 下载任务自己的作用域：**故意不挂在界面上**。
     * 用户翻走、Compose 把缩略图撤掉时，已经拉了一半的图仍然会落完盘，
     * 下次进来直接命中缓存；否则弱网下会出现「每次进详情页都从头再下一遍」。
     */
    private val downloadScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * 上传附件。
     *
     * `capturedAt` 用字符串 form 字段传秒级/毫秒级都行（后端两种都认），这里统一给毫秒。
     * 空值用空字符串而不是省略字段：Retrofit 的 `@Part` 一旦为 null 会直接抛异常，
     * 而「不传」在 multipart 里本来就等价于空串，后端把空串当作「没给」。
     */
    suspend fun upload(
        file: File,
        bizType: String? = null,
        bizId: Int? = null,
        capturedAt: Long? = null,
    ): FileDto {
        val mime = mimeOf(file.name)
        val part = MultipartBody.Part.createFormData(
            "file",
            file.name,
            file.asRequestBody(mime.toMediaType()),
        )
        return exec.data {
            api.uploadFile(
                file = part,
                bizType = (bizType ?: "").toRequestBody(TEXT_PLAIN),
                bizId = (bizId?.toString() ?: "").toRequestBody(TEXT_PLAIN),
                capturedAt = (capturedAt?.toString() ?: "").toRequestBody(TEXT_PLAIN),
            )
        }
    }

    /** 某个人员 / 台账名下的附件。人员详情的「现场照片」区走这里 */
    suspend fun list(bizType: String, bizId: Int, pageSize: Int = 100): PageData<FileDto> =
        exec.page { api.files(bizType = bizType, bizId = bizId, pageSize = pageSize) }

    /**
     * 删除附件。
     *
     * 注意这是**不可逆**的：后端删库记录的同时会把磁盘上的物理文件删掉，
     * 既不能在界面上找回，也去不了服务器目录里捞。所以调用方必须先拿到用户确认。
     */
    suspend fun remove(id: Int) {
        exec.run { api.deleteFile(id) }
    }

    /**
     * 取回一张图片并落到本地缓存文件，返回该文件供 Coil 直接渲染。
     *
     * 三件事必须一起做，少一件现场就会「卡住 / 闪退」——修复前正是缺了它们：
     *
     *  1. **全程在 IO 线程**。调用方是 Compose 的 `produceState`，它跑在组合的协程
     *     上下文里，也就是**主线程**。`/files/:id` 是 `@Streaming`，读响应体是同步
     *     阻塞的，于是一张 5MB 的照片在弱网下能把主线程堵十几秒，界面完全不动；
     *     FlowRow 里几张同时开始，就排队堵几十秒 —— 用户看到的是「卡住」，
     *     再往下就是 ANR 被系统杀掉（「闪退」）。
     *
     *  2. **流式落盘，不经过 ByteArray**。原来先 `bytes()` 读成数组再写文件，
     *     等于整张原图在堆里待一份、写入缓冲再一份；照片区是同时开始的，
     *     二十张就上百 MB，低端机直接 OOM。
     *
     *  3. **落盘前后都校验**。中途断网、或服务端回了张错误页，都会变成一个永远
     *     解不出来的 `file-x.jpg`；而「命中缓存就直接返回」意味着它会被一直用下去，
     *     表现为「这张照片永远打不开」。所以先写 .part、校验通过再改名，
     *     非图片内容直接丢弃，让下次点击能重新下。
     *
     * 为什么落盘而不是把字节交给 Coil：盘上有文件 = 进过村没信号时，看过的照片
     * 还能再打开；Coil 对 File 的识别也最直接。照片按 id 不可变，命中即用。
     */
    suspend fun imageFile(id: Int): File = withContext(Dispatchers.IO) {
        if (id <= 0) throw IOException("无效的附件 id: $id")
        cachedFile(id)?.let { return@withContext it }

        val task = inflight.computeIfAbsent(id) { key ->
            // 这里用默认的 Dispatched 启动：任务体不会在 computeIfAbsent 的锁内执行，
            // 它 finally 里的 inflight.remove 才不会变成「锁内递归改同一个 map」
            downloadScope.async {
                try {
                    fetchToCache(id)
                } finally {
                    inflight.remove(key)
                }
            }
        }
        // await() 被取消（界面撤掉）不会取消下载本身：任务在 downloadScope 里跑完并落盘
        task.await()
    }

    private fun cachedFile(id: Int): File? {
        val dir = imageCacheDir ?: return null
        val cached = File(dir, fileNameOf(id))
        if (!cached.exists() || cached.length() <= 0) return null
        // 命中也要验一次文件头：v2.2.2 之前缓存的是「先 bytes() 再写」，中途断网会留下
        // 半张图；更早还有把服务端错误页存成 .jpg 的可能。这类文件 Coil 永远解不出来，
        // 而命中就返回意味着它再也不会被重新下载——现象就是「这张照片永远打不开」。
        // 删掉重下即可自愈，代价只是每张图多读 12 个字节。
        if (!looksLikeImage(cached)) {
            cached.delete()
            return null
        }
        return cached
    }

    private fun fileNameOf(id: Int): String = "file-$id.jpg"

    private suspend fun fetchToCache(id: Int): File {
        val dir = imageCacheDir
        if (dir == null) {
            // 没配缓存目录（异常装配 / 单测）：退回临时文件，仍然流式写盘
            val target = File.createTempFile("img-$id-", ".jpg")
            writeAtomically(target, id)
            return target
        }
        if (!dir.exists() && !dir.mkdirs()) throw IOException("图片缓存目录创建失败")
        val target = File(dir, fileNameOf(id))
        // 上次中断留下的 .part 只可能是残缺的，先清掉
        File(dir, "${fileNameOf(id)}.part").delete()
        writeAtomically(target, id)
        pruneCache(dir)
        return target
    }

    /**
     * 边下边写，只有校验通过才改名成正式文件名。
     * 先写 `.part` 再 rename 的原因：中途断网不会在缓存里留下一张半截图
     * （半张图会让 Coil 一直解不出来）。
     */
    private suspend fun writeAtomically(target: File, id: Int) {
        val tmp = File(target.parentFile, "${target.name}.part")
        try {
            exec.stream({ api.downloadFile(id) }) { body ->
                body.byteStream().use { input ->
                    tmp.outputStream().use { out -> input.copyTo(out, COPY_BUFFER) }
                }
            }
            if (tmp.length() <= 0L) throw IOException("图片内容为空")
            if (!looksLikeImage(tmp)) throw IOException("返回的内容不是图片")
            if (target.exists() && !target.delete()) throw IOException("旧缓存清理失败")
            if (!tmp.renameTo(target)) throw IOException("图片缓存写入失败")
        } catch (e: Throwable) {
            // 任何失败都不留残骸：留着就会变成一张「永远打不开、又永远命中缓存」的图
            tmp.delete()
            throw e
        }
    }

    /**
     * 缓存目录按**文件数**封顶，超了删最旧的。
     *
     * 照片按 id 不可变，删掉只是下次重下，不会读错；但不管的话，一个村反复拍照
     * 几个月就能把 cacheDir 撑到几百 MB（系统清理缓存是整目录清空，
     * 届时正在写的文件也可能被一起收走）。
     */
    private fun pruneCache(dir: File) {
        val files = dir.listFiles()?.filter { it.isFile && it.name.endsWith(".jpg") } ?: return
        if (files.size <= MAX_CACHED_PHOTOS) return
        files.sortedBy { it.lastModified() }
            .take(files.size - MAX_CACHED_PHOTOS)
            .forEach { it.delete() }
    }

    companion object {
        private val TEXT_PLAIN = "text/plain".toMediaType()

        /** 单次从响应体搬运的字节数。缓冲太小会在弱网下放大系统调用次数 */
        private const val COPY_BUFFER = 64 * 1024

        /** 图片缓存条目上限。按单张 3–8MB 估，150 张约 0.5–1GB，够覆盖一个村的现场照片 */
        private const val MAX_CACHED_PHOTOS = 150

        val ALLOWED_EXTENSIONS = setOf(".pdf", ".jpg", ".jpeg", ".png", ".webp")

        fun isAllowed(name: String): Boolean =
            ALLOWED_EXTENSIONS.any { name.endsWith(it, ignoreCase = true) }

        fun mimeOf(name: String): String = when {
            name.endsWith(".pdf", true) -> "application/pdf"
            name.endsWith(".png", true) -> "image/png"
            name.endsWith(".webp", true) -> "image/webp"
            else -> "image/jpeg"
        }

        /**
         * 只认白名单里的三种图片格式（后端上传白名单也只有这三种）。
         *
         * 只读文件头几个字节，不解析整张图。用途是拦住「服务端回了 HTML 错误页 /
         * JSON 报错」这类**状态码是 200 但内容不是图**的情况——它们要是被当成
         * 图片存进缓存，Coil 每次都会解码失败，而缓存命中又不会再重下，
         * 于是一张错误的图会永远显示不出来。
         */
        internal fun looksLikeImage(file: File): Boolean {
            val head = ByteArray(12)
            val read = file.inputStream().use { it.read(head) }
            if (read < 4) return false
            val jpeg = read >= 3 &&
                head[0] == 0xFF.toByte() && head[1] == 0xD8.toByte() && head[2] == 0xFF.toByte()
            val png = read >= 8 &&
                head[0] == 0x89.toByte() && head[1] == 'P'.code.toByte() &&
                head[2] == 'N'.code.toByte() && head[3] == 'G'.code.toByte()
            val webp = read >= 12 &&
                String(head, 0, 4) == "RIFF" && String(head, 8, 4) == "WEBP"
            return jpeg || png || webp
        }
    }
}
