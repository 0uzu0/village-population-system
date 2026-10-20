package com.village.population.util

import android.content.Context
import android.os.Build
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 崩溃日志落地。
 *
 * 为什么需要它：村级现场的手机不在我们手上，崩溃后用户只能说「打开就闪退」，
 * 拿不到任何栈信息，排查只能靠猜（这已经发生过两次）。这里把未捕获异常的
 * 完整堆栈写到应用私有目录，**下次启动后可在「我的 → 崩溃诊断」里看到并复制**，
 * 用户把那段文字发过来即可定位。
 *
 * 三条设计约束：
 *  1. 崩溃处理器里**绝对不能抛异常**——所有 IO 都 runCatching 包死，
 *     否则会从「应用崩了」变成「应用崩了且一直弹系统崩溃框」；
 *  2. 必须先调原来的处理器：系统仍需知道这次崩溃（ANR/统计/系统日志依赖它）；
 *  3. 只保留最近若干条，避免长期占用空间；每条有大小上限，
 *     有些异常链会打印上万行。
 */
object CrashLogger {

    private const val DIR_NAME = "crash"
    private const val MAX_FILES = 10

    /** 单条报告最大字符数。异常链爆炸时截断，保证还能写下去 */
    private const val MAX_REPORT_CHARS = 60_000

    private val TIME = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA)

    @Volatile
    private var crashDir: File? = null

    /** 在 Application.onCreate 的第一行调用（早于任何依赖装配） */
    fun install(context: Context) {
        val dir = File(context.filesDir, DIR_NAME)
        crashDir = dir
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                dir.mkdirs()
                dir.listFiles()?.sortedByDescending { it.lastModified() }
                    ?.drop(MAX_FILES - 1)
                    ?.forEach { it.delete() }
                val stamp = File(dir, "crash-${System.currentTimeMillis()}.txt")
                stamp.writeText(buildReport(thread, error))
            }
            // 交回系统默认处理（进程大概率会被杀，这是正常的）
            previous?.uncaughtException(thread, error)
        }
    }

    /** 生成报告文本。抽成纯函数便于单元测试 */
    fun buildReport(
        thread: Thread,
        error: Throwable,
        versionName: String = "",
        versionCode: Int = 0,
        device: String = "",
        time: String = TIME.format(Date()),
    ): String {
        val header = buildString {
            appendLine("时间：$time")
            appendLine("应用版本：$versionName（versionCode=$versionCode）")
            appendLine("设备：$device")
            appendLine("线程：${thread.name}")
            appendLine("异常：${error.javaClass.name}")
            appendLine("消息：${error.message ?: "(无)"}")
            appendLine()
            appendLine("---- 堆栈 ----")
            appendLine(error.stackTraceToString())
        }
        return if (header.length > MAX_REPORT_CHARS) header.take(MAX_REPORT_CHARS) + "\n…（已截断）" else header
    }

    private fun buildReport(thread: Thread, error: Throwable): String = buildReport(
        thread = thread,
        error = error,
        versionName = runCatching { com.village.population.BuildConfig.VERSION_NAME }.getOrDefault(""),
        versionCode = runCatching { com.village.population.BuildConfig.VERSION_CODE }.getOrDefault(0),
        device = runCatching {
            "${Build.MANUFACTURER} ${Build.MODEL} / Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
        }.getOrDefault("未知设备"),
    )

    /** 已有的崩溃记录，按时间倒序 */
    fun list(context: Context): List<File> {
        val dir = crashDir ?: File(context.filesDir, DIR_NAME)
        return dir.listFiles { f -> f.isFile && f.name.startsWith("crash-") }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()
    }

    fun read(file: File): String = runCatching { file.readText() }.getOrDefault("（读取失败）")

    fun readLatest(context: Context): String? = list(context).firstOrNull()?.let { read(it) }

    fun count(context: Context): Int = list(context).size

    fun clear(context: Context) {
        val dir = crashDir ?: File(context.filesDir, DIR_NAME)
        runCatching { dir.listFiles()?.forEach { it.delete() } }
    }
}
