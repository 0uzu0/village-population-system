package com.village.population.data.repository

import com.village.population.data.local.JsonCache
import com.village.population.data.local.queue.OfflineQueue
import com.village.population.data.local.queue.OpType
import com.village.population.data.local.queue.QueuedOp
import com.village.population.data.remote.ApiException
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.dto.BatchIdsRequest
import com.village.population.data.remote.dto.DashboardDto
import com.village.population.data.remote.dto.PageData
import com.village.population.data.remote.dto.PendingDto
import com.village.population.data.remote.dto.PendingSummaryDto
import com.village.population.data.remote.dto.QuickGroupDto
import com.village.population.data.remote.dto.TagDto
import com.village.population.data.remote.dto.VillageDto
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.IOException

/**
 * 基础数据仓库：工作台指标、重点人群分组、村庄、待核查。
 *
 * 这些都属于「看一眼」的数据——走访前缓存下来，现场没信号也能翻。
 * 写操作（待核查处理）同样支持离线排队。
 *
 * **不含专项台账**：手机端不做台账速记。台账是「对着大表格整理金额与发票号」
 * 的活，在手机上填反而更容易填错；这部分留在电脑端。
 */
class MetaRepository(
    private val api: ApiService,
    private val exec: ApiExecutor,
    private val cache: JsonCache,
    private val queue: OfflineQueue,
    private val json: Json = com.village.population.data.remote.AppJson,
) {

    /** 缓存降级：仅网络层失败才回退到本地，业务错误（无权限等）照实抛出 */
    private suspend fun <T> cached(
        key: String,
        serializer: KSerializer<T>,
        block: suspend () -> T,
    ): Cached<T> =
        try {
            val value = block()
            cache.put(key, serializer, value)
            Cached(value)
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            val hit = cache.get(key, serializer) ?: throw e
            Cached(hit.value, fromCache = true, savedAt = hit.savedAt)
        }

    // ---------------- 工作台 ----------------

    suspend fun dashboard(): Cached<DashboardDto> =
        cached("dashboard", DashboardDto.serializer()) { exec.data { api.dashboard() } }

    suspend fun quickGroups(): Cached<List<QuickGroupDto>> =
        cached("quickGroups", ListSerializer(QuickGroupDto.serializer())) {
            exec.data { api.quickGroups() }.list
        }

    // ---------------- 村庄 / 网格 ----------------

    /** 村庄列表：按村名聚合的视图，一个村可跨多个网格 */
    suspend fun villages(keyword: String? = null): Cached<List<VillageDto>> =
        cached("villages:${keyword.orEmpty()}", ListSerializer(VillageDto.serializer())) {
            exec.simpleList { api.villages(keyword?.takeIf { it.isNotBlank() }) }
        }

    // ---------------- 标签 ----------------

    /**
     * 个人标签定义。只用于把重点人群的 tagCodes 解析成 tagIds。
     *
     * 缓存下来很有必要：走访前在工作台连一次网，到了村里（没信号）点「低保对象」
     * 仍然能正确地筛出低保名单——否则那个入口就只能干瞪眼。
     */
    suspend fun personTags(): Cached<List<TagDto>> =
        cached("personTags", ListSerializer(TagDto.serializer())) {
            exec.page { api.tagDefinitions(objectType = "PERSON", pageSize = 200) }.list
        }

    // ---------------- 待核查 ----------------

    suspend fun pendingList(
        page: Int,
        pageSize: Int = 20,
        keyword: String? = null,
        status: String? = null,
    ): Cached<PageData<PendingDto>> {
        val key = "pending|$page|$pageSize|${keyword.orEmpty()}|${status.orEmpty()}"
        return cached(key, PageData.serializer(PendingDto.serializer())) {
            exec.page {
                api.pendingList(
                    page = page,
                    pageSize = pageSize,
                    keyword = keyword?.takeIf { it.isNotBlank() },
                    status = status?.takeIf { it.isNotBlank() },
                )
            }
        }
    }

    suspend fun pendingSummary(): PendingSummaryDto = exec.data { api.pendingSummary() }

    /**
     * 确认为正式人员。
     * 这个操作**不入离线队列**：它要在后端做身份证查重、建 person、建 family_member 关联，
     * 而且确认依据（姓名唯一性）必须当场得到结论。排在队列里隔天再执行，
     * 出现「重复人员」时已经没人记得当时点的是哪一条了。
     */
    suspend fun confirmPending(id: Int) {
        exec.run { api.confirmPending(id) }
    }

    /** 忽略：可以离线排队，被忽略的记录不会因为晚几小时生效而变味 */
    suspend fun ignorePending(id: Int): SubmitResult =
        try {
            exec.run { api.ignorePending(id) }
            SubmitResult.Sent(id)
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            val label = "忽略待核查记录 #$id"
            queue.enqueue(
                QueuedOp(
                    type = OpType.PENDING_IGNORE,
                    payload = json.encodeToString(BatchIdsRequest.serializer(), BatchIdsRequest(listOf(id))),
                    label = label,
                    refId = id,
                )
            )
            SubmitResult.Queued(label)
        }

    suspend fun batchIgnore(ids: List<Int>) {
        exec.run { api.batchIgnorePending(BatchIdsRequest(ids)) }
    }
}
