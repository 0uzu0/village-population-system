package com.village.population.data.remote

import com.village.population.data.remote.dto.ApiEnvelope
import com.village.population.data.remote.dto.PersonCreateRequest
import com.village.population.data.remote.dto.PersonSaveResult
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.Assert.assertNotNull
import java.io.File

/**
 * 移动端 ↔ 后端请求体契约测试。
 *
 * ## 钉住的是哪类问题
 *
 * `PersonCreateRequest` 是 Kotlin 数据类，后端校验是 TypeScript 的 zod schema，
 * 两边**没有任何编译期联系**：后端把 `phone` 的上限从 255 改成 20、或者把枚举值
 * 换了个写法，Android 这边照样编译通过，只在村里点「保存」时才报一句看不懂的错。
 *
 * ## 做法：与后端共用同一份样本
 *
 * 样本在 `backend/test/fixtures/android/` 目录下，两端各读一次：
 *  - 后端 `test/androidContract.test.ts`：拿真实 zod schema 解析，确认后端接受；
 *  - 本文件：把数据类**真的序列化一遍**，逐键比对，确认 APP 发出的就是样本。
 *
 * 因此「后端改名 / 收紧上限」会在这里先红，而不是等走访现场才发现。
 *
 * 另一个被钉住的细节是 JSON 配置：explicitNulls=false 会让 null 字段**整个消失**。
 * 这是「文本字段清空要发空串、枚举未选要发 null（省略）」两种相反的语义能同时成立
 * 的前提，一旦有人改了 AppJson 的配置，这组用例会立刻失败。
 */
class AndroidApiContractTest {

    private val json = AppJson

    /**
     * 从当前工作目录向上找样本目录。
     * 单元测试的工作目录是 `android/app`，但不同 Gradle 版本可能是仓库根，
     * 逐级向上找比写死相对路径稳。
     */
    private fun fixture(name: String): JsonObject {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val file = File(dir, "backend/test/fixtures/android/$name")
            if (file.isFile) return Json.parseToJsonElement(file.readText()).jsonObject
            dir = dir.parentFile
        }
        error("找不到契约样本 $name（应在 backend/test/fixtures/android/ 下，从仓库内运行单元测试）")
    }

    private fun serialize(request: PersonCreateRequest): JsonObject =
        Json.parseToJsonElement(json.encodeToString(PersonCreateRequest.serializer(), request)).jsonObject

    @Test
    fun `上门登记_提交体与后端契约样本逐键一致`() {
        val request = PersonCreateRequest(
            name = "张三",
            gender = "MALE",
            birthDate = "1955-03-08",
            idCard = "320102195503081232",
            phone = "13800000001",
            phoneBackup = "13900000002",
            hukouAddress = "江苏省南京市某区某街道",
            liveAddress = "三组 12 号",
            village = "某村",
            relation = "HEAD",
            remark = "",
            tagIds = listOf(8),
        )

        // 逐键比较而不是比字符串：键顺序随数据类声明顺序变化，那样的断言会假红
        assertEquals(fixture("person-create.json"), serialize(request))
    }

    @Test
    fun `编辑时清空字段_发出的是空串而不是被省略`() {
        val request = PersonCreateRequest(
            name = "张三",
            gender = "MALE",
            birthDate = "1955-03-08",
            idCard = "320102195503081232",
            // 用户把电话、地址、备注都删空了
            phone = "",
            phoneBackup = "",
            hukouAddress = "",
            liveAddress = "",
            village = "某村",
            relation = "HEAD",
            remark = "",
            tagIds = listOf(8),
            rowVersion = 3,
        )

        val body = serialize(request)
        assertEquals(fixture("person-update-clear.json"), body)

        // 这三行是这条契约真正要保的东西：空值必须**出现在请求体里**。
        // 后端收到 '' 会把该列落成 NULL；若被省掉则视为「没提交」，清空就是假成功
        assertTrue("phone 必须以空串出现", body.containsKey("phone"))
        assertEquals("", body["phone"]?.jsonPrimitive?.content)
        assertTrue("remark 必须以空串出现", body.containsKey("remark"))
    }

    @Test
    fun `性别未选择时不发送该键_而不是发空串`() {
        val body = serialize(PersonCreateRequest(name = "张三"))

        // 后端 gender 是 z.enum(['MALE','FEMALE'])，空串会被直接拒掉，
        // 所以「没选」只能是键不存在（explicitNulls=false 的效果）
        assertFalse("未选性别时不能发 gender", body.containsKey("gender"))
        assertFalse("未选村庄时不能发 village", body.containsKey("village"))
        assertFalse("新增时不带版本号", body.containsKey("rowVersion"))
        assertTrue("姓名一定在", body.containsKey("name"))
    }

    @Test
    fun `待核查补录的 patch 与后端契约样本一致`() {
        // 界面只提交改动过的字段，这里模拟「补录了身份证、换了个电话、删掉备用电话」
        val body = buildJsonObject {
            put("name", "李四")
            put("idCard", "320102195503081232")
            put("phone", "13800000009")
            put("phoneBackup", "")
            put("handleNote", "已核对身份证")
        }

        assertEquals(fixture("pending-patch.json"), body)
        // 被清空的备用电话同样要以空串出现：后端把 '' 落成 NULL
        assertEquals("", body["phoneBackup"]?.jsonPrimitive?.content)
    }

    @Test
    fun `转待核查的响应能正确解析_pending 分支不靠 id 默认值蒙`() {
        // 后端未建正式档案时的真实响应体：没有 id，只有 pending 与 pendingId
        val env = json.decodeFromString(
            ApiEnvelope.serializer(PersonSaveResult.serializer()),
            """{"code":0,"message":"未填写身份证号，已转入待核查人员","data":{"pending":true,"pendingId":42}}"""
        )

        assertNotNull(env.data)
        assertTrue("必须识别出转待核查", env.data!!.pending)
        assertEquals(42, env.data!!.pendingId)
        // 关键：这条路径下 id 仍是默认值 0，界面靠 pending 判断，不靠 id==0
        assertEquals(0, env.data!!.id)
    }

    @Test
    fun `正常建档的响应解析出 id 与 personNo`() {
        val env = json.decodeFromString(
            ApiEnvelope.serializer(PersonSaveResult.serializer()),
            """{"code":0,"message":"新增成功","data":{"id":17,"personNo":"P0017"}}"""
        )

        assertEquals(17, env.data?.id)
        assertEquals("P0017", env.data?.personNo)
        assertFalse(env.data!!.pending)
    }
}
