package com.village.population.data.remote

import com.village.population.data.remote.dto.ApiEnvelope
import com.village.population.data.remote.dto.PageData
import com.village.population.data.remote.dto.SimpleListData
import com.village.population.data.remote.dto.VoidEnvelope
import kotlinx.serialization.json.Json
import okhttp3.ResponseBody
import retrofit2.HttpException
import java.io.IOException

/**
 * 接口调用的统一出口。
 *
 * 存在的意义是把三件容易写漏的事收敛到一处：
 *  1. `code != 0` 要当失败抛异常（很多人只 catch 了 HTTP 异常，于是
 *     「账号或密码错误」这种 200 包着的业务错误被当成成功，页面莫名其妙是空的）；
 *  2. 真正的 HTTP 4xx/5xx 要把后端的中文 message 解出来，而不是抛「HTTP 500」；
 *  3. 401 要触发一次统一的登出。
 */
class ApiExecutor(
    private val json: Json,
    private val onUnauthorized: (String) -> Unit,
) {

    /** 期望返回一个对象（详情、登录结果…） */
    suspend fun <T> data(block: suspend () -> ApiEnvelope<T>): T {
        val env = guarded(block)
        ensureOk(env.code, env.errorCode, env.message)
        return env.data ?: throw ApiException(env.code, env.errorCode, "服务端未返回数据")
    }

    /** 期望返回分页对象 */
    suspend fun <T> page(block: suspend () -> ApiEnvelope<PageData<T>>): PageData<T> {
        val env = guarded(block)
        ensureOk(env.code, env.errorCode, env.message)
        return env.data ?: PageData()
    }

    /** 期望返回 `{ list, total }`（村庄列表这类没有分页字段的接口） */
    suspend fun <T> simpleList(block: suspend () -> ApiEnvelope<SimpleListData<T>>): List<T> {
        val env = guarded(block)
        ensureOk(env.code, env.errorCode, env.message)
        return env.data?.list ?: emptyList()
    }

    /** 不关心返回体，只要求成功（改密码、打标签、忽略…） */
    suspend fun run(block: suspend () -> VoidEnvelope) {
        val env = guarded(block)
        ensureOk(env.code, env.errorCode, env.message)
    }

    /**
     * 下载二进制（附件）。走的是同一个鉴权拦截器，
     * 所以拿到的不是「一个能直接给图片控件用的 URL」，而是字节——
     * `/files/:id` 需要 Authorization 头，直链一定 401。
     */
    suspend fun download(block: suspend () -> ResponseBody): ByteArray {
        val body = guarded(block)
        return body.use { it.bytes() }
    }

    private suspend fun <R> guarded(block: suspend () -> R): R =
        try {
            block()
        } catch (e: HttpException) {
            // 真正的 HTTP 错误：把体里的 message 解出来再抛
            throw e.toApiException { raw ->
                runCatching { json.decodeFromString(VoidEnvelope.serializer(), raw).message }.getOrNull()
            }.also { if (it.isUnauthorized) onUnauthorized(it.message) }
        } catch (e: IOException) {
            // 网络层异常（连不上、超时、DNS）原样抛出，由上层翻译成「网络不可用」
            throw e
        }

    private fun ensureOk(code: Int, errorCode: String?, message: String) {
        if (code == 0) return
        val ex = ApiException(
            code = code,
            errorCode = errorCode,
            message = message.takeIf { it.isNotBlank() } ?: "请求失败（$code）",
            // 后端 fail() 会把 HTTP 状态码写进 code，>=400 时按 HTTP 错误理解
            httpStatus = code.takeIf { it >= 400 },
        )
        if (ex.isUnauthorized) onUnauthorized(ex.message)
        throw ex
    }
}
