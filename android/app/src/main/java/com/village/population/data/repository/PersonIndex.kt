package com.village.population.data.repository

import com.village.population.data.local.JsonCache
import com.village.population.data.local.get
import com.village.population.data.local.put
import com.village.population.data.remote.dto.PageData
import com.village.population.data.remote.dto.PersonDto
import com.village.population.util.DateText
import kotlinx.serialization.Serializable

/**
 * 本机全量人员索引：**进村前同步一次，现场断网也能搜人**。
 *
 * ## 为什么需要它
 *
 * 列表接口的缓存是按「查询条件」存页的（见 JsonCache 与 PersonQuery.cacheKey），
 * 只有在有网时翻过的那几页才有缓存。现实是网格员进村前只看了「本村在册」，
 * 到了人家里想搜一个名字，关键词一变缓存就 miss —— 界面直接报网络错误。
 * 最需要查人的时刻，恰恰是查不到的时候。
 *
 * ## 为什么不引 Room
 *
 * 全量 7600 多人、每人一条 [PersonDto]，落一个 JSON 约 5MB，进程内解析一次
 * 占十几 MB——完全在一台普通安卓机的承受范围内。换成 Room 要多一套 KSP 注解处理、
 * 一套 DAO、一套迁移，换来的 SQL 查询能力这里一条都用不上（就是内存里 contains）。
 *
 * ## 为什么还要单独存一份 meta
 *
 * 「已缓存 7677 人」这种文案要在列表/我的页**随手读**，而读人数如果去解析 5MB 主文件，
 * 就等于每次进列表都在主线程上做一次几十毫秒的大 JSON 解析。所以条数与时间单独
 * 写一个几百字节的 [IndexMeta]，主文件只在真的要搜人/取详情时才读。
 *
 * ## 口径必须与后端一致
 *
 * 本地筛选是后端 `buildPersonListQuery` 的**另一份实现**，两边口径漂移了，
 * 表现是「同一组条件，有网 12 人、断网 9 人」——比报错更难查。
 * 所以这里的每个条件都注明对应的后端规则，改一边要看另一边。
 * （`PersonIndexTest` 钉住了几条最容易漂的：在册口径、年龄闭区间、标签 AND/OR。）
 */
class PersonIndex(private val cache: JsonCache) {

    /** 解析过的全量名单留在内存里，别每次搜索都重新读 5MB JSON */
    @Volatile
    private var memo: List<PersonDto>? = null

    @Volatile
    private var metaMemo: IndexMeta? = null

    /** 名单人数；0 = 还没同步过 */
    val size: Int
        get() = meta()?.count ?: 0

    /** 上次同步时间；0 = 从未同步 */
    val savedAt: Long
        get() = meta()?.savedAt ?: 0L

    fun isEmpty(): Boolean = size == 0

    /** 现在这份名单算不算「该更新了」：超过 24 小时算过期 */
    fun isStale(now: Long = System.currentTimeMillis()): Boolean {
        val at = savedAt
        if (at == 0L) return true
        return now - at > STALE_MS
    }

    fun save(list: List<PersonDto>) {
        val at = System.currentTimeMillis()
        cache.put(KEY, list)
        // meta 最后写：它是「这份名单可用」的提交标记
        cache.put(META_KEY, IndexMeta(count = list.size, savedAt = at))
        memo = list
        metaMemo = IndexMeta(count = list.size, savedAt = at)
    }

    fun clear() {
        cache.remove(KEY)
        cache.remove(META_KEY)
        memo = null
        metaMemo = null
    }

    /** 按 id 取一条：断网时打开某个人的详情就靠它 */
    fun byId(id: Int): PersonDto? = load()?.firstOrNull { it.id == id }

    /**
     * 本地分页查询。名单还没同步过时返回 null，
     * 让调用方把原来的网络异常原样抛给用户（而不是给一个空列表假装「没这个人」）。
     */
    fun query(q: PersonQuery): PageData<PersonDto>? {
        val all = load() ?: return null
        // 顺序固定按 id 升序：与后端 /persons 的默认排序（p.id asc）一致。
        // 列表页目前不提供自定义排序，本地没必要多一套排序语义去和后端对齐。
        val matched = all.asSequence()
            .filter { matches(it, q) }
            .toList()
        val from = (q.page - 1) * q.pageSize
        if (from >= matched.size) {
            return PageData(list = emptyList(), total = matched.size, page = q.page, pageSize = q.pageSize)
        }
        val page = matched.subList(from, minOf(from + q.pageSize, matched.size))
        return PageData(list = page, total = matched.size, page = q.page, pageSize = q.pageSize)
    }

    private fun meta(): IndexMeta? =
        metaMemo ?: cache.get<IndexMeta>(META_KEY)?.value?.also { metaMemo = it }

    private fun load(): List<PersonDto>? {
        memo?.let { return it }
        val entry = cache.get<List<PersonDto>>(KEY) ?: return null
        memo = entry.value
        return entry.value
    }

    /** 与主文件分开的小元数据，见类注释 */
    @Serializable
    private data class IndexMeta(val count: Int = 0, val savedAt: Long = 0L)

    companion object {
        /** 与缓存目录同寿命：退出登录会随 cache.clear() 一起清掉——里面有身份证号 */
        private const val KEY = "person_index"
        private const val META_KEY = "person_index_meta"

        private const val STALE_MS = 24L * 60 * 60 * 1000

        /**
         * 在册口径。与后端 `utils/personStatus.ts` 的 `activeSql()` 一致：
         * 只有 NORMAL / MOVED_IN 算在册，死亡与迁出只在查历史时出现。
         */
        val ACTIVE_STATUSES = setOf("NORMAL", "MOVED_IN")

        /**
         * 单个条件是否命中。**每一条都对应后端 buildPersonListQuery 的一个分支**。
         */
        internal fun matches(p: PersonDto, q: PersonQuery): Boolean {
            if (q.keyword.isNotBlank()) {
                val kw = q.keyword.trim()
                // 后端：name / id_card / phone / phone_backup / hukou_address / live_address
                val hit = listOf(p.name, p.idCard, p.phone, p.phoneBackup, p.hukouAddress, p.liveAddress)
                    .any { !it.isNullOrBlank() && it.contains(kw, ignoreCase = true) }
                if (!hit) return false
            }
            if (!q.village.isNullOrBlank()) {
                // 后端是 villages（逗号分隔、IN 精确匹配），不是模糊匹配
                val names = q.village.split(',').map { it.trim() }.filter { it.isNotEmpty() }
                if (names.isNotEmpty() && p.village !in names) return false
            }
            if (q.gridId != null && p.gridId != q.gridId) return false
            if (!q.gender.isNullOrBlank() && p.gender != q.gender) return false

            // 后端：传了 status 就以 status 为准，activeOnly 不再生效
            if (!q.status.isNullOrBlank()) {
                if (p.status != q.status) return false
            } else if (q.activeOnly && p.status !in ACTIVE_STATUSES) {
                return false
            }

            if (q.minAge != null || q.maxAge != null) {
                val age = DateText.ageOf(p.birthDate) ?: return false
                // 后端 buildAgeFilter 两端都是闭区间
                if (q.minAge != null && age < q.minAge) return false
                if (q.maxAge != null && age > q.maxAge) return false
            }

            if (q.tagIds.isNotEmpty()) {
                val mine = p.tags.map { it.id }.toSet()
                val ok = if (q.tagMode == "ALL") mine.containsAll(q.tagIds) else q.tagIds.any { it in mine }
                if (!ok) return false
            }
            return true
        }
    }
}
