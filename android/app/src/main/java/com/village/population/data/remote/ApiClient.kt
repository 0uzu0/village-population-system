package com.village.population.data.remote

import com.village.population.BuildConfig
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/**
 * JSON 约定。三条都是被后端的实际行为逼出来的：
 *
 *  - ignoreUnknownKeys：后端 VO 返回的字段比客户端模型多（详情比列表多出
 *    disability/changes 等），不忽略就会整条解析失败。
 *  - explicitNulls = false：**关键**。后端不少字段是 `z.string().optional()`
 *    而不是 `.nullable()`（例如 gender 是 z.enum(...).optional()），
 *    发 null 会被 zod 直接拒掉。让 null 字段不参与序列化，等于「不传」。
 *  - coerceInputValues：某字段后端回了 null 而模型声明为非空且有默认值时，
 *    用默认值兜底，而不是抛 SerializationException。
 */
@OptIn(ExperimentalSerializationApi::class)
val AppJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

/**
 * 把请求打到用户当前配置的服务器上。
 *
 * Retrofit 的 baseUrl 是构建期固定的，但本项目的服务器地址是**运行时可改**的
 * （同一个 APK 发给几十个村，各村的 NAS 地址不一样），所以这里用占位 baseUrl，
 * 由拦截器在每次请求时把 scheme/host/port 换成配置值。
 * 路径前缀也一并处理，以支持部署在 `/pop/` 这类子路径下的情况。
 */
private class BaseUrlInterceptor(private val baseUrlProvider: () -> String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val configured = baseUrlProvider().trim()
        val parsed = configured.toHttpUrlOrNull()
        // 地址还没配好（或填错了）时不改 URL，交给 Retrofit 抛错，由上层提示用户去设置
        if (parsed == null) return chain.proceed(original)

        val prefix = parsed.encodedPath.trimEnd('/')
        val newUrl = original.url.newBuilder()
            .scheme(parsed.scheme)
            .host(parsed.host)
            .port(parsed.port)
            .encodedPath(prefix + original.url.encodedPath)
            .build()

        return chain.proceed(original.newBuilder().url(newUrl).build())
    }
}

/** 附带 Bearer token。token 存在内存镜像里（见 SessionState），拦截器里不能挂起读 DataStore */
private class AuthInterceptor(private val tokenProvider: () -> String?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenProvider()
        val request =
            if (token.isNullOrBlank()) chain.request()
            else chain.request().newBuilder()
                // 后端只接受 Bearer header，不用 Cookie
                .header("Authorization", "Bearer $token")
                .build()
        return chain.proceed(request)
    }
}

/**
 * 构建 Retrofit 客户端。
 * 这里刻意不引 Hilt/Koin：全应用只有一个单例容器（AppContainer），
 * 手写依赖装配比引入注解处理器更省编译时间，也少一层「看不懂的魔法」。
 */
class ApiClient(
    tokenProvider: () -> String?,
    baseUrlProvider: () -> String,
) {

    private val okHttp: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(BaseUrlInterceptor(baseUrlProvider))
        .addInterceptor(AuthInterceptor(tokenProvider))
        .apply {
            if (BuildConfig.DEBUG) {
                addInterceptor(
                    HttpLoggingInterceptor().apply {
                        level = HttpLoggingInterceptor.Level.BODY
                        // 绝不把 token 打进日志：logcat 在真机上别的应用也能读
                        redactHeader("Authorization")
                    }
                )
            }
        }
        // 村级场景网络抖动多，读写超时给宽一点；上传大图也需要更长的写超时
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val retrofit: Retrofit = Retrofit.Builder()
        // 占位地址，真实地址由 BaseUrlInterceptor 改写
        .baseUrl("http://placeholder.invalid/")
        .client(okHttp)
        .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
        .build()

    val service: ApiService = retrofit.create(ApiService::class.java)
}
