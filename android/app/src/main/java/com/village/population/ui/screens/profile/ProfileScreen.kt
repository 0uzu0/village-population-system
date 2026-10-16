package com.village.population.ui.screens.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.BuildConfig
import com.village.population.data.local.queue.QueuedOp
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.components.FormField
import com.village.population.ui.components.clickableNoRipple
import com.village.population.ui.theme.AppTheme
import com.village.population.ui.theme.AppShapes
import com.village.population.util.DateText
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@Composable
fun ProfileScreen(onLoggedOut: () -> Unit) {
    val container = LocalAppContainer.current
    val tokens = AppTheme.tokens
    val scope = rememberCoroutineScope()
    val updateController = container.updateController
    val user by container.session.user.collectAsStateWithLifecycle()
    val pendingOps by container.queue.size.collectAsStateWithLifecycle()

    var baseUrl by remember { mutableStateOf(container.settings.baseUrlInMemory) }
    var baseUrlMessage by remember { mutableStateOf<String?>(null) }
    var ops by remember { mutableStateOf<List<QueuedOp>>(emptyList()) }
    var message by remember { mutableStateOf<String?>(null) }
    var showPasswordDialog by remember { mutableStateOf(false) }
    var showLogoutDialog by remember { mutableStateOf(false) }
    var showServerDialog by remember { mutableStateOf(false) }
    var showQueueDialog by remember { mutableStateOf(false) }
    var lastSyncAt by remember { mutableStateOf(0L) }

    suspend fun refreshLocal() {
        ops = container.queue.all()
        lastSyncAt = runCatching { container.settings.lastSyncAtFlow.first() }.getOrDefault(0L)
    }

    LaunchedEffect(pendingOps, message, showQueueDialog) { refreshLocal() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
    ) {
        // 身份头，对应设计稿「我的」页顶部那块品牌渐变。
        // 这一页没有页头（它是底部 Tab），这块渐变同时承担「我在哪一屏」和「我是谁」两件事
        Column(
            Modifier
                .fillMaxWidth()
                .background(Brush.linearGradient(listOf(tokens.brand, tokens.brandStrong)))
                .padding(start = 18.dp, end = 18.dp, top = 26.dp, bottom = 22.dp),
        ) {
            Box(
                Modifier.size(44.dp).background(Color.White.copy(alpha = 0.22f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Person, contentDescription = null, tint = Color.White)
            }
            Spacer(Modifier.height(9.dp))
            Text(
                user?.displayName ?: "未登录",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = Color.White,
            )
            Text(
                listOfNotNull(
                    user?.roles?.takeIf { it.isNotEmpty() }?.joinToString("、") ?: "网格员",
                    user?.username?.let { "账号 $it" },
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = Color.White.copy(alpha = 0.85f),
            )
        }

        Column(
            Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            // 设置项收成一张列表卡（设计稿做法）：三行都是「点进去做一件事」，
            // 摊成三张卡片会让页面显得比实际长了三倍
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(AppShapes.card),
                shadowElevation = AppShapes.cardElevation,
                tonalElevation = 0.dp,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column {
                    SettingRow(
                        icon = Icons.Filled.Public,
                        title = "服务器地址",
                        subtitle = container.settings.baseUrlInMemory,
                    ) { showServerDialog = true }

                    SettingDivider()

                    SettingRow(
                        icon = Icons.Filled.SystemUpdate,
                        title = "检查更新",
                        subtitle = "当前版本 ${BuildConfig.VERSION_NAME}",
                    ) { updateController.check(manual = true) }

                    SettingDivider()

                    SettingRow(
                        icon = Icons.Filled.CloudUpload,
                        title = "待同步记录",
                        subtitle = if (pendingOps > 0) {
                            "$pendingOps 条待上传" +
                                (ops.firstOrNull { it.lastError != null }?.lastError?.let { " · 最近失败：$it" } ?: "")
                        } else {
                            "全部已上传"
                        },
                        trailing = if (pendingOps > 0) "$pendingOps" else null,
                    ) { showQueueDialog = true }

                    SettingDivider()

                    SettingRow(
                        icon = Icons.Filled.Lock,
                        title = "修改密码",
                        subtitle = "账号：${user?.username ?: "—"}",
                    ) { showPasswordDialog = true }
                }
            }

            message?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = tokens.green)
            }

            OutlinedButton(
                onClick = { showLogoutDialog = true },
                shape = RoundedCornerShape(AppShapes.control),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text("退出登录") }

            Text(
                "掌上村务 ${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）\n" +
                    "未上传的数据不会因为退出登录而丢失；人口数据以身份证号为权威来源，" +
                    "统计口径为在册人口（正常 / 迁入）。",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.ink3,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
        }
    }

    if (showServerDialog) {
        AlertDialog(
            onDismissRequest = { showServerDialog = false },
            title = { Text("服务器地址") },
            text = {
                Column {
                    FormField(
                        label = "地址",
                        value = baseUrl,
                        onValueChange = { baseUrl = it; baseUrlMessage = null },
                        placeholder = "192.168.1.100:8080",
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "只填 IP 与端口即可，程序会自动补 http://。同一个安装包分发给多个村时，" +
                            "各村的地址在这里单独设置。",
                        style = MaterialTheme.typography.bodySmall,
                        color = AppTheme.tokens.ink3,
                    )
                    baseUrlMessage?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = AppTheme.tokens.green)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        container.settings.saveBaseUrl(baseUrl)
                        baseUrl = container.settings.baseUrlInMemory
                        baseUrlMessage = "已保存：${container.settings.baseUrlInMemory}"
                    }
                }) { Text("保存") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        scope.launch {
                            container.settings.resetBaseUrl()
                            baseUrl = container.settings.baseUrlInMemory
                            baseUrlMessage = "已恢复打包时注入的默认地址"
                        }
                    }) { Text("恢复默认") }
                    TextButton(onClick = { showServerDialog = false; baseUrlMessage = null }) { Text("关闭") }
                }
            },
        )
    }

    if (showQueueDialog) {
        AlertDialog(
            onDismissRequest = { showQueueDialog = false },
            title = { Text("待同步记录") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text(
                        "待同步 $pendingOps 条\n" +
                            "上次同步：${if (lastSyncAt > 0) DateText.formatDateTime(lastSyncAt) else "尚未同步"}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (pendingOps > 0) AppTheme.tokens.amber else AppTheme.tokens.ink2,
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = {
                                container.syncManager.requestSync()
                                message = "已请求同步；同步在后台进行，完成后本页数字会更新"
                            },
                            enabled = pendingOps > 0,
                            modifier = Modifier.weight(1f),
                        ) { Text("立即同步") }
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    container.cache.clear()
                                    message = "已清空本地缓存（未上传的数据保留）"
                                }
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text("清空缓存") }
                    }

                    if (ops.isNotEmpty()) {
                        Spacer(Modifier.height(12.dp))
                        Text("队列明细", style = MaterialTheme.typography.bodyMedium)
                        ops.take(20).forEach { op ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text(op.label.ifBlank { op.type }, style = MaterialTheme.typography.bodyMedium)
                                    Text(
                                        listOfNotNull(
                                            DateText.formatDateTime(op.createdAt),
                                            op.attempts.takeIf { it > 0 }?.let { "已重试 $it 次" },
                                            op.lastError,
                                        ).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = if (op.exhausted) MaterialTheme.colorScheme.error
                                        else AppTheme.tokens.ink3,
                                    )
                                }
                                TextButton(onClick = {
                                    scope.launch { container.queue.removeWithFile(op); refreshLocal() }
                                }) { Text("删除") }
                            }
                        }
                        if (ops.size > 20) {
                            Text(
                                "仅显示前 20 条，共 ${ops.size} 条",
                                style = MaterialTheme.typography.bodySmall,
                                color = AppTheme.tokens.ink3,
                            )
                        }
                    } else {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "队列里没有待上传的记录。",
                            style = MaterialTheme.typography.bodySmall,
                            color = AppTheme.tokens.ink3,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showQueueDialog = false }) { Text("关闭") }
            },
        )
    }

    if (showPasswordDialog) {
        ChangePasswordDialog(
            onDismiss = { showPasswordDialog = false },
            onSubmit = { oldPwd, newPwd, onResult ->
                scope.launch {
                    try {
                        container.authRepository.changePassword(oldPwd, newPwd)
                        onResult(true, "密码已修改，下次登录请使用新密码")
                    } catch (e: Exception) {
                        onResult(false, e.toUserMessage())
                    }
                }
            },
        )
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("退出登录") },
            text = {
                Text(
                    if (pendingOps > 0)
                        "本机还有 $pendingOps 条未同步的记录。退出登录不会删除它们，" +
                            "重新登录后可以继续同步。"
                    else "确认退出当前账号？"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    scope.launch {
                        container.logout()
                        onLoggedOut()
                    }
                }) { Text("退出") }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) { Text("取消") }
            },
        )
    }
}

