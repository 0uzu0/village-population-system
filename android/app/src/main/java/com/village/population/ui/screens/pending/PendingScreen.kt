package com.village.population.ui.screens.pending

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.data.remote.dto.PendingDto
import com.village.population.data.repository.MetaRepository
import com.village.population.ui.components.EmptyBox
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.LoadingBox
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import android.widget.Toast

data class PendingUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val list: List<PendingDto> = emptyList(),
    val total: Int = 0,
    val selected: Set<Int> = emptySet(),
    val keyword: String = "",
    val working: Boolean = false,
)

class PendingViewModel(private val meta: MetaRepository) : ViewModel() {

    private val _state = MutableStateFlow(PendingUiState())
    val state: StateFlow<PendingUiState> = _state.asStateFlow()

    fun onKeyword(value: String) = _state.update { it.copy(keyword = value) }

    fun toggle(id: Int) = _state.update {
        it.copy(selected = if (it.selected.contains(id)) it.selected - id else it.selected + id)
    }

    fun clearSelection() = _state.update { it.copy(selected = emptySet()) }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val page = meta.pendingList(page = 1, pageSize = 50, keyword = _state.value.keyword)
                _state.update { it.copy(loading = false, list = page.value.list, total = page.value.total) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.toUserMessage()) }
            }
        }
    }

    /**
     * 确认入库。
     * 这个动作不走离线队列：后端要在这里做身份证查重、建 person 与家庭关联，
     * 依据（姓名是否唯一）必须当场有结论。排队到明天再执行，出现重复人员时
     * 已经没人记得当初确认的是哪一条了。
     */
    fun confirm(id: Int, onResult: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(working = true) }
            try {
                meta.confirmPending(id)
                _state.update { it.copy(working = false, list = it.list.filterNot { row -> row.id == id }) }
                onResult(true, "已确认入库")
            } catch (e: Exception) {
                _state.update { it.copy(working = false) }
                onResult(false, e.toUserMessage())
            }
        }
    }

    /** 忽略：可以离线排队（晚几小时生效不影响结果） */
    fun ignore(id: Int, onResult: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(working = true) }
            try {
                when (val result = meta.ignorePending(id)) {
                    is com.village.population.data.repository.SubmitResult.Sent -> {
                        _state.update { it.copy(working = false, list = it.list.filterNot { row -> row.id == id }) }
                        onResult(true, "已忽略")
                    }
                    is com.village.population.data.repository.SubmitResult.Queued -> {
                        _state.update { it.copy(working = false, list = it.list.filterNot { row -> row.id == id }) }
                        onResult(true, "无网络，已暂存本机，联网后自动忽略")
                    }
                }
            } catch (e: Exception) {
                _state.update { it.copy(working = false) }
                onResult(false, e.toUserMessage())
            }
        }
    }

    /** 批量忽略：一次请求处理一整批，不再逐条打接口 */
    fun batchIgnore(onResult: (Boolean, String) -> Unit) {
        val ids = _state.value.selected.toList()
        if (ids.isEmpty()) {
            onResult(false, "请先勾选要忽略的记录")
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(working = true) }
            try {
                meta.batchIgnore(ids)
                _state.update {
                    it.copy(
                        working = false,
                        list = it.list.filterNot { row -> ids.contains(row.id) },
                        selected = emptySet(),
                    )
                }
                onResult(true, "已忽略 ${ids.size} 条")
            } catch (e: Exception) {
                _state.update { it.copy(working = false) }
                onResult(false, e.toUserMessage())
            }
        }
    }
}

@Composable
fun PendingScreen(onOpenPerson: (Int) -> Unit) {
    val context = LocalContext.current
    val vm: PendingViewModel = com.village.population.ui.containerViewModel { PendingViewModel(it.metaRepository) }
    val state by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.load() }

    val toast: (Boolean, String) -> Unit = { _, message ->
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(
                    "共 ${state.total} 条待核查",
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "这些记录来自 Excel 导入：身份证号为空或非法，无法直接建档。" +
                        "核对后可「确认入库」（按姓名匹配已有人员）或「忽略」。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = state.keyword,
                    onValueChange = vm::onKeyword,
                    placeholder = { Text("按姓名搜索") },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { vm.batchIgnore(toast) },
                    enabled = state.selected.isNotEmpty() && !state.working,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("批量忽略（已选 ${state.selected.size} 条）")
                }
            }

            when {
                state.loading -> LoadingBox()
                state.error != null -> ErrorBox(state.error!!) { vm.load() }
                state.list.isEmpty() -> EmptyBox("没有待核查记录")
                else -> LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(state.list, key = { it.id }) { row ->
                        PendingRow(
                            row = row,
                            checked = state.selected.contains(row.id),
                            working = state.working,
                            onToggle = { vm.toggle(row.id) },
                            onOpen = { onOpenPerson(row.id) },
                            onConfirm = { vm.confirm(row.id, toast) },
                            onIgnore = { vm.ignore(row.id, toast) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PendingRow(
    row: PendingDto,
    checked: Boolean,
    working: Boolean,
    onToggle: () -> Unit,
    onOpen: () -> Unit,
    onConfirm: () -> Unit,
    onIgnore: () -> Unit,
) {
    Card(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = checked, onCheckedChange = { onToggle() })
                Column(Modifier.weight(1f)) {
                    Text(
                        row.name ?: "（无姓名）",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(
                        listOfNotNull(
                            row.idCard?.takeIf { it.isNotBlank() } ?: "身份证号缺失",
                            row.village,
                            row.reason,
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onConfirm, enabled = !working, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null)
                    Spacer(Modifier.width(4.dp))
                    Text("确认")
                }
                OutlinedButton(onClick = onIgnore, enabled = !working, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Filled.Cancel, contentDescription = null)
                    Spacer(Modifier.width(4.dp))
                    Text("忽略")
                }
                IconButton(onClick = onOpen) {
                    Text("详情", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
