package com.village.population.ui.screens.pending

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.data.remote.dto.PendingDto
import com.village.population.data.repository.MetaRepository
import com.village.population.ui.components.EmptyBox
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.InfoRow
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.QCard
import com.village.population.ui.components.SearchField
import com.village.population.ui.theme.AppTheme
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

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
fun PendingScreen() {
    val context = LocalContext.current
    val tokens = AppTheme.tokens
    val vm: PendingViewModel = com.village.population.ui.containerViewModel { PendingViewModel(it.metaRepository) }
    val state by vm.state.collectAsStateWithLifecycle()
    // 详情就在本页用弹窗展示：import_pending.id 与 person.id 是两套编号，
    // 早先这里直接 navigate("person/{row.id}")，打开的要么是另一个人的档案，
    // 要么是根本不存在的 id——**待核查记录本来就还没有对应的正式人员**。
    var detail by remember { mutableStateOf<PendingDto?>(null) }

    LaunchedEffect(Unit) { vm.load() }

    val toast: (Boolean, String) -> Unit = { _, message ->
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Column(
                Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    "共 ${state.total} 条待处理 · 来源：导入时身份证号为空或非法，需逐条补齐或忽略。",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                )
                SearchField(
                    value = state.keyword,
                    onValueChange = vm::onKeyword,
                    placeholder = "按姓名搜索",
                    onSearch = { vm.load() },
                )
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (state.selected.isEmpty()) "未勾选记录" else "已勾选 ${state.selected.size} 条",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (state.selected.isEmpty()) tokens.ink3 else tokens.brand,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedButton(
                        onClick = { vm.batchIgnore(toast) },
                        enabled = state.selected.isNotEmpty() && !state.working,
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                    ) { Text("批量忽略", style = MaterialTheme.typography.bodySmall) }
                }
            }

            when {
                state.loading -> LoadingBox()
                state.error != null -> ErrorBox(state.error!!) { vm.load() }
                state.list.isEmpty() -> EmptyBox("没有待核查记录")
                else -> LazyColumn(
                    contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.list, key = { it.id }) { row ->
                        PendingRow(
                            row = row,
                            checked = state.selected.contains(row.id),
                            working = state.working,
                            onToggle = { vm.toggle(row.id) },
                            onOpen = { detail = row },
                            onConfirm = { vm.confirm(row.id, toast) },
                            onIgnore = { vm.ignore(row.id, toast) },
                        )
                    }
                }
            }
        }
    }

    detail?.let { row ->
        PendingDetailDialog(row = row, onDismiss = { detail = null })
    }
}

/** 待核查详情。字段与 import_pending 一一对应，**身份证号原样展示**——
 *  这一屏存在的意义就是让人拿它去核对，抹掉或格式化都会让核对无从下手。 */
@Composable
private fun PendingDetailDialog(row: PendingDto, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(
                Modifier
                    .padding(16.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Text("待核查详情", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    "该记录尚未进入正式档案，核对后可回到列表「确认」或「忽略」。",
                    style = MaterialTheme.typography.bodySmall,
                    color = AppTheme.tokens.ink3,
                )
                Spacer(Modifier.height(10.dp))
                InfoRow("姓名", row.name)
                InfoRow("性别", row.gender)
                InfoRow("出生日期", row.birthDate)
                InfoRow("身份证号", row.idCard?.takeIf { it.isNotBlank() } ?: "（空）")
                InfoRow("本人电话", row.phone)
                InfoRow("备用电话", row.phoneBackup)
                InfoRow("所属村庄", row.village)
                InfoRow("网格编号", row.gridNo)
                InfoRow("家庭编号", row.familyNo)
                InfoRow("与户主关系", row.relation)
                InfoRow("户籍地址", row.hukouAddress)
                InfoRow("现居住地址", row.liveAddress)
                InfoRow("待核查原因", row.reasonText?.takeIf { it.isNotBlank() } ?: reasonLabel(row.reason))
                InfoRow("处理备注", row.handleNote)
                InfoRow("导入批次", listOfNotNull(row.batchNo, row.rowNo?.let { "第 $it 行" }).joinToString(" · "))
                InfoRow("导入时间", row.createdAt)
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) { Text("关闭") }
                }
            }
        }
    }
}

/** 待核查原因码 → 中文；与后端 import_pending.reason 的取值一致 */
private fun reasonLabel(reason: String?): String? = when (reason) {
    "ID_CARD_MISSING" -> "身份证号缺失"
    "ID_CARD_INVALID" -> "身份证号非法"
    null -> null
    else -> reason
}

/**
 * 待核查卡片，对应设计稿的 `.qcard`：琥珀左边框 + 姓名 + 原因 + 两个操作。
 *
 * 「为什么这条要核查」写在卡片上而不是藏进详情：这一屏通常有几十条，
 * 逐条点进去看原因才能决定怎么处理，等于把网格员按在屏幕上点几十次。
 */
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
    val tokens = AppTheme.tokens
    QCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = checked, onCheckedChange = { onToggle() })
            Column(Modifier.weight(1f)) {
                Text(
                    row.name ?: "（无姓名）",
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = tokens.ink,
                )
                Text(
                    listOfNotNull(
                        row.idCard?.takeIf { it.isNotBlank() } ?: "身份证号缺失",
                        row.village?.takeIf { it.isNotBlank() },
                        row.reasonText?.takeIf { it.isNotBlank() } ?: reasonLabel(row.reason),
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Button(
                onClick = onConfirm,
                enabled = !working,
                shape = RoundedCornerShape(7.dp),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                colors = ButtonDefaults.buttonColors(containerColor = tokens.brand),
            ) { Text("确认入库", style = MaterialTheme.typography.bodySmall) }
            OutlinedButton(
                onClick = onIgnore,
                enabled = !working,
                shape = RoundedCornerShape(7.dp),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
            ) { Text("忽略", style = MaterialTheme.typography.bodySmall) }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onOpen) {
                Text("详情", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.width(2.dp))
                Icon(
                    Icons.AutoMirrored.Filled.ArrowForward,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}
