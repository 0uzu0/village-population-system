package com.village.population.ui.screens.login

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.BuildConfig
import com.village.population.data.local.SettingsStore
import com.village.population.data.repository.AuthRepository
import com.village.population.ui.containerViewModel
import com.village.population.ui.components.FormField
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
    val vm: LoginViewModel = containerViewModel { LoginViewModel(it.authRepository, it.settings) }
    val state by vm.state.collectAsStateWithLifecycle()
    var passwordVisible by mutableStateOf(false)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(48.dp))

        Surface(
            shape = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(64.dp),
        ) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Filled.Home,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(34.dp),
                )
            }
        }

        Spacer(Modifier.height(20.dp))
        Text("掌上村务", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(
            "村级人口与重点人群精细化管理系统",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(28.dp))

        OutlinedTextField(
            value = state.username,
            onValueChange = vm::onUsername,
            label = { Text("账号") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = state.password,
            onValueChange = vm::onPassword,
            label = { Text("密码") },
            singleLine = true,
            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                    Icon(
                        if (passwordVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = if (passwordVisible) "隐藏密码" else "显示密码",
                    )
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )

        val error = state.error
        if (error != null) {
            Spacer(Modifier.height(10.dp))
            Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        val notice = state.notice
        if (notice != null) {
            Spacer(Modifier.height(10.dp))
            Text(notice, color = MaterialTheme.colorScheme.secondary, style = MaterialTheme.typography.bodyMedium)
        }

        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { vm.login(onLoggedIn) },
            enabled = !state.loading,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            Text(if (state.loading) "登录中…" else "登 录", style = MaterialTheme.typography.labelLarge)
        }

        Spacer(Modifier.height(8.dp))
        TextButton(onClick = vm::toggleServerConfig, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Icon(Icons.Filled.Settings, contentDescription = null)
            Text("  服务器设置")
        }

        if (state.showServerConfig) {
            Spacer(Modifier.height(4.dp))
            Text(
                "同一个安装包会分发给多个村使用，服务器地址各不相同。地址只填 IP 与端口即可，" +
                    "例如 192.168.1.100:8080，程序会自动补上 http://。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(10.dp))
            FormField(
                label = "服务器地址",
                value = state.baseUrl,
                onValueChange = vm::onBaseUrl,
                placeholder = "192.168.1.100:8080",
            )
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = vm::saveBaseUrl, modifier = Modifier.weight(1f)) { Text("保存地址") }
                TextButton(onClick = vm::resetBaseUrl, modifier = Modifier.weight(1f)) { Text("恢复默认") }
            }
        }

        Spacer(Modifier.height(32.dp))
        Text(
            "版本 ${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        )
        Spacer(Modifier.height(24.dp))
    }
}
