package com.village.population.data.repository

import com.village.population.data.local.SessionState
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.dto.ChangePasswordRequest
import com.village.population.data.remote.dto.LoginRequest
import com.village.population.data.remote.dto.UserDto

class AuthRepository(
    private val api: ApiService,
    private val exec: ApiExecutor,
    private val session: SessionState,
) {

    /**
     * 登录。
     * 后端对登录做了限流（同 IP 每分钟 10 次），错误信息里会带重试秒数，
     * 这里不要覆盖它——「登录尝试过于频繁，请 47 秒后重试」比「登录失败」有用得多。
     */
    suspend fun login(username: String, password: String): UserDto {
        val result = exec.data { api.login(LoginRequest(username.trim(), password)) }
        session.save(result.token, result.user)
        return result.user
    }

    /** 刷新当前用户信息（权限可能在管理员那边改过） */
    suspend fun refreshMe(): UserDto {
        val user = exec.data { api.me() }
        session.updateUser(user)
        return user
    }

    suspend fun changePassword(oldPassword: String, newPassword: String) {
        val result = exec.data { api.changePassword(ChangePasswordRequest(oldPassword, newPassword)) }
        // 后端已作废本机旧 token，必须换上响应里这张新的，否则下一步就 401
        if (result.token.isNotBlank()) session.updateToken(result.token)
    }

    suspend fun logout() {
        session.clear()
    }
}
