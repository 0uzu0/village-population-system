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
    private val json: Json = com.village.population.data.remote.AppJson,
) {

    /**
     * 人员列表。
     * 有网走接口并顺手写缓存；**只有网络层失败**才降级到缓存，
     * 业务错误（如无权限 403）该报就报——拿旧数据掩盖权限问题会让人以为系统坏了。
     */
    suspend fun list(query: PersonQuery): Cached<PageData<PersonDto>> =
        try {
            val page = exec.page {
                api.persons(
                    page = query.page,
                    pageSize = query.pageSize,
                    keyword = query.keyword.takeIf { it.isNotBlank() },
                    village = query.village?.takeIf { it.isNotBlank() },
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
            val hit = cache.get<PageData<PersonDto>>(query.cacheKey) ?: throw e
            Cached(hit.value, fromCache = true, savedAt = hit.savedAt)
        }

    /** 人员详情。看过的详情会留在本机，下次没信号也能点开 */
    suspend fun detail(id: Int): Cached<PersonDto> =
        try {
            val person = exec.data { api.person(id) }
            cache.put(detailKey(id), person)
            Cached(person)
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            val hit = cache.get<PersonDto>(detailKey(id)) ?: throw e
            Cached(hit.value, fromCache = true, savedAt = hit.savedAt)
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
}
