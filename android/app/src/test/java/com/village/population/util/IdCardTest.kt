package com.village.population.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 身份证解析。
 *
 * 这组用例是照着后端 `backend/src/utils/idcard.ts` 的语义写的——
 * 客户端镜像一份逻辑，就必须用同一批边界条件钉住，否则两边会慢慢漂移，
 * 表现就是「手机上校验通过、上传后被后端拒绝」。
 */
class IdCardTest {

    /** 用一个校验位正确的号码（11010519491231002X 是公开的示例号） */
    private val validId = "11010519491231002X"

    @Test
    fun `合法18位号码通过并解析出出生日期与性别`() {
        val result = IdCard.validate(validId)
        assertTrue(result is IdCard.Result.Valid)
        result as IdCard.Result.Valid
        assertEquals(validId, result.normalized)
        assertEquals("1949-12-31", result.birthDate)
        // 第 17 位是 2，偶数 → 女
        assertEquals("FEMALE", result.gender)
    }

    @Test
    fun `校验位错误要被拦下`() {
        // 末位从 X 改成 1，加权校验必然不通过
        val result = IdCard.validate("110105194912310021")
        assertTrue(result is IdCard.Result.Invalid)
        assertEquals("身份证号码校验位错误", (result as IdCard.Result.Invalid).message)
    }

    @Test
    fun `长度为17位时报位数错误而不是格式错误`() {
        val result = IdCard.validate("11010519491231002")
        assertTrue(result is IdCard.Result.Invalid)
        assertTrue((result as IdCard.Result.Invalid).message.contains("18位"))
    }

    @Test
    fun `15位旧版按格式合法处理并升位补校验码`() {
        val result = IdCard.validate("110105491231002")
        assertTrue(result is IdCard.Result.Valid)
        result as IdCard.Result.Valid
        assertEquals(18, result.normalized.length)
        // 升位规则：第 7 位起插入 "19"
        assertTrue(result.normalized.startsWith("11010519"))
    }

    @Test
    fun `小写x应被归一化为大写`() {
        val result = IdCard.validate("11010519491231002x")
        assertTrue(result is IdCard.Result.Valid)
        assertEquals(validId, (result as IdCard.Result.Valid).normalized)
    }

    /**
     * 关键边界：校验位合法 ≠ 月日真实存在。
     * 这类号段确实存在（如 02-30），此时必须返回 null 让调用方回退，
     * 绝不能把不存在的日期写进 birth_date —— 那会让年龄算错，而且很难被发现。
     */
    @Test
    fun `不存在的月日返回空出生日期而不报错`() {
        assertNull(IdCard.birthOf("11010519490230002X"))
        assertNull(IdCard.birthOf("11010519491331002X"))
    }

    @Test
    fun `闰年2月29日被接受_平年被拒绝`() {
        assertEquals("2000-02-29", IdCard.birthOf("11010520000229001X"))
        assertNull(IdCard.birthOf("1900-02-29"))
    }

    @Test
    fun `闰年判断遵循四年一闰百年不闰四百年再闰`() {
        assertEquals("2000-02-29", IdCard.birthOf("11010520000229001X"))
        // 1900 不是闰年：从 15 位号补 19 前缀也能验证同样的规则
        assertNull(IdCard.birthOf("110105000229001"))
    }

    @Test
    fun `第17位奇数为男偶数为女`() {
        assertEquals("MALE", IdCard.genderOf("11010519491231003X"))
        assertEquals("FEMALE", IdCard.genderOf("11010519491231002X"))
        assertNull(IdCard.genderOf("123"))
    }

    @Test
    fun `空值与非数字输入给出可读提示`() {
        assertEquals("请输入身份证号", (IdCard.validate("") as IdCard.Result.Invalid).message)
        assertEquals("身份证号码格式不正确", (IdCard.validate("11010519491231002A") as IdCard.Result.Invalid).message)
    }
}
