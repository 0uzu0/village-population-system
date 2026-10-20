package com.village.population.data.repository

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.village.population.BuildConfig
import com.village.population.data.remote.AppJson
import com.village.population.data.remote.dto.GitHubReleaseDto
import com.village.population.util.compareVersions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.GET
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * APK 下载走 gh-proxy 加速（国内直连 GitHub release 资产基本超时）。
 *
 * gh-proxy 的用法是「代理前缀 + 完整 GitHub URL」，用户指定的通道是
 * `https://v4.gh-proxy.org/https://github.com/0uzu0/village-population-system/releases/latest`。
 * releases/latest 本身是个 HTML 页面，直接拿它当 APK 下载必然失败；
 * 所以前缀套在 release 资产的真实地址（browser_download_url）上，
 * 落到同一条加速通道：
 * `https://v4.gh-proxy.org/https://github.com/.../releases/download/vX.Y.Z/village-app-X.Y.Z.apk`
 */
private const val DOWNLOAD_PROXY_PREFIX = "https://v4.gh-proxy.org/"

/**
 * 检查更新 + 下载安装 APK。
 *
 * 与 [com.village.population.data.remote.ApiClient] 刻意隔离：ApiClient 的
 * BaseUrlInterceptor 会把**所有**请求的 host 改写成用户配置的村级服务器地址、
 * AuthInterceptor 会塞 Bearer 头——GitHub 请求一个都不能带，否则永远打不到
 * api.github.com。所以这里单独建一套 OkHttp/Retrofit，baseUrl 固定
 * `https://api.github.com/`。
 */
class UpdateRepository(private val context: Context) {

    data class UpdateInfo(
        /** 去 v 前缀后的最新版本号，如 "1.0.4" */
        val version: String,
        val apkUrl: String,
        val fileName: String,
        val sizeBytes: Long,
    )

    private interface GitHubApi {
        @GET("repos/0uzu0/village-population-system/releases/latest")
        suspend fun latestRelease(): GitHubReleaseDto
    }

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            // GitHub API 强制要求 User-Agent 头，缺了直接 403
            chain.proceed(
                chain.request().newBuilder()
                    .header("User-Agent", "village-population-android")
                    .build(),
            )
        }
        .build()

    private val api: GitHubApi = Retrofit.Builder()
        .baseUrl("https://api.github.com/")
        .client(http)
        .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(GitHubApi::class.java)

    /**
     * 拉取最新 release，与本机版本比较。
     *
     * 有更新返回 [UpdateInfo]，没有返回 null；网络 / 解析错误向上抛，由调用方
     * 决定「提示给用户」还是「静默吞掉」（启动时的静默检查走后者）。
     */
    suspend fun checkForUpdate(): UpdateInfo? {
        val release = api.latestRelease()
        val latest = normalizeVersion(release.tag_name)
        val apk = release.assets.firstOrNull { asset ->
            asset.name.endsWith(".apk", ignoreCase = true) && asset.browser_download_url.isNotBlank()
        } ?: return null
        val current = normalizeVersion(BuildConfig.VERSION_NAME)
        if (latest.isBlank() || compareVersions(latest, current) <= 0) return null
        return UpdateInfo(
            version = latest,
            apkUrl = DOWNLOAD_PROXY_PREFIX + apk.browser_download_url,
            fileName = apk.name,
            sizeBytes = apk.size,
        )
    }

    /**
     * 下载 APK 到 `cacheDir/updates`，带进度回调。
     *
     * 先写 `.part` 再改名：中途断网不会在目录里留下半截 APK。
     * OkHttp 的 execute 是阻塞调用，这里切到 IO 线程跑，避免主线程网络异常。
     */
    suspend fun downloadApk(
        url: String,
        onProgress: (received: Long, total: Long) -> Unit = { _, _ -> },
    ): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates")
        if (!dir.exists() && !dir.mkdirs()) throw IOException("无法创建下载目录")
        val target = File(dir, "village-app.apk")
        val tmp = File(dir, "village-app.apk.part")

        val request = Request.Builder().url(url).build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("下载失败（HTTP ${response.code}）")
            val body = response.body ?: throw IOException("下载失败：响应为空")
            val total = body.contentLength()
            var received = 0L
            body.byteStream().use { input ->
                tmp.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                        received += read
                        onProgress(received, total)
                    }
                }
            }
        }

        if (target.exists()) target.delete()
        if (!tmp.renameTo(target)) {
            tmp.delete()
            throw IOException("APK 写入失败")
        }
        target
    }

    /**
     * 判断下载到的更新包与本机已安装版本**签名是否一致**。
     *
     * 为什么需要这一步：CI 在缺签名密钥时会降级用 debug 签名出包，
     * 而 debug 签名包与正式签名包**不能覆盖安装**（系统报「应用未安装」）。
     * 用户看到的现象就是「点了更新，装不上/以为更新崩了」，且完全不知道为什么。
     * 提前比对签名，就能在拉起安装器之前给出人话提示：需先卸载旧版。
     *
     * 取不到信息时返回 true（不阻断），让系统安装器按自己的规则处理——
     * 宁可走原来的路径，也不要因为这段辅助判断挡住一次正常的更新。
     */
    @Suppress("DEPRECATION")
    fun isSameSignature(apkFile: File): Boolean = runCatching {
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfo(apkFile.absolutePath, android.content.pm.PackageManager.GET_SIGNATURES)
            ?: return true
        val installed = pm.getPackageInfo(context.packageName, android.content.pm.PackageManager.GET_SIGNATURES)
        val archiveSigs = archive.signatures?.map { it.toCharsString() }?.toSet().orEmpty()
        val installedSigs = installed.signatures?.map { it.toCharsString() }?.toSet().orEmpty()
        if (archiveSigs.isEmpty() || installedSigs.isEmpty()) true else archiveSigs == installedSigs
    }.getOrDefault(true)

    /**
     * 拉起系统安装器安装 APK。
     *
     * Android 8+（API 26+）需要「安装未知应用」权限，没有时先跳系统设置引导授权，
     * 此时返回 false（表示「这次只是去开权限、还没真正安装」），调用方据此提示用户
     * 授权后重新检查更新。API 24/25 没有 canRequestPackageInstalls 这个方法，
     * 直接按「可以装」处理——旧系统上系统安装器会自行引导打开「未知来源」。
     */
    fun installApk(file: File): Boolean {
        val pm = context.packageManager
        val canInstall = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || pm.canRequestPackageInstalls()
        if (!canInstall) {
            openUnknownAppSourcesSettings()
            return false
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(intent) }
        return true
    }

    private fun openUnknownAppSourcesSettings() {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
    }

    private fun normalizeVersion(raw: String): String =
        raw.trim().removePrefix("v").removePrefix("V").substringBefore('-')
}
