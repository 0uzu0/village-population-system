package com.village.population.util

/**
 * 语义化版本比较（纯函数，便于单测）。
 *
 * 只比较「主.次.修订」三段数字，忽略 v/V 前缀与 `-debug` / `-rc` 之类的后缀。
 * 本项目的版本号有两个来源、格式不完全一致：`BuildConfig.VERSION_NAME`
 * 在 debug 包下是 `1.0.3-debug`，GitHub 的 tag 形如 `v1.0.4`。直接按字符串
 * 比较会得出「1.0.10 < 1.0.9」这种错误结论，所以必须拆段后逐位比。
 *
 * @return a>b 返回 1，a<b 返回 -1，相等返回 0
 */
fun compareVersions(a: String, b: String): Int {
    val pa = toParts(a)
    val pb = toParts(b)
    val n = maxOf(pa.size, pb.size)
    for (i in 0 until n) {
        val x = pa.getOrElse(i) { 0 }
        val y = pb.getOrElse(i) { 0 }
        if (x > y) return 1
        if (x < y) return -1
    }
    return 0
}

/** latest 是否比 current 新（用于判断「要不要提示升级」） */
fun isNewerVersion(latest: String, current: String): Boolean = compareVersions(latest, current) > 0

/** 去掉 v/V 前缀与 `-xxx` 后缀，把每一段取开头的连续数字（非数字段当 0） */
private fun toParts(raw: String): List<Int> =
    raw.trim()
        .removePrefix("v")
        .removePrefix("V")
        .substringBefore('-')
        .split('.')
        .map { seg -> seg.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }
