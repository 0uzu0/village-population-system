package com.village.population.data.repository

import com.village.population.data.local.JsonCache
import com.village.population.data.local.get
import com.village.population.data.local.put
import com.village.population.data.remote.ApiException
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.dto.FamilyDetailDto
import java.io.IOException

/**
 * 家庭仓库。
 *
 * 目前移动端只用到「读一个户」——人员详情里的同户成员。
 * 写入口（改户主、加减成员）刻意不做：这些操作要看清全户再动，
 * 手机上误点一下就把人从户里挪走，风险远大于收益。
 *
 * 读接口同样带缓存降级：入户时经常没信号，而「这户还有谁」是站在门口就要看的信息。
 */
class FamilyRepository(
    private val api: ApiService,
    private val exec: ApiExecutor,
    private val cache: JsonCache,
) {

    suspend fun detail(id: Int): Cached<FamilyDetailDto> {
        return try {
            val family = exec.data { api.family(id) }
            cache.put(key(id), family)
            Cached(family)
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            val hit = cache.get<FamilyDetailDto>(key(id)) ?: throw e
            Cached(hit.value, fromCache = true, savedAt = hit.savedAt)
        }
    }

    private fun key(id: Int) = "family:$id"
}
