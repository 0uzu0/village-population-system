package com.village.population.data.repository

import com.village.population.data.local.JsonCache
import com.village.population.data.remote.AppJson
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.remote.dto.PersonTagDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/**
 * 本地名单索引。
 *
 * 这一层的风险不是崩溃，而是**口径漂移**：本地筛选是后端 buildPersonListQuery 的第二份实现，
 * 条件写宽了/写窄了，表现是「有网 12 人、断网 9 人」——比报错更难查，
 * 而且只在没信号的时候出现。所以下面每一条都对着后端的规则写。
 */
class PersonIndexTest {

    private fun indexWith(people: List<PersonDto>): PersonIndex {
        val dir = Files.createTempDirectory("person-index-test").toFile()
        val index = PersonIndex(JsonCache(dir, AppJson))
        index.save(people)
        return index
    }

    private fun person(
        id: Int,
        name: String,
        status: String = "NORMAL",
        village: String = "艾园村",
        gender: String = "MALE",
        birthDate: String = "1960-01-01",
        idCard: String = "32012419600101${id.toString().padStart(4, '0')}",
        phone: String? = null,
        tags: List<PersonTagDto> = emptyList(),
    ) = PersonDto(
        id = id,
        name = name,
        status = status,
        village = village,
        gender = gender,
        birthDate = birthDate,
        idCard = idCard,
        phone = phone,
        hukouAddress = "$village 1 号",
        tags = tags,
    )

    private val sample = listOf(
        person(1, "徐露", village = "艾园村", gender = "FEMALE", birthDate = "1991-09-23"),
        person(2, "徐之青", village = "艾园村", birthDate = "1965-01-17"),
        person(3, "陶欣彤", village = "小陶家村", gender = "FEMALE", birthDate = "2015-12-03"),
        person(4, "已故老人", status = "DEAD", village = "北口村", birthDate = "1940-05-01"),
        person(5, "迁出青年", status = "MOVED_OUT", village = "北口村", birthDate = "1995-03-03"),
    )

    @Test
    fun `默认只返回在册人员——死亡与迁出不算在册`() {
        val page = indexWith(sample).query(PersonQuery())!!
        assertEquals(3, page.total)
        assertTrue(page.list.none { it.status == "DEAD" || it.status == "MOVED_OUT" })
    }

    @Test
    fun `传了状态就以状态为准，activeOnly 不再生效`() {
        val dead = indexWith(sample).query(PersonQuery(status = "DEAD", activeOnly = false))!!
        assertEquals(1, dead.total)
        assertEquals("已故老人", dead.list.single().name)
    }

    @Test
    fun `全部状态等于取消在册过滤`() {
        val all = indexWith(sample).query(PersonQuery(activeOnly = false))!!
        assertEquals(sample.size, all.total)
    }

    @Test
    fun `关键词命中姓名_身份证_手机号与地址`() {
        val index = indexWith(
            sample + person(9, "电话测试", phone = "15800005272", idCard = "320124199001010099")
        )
        assertEquals(1, index.query(PersonQuery(keyword = "徐露"))!!.total)
        assertEquals(1, index.query(PersonQuery(keyword = "5272"))!!.total)
        assertEquals(1, index.query(PersonQuery(keyword = "小陶家村"))!!.total)
    }

    @Test
    fun `村庄是精确匹配，不是模糊匹配`() {
        val index = indexWith(sample)
        // 「艾园村」不能把「艾园六队」之类的近似村名带进来，反之亦然
        assertEquals(2, index.query(PersonQuery(village = "艾园村"))!!.total)
        assertEquals(0, index.query(PersonQuery(village = "艾园"))!!.total)
    }

    @Test
    fun `性别筛选`() {
        val index = indexWith(sample)
        val female = index.query(PersonQuery(gender = "FEMALE"))!!
        assertEquals(2, female.total)
        assertTrue(female.list.all { it.gender == "FEMALE" })
    }

    @Test
    fun `老年人是含 60 岁，与后端 ELDERLY_MIN_AGE 一致`() {
        val index = indexWith(sample)
        // 1965 年出生在 2026 年已满 60；1991 的不算；2015 的也不算
        val elderly = index.query(PersonQuery(minAge = 60))!!
        assertEquals(1, elderly.total)
        assertEquals("徐之青", elderly.list.single().name)
    }

    @Test
    fun `18 岁以下用 maxAge 17——传 18 会多捞一个`() {
        val index = indexWith(sample)
        assertEquals(1, index.query(PersonQuery(maxAge = 17))!!.total)
    }

    @Test
    fun `标签 ANY 与 ALL 的差别`() {
        val lowIncome = PersonTagDto(id = 3, name = "低保")
        val disabled = PersonTagDto(id = 4, name = "残疾")
        val index = indexWith(
            listOf(
                person(21, "仅低保", tags = listOf(lowIncome)),
                person(22, "两者都有", tags = listOf(lowIncome, disabled)),
                person(23, "两者都无"),
            )
        )
        assertEquals(2, index.query(PersonQuery(tagIds = listOf(3), tagMode = "ANY"))!!.total)
        assertEquals(
            1,
            index.query(PersonQuery(tagIds = listOf(3, 4), tagMode = "ALL"))!!.total
        )
    }

    @Test
    fun `分页按页切，total 是全量命中数而不是本页条数`() {
        val index = indexWith((1..25).map { person(it, "村民$it") })
        val first = index.query(PersonQuery(page = 1, pageSize = 10))!!
        assertEquals(10, first.list.size)
        assertEquals(25, first.total)
        val last = index.query(PersonQuery(page = 3, pageSize = 10))!!
        assertEquals(5, last.list.size)
    }

    @Test
    fun `超出末页返回空列表而不是崩溃或回绕`() {
        val page = indexWith(sample).query(PersonQuery(page = 9, pageSize = 20))!!
        assertEquals(0, page.list.size)
        assertEquals(3, page.total)
    }

    @Test
    fun `按 id 取单条，未命中返回 null`() {
        val index = indexWith(sample)
        assertEquals("陶欣彤", index.byId(3)?.name)
        assertNull(index.byId(999))
    }

    @Test
    fun `没有下载过名单时返回 null，交给调用方抛原来的网络异常`() {
        val dir = Files.createTempDirectory("person-index-empty").toFile()
        val index = PersonIndex(JsonCache(dir, AppJson))
        assertNull(index.query(PersonQuery()))
        assertNull(index.byId(1))
        assertTrue(index.isEmpty())
        assertTrue(index.isStale())
    }

    @Test
    fun `人数与同步时间写在 meta 里，重新构造实例也能读到`() {
        val dir = Files.createTempDirectory("person-index-meta").toFile()
        val first = PersonIndex(JsonCache(dir, AppJson))
        first.save(sample)
        // 模拟重启：同一个目录，新的实例（内存里的 memo 没了）
        val second = PersonIndex(JsonCache(dir, AppJson))
        assertEquals(sample.size, second.size)
        assertTrue(second.savedAt > 0)
        assertFalse(second.isStale())
        assertNotNull(second.byId(1))
    }

    @Test
    fun `清空后连内存副本一起丢——换人登录不能还能搜到上一个账号的档案`() {
        val dir = Files.createTempDirectory("person-index-clear").toFile()
        val index = PersonIndex(JsonCache(dir, AppJson))
        index.save(sample)
        index.clear()
        assertEquals(0, index.size)
        assertNull(index.byId(1))
        assertNull(index.query(PersonQuery()))
    }
}
