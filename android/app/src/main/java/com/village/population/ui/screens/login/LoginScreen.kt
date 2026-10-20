package com.village.population.ui.screens.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.BuildConfig
import com.village.population.data.local.SettingsStore
import com.village.population.data.repository.AuthRepository
import com.village.population.ui.components.FormField
import com.village.population.ui.components.PasswordField
import com.village.population.ui.components.clickableNoRipple
import com.village.population.ui.theme.AppTheme
import com.village.population.ui.theme.AppShapes
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val username: String = "",
    val password: String = "",
    val baseUrl: String = "",
    val showServerConfig: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

class LoginViewModel(
    private val auth: AuthRepository,
    private val settings: SettingsStore,
) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState(baseUrl = settings.baseUrlInMemory))
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onUsername(value: String) = _state.update { it.copy(username = value, error = null) }
    fun onPassword(value: String) = _state.update { it.copy(password = value, error = null) }
    fun onBaseUrl(value: String) = _state.update { it.copy(baseUrl = value, error = null) }
    fun toggleServerConfig() = _state.update { it.copy(showServerConfig = !it.showServerConfig) }

    /** 保存服务器地址。这一步单独做（而不是登录时顺带），因为它本身就是个失败点，
     *  地址写错了要能让用户当场看到「保存成功」再录账号。 */
    fun saveBaseUrl() {
        viewModelScope.launch {
            val raw = _state.value.baseUrl
            if (raw.isBlank()) {
                _state.update { it.copy(error = "请填写服务器地址") }
                return@launch
            }
            settings.saveBaseUrl(raw)
            _state.update {
                it.copy(
                    baseUrl = settings.baseUrlInMemory,
                    notice = "服务器地址已保存：${settings.baseUrlInMemory}",
                    error = null,
                    showServerConfig = false,
                )
            }
        }
    }

    fun resetBaseUrl() {
        viewModelScope.launch {
            settings.resetBaseUrl()
            _state.update {
                it.copy(baseUrl = settings.baseUrlInMemory, notice = "已恢复默认服务器地址", error = null)
            }
        }
    }

    /**
     * 登录。
     * 成功后由界面层负责跳转（ViewModel 不碰导航）。
     * 失败时把后端的原话显示出来——登录限流的提示里带重试秒数，自己编文案会丢掉这个信息。
     */
    fun login(onSuccess: () -> Unit) {
        val current = _state.value
        if (current.username.isBlank() || current.password.isBlank()) {
            _state.update { it.copy(error = "请输入账号和密码") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null, notice = null) }
            try {
                auth.login(current.username, current.password)
                _state.update { it.copy(loading = false, password = "") }
                onSuccess()
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.toUserMessage()) }
            }
        }
    }
}

@Composable
fun LoginScreen(onLoggedIn: () -> Unit) {
    val tokens = AppTheme.tokens
    val vm: LoginViewModel = com.village.population.ui.containerViewModel { LoginViewModel(it.authRepository, it.settings) }
    val state by vm.state.collectAsStateWithLifecycle()
    var passwordVisible by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        // 品牌渐变头（设计稿画法）：登录页是全应用唯一没有页头的屏，
        // 一块渐变既交代了「这是什么应用」，也把视觉焦点压在下面的输入框上
        Column(
            Modifier
                .fillMaxWidth()
                .background(Brush.linearGradient(listOf(tokens.brand, tokens.brandStrong)))
                .padding(start = 20.dp, end = 20.dp, top = 34.dp, bottom = 26.dp),
        ) {
            Box(
                Modifier.size(46.dp).background(Color.White.copy(alpha = 0.20f), RoundedCornerShape(13.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Home,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(24.dp),
                )
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "掌上村务",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
            Text(
                "村级人口与重点人群精细化管理系统",
                style = MaterialTheme.typography.bodySmall,
                color = Color.White.copy(alpha = 0.85f),
            )
        }

        Column(
            Modifier.padding(horizontal = 16.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // 用应用自己的表单语言（标签在上 + 白盒），不再用 Material 的
            // OutlinedTextField：登录页是全应用第一屏，第一屏就拿另一套控件，
            // 等于告诉用户「后面每个页面都可能长得不一样」
            FormField(
                label = "账号",
                value = state.username,
                onValueChange = vm::onUsername,
                placeholder = "请输入账号",
            )
            PasswordField(
                label = "密码",
                value = state.password,
                onValueChange = vm::onPassword,
                visible = passwordVisible,
                onToggleVisible = { passwordVisible = !passwordVisible },
                placeholder = "请输入密码",
                onImeAction = { vm.login(onLoggedIn) },
            )

            // 服务器地址收成一行（设计稿的「服务器地址 ▾」）：
            // 它一装完就填好了，日常登录根本不用看；但同一个包要发几十个村，
            // 需要改的时候必须一眼找得到，所以放成显式的一行而不是藏进菜单
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(AppShapes.control),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickableNoRipple(true) { vm.toggleServerConfig() },
            ) {
                Row(
                    Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "服务器地址",
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.ink3,
                        )
                        Text(
                            state.baseUrl,
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.ink2,
                        )
                    }
                    Icon(
                        Icons.Filled.ChevronRight,
                        contentDescription = if (state.showServerConfig) "收起服务器设置" else "展开服务器设置",
                        tint = tokens.ink3,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            state.notice?.let {
                Text(it, color = tokens.green, style = MaterialTheme.typography.bodyMedium)
            }

            Button(
                onClick = { vm.login(onLoggedIn) },
                enabled = !state.loading,
                shape = RoundedCornerShape(AppShapes.control),
                contentPadding = PaddingValues(vertical = 15.dp),
                // 同 PrimaryButton：52dp 是下限不是定高，大字号下按钮跟着长
                modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp),
            ) {
                Text(if (state.loading) "登录中…" else "登 录", style = MaterialTheme.typography.labelLarge)
            }

            if (state.showServerConfig) {
                Text(
                    "同一个安装包会分发给多个村使用，服务器地址各不相同。地址只填 IP 与端口即可，" +
                        "例如 192.168.1.100:8080，程序会自动补上 http://。",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                )
                FormField(
                    label = "服务器地址",
                    value = state.baseUrl,
                    onValueChange = vm::onBaseUrl,
                    placeholder = "192.168.1.100:8080",
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = vm::saveBaseUrl,
                        shape = RoundedCornerShape(AppShapes.control),
                        modifier = Modifier.weight(1f),
                    ) { Text("保存地址") }
                    TextButton(onClick = vm::resetBaseUrl, modifier = Modifier.weight(1f)) { Text("恢复默认") }
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                "版本 ${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.ink3,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            Spacer(Modifier.height(16.dp))
        }
    }
}
