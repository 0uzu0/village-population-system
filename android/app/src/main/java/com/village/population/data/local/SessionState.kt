package com.village.population.data.local

import com.village.population.data.remote.AppJson
import com.village.population.data.remote.dto.UserDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first

/**
 * 当前登录态。
 *
 * 为什么要在内存里再存一份 token？
 * 因为 OkHttp 的拦截器是**同步**执行的，没法在里面 `suspend` 去读 DataStore。
 * 所以：DataStore 是持久层，内存字段是拦截器读的那一份，两边在 restore/save/clear 时同步。
 *
 * 顺带解决了另一个问题：401 的统一处理。任意一个接口发现登录态失效都会调 [notifyExpired]，
 * 由 UI 层消费一次（消费后清标记），避免「并发请求全部 401 导致连弹十个提示、反复跳登录页」。
 */
class SessionState(private val store: SettingsStore) {

    @Volatile
    private var tokenValue: String? = null

    @Volatile
    private var userValue: UserDto? = null

    private val _user = MutableStateFlow<UserDto?>(null)
    val user: StateFlow<UserDto?> = _user.asStateFlow()

    private val _signedIn = MutableStateFlow(false)
    val signedIn: StateFlow<Boolean> = _signedIn.asStateFlow()

    private val _expiredReason = MutableStateFlow<String?>(null)
    val expiredReason: StateFlow<String?> = _expiredReason.asStateFlow()

    /** 供 OkHttp 拦截器同步读取 */
    fun token(): String? = tokenValue

    fun currentUser(): UserDto? = userValue

    fun can(permission: String): Boolean = userValue?.can(permission) ?: false

    /** 冷启动时调用一次：把持久化的登录态装载进内存 */
    suspend fun restore() {
        val token = store.tokenFlow.first()
        val userJson = store.userJsonFlow.first()
        tokenValue = token
        userValue = userJson?.let { runCatching { AppJson.decodeFromString(UserDto.serializer(), it) }.getOrNull() }
        _user.value = userValue
        _signedIn.value = !token.isNullOrBlank()
    }

    suspend fun save(token: String, user: UserDto) {
        tokenValue = token
        userValue = user
        _user.value = user
        _signedIn.value = true
        _expiredReason.value = null
        store.saveSession(token, AppJson.encodeToString(UserDto.serializer(), user))
    }

    /** 更新用户信息（如改完密码后刷新 /auth/me），不动 token */
    suspend fun updateUser(user: UserDto) {
        userValue = user
        _user.value = user
        store.saveSession(tokenValue.orEmpty(), AppJson.encodeToString(UserDto.serializer(), user))
    }

    /**
     * 只换 token（改密码后服务端换发）。
     *
     * 后端改密时会把该用户所有旧 token 作废，只有本次响应里的这张有效；
     * 不回存的话下一次请求就 401，用户会以为「改完密码就被登出了」。
     */
    suspend fun updateToken(token: String) {
        tokenValue = token
        val json = userValue?.let { AppJson.encodeToString(UserDto.serializer(), it) } ?: return
        store.saveSession(token, json)
    }

    /** 主动登出 */
    suspend fun clear() {
        tokenValue = null
        userValue = null
        _user.value = null
        _signedIn.value = false
        _expiredReason.value = null
        store.clearSession()
    }

    /**
     * 登录态失效（401）。
     * 这里只**标记**不直接清：清 token 是不可逆操作，交给 UI 层确认后再做，
     * 万一是服务端配置临时出错（比如换了 JWT 密钥重启），用户重启应用还能回到原状态。
     */
    fun notifyExpired(reason: String) {
        if (_expiredReason.value == null) _expiredReason.value = reason
    }

    fun consumeExpiredReason(): String? {
        val reason = _expiredReason.value
        _expiredReason.value = null
        return reason
    }
}
