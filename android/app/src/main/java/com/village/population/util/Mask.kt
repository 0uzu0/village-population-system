package com.village.population.util

/**
 * 界面脱敏。
 *
 * 后端存的是**明文**身份证号与手机号（它要拿证件号做权威的出生日期/性别来源），
 * 但列表和详情页是给网格员在村里、在村委会办公室翻的，一整屏身份证号裸奔既没必要，
 * 也容易被人顺手拍走。设计稿里定的口径就是这两条，照抄：
 *
 *   身份证号  XXXXXX1948****0026   ← 前 6 位（地区码）抹掉，出生年与后 4 位保留
 *   手机号    138****6021          ← 前 3 位与后 4 位保留
 *
 * 保留出生年与后 4 位是有意的：网格员核人靠的就是「年纪对得上」加「尾号对得上」，
 * 全抹掉等于让人拿着一个无法核对的字符串下乡。
 *
 * 需要完整号码的地方（待核查详情、编辑表单）**不要**用这里的方法，
 * 那一屏存在的意义就是逐位核对。
 */
object Mask {

    /**
     * 身份证号脱敏。
     * 18 位正常号码 → `XXXXXX` + 出生年 + `****` + 后 4 位。
     * 位数不足（含 14 位脱敏号）或非纯数字时返回原样：这类值本来就不是完整号，
     * 再按位切会切出一个既不像原值也不像脱敏值的四不像，反而没法核对。
     */
    fun idCard(raw: String?): String {
        val value = raw?.trim().orEmpty()
        if (value.length != 18) return value
        val year = value.substring(6, 10)
        val tail = value.substring(14, 18)
        return "XXXXXX$year****$tail"
    }

    /** 手机号脱敏。11 位 → 前 3 + `****` + 后 4；不是 11 位就原样返回（座机、短号） */
    fun phone(raw: String?): String {
        val value = raw?.trim().orEmpty()
        if (value.length != 11) return value
        return value.take(3) + "****" + value.takeLast(4)
    }
}
