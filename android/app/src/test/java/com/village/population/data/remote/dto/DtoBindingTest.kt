package com.village.population.data.remote.dto

import com.village.population.data.remote.AppJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * DTO 与后端真实载荷的绑定测试。
 *
 * 为什么需要：本项目后端**不是**统一驼峰返回——
 *   · 人员相关接口走 `toPersonVO()`，是驼峰（personNo / phoneBackup）；
 *   · 网格 / 村庄 / 待核查等接口直接返回**原始 SQL 行**，字段名是数据库列名与 SQL
 *     别名（`person_count` / `id_card`），是下划线。
 * 而 Json 配了 `ignoreUnknownKeys = true`，**字段名写错不会报错**：对不上的键被直接忽略，
 * 属性保持默认值。于是「村里人数全是 0」「待核查列表身份证号整列空白」这类问题
 * 既不编译报错也不抛异常，只能靠人肉发现。PC 端已经在同一个坑上踩过两次。
 *
 * 所以这里把每个接口的**真实响应样例**钉住（样例取自对应后端路由的 SELECT 别名），
 * 谁改了 @SerialName、或误按驼峰写新字段，这里立刻红。
 */
class DtoBindingTest {

    /** GET /api/grids/villages —— 后端算的是 SQL 别名，不是驼峰 */
    @Test
    fun `村庄统计字段按 SQL 别名绑定`() {
        val json = """
            {
              "name": "艾园村",
              "manager": "王建国",
              "phone": "13800000001",
              "person_count": 128,
              "family_count": 43,
              "grid_names": "红星村第一网格、红星村第二网格",
              "party_count": 6,
              "disabled_count": 3,
              "extreme_poverty_count": 2,
              "low_income_count": 5,
              "veteran_count": 4,
              "preferential_count": 1
            }
        """.trimIndent()

        val v = AppJson.decodeFromString<VillageDto>(json)

        assertEquals("艾园村", v.name)
        assertEquals("王建国", v.manager)
        // 这两个数字决定「选择村庄」弹窗里那句「N 人」，绑错就是一片 0 人
        assertEquals(128, v.personCount)
        assertEquals(43, v.familyCount)
        assertEquals("红星村第一网格、红星村第二网格", v.gridNames)
        assertEquals(6, v.partyCount)
        assertEquals(3, v.disabledCount)
        assertEquals(2, v.extremePovertyCount)
        assertEquals(5, v.lowIncomeCount)
        assertEquals(4, v.veteranCount)
        assertEquals(1, v.preferentialCount)
    }

    /** 村庄列表接口只返回 `{ list, total }`，没有 page / pageSize */
    @Test
    fun `村庄列表信封可解析`() {
        val json = """{"code":0,"message":"success","data":{"list":[{"name":"仓门口村","person_count":12}],"total":1}}"""

        val env = AppJson.decodeFromString<ApiEnvelope<SimpleListData<VillageDto>>>(json)

        assertEquals(0, env.code)
        assertEquals(1, env.data!!.total)
        assertEquals("仓门口村", env.data!!.list[0].name)
        assertEquals(12, env.data!!.list[0].personCount)
    }

    /** 写错成驼峰会静默变默认值——这正是本组用例要拦住的事 */
    @Test
    fun `驼峰键不会绑定到下划线字段`() {
        val json = """{"name":"艾园村","personCount":128,"gridNames":"一网格"}"""

        val v = AppJson.decodeFromString<VillageDto>(json)

        assertEquals("艾园村", v.name)
        assertEquals(0, v.personCount)
        assertNull(v.gridNames)
    }

    /** GET /api/grids —— 同样是原始行 */
    @Test
    fun `网格字段按 SQL 列名绑定`() {
        val json = """
            {
              "id": 7, "grid_no": "G-001", "name": "红星村第一网格",
              "manager": "李红", "staff": "张三,李四", "description": "含 3 个自然村",
              "status": 1, "person_count": 320, "family_count": 110,
              "party_count": 12, "disabled_count": 8,
              "created_at": "2026-10-01 09:00:00", "updated_at": "2026-10-01 09:00:00"
            }
        """.trimIndent()

        val g = AppJson.decodeFromString<GridDto>(json)

        assertEquals(7, g.id)
        assertEquals("G-001", g.gridNo)
        assertEquals("红星村第一网格", g.name)
        assertEquals("张三,李四", g.staff)
        assertEquals(320, g.personCount)
        assertEquals(110, g.familyCount)
    }

