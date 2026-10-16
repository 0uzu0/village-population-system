package com.village.population.util

import com.village.population.data.remote.ApiException
import java.io.IOException

/**
 * 把异常翻译成能直接给网格员看的句子。
 *
 * 原则：宁可说「网络不可用，请检查服务器地址」，也不要把
 * "Expected URL scheme 'http' or 'https'" 这种英文栈信息甩给用户。
 */
fun Throwable.toUserMessage(): String = when (this) {
    is ApiException -> message.orEmpty().ifBlank { "操作失败" }
    is IOException -> "网络不可用，请检查网络或服务器地址"
    else -> message?.takeIf { it.isNotBlank() } ?: "操作失败"
}

/** 是否属于「可以稍后重试」的情况（网络问题），用于提示「已暂存，联网后自动上传」 */
fun Throwable.isNetworkProblem(): Boolean = this is IOException && this !is ApiException
