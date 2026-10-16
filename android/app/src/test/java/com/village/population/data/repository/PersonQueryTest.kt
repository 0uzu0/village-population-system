package com.village.population.data.repository

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 人员查询条件。
 *
 * 这些断言对应 PC 端踩过的坑：
 *  - activeOnly 必须是字符串 "true"/"false"（后端是 z.enum(['true','false'])，
 *    传布尔会被 zod 拒掉，报错还完全看不出问题在哪）；
 *  - 「18 岁以下」要传 maxAge = 17，因为后端的 maxAge 是**闭区间**，
 *    传 18 会把正好 18 岁的人也捞进来。
 */
class PersonQueryTest {

    @Test
    fun `activeOnly序列化成字符串而不是布尔`() {
        assertEquals("true", PersonQuery().activeOnlyParam)
        assertEquals("false", PersonQuery(activeOnly = false).activeOnlyParam)
    }

    @Test
    fun `未成年人上界是17不是18`() {
        val query = PersonQuery.minor()
        assertEquals(17, query.maxAge)
        assertNull(query.minAge)
    }

    @Test
    fun `老年人下界是60`() {
        assertEquals(60, PersonQuery.elderly().minAge)
    }

    @Test
    fun `标签列表序列化成逗号分隔_空列表则不发该参数`() {
        assertNull(PersonQuery().tagIdsParam)
        assertEquals("3,7,11", PersonQuery(tagIds = listOf(3, 7, 11)).tagIdsParam)
    }

    @Test
    fun `缓存键对同样的条件稳定`() {
        val a = PersonQuery(keyword = "张三", village = "东村", page = 2)
        val b = PersonQuery(keyword = "张三", village = "东村", page = 2)
        assertEquals(a.cacheKey, b.cacheKey)
    }

    @Test
    fun `任一筛选条件变化都会改变缓存键`() {
        val base = PersonQuery()
        assertNotEquals(base.cacheKey, PersonQuery(keyword = "李四").cacheKey)
        assertNotEquals(base.cacheKey, PersonQuery(page = 2).cacheKey)
        assertNotEquals(base.cacheKey, PersonQuery(activeOnly = false).cacheKey)
        assertNotEquals(base.cacheKey, PersonQuery(tagIds = listOf(1)).cacheKey)
        assertNotEquals(base.cacheKey, PersonQuery(minAge = 60).cacheKey)
        assertNotEquals(base.cacheKey, PersonQuery(village = "西村").cacheKey)
    }

    @Test
    fun `关键词前后空格不影响缓存键`() {
        assertEquals(
            PersonQuery(keyword = "张三").cacheKey,
            PersonQuery(keyword = "  张三  ").cacheKey,
        )
    }

    @Test
    fun `hasFilter能识别出是否处于筛选态`() {
        assertFalse(PersonQuery().hasFilter)
        assertTrue(PersonQuery(keyword = "张").hasFilter)
        assertTrue(PersonQuery(activeOnly = false).hasFilter)
        assertTrue(PersonQuery(tagIds = listOf(1)).hasFilter)
    }
}
