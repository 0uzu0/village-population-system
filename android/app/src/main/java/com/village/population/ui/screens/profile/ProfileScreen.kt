package com.village.population.ui.screens.profile

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.platform.LocalContext
import android.content.ClipData
import android.content.ClipboardManager
import com.village.population.BuildConfig
import com.village.population.data.local.queue.QueuedOp
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.components.ActionButton
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.FormField
import com.village.population.ui.components.clickableNoRipple
import com.village.population.ui.theme.AppTheme
import com.village.population.ui.theme.AppShapes
import com.village.population.util.CrashLogger
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
    var showCrashDialog by remember { mutableStateOf(false) }
    var crashText by remember { mutableStateOf("") }
    var lastSyncAt by remember { mutableStateOf(0L) }
    val context = LocalContext.current

    suspend fun refreshLocal() {
        ops = container.queue.all()
        lastSyncAt = runCatching { container.settings.lastSyncAtFlow.first() }.getOrDefault(0L)
    }

    LaunchedEffect(pendingOps, message, showQueueDialog) { refreshLocal() }

    // 标题栏（设计稿 .topbar「我的」）：这一屏此前整页直接铺内容，
    // 滚到底部时看不出在哪一页——四个底栏 Tab 里只有它有标题
    Scaffold(
        topBar = { AppTopBar(title = "我的") },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()),
        ) {
            Column(
                Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(11.dp),
            ) {
            // 身份卡（设计稿「我的」页 v3 白卡）：无渐变、无彩色底。
            // 品牌浅底头像 + 姓名 + 角色 + 版本号胶囊，一卡说清「我是谁、什么版本」。
            // 旧版这里是一块品牌渐变头 + 半透明头像——与首页头卡去蓝是同一条决策：
            // 大面积品牌色显沉，且半透明元素叠渐变最容易显脏
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(AppShapes.card),
                shadowElevation = AppShapes.cardElevation,
                tonalElevation = 0.dp,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(58.dp).background(tokens.brandLight, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            (user?.displayName ?: "村").take(1),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = tokens.brandStrong,
                        )
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            user?.displayName ?: "未登录",
                            // 设计稿 .me-name 17px 800：身份卡是「我是谁」，
                            // 用标题档 20sp 会跟页面标题抢层级
                            style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp),
                            fontWeight = FontWeight.ExtraBold,
                            color = tokens.ink,
                        )
                        Spacer(Modifier.height(3.dp))
                        Text(
                            listOfNotNull(
                                user?.roles?.takeIf { it.isNotEmpty() }?.joinToString("、") ?: "网格员",
                                user?.username?.let { "账号 $it" },
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.ink3,
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    // 版本号胶囊（设计稿 me-ver）：安静灰底 + 细描边，
                    // 版本号是「查询时用得着、日常不用盯」的信息，不该抢主次的眼
                    Surface(
                        color = tokens.quiet,
                        shape = RoundedCornerShape(AppShapes.chip),
                        border = BorderStroke(1.dp, tokens.line2),
                    ) {
                        Text(
                            "v${BuildConfig.VERSION_NAME}",
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.ink3,
                            modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                        )
                    }
                }
            }
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

                    // 崩溃诊断：真机闪退时用户拿不到任何栈信息，这一行让「崩溃原因」
                    // 可以被复制出来发给技术员，不必再靠猜或让用户装 adb
                    SettingRow(
                        icon = Icons.Filled.BugReport,
                        title = "崩溃诊断",
                        subtitle = CrashLogger.count(context).let {
                            if (it > 0) "已记录 $it 次崩溃，可复制详情" else "暂无崩溃记录"
                        },
                    ) {
                        crashText = CrashLogger.readLatest(context) ?: ""
                        showCrashDialog = true
                    }

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

                    SettingDivider()

                    // 退出登录收进同一张列表卡，做成 danger 行（设计稿 menu-row.danger）：
                    // 破坏性操作放在列表末尾并用红色标记，与上面的设置行拉开距离，
                    // 不再单独占一个按钮——满页只有一个按钮时，那个按钮会变得特别「重」
                    SettingRow(
                        icon = Icons.AutoMirrored.Filled.ExitToApp,
                        title = "退出登录",
                        subtitle = if (pendingOps > 0) "有 $pendingOps 条未同步记录，退出不会丢失" else null,
                        danger = true,
                    ) { showLogoutDialog = true }
                }
            }

            message?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = tokens.green)
            }

            Text(
                "掌上村务 ${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）\n" +
                    "未上传的数据不会因为退出登录而丢失；人口数据以身份证号为权威来源，" +
                    "统计口径为在册人口（正常 / 迁入）。",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.ink3,
                // 设计稿 .me-foot 居中：页脚是收尾的脚注，不是内容
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            }
        }
    }

    if (showCrashDialog) {
        AlertDialog(
            onDismissRequest = { showCrashDialog = false },
            title = { Text("崩溃诊断") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    if (crashText.isBlank()) {
                        Text(
                            "暂无崩溃记录。\n\n如果应用再次闪退，重新打开后这里会出现完整堆栈，" +
                                "点「复制」发给技术员即可定位。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.ink2,
                        )
                    } else {
                        Text(
                            crashText,
                            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            color = tokens.ink2,
                        )
                    }
                }
            },
            confirmButton = {
                Row {
                    TextButton(
                        onClick = {
                            val cm = context.getSystemService(ClipboardManager::class.java)
                            cm?.setPrimaryClip(ClipData.newPlainText("crash", crashText))
                            message = "崩溃详情已复制，粘贴发送即可"
                            showCrashDialog = false
                        },
                        enabled = crashText.isNotBlank(),
                    ) { Text("复制") }
                    TextButton(onClick = {
                        CrashLogger.clear(context)
                        crashText = ""
                        message = "崩溃记录已清除"
                    }) { Text("清除") }
                    TextButton(onClick = { showCrashDialog = false }) { Text("关闭") }
                }
            },
        )
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
                        // 这里写的是 DataStore 与文件系统，都可能抛 IOException。
                        // rememberCoroutineScope 的异常同样没人接，会直接把应用打死，
                        // 所以每一处「改本机数据」的协程都必须自己兜住。
                        val r = runCatching {
                            container.settings.saveBaseUrl(baseUrl)
                            baseUrl = container.settings.baseUrlInMemory
                        }
                        baseUrlMessage = r.fold(
                            onSuccess = { "已保存：${container.settings.baseUrlInMemory}" },
                            onFailure = { it.toUserMessage() },
                        )
                    }
                }) { Text("保存") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        scope.launch {
                            val r = runCatching {
                                container.settings.resetBaseUrl()
                                baseUrl = container.settings.baseUrlInMemory
                            }
                            baseUrlMessage = r.fold(
                                onSuccess = { "已恢复打包时注入的默认地址" },
                                onFailure = { it.toUserMessage() },
                            )
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
                    // 弹窗内的一实一虚同样走设计稿按钮对：立即同步是主操作（实钮），
                    // 清空缓存是次操作（虚钮）——后者有破坏性，不该用品牌蓝鼓励点击
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        ActionButton(
                            text = "立即同步",
                            onClick = {
                                container.syncManager.requestSync()
                                message = "已请求同步；同步在后台进行，完成后本页数字会更新"
                            },
                            enabled = pendingOps > 0,
                            filled = true,
                            modifier = Modifier.weight(1f),
                        )
                        ActionButton(
                            text = "清空缓存",
                            onClick = {
                                scope.launch {
                                    message = runCatching {
                                        container.cache.clear()
                                        "已清空本地缓存（未上传的数据保留）"
                                    }.getOrElse { it.toUserMessage() }
                                }
                            },
                            modifier = Modifier.weight(1f),
                        )
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
                                    scope.launch { runCatching { container.queue.removeWithFile(op) }; refreshLocal() }
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
                        // 退出登录即使清缓存失败也必须放行，否则用户被困在已失效的登录态里
                        runCatching { container.logout() }
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
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val tokens = AppTheme.tokens
    val fg = if (danger) tokens.red else tokens.brandStrong
    Row(
        Modifier
            .fillMaxWidth()
            .clickableNoRipple(true, onClick)
            .padding(horizontal = 13.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 图标放进 34dp 圆角瓦片（设计稿 m-ico）：裸一个小图标在行首显得散，
        // 且与右对齐的 › 形不成视觉对。danger 行换红底红字
        Box(
            Modifier.size(34.dp).background(
                if (danger) tokens.redBg else tokens.brandFaint,
                RoundedCornerShape(AppShapes.control),
            ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = fg,
                modifier = Modifier.size(18.dp),
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            // 设计稿 .menu-row 14px 500：设置项是「一行一件事」，
            // 用正文 17sp 会让五行菜单读起来像五段正文
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = fg,
            )
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
