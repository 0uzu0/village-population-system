package com.village.population.util

/**
 * 身份证号解析（GB 11643-1999）。
 *
 * 这是后端 `backend/src/utils/idcard.ts` 的**同口径客户端镜像**，不是另立一套规则。
 * 为什么要镜像一份：走访现场没信号，登记只能先在本地完成，此时：
 *  - 校验位错误要立刻告诉用户，不能等上传后才被后端打回（那时人已经走了）；
 *  - 出生日期与性别要从证件号带出来，不能手填（手填必错，而且后端本来也会覆盖）。
 *
 * 三条与后端保持一致的细节，改动时必须同步：
 *  1. 15 位旧版按「格式合法」处理，升位后补校验码，不做加权校验；
 *  2. **校验位合法 ≠ 月日存在**（会出现 02-30 这类号段），
 *     这种返回 birthDate = null，交由调用方回退，绝不把假日期写进档案；
 *  3. 性别编码是 `MALE` / `FEMALE`，不是「男/女」。
 */
object IdCard {

    private val WEIGHTS = intArrayOf(7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)

    /** 校验码表：下标 = 加权和 % 11 */
    private const val CHECK_CODES = "10X98765432"

    private val RE_15 = Regex("^\\d{15}$")
    private val RE_18 = Regex("^\\d{17}[\\dX]$")

    sealed interface Result {
        data class Valid(
            val normalized: String,
            val birthDate: String?,
            val gender: String?,
        ) : Result

        data class Invalid(val message: String) : Result
    }

    fun validate(raw: String): Result {
        val value = raw.trim().uppercase()
        if (value.isEmpty()) return Result.Invalid("请输入身份证号")

        if (value.length == 15) {
            if (!RE_15.matches(value)) return Result.Invalid("15位身份证必须为数字")
            val upgraded = value.substring(0, 6) + "19" + value.substring(6)
            val normalized = upgraded + checkCodeOf(upgraded)
            return Result.Valid(normalized, birthOf(normalized), genderOf(normalized))
        }

        if (value.length != 18) return Result.Invalid("身份证号码必须为18位（或15位旧版）")
        if (!RE_18.matches(value)) return Result.Invalid("身份证号码格式不正确")

        val sum = WEIGHTS.indices.sumOf { WEIGHTS[it] * (value[it] - '0') }
        if (CHECK_CODES[sum % 11] != value[17]) return Result.Invalid("身份证号码校验位错误")

        return Result.Valid(value, birthOf(value), genderOf(value))
    }

    /** 由 17 位前缀算校验位（15 位升位用） */
    private fun checkCodeOf(prefix17: String): Char {
        if (prefix17.length != 17) return ' '
        val sum = WEIGHTS.indices.sumOf { WEIGHTS[it] * (prefix17[it] - '0') }
        return CHECK_CODES[sum % 11]
    }

    /** 提取出生日期 yyyy-MM-dd；月日不存在时返回 null */
    fun birthOf(id: String): String? {
        val value = id.trim()
        val y: String
        val m: String
        val d: String
        when (value.length) {
            18 -> {
                y = value.substring(6, 10)
                m = value.substring(10, 12)
                d = value.substring(12, 14)
            }
            15 -> {
                y = "19" + value.substring(6, 8)
                m = value.substring(8, 10)
                d = value.substring(10, 12)
            }
            else -> return null
        }
        if (!Regex("^\\d{4}$").matches(y) || !Regex("^\\d{2}$").matches(m) || !Regex("^\\d{2}$").matches(d)) {
            return null
        }
        val yi = y.toInt()
        val mi = m.toInt()
        val di = d.toInt()
        if (yi < 1900 || yi > 2100 || mi < 1 || mi > 12 || di < 1) return null
        if (di > daysInMonth(yi, mi)) return null
        return "$y-$m-$d"
    }

    /** 第 17 位（15 位版第 15 位）奇数为男 */
    fun genderOf(id: String): String? {
        val value = id.trim()
        if (value.length != 18 && value.length != 15) return null
        val digit = if (value.length == 18) value[16] - '0' else value[14] - '0'
        return if (digit % 2 == 1) "MALE" else "FEMALE"
    }

    private fun daysInMonth(year: Int, month: Int): Int = when (month) {
        1, 3, 5, 7, 8, 10, 12 -> 31
        4, 6, 9, 11 -> 30
        else -> if (isLeapYear(year)) 29 else 28
    }

    private fun isLeapYear(year: Int): Boolean =
        (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}
