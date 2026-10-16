package com.village.population.ui.screens.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.BuildConfig
import com.village.population.data.local.queue.QueuedOp
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.components.FormField
import com.village.population.ui.components.SectionCard
import com.village.population.util.DateText
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

@Composable
fun ProfileScreen(onLoggedOut: () -> Unit) {
    val container = LocalAppContainer.current
    val scope = rememberCoroutineScope()
    val user by container.session.user.collectAsStateWithLifecycle()
    val pendingOps by container.queue.size.collectAsStateWithLifecycle()

    var baseUrl by remember { mutableStateOf(container.settings.baseUrlInMemory) }
    var baseUrlMessage by remember { mutableStateOf<String?>(null) }
    var ops by remember { mutableStateOf<List<QueuedOp>>(emptyList()) }
    var message by remember { mutableStateOf<String?>(null) }
    var showPasswordDialog by remember { mutableStateOf(false) }
    var showLogoutDialog by remember { mutableStateOf(false) }
    var lastSyncAt by remember { mutableStateOf(0L) }

    suspend fun refreshLocal() {
        ops = container.queue.all()
        lastSyncAt = runCatching { container.settings.lastSyncAtFlow.first() }.getOrDefault(0L)
    }

    LaunchedEffect(pendingOps, message) { refreshLocal() }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SectionCard(title = "当前账号") {
            Text(
                user?.displayName ?: "未登录",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "账号：${user?.username ?: "—"}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (user?.roles?.isNotEmpty() == true) {
                Text(
                    "角色：${user!!.roles.joinToString("、")}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                "权限项：${user?.permissions?.size ?: 0} 个" + if (user?.isAdmin == true) "（管理员）" else "",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
            Spacer(Modifier.height(10.dp))
            OutlinedButton(onClick = { showPasswordDialog = true }) { Text("修改密码") }
        }

        SectionCard(title = "服务器地址") {
            FormField(
                label = "地址",
                value = baseUrl,
                onValueChange = { baseUrl = it; baseUrlMessage = null },
                placeholder = "192.168.1.100:8080",
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "只填 IP 与端口即可，程序会自动补 http://。同一个安装包分发给多个村时，" +
                    "各村的地址在这里单独设置。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = {
                        scope.launch {
                            container.settings.saveBaseUrl(baseUrl)
                            baseUrl = container.settings.baseUrlInMemory
                            baseUrlMessage = "已保存"
                        }
                    },
                    modifier = Modifier.weight(1f),
                ) { Text("保存") }
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            container.settings.resetBaseUrl()
                            baseUrl = container.settings.baseUrlInMemory
                            baseUrlMessage = "已恢复打包时注入的默认地址"
                        }
                    },
                    modifier = Modifier.weight(1f),
                ) { Text("恢复默认") }
            }
            baseUrlMessage?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.secondary)
            }
        }

        SectionCard(title = "离线数据") {
            Text(
                "待同步 $pendingOps 条",
                style = MaterialTheme.typography.bodyLarge,
                color = if (pendingOps > 0) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "上次同步：${if (lastSyncAt > 0) DateText.formatDateTime(lastSyncAt) else "尚未同步"}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = {
                        container.syncManager.requestSync()
                        message = "已请求同步；同步在后台进行，完成后本页数字会更新"
                    },
                    modifier = Modifier.weight(1f),
                    enabled = pendingOps > 0,
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
                                color = if (op.exhausted) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline,
                            )
                        }
                        TextButton(onClick = { scope.launch { container.queue.removeWithFile(op); refreshLocal() } }) {
                            Text("删除")
                        }
                    }
                }
                if (ops.size > 20) {
                    Text(
                        "仅显示前 20 条，共 ${ops.size} 条",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            }
        }

        SectionCard(title = "关于") {
            Text("掌上村务 ${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）", style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(4.dp))
            Text(
                "村级人口与重点人群精细化管理系统 · 移动端\n" +
                    "人口数据以身份证号为权威来源；统计口径为在册人口（正常 / 迁入）。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        message?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.secondary)
        }

        OutlinedButton(
            onClick = { showLogoutDialog = true },
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) { Text("退出登录") }

        Spacer(Modifier.height(24.dp))
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
                        color = if (ok) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error,
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
