package com.village.population.data.remote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 查询参数名的守卫。
 *
 * 这一类错误的失败方式几乎没有声音：后端 zod 会把 `z.object` 里没声明的键
 * **直接丢掉且不报错**，于是 `@Query("village")` 发出去的 `?village=艾园村`
 * 被静默忽略，接口照常 200、照常返回全量——界面上只是「筛选了但没生效」。
 *
 * 手机端「按村庄筛选」就是这个状态一直没人发现：选了村，人数没变，
 * 还以为是缓存没刷。所以用源码断言把参数名钉死，改错了先红灯。
 */
class ApiParamContractTest {

    private val source: String by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val file = File(dir, "app/src/main/java/com/village/population/data/remote/ApiService.kt")
            if (file.isFile) return@lazy file.readText()
            dir = dir.parentFile
        }
        error("找不到 ApiService.kt（应在 android/app/src/main/java/… 下运行单元测试）")
    }

    @Test
    fun `村庄筛选必须用复数 villages——后端只认这个键`() {
        assertTrue(source, source.contains("@Query(\"villages\")"))
        assertFalse(
            "单数 village 会被后端静默忽略，筛了等于没筛",
            Regex("""@Query\("village"\)""").containsMatchIn(source)
        )
    }

    @Test
    fun `家庭详情接口存在且路径正确`() {
        assertTrue(source.contains("@GET(\"api/families/{id}\")"))
    }
}
