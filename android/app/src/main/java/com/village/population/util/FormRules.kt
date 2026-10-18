package com.village.population.util

/**
 * 表单字段的**长度与格式上限**，逐条对应后端 zod 校验。
 *
 * 为什么要在客户端再写一遍：这些上限在后端是「超了就 400」，而移动端的提交
 * 发生在**走访现场**——网格员填完一长串备注点了保存，才看到「保存失败」，
 * 此时人可能已经走了，网络又差，他不知道是哪一栏超了。提前在本地拦下来，
 * 提示语还能说清「最多 500 字」。
 *
 * 数字来源（改动必须同步，否则这里拦住或被后端打回的字段就对不上）：
 *  - `backend/src/modules/person.ts` 的 `personSchema`
 *  - `backend/src/modules/pending.ts` 的 `updateSchema`
 *  - 表结构 `person.remark VARCHAR(500)`、`import_pending.handle_note VARCHAR(255)`
 */
object FormRules {

    /** personSchema.name: z.string().max(64) */
    const val NAME_MAX = 64

    /** personSchema.hukouAddress / liveAddress: max(255) */
    const val ADDRESS_MAX = 255

    /** personSchema.village: max(128) */
    const val VILLAGE_MAX = 128

    /** personSchema.remark: max(500) */
    const val REMARK_MAX = 500

    /** import_pending.handle_note: VARCHAR(255) */
    const val HANDLE_NOTE_MAX = 255

    /** person.phone / phone_backup: VARCHAR(20) */
    const val PHONE_MAX = 20

    /** import_pending.grid_no / family_no: VARCHAR(64) */
    const val CODE_MAX = 64

    private val DATE_RE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

    /** 超长就返回提示语，否则 null */
    fun lengthError(label: String, value: String, max: Int): String? =
        if (value.length > max) "${label}最多 $max 个字符（当前 ${value.length} 个）" else null

    /**
     * 出生日期：允许为空（无身份证的新增会走到待核查，不强求日期），
     * 但填了就必须是 yyyy-MM-dd，否则后端 regex 会整单打回。
     * 只校验格式与月日范围，不做「必须是过去」这类业务判断——百岁老人、
     * 新生儿都要能录，判断留给后端口径。
     */
    fun dateError(label: String, value: String): String? {
        if (value.isBlank()) return null
        if (!DATE_RE.matches(value.trim())) return "${label}格式应为 yyyy-MM-dd"
        val (y, m, d) = value.trim().split("-").map { it.toInt() }
        if (m !in 1..12) return "${label}月份不正确"
        val days = daysInMonth(y, m)
        if (d !in 1..days) return "${label}日期不正确"
        return null
    }

    /**
     * 性别：移动端待核查弹窗里是可编辑文本框，用户可能输入「男」之外的任意内容。
     * 后端的枚举只认 MALE / FEMALE，所以这里必须先翻译/拦截，
     * 否则一次保存会得到一条看不懂的「Invalid enum value」。
     */
    fun genderCode(input: String): String? = when (input.trim().uppercase()) {
        "MALE", "男" -> "MALE"
        "FEMALE", "女" -> "FEMALE"
        else -> null
    }

    private fun daysInMonth(year: Int, month: Int): Int = when (month) {
        1, 3, 5, 7, 8, 10, 12 -> 31
        4, 6, 9, 11 -> 30
        else -> if ((year % 4 == 0 && year % 100 != 0) || year % 400 == 0) 29 else 28
    }
}