    /**
     * GET /api/statistics/dashboard —— 这个接口是**驼峰**（后端逐字段写死的返回值），
     * 但字段名由 focusGroups.ts 的 dashboardField 决定，容易猜成更自然的名字。
     */
    @Test
    fun `工作台字段名与 dashboardField 一致`() {
        val json = """
            {
              "totalPopulation": 3850, "familyCount": 1320, "gridCount": 9,
              "hukouCount": 3610, "residentCount": 2980,
              "partyCount": 61, "veteranCount": 55, "preferentialCount": 21,
              "lowIncomePersonCount": 88, "extremePovertyCount": 12,
              "disabledCount": 47, "lowIncomeFamilyCount": 40
            }
        """.trimIndent()

        val d = AppJson.decodeFromString<DashboardDto>(json)

        assertEquals(3850, d.totalPopulation)
        assertEquals(3610, d.hukouCount)
        assertEquals(2980, d.residentCount)
        // 这两个最容易被写错：党员不是 partyMemberCount，低保对象不是 lowIncomeCount
        assertEquals(61, d.partyCount)
        assertEquals(88, d.lowIncomePersonCount)
        assertEquals(40, d.lowIncomeFamilyCount)
    }

    /**
     * GET /api/key-groups/quick。
     * 重点在 `tagCodes`：它是「点卡片跳人员列表」时唯一能用来正确筛选的东西。
     * 少了它，客户端只能拿 `code` 去匹配标签——「党员」会漏掉预备党员。
     */
    @Test
    fun `重点人群快捷分组带上构成该族群的标签编码`() {
        val json = """
            {
              "list": [
                {"label":"党员","code":"PARTY_MEMBER",
                 "tagCodes":["PARTY_MEMBER","PARTY_PROBATIONARY"],
                 "count":61,"color":"#E5484D","byAge":false,"minAge":null,"maxAge":null},
                {"label":"老年人（≥60岁）","code":"ELDERLY","tagCodes":[],
                 "count":702,"color":"#3978F6","byAge":true,"minAge":60,"maxAge":null}
              ],
              "note": "口径说明"
            }
        """.trimIndent()

        val data = AppJson.decodeFromString<QuickGroupData>(json)

        assertEquals(2, data.list.size)
        val party = data.list.first { it.code == "PARTY_MEMBER" }
        assertEquals(listOf("PARTY_MEMBER", "PARTY_PROBATIONARY"), party.tagCodes)
        assertTrue(!party.byAge)

        val elderly = data.list.first { it.code == "ELDERLY" }
        assertTrue(elderly.byAge)
        assertEquals(60, elderly.minAge)
        assertTrue("年龄类没有标签", elderly.tagCodes.isEmpty())
    }

    /** GET /api/pending —— 原始行，且带 operator_name 等移动端不用的附加列 */
    @Test
    fun `待核查字段按 SQL 列名绑定`() {
        val json = """
            {
              "id": 12, "batch_no": "B20261001", "row_no": 5,
              "reason": "ID_CARD_INVALID", "reason_text": "身份证号校验位错误",
              "name": "张三", "gender": "男", "birth_date": "1968-03-04",
              "id_card": "32010219680304123", "phone": "13800000002", "phone_backup": null,
              "hukou_address": "江苏省某市某镇艾园村 1 号",
              "live_address": "江苏省某市某镇艾园村 2 号",
              "village": "艾园村", "grid_no": "G-001", "family_no": "F-0001",
              "relation": "户主", "status": "PENDING", "handle_note": null,
              "created_by": 1, "operator_name": "系统管理员",
              "created_at": "2026-10-01 09:00:00", "updated_at": "2026-10-01 09:00:00"
            }
        """.trimIndent()

        val p = AppJson.decodeFromString<PendingDto>(json)

        assertEquals(12, p.id)
        assertEquals("张三", p.name)
        // 原因码是 ID_CARD_INVALID 的行，这一列就是网格员要核对的原号码
        assertEquals("32010219680304123", p.idCard)
        assertEquals("1968-03-04", p.birthDate)
        assertEquals("ID_CARD_INVALID", p.reason)
        assertEquals("身份证号校验位错误", p.reasonText)
        assertEquals("艾园村", p.village)
        assertEquals("B20261001", p.batchNo)
        assertEquals("2026-10-01 09:00:00", p.createdAt)
    }
}
