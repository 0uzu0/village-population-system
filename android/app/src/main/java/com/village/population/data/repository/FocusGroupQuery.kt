package com.village.population.data.repository

import com.village.population.data.remote.dto.QuickGroupDto
import com.village.population.data.remote.dto.TagDto

/**
 * 把工作台上的「重点人群」入口，翻译成人员列表能用的筛选条件。
 *
 * 为什么要单独一个纯函数：这里是最容易出错、也最难发现出错的地方——
 * 点「低保对象」跳过去却看到全村人的名单，页面不报任何错，只是数字不对。
 * 抽成纯函数就能直接写单元测试（见 FocusGroupQueryTest）。
 *
 * 两类人群的筛选方式完全不同，不能混：
 *
 * · **年龄类**（老年人 ≥60、未成年人 <18）：按出生日期算出来的人数，
 *   跟他有没有打过标签毫无关系，所以筛的是 `minAge`/`maxAge`。
 *   注意后端 `maxAge` 是**闭区间**，接口给的 `maxAge` 已经是 17（即「<18 岁」），
 *   直接透传即可，不要再减 1。
 *
 * · **身份类**（党员、退役军人、低保、特困、残疾、优抚）：按标签筛。
 *   ⚠️ 必须用 `tagCodes` 而不是 `code`：「党员」由正式党员 + 预备党员两个标签构成，
 *   只按 `code`（PARTY_MEMBER）筛会少一截人，跟卡片上的数字对不上。
 *   多个标签之间是「命中任一即计入」，所以 tagMode 用 ANY。
 *
 * 解析不出任何标签时返回 null，**绝不能退化成「不加筛选」**——
 * 那等于把「低保对象 62 人」点成了一个 1200 人的全村名单，是最坏的一种失败。
 */
object FocusGroupQuery {

    /** 把族群解析成筛选条件；无法解析（标签字典缺失）时返回 null */
    fun build(group: QuickGroupDto, tags: List<TagDto>): PersonQuery? =
        if (group.byAge) {
            // 年龄类：minAge / maxAge 可能只有其一（老年只有下界、未成年只有上界）
            PersonQuery(minAge = group.minAge, maxAge = group.maxAge, page = 1)
        } else {
            val ids = tagIdsOf(group, tags)
            if (ids.isEmpty()) null
            else PersonQuery(tagIds = ids, tagMode = "ANY", page = 1)
        }

    /**
     * 族群涉及的标签 id。
     * 兼容旧数据：万一后端还没升级、`tagCodes` 没返回，就退回用 `code`（仍比不筛好）。
     */
    fun tagIdsOf(group: QuickGroupDto, tags: List<TagDto>): List<Int> {
        val codes = group.tagCodes.ifEmpty { listOf(group.code).filter { it.isNotBlank() } }
        return codes.mapNotNull { code -> tags.firstOrNull { it.code == code }?.id }.distinct()
    }
}
