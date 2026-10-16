package com.village.population.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * GitHub「最新 release」的响应模型。
 *
 * GitHub 实际返回的字段有几十个，这里只声明「检查更新」会用到的那几个，
 * 其余字段靠 AppJson 的 ignoreUnknownKeys 忽略。字段名沿用 GitHub 的
 * snake_case（`tag_name` / `browser_download_url`），省去 @SerialName 注解。
 */
@Serializable
data class GitHubReleaseDto(
    val tag_name: String = "",
    val assets: List<GitHubAssetDto> = emptyList(),
)

@Serializable
data class GitHubAssetDto(
    val name: String = "",
    val browser_download_url: String = "",
    val size: Long = 0,
)
