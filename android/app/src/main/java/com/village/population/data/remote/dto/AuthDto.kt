package com.village.population.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
)

@Serializable
data class LoginResponse(
    val token: String = "",
    val user: UserDto = UserDto(),
)

/**
 * 登录用户。`permissions` 是后端算好的权限码集合（如 `person:view`、`ledger:manage`），
 * 移动端据此决定按钮显不显示——注意这只是「少给用户看一眼」，真正的拦截在后端，
 * 客户端不能用它当安全边界。
 */
@Serializable
data class UserDto(
    val id: Int = 0,
    val username: String = "",
    val realName: String? = null,
    val isAdmin: Boolean = false,
    val roles: List<String> = emptyList(),
    val permissions: List<String> = emptyList(),
) {
    val displayName: String get() = realName?.takeIf { it.isNotBlank() } ?: username

    /** 管理员默认拥有一切权限，与后端 loadAuthContext 的口径一致 */
    fun can(permission: String): Boolean = isAdmin || permissions.contains(permission)
}

@Serializable
data class ChangePasswordRequest(
    val oldPassword: String,
    val newPassword: String,
)
