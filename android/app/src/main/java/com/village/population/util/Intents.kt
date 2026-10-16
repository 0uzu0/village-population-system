package com.village.population.util

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * 跳系统拨号盘。
 *
 * 用 ACTION_DIAL 而不是 ACTION_CALL：后者需要 CALL_PHONE 权限，
 * 而且会「直接拨出去」——网格员点错一个号就麻烦大了。
 * 拨号盘模式让用户还能核对一眼号码再按拨打键。
 */
fun Context.dial(phone: String?) {
    val number = phone?.filter { it.isDigit() || it == '+' || it == '-' }?.takeIf { it.isNotBlank() } ?: return
    runCatching {
        startActivity(
            Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
