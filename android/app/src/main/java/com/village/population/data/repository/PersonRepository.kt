package com.village.population.data.repository

import com.village.population.data.local.JsonCache
import com.village.population.data.local.get
import com.village.population.data.local.put
import com.village.population.data.local.queue.OfflineQueue
import com.village.population.data.local.queue.OpType
import com.village.population.data.local.queue.QueuedOp
import com.village.population.data.remote.ApiException
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.dto.AddTagRequest
import com.village.population.data.remote.dto.PageData
import com.village.population.data.remote.dto.PersonCreateRequest
import com.village.population.data.remote.dto.PersonDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.IOException

/**
 * 人员仓库。
 *
 * 最重要的设计判断：**读接口带缓存降级，写接口带离线队列**。
 * 村级走访的真实场景是「出门前先看一眼名单 → 走到人家里没信号 → 现场登记」，
 * 所以「读」要能拿旧数据，「写」要能先落到本地。
 */
class PersonRepository(
    private val api: ApiService,
    private val exec: ApiExecutor,
    private val cache: JsonCache,
    private val queue: OfflineQueue,
    /** 全量名单：有网时同步，断网时列表与详情都靠它救场 */
    private val index: PersonIndex,
    private val json: Json = com.village.population.data.remote.AppJson,
) {

    /**
     * 人员列表。
     * 有网走接口并顺手写缓存；**只有网络层失败**才降级，
     * 业务错误（如无权限 403）该报就报——拿旧数据掩盖权限问题会让人以为系统坏了。
     *
     * 降级顺序：同条件的页缓存 → 全量索引本地筛选 → 抛原异常。
     * 中间那一层是这次补的：缓存只存「翻过的页」，换关键词就没了，
     * 而现场搜人恰恰是换关键词的场景。
     */
    suspend fun list(query: PersonQuery): Cached<PageData<PersonDto>> {
        return try {
            val page = exec.page {
                api.persons(
                    page = query.page,
                    pageSize = query.pageSize,
                    keyword = query.keyword.takeIf { it.isNotBlank() },
                    villages = query.village?.takeIf { it.isNotBlank() },
                    gridId = query.gridId,
                    gender = query.gender?.takeIf { it.isNotBlank() },
                    status = query.status?.takeIf { it.isNotBlank() },
                    activeOnly = query.activeOnlyParam,
                    tagIds = query.tagIdsParam,
                    tagMode = query.tagMode,
                    minAge = query.minAge,
                    maxAge = query.maxAge,
                )
            }
            cache.put(query.cacheKey, page)
            Cached(page)
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            val hit = cache.get<PageData<PersonDto>>(query.cacheKey)
            if (hit != null) {
                Cached(hit.value, fromCache = true, savedAt = hit.savedAt)
            } else {
                // 解析 5MB 主文件要在 IO 线程上做，不能挂在调用方（主线程）上
                val local = withContext(Dispatchers.IO) { index.query(query) } ?: throw e
                Cached(local, fromCache = true, savedAt = index.savedAt)
            }
        }
    }

    /** 人员详情。看过的详情会留在本机，其次查全量索引——没看过的也能断网打开 */
    suspend fun detail(id: Int): Cached<PersonDto> {
        return try {
            val person = exec.data { api.person(id) }
            cache.put(detailKey(id), person)
            Cached(person)
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            val hit = cache.get<PersonDto>(detailKey(id))
            if (hit != null) {
                Cached(hit.value, fromCache = true, savedAt = hit.savedAt)
            } else {
                val local = withContext(Dispatchers.IO) { index.byId(id) } ?: throw e
                Cached(local, fromCache = true, savedAt = index.savedAt)
            }
        }
    }

    /**
     * 下载全量人员名单到本机。
     *
     * 一次 200 条（后端 pageSize 上限），7600 人大约 39 个来回。**只有全部成功才落盘**：
     * 中途断网就写进去的话，会得到一份「缺了几个村」的名单，比没有更危险——
     * 现场搜不到人，会以为这个人不在村里。
     *
     * @param onProgress 已下载条数，用于界面上的进度文案
     */
    suspend fun syncIndex(onProgress: (Int) -> Unit = {}): Int = withContext(Dispatchers.IO) {
        val all = mutableListOf<PersonDto>()
        var page = 1
        while (true) {
            // activeOnly=false：死亡/迁出的历史档案也要能查，现场核对时经常需要
            val res = exec.page {
                api.persons(
                    page = page,
                    pageSize = SYNC_PAGE_SIZE,
                    activeOnly = "false",
                    sortBy = "id",
                    sortOrder = "asc",
                )
            }
            all += res.list
            onProgress(all.size)
            if (res.list.isEmpty() || res.list.size < SYNC_PAGE_SIZE || all.size >= res.total) break
            page++
        }
        index.save(all)
        all.size
    }

    /** 本地名单已缓存的人数；0 = 还没下载过 */
    val indexCount: Int get() = index.size

    /** 本地名单的同步时间；0 = 从未同步 */
    val indexSavedAt: Long get() = index.savedAt

    fun indexIsStale(): Boolean = index.isStale()

    /**
     * 名单过期就静默刷新一次。
     *
     * **只刷已经下载过的**：首次下载 7600 人要走 39 个来回、几 MB 流量，
     * 必须由用户在「我的 → 离线名单」里显式点一次；之后每天自动续一次是合理的。
     *
     * @return 是否真的发起了刷新（用于测试与界面判断，不关心可不接）
     */
    suspend fun refreshIndexIfStale(): Boolean = withContext(Dispatchers.IO) {
        if (index.isEmpty() || !index.isStale()) return@withContext false
        syncIndex()
        true
    }

    /**
     * 新增人员。
     *
     * 注意业务错误**不入队**：身份证校验位错误、重复身份证这类问题，后端会立刻拒绝，
     * 入队只会让它反复重试到次数耗尽，最后在队列里堆一堆永远传不上去的垃圾。
     * 只有「网络层失败」（IOException 而非 ApiException）才暂存。
     */
    suspend fun create(req: PersonCreateRequest): SubmitResult =
        try {
            val res = exec.data { api.createPerson(req) }
            // 后端两种成功：建档（data.id）与转待核查（data.pending=true，没有 id）。
            // 后者必须单独上报——它不是失败，也不能当成「已建档」让界面返回列表。
            if (res.pending) SubmitResult.Pending(res.pendingId) else SubmitResult.Sent(res.id)
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            val label = "新增人员 ${req.name}"
            queue.enqueue(
                QueuedOp(
                    type = OpType.CREATE_PERSON,
                    payload = json.encodeToString(PersonCreateRequest.serializer(), req),
                    label = label,
                )
            )
            SubmitResult.Queued(label)
        }

    suspend fun update(id: Int, req: PersonCreateRequest): SubmitResult =
        try {
            exec.data { api.updatePerson(id, req) }
            SubmitResult.Sent(id)
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            val label = "修改人员 ${req.name}"
            queue.enqueue(
                QueuedOp(
                    type = OpType.UPDATE_PERSON,
                    payload = json.encodeToString(PersonCreateRequest.serializer(), req),
                    label = label,
                    refId = id,
                )
            )
            SubmitResult.Queued(label)
        }

    /**
     * 打标签。一次一个（后端接口就是单标签），需要 tag:manage 权限。
     * 已关联的标签后端会返回 409 DUPLICATE_TAG —— 这种要原样抛给用户看，
     * 因为「该人员已关联此标签」是个有效反馈，不是错误。
     */
    suspend fun addTag(personId: Int, tagId: Int, basis: String? = null): SubmitResult =
        try {
            exec.run { api.addPersonTag(personId, AddTagRequest(tagId = tagId, basis = basis)) }
            SubmitResult.Sent(personId)
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            val label = "给人员打标签"
            queue.enqueue(
                QueuedOp(
                    type = OpType.ADD_PERSON_TAG,
                    payload = json.encodeToString(
                        AddTagRequest.serializer(),
                        AddTagRequest(tagId = tagId, basis = basis)
                    ),
                    label = label,
                    refId = personId,
                )
            )
            SubmitResult.Queued(label)
        }

    suspend fun removeTag(personId: Int, linkId: Int) {
        exec.run { api.removePersonTag(personId, linkId) }
    }

    private fun detailKey(id: Int) = "person:$id"

    private companion object {
        /** 与后端 `/persons` 的 pageSize 上限（200）对齐，再多会被 zod 拒掉 */
        const val SYNC_PAGE_SIZE = 200
    }
}
