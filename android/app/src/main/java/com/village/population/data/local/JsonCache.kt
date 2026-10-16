package com.village.population.data.local

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import java.io.File

/** 带时间戳的缓存条目。离线时界面要显示「数据截至 x 月 x 日」，时间戳是必须的 */
data class CachedEntry<T>(val savedAt: Long, val value: T)

/**
 * 极简 JSON 文件缓存。
 *
 * 为什么不用 Room？
 * 移动端要缓存的只有三样东西：工作台指标、人员列表某几页、看过的几个人详情。
 * 为这点数据引入 Room 就要多加 KSP 注解处理（构建更慢、CI 更容易因为版本不匹配而失败），
 * 换来的查询能力完全用不上。一个目录 + 一个 JSON 文件一条记录就够了。
 *
 * 写入策略是「先写 .tmp 再改名」：应用被杀进程时不会留下半截 JSON，
 * 否则下次启动读到坏文件会让整个离线功能看起来「莫名其妙全空」。
 */
class JsonCache(private val rootDir: File, private val json: Json) {

    private fun fileFor(key: String): File {
        // 键里可能带筛选条件（含中文、逗号、等号），统一换成文件名安全字符
        val safe = key.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
        return File(rootDir, "$safe.json")
    }

    fun <T> put(key: String, serializer: KSerializer<T>, value: T) {
        runCatching {
            rootDir.mkdirs()
            val element = JsonObject(
                mapOf(
                    "savedAt" to JsonPrimitive(System.currentTimeMillis()),
                    "value" to json.encodeToJsonElement(serializer, value),
                )
            )
            val target = fileFor(key)
            val tmp = File(rootDir, target.name + ".tmp")
            tmp.writeText(element.toString())
            if (!tmp.renameTo(target)) {
                // 某些文件系统上 rename 会失败（目标已存在且不可覆盖），退化为直接写
                target.writeText(element.toString())
                tmp.delete()
            }
        }
    }

    fun <T> get(key: String, serializer: KSerializer<T>): CachedEntry<T>? = runCatching {
        val file = fileFor(key)
        if (!file.exists()) return@runCatching null
        val element = json.parseToJsonElement(file.readText()) as? JsonObject ?: return@runCatching null
        val savedAt = element["savedAt"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: 0L
        val value = element["value"] ?: return@runCatching null
        CachedEntry(savedAt, json.decodeFromJsonElement(serializer, value))
    }.getOrNull()

    fun remove(key: String) {
        fileFor(key).delete()
    }

    fun clear() {
        rootDir.listFiles()?.forEach { it.delete() }
    }

    /** 缓存占用字节数，显示在「我的 → 离线数据」里 */
    fun sizeBytes(): Long =
        rootDir.listFiles()?.sumOf { if (it.isFile) it.length() else 0L } ?: 0L
}

// reified 版本：调用处写 cache.put("persons:p1", page) 即可，不用手动传 serializer
inline fun <reified T> JsonCache.put(key: String, value: T) = put(key, serializer<T>(), value)

inline fun <reified T> JsonCache.get(key: String): CachedEntry<T>? = get(key, serializer<T>())
