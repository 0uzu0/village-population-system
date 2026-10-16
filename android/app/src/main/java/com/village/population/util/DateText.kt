package com.village.population.util

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

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
    private val DATE_TIME_SEC = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA)

    /**
     * 北京时区。后端的 mysql2 连接配的是 `timezone: '+08:00'`，
     * `file.ts` 的 `stampOf` 也固定按北京时间输出文件名，所以这里必须跟它同一口径——
     * 否则同一个时刻在手机上与在服务器上会是两个名字。
     *
     * 写死 Asia/Shanghai 而不是取「设备当前时区」：手机被带到别的时区
     * （或有人改了系统时区）时，按当地时间命名会与后台的存档对不上，
     * 而这套东西只在中国境内的行政村使用，写死是安全的。
     */
    private val CN_ZONE = TimeZone.getTimeZone("Asia/Shanghai")

    /** 文件名时间戳 `yyyy-MM-dd-HHmmss`。秒固定写全，排序才等价于时间排序 */
    private val FILE_STAMP = SimpleDateFormat("yyyy-MM-dd-HH-mm-ss", Locale.CHINA).apply {
        timeZone = CN_ZONE
    }

    /** 今天，yyyy-MM-dd */
    fun today(): String = DATE_ONLY.format(Date())

    /**
     * 文件名用的时间戳 `yyyy-MM-dd-HH-mm-ss`，与后端 file.ts 的 stampOf 同一形状。
     *
     * 为什么是 `-` 而不是 `:`：`:` 在 Windows / NTFS 上是非法字符，
     * 从服务器上拷下来的照片在村委的办公机上可能打不开。
     *
     * 本机暂存名（`IMG_2026-10-16-13-00-05.jpg`）与后台落盘名
     * （`张三/2026-10-16-13-00-05.jpg`）因此同形，
     * 「本机待同步列表里看到的名字」和「上传后在服务器上的名字」能直接对上，
     * 排查问题时不用再到服务器上去翻。
     */
    fun fileStamp(millis: Long): String = FILE_STAMP.format(Date(millis))

    fun formatDateTime(millis: Long): String =
        if (millis <= 0L) "—" else DATE_TIME.format(Date(millis))

    /** 带秒的时间。同一分钟连拍的照片，只有秒能把它们分开 */
    fun formatTimestamp(millis: Long): String =
        if (millis <= 0L) "—" else DATE_TIME_SEC.format(Date(millis))

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
