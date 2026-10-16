package com.village.population.util

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * 日期与年龄。
 *
 * 刻意不用 java.time：那需要开启 core library desugaring（minSdk 24 < 26），
 * 而这里只需要「算年龄」和「格式化时间戳」两件事，Calendar + SimpleDateFormat 足够。
 * 少一个构建插件、少一层脱糖，CI 就少一个出问题的机会。
 *
 * 年龄口径与后端 `utils/age.ts` 的 calcAge 一致：**按年月日三元组比较**，
 * 不是「今年减出生年」——后者会把 12 月生日的人在 1 月就算大一岁。
 */
object DateText {

    private val DATE_TIME = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA)
    private val DATE_ONLY = SimpleDateFormat("yyyy-MM-dd", Locale.CHINA)

    /** 今天，yyyy-MM-dd */
    fun today(): String = DATE_ONLY.format(Date())

    fun formatDateTime(millis: Long): String =
        if (millis <= 0L) "—" else DATE_TIME.format(Date(millis))

    fun formatDate(millis: Long): String =
        if (millis <= 0L) "—" else DATE_ONLY.format(Date(millis))

    /**
     * 由出生日期算年龄（周岁）。出生日期非法时返回 null。
     * @param todayY/todayM/todayD 传入当天，便于单元测试固定时间
     */
    fun ageOf(birthDate: String?, todayY: Int, todayM: Int, todayD: Int): Int? {
        val parts = birthDate?.trim()?.split("-") ?: return null
        if (parts.size != 3) return null
        val year = parts[0].toIntOrNull() ?: return null
        val month = parts[1].toIntOrNull() ?: return null
        val day = parts[2].toIntOrNull() ?: return null
        if (month !in 1..12 || day !in 1..31 || year < 1900 || year > 2100) return null

        var age = todayY - year
        // 今年的生日还没到，减一岁
        if (todayM < month || (todayM == month && todayD < day)) age--
        return age.takeIf { it >= 0 }
    }

    fun ageOf(birthDate: String?): Int? {
        val now = Calendar.getInstance()
        return ageOf(
            birthDate,
            now.get(Calendar.YEAR),
            now.get(Calendar.MONTH) + 1,
            now.get(Calendar.DAY_OF_MONTH),
        )
    }

    /** 「离线数据，截至 10-16 15:20」里用的相对时间描述 */
    fun describeAge(millis: Long): String {
        if (millis <= 0L) return "未知"
        val diff = System.currentTimeMillis() - millis
        val minutes = diff / 60_000
        return when {
            minutes < 1 -> "刚刚"
            minutes < 60 -> "${minutes} 分钟前"
            minutes < 60 * 24 -> "${minutes / 60} 小时前"
            else -> "${minutes / (60 * 24)} 天前"
        }
    }
}
