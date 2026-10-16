package com.village.population.data.repository

import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.dto.FileDto
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

/**
 * 附件仓库。
 *
 * 两个后端约束必须记住：
 *  1. 类型白名单只有 .pdf/.jpg/.jpeg/.png/.webp —— 客户端先挡一道，别让用户白等一次上传；
 *  2. 大小**不限制**（nginx 与后端都已放开），所以不要在这里加大小校验，
 *     否则就会出现「电脑能传、手机说太大」这种说不清的问题。
 */
class FileRepository(
    private val api: ApiService,
    private val exec: ApiExecutor,
) {

    suspend fun upload(file: File, bizType: String? = null, bizId: Int? = null): FileDto {
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
            )
        }
    }

    /**
     * 下载附件字节。
     * 不能把 `/files/:id` 直接丢给图片控件——那个接口要 Bearer 头，直链必然 401。
     * 必须先取回字节再交给图片框架渲染。
     */
    suspend fun download(id: Int): ByteArray =
        exec.download { api.downloadFile(id) }

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
