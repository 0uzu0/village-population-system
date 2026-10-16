package com.village.population.data.repository

import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.dto.FileDto
import com.village.population.data.remote.dto.PageData
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

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
    /** 图片预览落盘目录。传 null 时 downloadToCache 会退回内存字节 */
    private val imageCacheDir: File? = null,
) {

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
     * 下载附件字节。
     * 不能把 `/files/:id` 直接丢给图片控件——那个接口要 Bearer 头，直链必然 401。
     * 必须先取回字节再交给图片框架渲染。
     */
    suspend fun download(id: Int): ByteArray =
        exec.download { api.downloadFile(id) }

    /**
     * 取回一张图片并落到本地缓存文件，返回该文件供 Coil 直接渲染。
     *
     * 为什么要落盘而不是把 ByteArray 交给 Coil：
     *  · 盘上有文件 = 进过村没信号时，看过的照片还能再打开；
     *  · Coil 对 File 的识别最直接（ByteArray 要靠嗅探头部字节推断格式）。
     * 照片按 id 不可变，所以文件名固定、命中即用，不需要考虑失效。
     */
    suspend fun imageFile(id: Int): File {
        val dir = imageCacheDir
        if (dir != null) {
            if (!dir.exists()) dir.mkdirs()
            val cached = File(dir, "file-$id.jpg")
            if (cached.exists() && cached.length() > 0) return cached
        }
        val bytes = download(id)
        val target = if (dir != null) File(dir, "file-$id.jpg") else File.createTempFile("img-$id-", ".jpg")
        // 先写 .part 再改名：中途断网不会在缓存里留下一张半截图（半张图会让 Coil 一直解不出来）
        val tmp = File(target.parentFile, "${target.name}.part")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(target)) {
            tmp.delete()
            throw java.io.IOException("图片缓存写入失败")
        }
        return target
    }

    companion object {
        private val TEXT_PLAIN = "text/plain".toMediaType()

        val ALLOWED_EXTENSIONS = setOf(".pdf", ".jpg", ".jpeg", ".png", ".webp")

        fun isAllowed(name: String): Boolean =
            ALLOWED_EXTENSIONS.any { name.endsWith(it, ignoreCase = true) }

        fun mimeOf(name: String): String = when {
            name.endsWith(".pdf", true) -> "application/pdf"
            name.endsWith(".png", true) -> "image/png"
            name.endsWith(".webp", true) -> "image/webp"
            else -> "image/jpeg"
        }
    }
}
