package com.village.population.ui.update

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.village.population.BuildConfig
import com.village.population.data.repository.UpdateRepository
import com.village.population.ui.theme.AppTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.IOException

/** 更新功能的界面状态机 */
sealed interface UpdateState {
    data object Idle : UpdateState

    /** 手动检查进行中（启动时的静默检查不显示这个状态） */
    data object Checking : UpdateState

    /** 已是最新版本 */
    data class Latest(val version: String) : UpdateState

    /** 发现新版，等待用户确认下载 */
    data class Found(val version: String, val sizeText: String) : UpdateState

    /** 正在下载 */
    data class Downloading(val received: Long, val total: Long) : UpdateState {
        val progress: Float
            get() = if (total > 0) (received.toFloat() / total).coerceIn(0f, 1f) else 0f
    }

    data class Error(val message: String) : UpdateState
}

/**
 * 更新状态控制器：手动检查（「我的」页入口）与启动静默检查两处共用同一份逻辑。
 * 刻意不用 ViewModel——状态只活在本屏/本壳内，一个 remembered 对象足够。
 */
class UpdateController(
    private val scope: CoroutineScope,
    private val repository: UpdateRepository,
) {
    var state by mutableStateOf<UpdateState>(UpdateState.Idle)
        private set

    /** 最近一次检查到的更新信息，供「下载」按钮使用 */
    private var pending: UpdateRepository.UpdateInfo? = null

    /**
     * 检查更新。
     *
     * @param manual true = 用户主动点击：显示「检查中」、失败时弹错误；
     *               false = 启动静默检查：只在发现新版时弹，失败静默吞掉。
     */
    fun check(manual: Boolean) {
        val current = state
        if (current is UpdateState.Checking || current is UpdateState.Downloading) return
        if (manual) state = UpdateState.Checking
        scope.launch {
            try {
                val info = repository.checkForUpdate()
                if (info == null) {
                    state = if (manual) UpdateState.Latest(BuildConfig.VERSION_NAME) else UpdateState.Idle
                } else {
                    pending = info
                    state = UpdateState.Found(
                        version = info.version,
                        sizeText = if (info.sizeBytes > 0) formatBytes(info.sizeBytes) else "大小未知",
                    )
                }
            } catch (e: Exception) {
                state = if (manual) UpdateState.Error("检查更新失败：${shortError(e)}") else UpdateState.Idle
            }
        }
    }

    /** 下载 APK 并拉起系统安装器 */
    fun download() {
        val info = pending ?: return
        scope.launch {
            state = UpdateState.Downloading(0, 0)
            val file = try {
                repository.downloadApk(info.apkUrl) { received, total ->
                    state = UpdateState.Downloading(received, total)
                }
            } catch (e: Exception) {
                state = UpdateState.Error("下载失败：${shortError(e)}")
                return@launch
            }
            state = UpdateState.Idle
            try {
                val launched = repository.installApk(file)
                if (!launched) {
                    state = UpdateState.Error(
                        "请在系统设置中允许「安装未知应用」，然后重新点击检查更新下载安装。",
                    )
                }
            } catch (e: Exception) {
                state = UpdateState.Error("安装失败：${shortError(e)}")
            }
        }
    }

    fun dismiss() {
        state = UpdateState.Idle
        pending = null
    }
}

/** 更新流程的各类弹窗，纯展示，不含业务逻辑 */
@Composable
fun UpdateDialogs(
    state: UpdateState,
    onDismiss: () -> Unit,
    onDownload: () -> Unit,
) {
    when (state) {
        UpdateState.Idle -> Unit

        UpdateState.Checking -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("检查更新") },
            text = {
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(12.dp))
                    Text("正在检查…", style = MaterialTheme.typography.bodyMedium)
                }
            },
            confirmButton = {},
        )

        is UpdateState.Latest -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("已是最新版本") },
            text = { Text("当前版本 v${state.version} 已是最新。") },
            confirmButton = { TextButton(onClick = onDismiss) { Text("好的") } },
        )

        is UpdateState.Found -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("发现新版本") },
            text = { Text("检测到新版本 v${state.version}（${state.sizeText}），是否下载更新？") },
            confirmButton = { TextButton(onClick = onDownload) { Text("下载") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
        )

        is UpdateState.Downloading -> AlertDialog(
            // 下载中不允许点掉：点掉会丢「下载完成自动安装」的状态
            onDismissRequest = {},
            title = { Text("正在下载更新") },
            text = {
                Column {
                    LinearProgressIndicator(
                        progress = { state.progress },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        if (state.total > 0) {
                            "已下载 ${formatBytes(state.received)} / ${formatBytes(state.total)}"
                        } else {
                            "已下载 ${formatBytes(state.received)}"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = AppTheme.tokens.ink3,
                    )
                }
            },
            confirmButton = {},
        )

        is UpdateState.Error -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("更新") },
            text = { Text(state.message) },
            confirmButton = { TextButton(onClick = onDismiss) { Text("知道了") } },
        )
    }
}

/** 把字节数转成人话（下载进度与「发现新版」的体积提示共用） */
private fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return "${"%.0f".format(kb)} KB"
    val mb = kb / 1024.0
    return "${"%.1f".format(mb)} MB"
}

/** 把异常压成一句能直接给网格员看的短话 */
private fun shortError(e: Throwable): String = when (e) {
    is HttpException -> "HTTP ${e.code()}"
    is IOException -> "网络不可用，请稍后重试"
    else -> e.message?.takeIf { it.isNotBlank() } ?: "未知错误"
}