/** 设置列表的一行，对应设计稿「我的」里那三行（图标 + 标题 + 副标题 + 右侧值 + ›） */
@Composable
private fun SettingRow(
    icon: ImageVector,
    title: String,
    subtitle: String?,
    trailing: String? = null,
    onClick: () -> Unit,
) {
    val tokens = AppTheme.tokens
    Row(
        Modifier
            .fillMaxWidth()
            .clickableNoRipple(true, onClick)
            .padding(horizontal = 13.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tokens.ink2, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = tokens.ink)
            if (!subtitle.isNullOrBlank()) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                    maxLines = 1,
                )
            }
        }
        if (trailing != null) {
            Text(
                trailing,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = tokens.brand,
            )
        }
        Spacer(Modifier.width(4.dp))
        Icon(
            Icons.Filled.ChevronRight,
            contentDescription = null,
            tint = tokens.ink3,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
private fun SettingDivider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(AppTheme.tokens.line2))
}

@Composable
private fun ChangePasswordDialog(
    onDismiss: () -> Unit,
    onSubmit: (String, String, (Boolean, String) -> Unit) -> Unit,
) {
    var oldPwd by remember { mutableStateOf("") }
    var newPwd by remember { mutableStateOf("") }
    var confirmPwd by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("修改密码") },
        text = {
            Column {
                FormField("原密码", oldPwd, { oldPwd = it; result = null })
                Spacer(Modifier.height(10.dp))
                FormField("新密码（至少 8 位）", newPwd, { newPwd = it; result = null })
                Spacer(Modifier.height(10.dp))
                FormField("确认新密码", confirmPwd, { confirmPwd = it; result = null })
                result?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (ok) AppTheme.tokens.green else MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                when {
                    oldPwd.isBlank() || newPwd.isBlank() -> {
                        ok = false; result = "请填写完整"
                    }
                    newPwd.length < 8 -> {
                        ok = false; result = "新密码至少 8 位（与后端校验一致）"
                    }
                    newPwd != confirmPwd -> {
                        ok = false; result = "两次输入的新密码不一致"
                    }
                    else -> onSubmit(oldPwd, newPwd) { success, message ->
                        ok = success
                        result = message
                        if (success) {
                            oldPwd = ""; newPwd = ""; confirmPwd = ""
                        }
                    }
                }
            }) { Text("确定") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
