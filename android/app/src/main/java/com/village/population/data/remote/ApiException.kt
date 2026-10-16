package com.village.population.data.remote

import retrofit2.HttpException
import java.io.IOException

/**
 * 统一的接口异常。
 *
 * 后端有两套错误表达方式，这里都收敛到同一个类型：
 *  - 业务失败：HTTP 200 + `{ code: 401, message: "账号或密码错误" }`
 *  - 未匹配路由 / 中间件拒绝：真正的 HTTP 4xx/5xx，体里同样有 code/message
 * 调用方只需要 catch 这一个异常、display 它的 message。
 */
class ApiException(
    val code: Int,
    val errorCode: String? = null,
    override val message: String,
    val httpStatus: Int? = null,
) : IOException(message) {

    /**
     * 登录态失效。注意继承的是 IOException —— 这样 ViewModel 里
     * 「网络异常」和「业务异常」的分支可以只判 is ApiException / is IOException。
     */
    val isUnauthorized: Boolean
        get() = httpStatus == 401 || code == 401 ||
            errorCode == "UNAUTHORIZED" || errorCode == "INVALID_CREDENTIALS"

    /** 账号被停用：提示与「密码错」要分开，否则用户会反复试密码 */
    val isAccountDisabled: Boolean get() = errorCode == "ACCOUNT_DISABLED"

    /** 是否值得重试（离线队列据此决定是否重投） */
    val retryable: Boolean
        get() = !isUnauthorized && !isAccountDisabled && (httpStatus == null || httpStatus >= 500)
}

/** 把真正的 HTTP 错误体解析成 ApiException（体里的中文提示比「HTTP 500」有用得多） */
internal fun HttpException.toApiException(decode: (String) -> String?): ApiException {
    val raw = runCatching { response()?.errorBody()?.string() }.getOrNull()
    val decoded = raw?.let { runCatching { decode(it) }.getOrNull() }
    return ApiException(
        code = code(),
        errorCode = null,
        message = decoded?.takeIf { it.isNotBlank() } ?: "请求失败（HTTP ${code()}）",
        httpStatus = code(),
    )
}
