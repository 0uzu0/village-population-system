package com.village.population.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.village.population.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "village_settings")

/**
 * 本机设置（DataStore 持久化）。
 *
 * 只存三样东西：服务器地址、token、登录用户信息。业务数据一律不在这里——
 * 缓存走 [JsonCache]，待上传的写操作走 [OfflineQueue]。
 */
class SettingsStore(private val context: Context) {

    /**
     * 服务器地址的内存镜像。
     *
     * OkHttp 的拦截器是同步执行的，没法在里面 suspend 读 DataStore，
     * 所以这里维护一份 volatile 副本：启动时 [refreshCache] 装载，写入时同步更新。
     */
    @Volatile
    var baseUrlInMemory: String = BuildConfig.API_BASE_URL
        private set

    private object Keys {
        val BASE_URL = stringPreferencesKey("base_url")
        val TOKEN = stringPreferencesKey("token")
        val USER_JSON = stringPreferencesKey("user_json")
        val LAST_SYNC_AT = stringPreferencesKey("last_sync_at")
    }

    /**
     * 服务器地址。没配置过时用打包时注入的默认值（`-PapiBaseUrl=...`），
     * 因此发到各村的包可以各自带一个默认地址，装完即用，不必人人手填。
     */
    val baseUrlFlow: Flow<String> = context.settingsDataStore.data.map { prefs ->
        prefs[Keys.BASE_URL]?.takeIf { it.isNotBlank() } ?: BuildConfig.API_BASE_URL
    }

    val tokenFlow: Flow<String?> = context.settingsDataStore.data.map { it[Keys.TOKEN] }
    val userJsonFlow: Flow<String?> = context.settingsDataStore.data.map { it[Keys.USER_JSON] }
    val lastSyncAtFlow: Flow<Long> = context.settingsDataStore.data.map { it[Keys.LAST_SYNC_AT]?.toLongOrNull() ?: 0L }

    suspend fun currentBaseUrl(): String = baseUrlFlow.first()

    /** 冷启动时调用一次，把持久化的地址装进内存镜像 */
    suspend fun refreshCache() {
        baseUrlInMemory = currentBaseUrl()
    }

    suspend fun saveBaseUrl(url: String) {
        val normalized = normalize(url)
        context.settingsDataStore.edit { it[Keys.BASE_URL] = normalized }
        baseUrlInMemory = normalized
    }

    /** 恢复默认地址（打包时注入的那个） */
    suspend fun resetBaseUrl() {
        context.settingsDataStore.edit { it.remove(Keys.BASE_URL) }
        baseUrlInMemory = BuildConfig.API_BASE_URL
    }

    suspend fun saveSession(token: String, userJson: String) {
        context.settingsDataStore.edit {
            it[Keys.TOKEN] = token
            it[Keys.USER_JSON] = userJson
        }
    }

    suspend fun clearSession() {
        context.settingsDataStore.edit {
            it.remove(Keys.TOKEN)
            it.remove(Keys.USER_JSON)
        }
    }

    suspend fun markSynced(at: Long = System.currentTimeMillis()) {
        context.settingsDataStore.edit { it[Keys.LAST_SYNC_AT] = at.toString() }
    }

    companion object {
        /**
         * 补全协议与结尾斜杠。
         * 网格员抄地址时经常只写 `192.168.1.100:8080`——不补 http:// 会直接被 OkHttp 判为非法 URL，
         * 而错误信息（"Expected URL scheme 'http' or 'https'"）对用户毫无意义。
         */
        fun normalize(raw: String): String {
            var value = raw.trim()
            if (value.isEmpty()) return value
            if (!value.startsWith("http://", true) && !value.startsWith("https://", true)) {
                value = "http://$value"
            }
            if (!value.endsWith("/")) value += "/"
            return value
        }
    }
}
