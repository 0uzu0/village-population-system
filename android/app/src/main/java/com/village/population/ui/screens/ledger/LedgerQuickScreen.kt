package com.village.population.ui.screens.ledger

import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.data.remote.dto.LedgerCategoryDto
import com.village.population.data.remote.dto.LedgerRecordCreateRequest
import com.village.population.data.repository.MetaRepository
import com.village.population.data.repository.SubmitResult
import com.village.population.ui.components.AppChip
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.FormField
import com.village.population.ui.components.PickerField
import com.village.population.ui.components.PickerOption
import com.village.population.ui.components.SectionCard
import com.village.population.ui.theme.AppTheme
import com.village.population.util.DateText
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import android.widget.Toast

data class LedgerUiState(
    val categories: List<LedgerCategoryDto> = emptyList(),
    val category: String = "",
    val workType: String = "",
    val title: String = "",
    val recordDate: String = DateText.today(),
    val laborCost: String = "",
    val invoiceCost: String = "",
    val invoiceNo: String = "",
    val responsible: String = "",
    val location: String = "",
    val detail: String = "",
    val remark: String = "",
    val saving: Boolean = false,
    val error: String? = null,
) {
    val workTypes: List<PickerOption>
        get() = categories.firstOrNull { it.code == category }?.workTypes?.map { PickerOption(it.code, it.name) }
            ?: emptyList()
}

class LedgerViewModel(private val meta: MetaRepository) : ViewModel() {

    private val _state = MutableStateFlow(LedgerUiState())
    val state: StateFlow<LedgerUiState> = _state.asStateFlow()

    /** 条口与工作类型的下拉项来自后端 /ledgers/meta（配置写在代码里，前端不再各写一份中文名） */
    fun loadMeta() {
        viewModelScope.launch {
            runCatching { meta.ledgerMeta() }.onSuccess { categories ->
                _state.update { it.copy(categories = categories) }
            }
        }
    }

    fun onField(update: (LedgerUiState) -> LedgerUiState) = _state.update(update)

    fun onCategory(code: String) = _state.update { it.copy(category = code, workType = "") }

    fun save(onResult: (String) -> Unit) {
        val s = _state.value
        if (s.category.isBlank()) {
            _state.update { it.copy(error = "请选择条口") }
            return
        }
        if (s.title.isBlank() && s.detail.isBlank()) {
            _state.update { it.copy(error = "标题与内容至少填一项，否则这条记录以后没人看得懂") }
            return
        }
        if (s.laborCost.isNotBlank() && s.laborCost.toDoubleOrNull() == null) {
            _state.update { it.copy(error = "人工费请填写数字") }
            return
        }
        if (s.invoiceCost.isNotBlank() && s.invoiceCost.toDoubleOrNull() == null) {
            _state.update { it.copy(error = "发票金额请填写数字") }
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(saving = true, error = null) }
            try {
                val result = meta.createLedgerRecord(
                    LedgerRecordCreateRequest(
                        category = s.category,
                        workType = s.workType.takeIf { it.isNotBlank() },
                        recordDate = s.recordDate.takeIf { it.isNotBlank() },
                        laborCost = s.laborCost.toDoubleOrNull(),
                        invoiceCost = s.invoiceCost.toDoubleOrNull(),
                        invoiceNo = s.invoiceNo.takeIf { it.isNotBlank() },
                        responsible = s.responsible.takeIf { it.isNotBlank() },
                        location = s.location.takeIf { it.isNotBlank() },
                        title = s.title.takeIf { it.isNotBlank() },
                        detail = s.detail.takeIf { it.isNotBlank() },
                        remark = s.remark.takeIf { it.isNotBlank() },
                    )
                )
                _state.update { it.copy(saving = false) }
                onResult(
                    when (result) {
                        is SubmitResult.Sent -> "台账已保存"
                        is SubmitResult.Queued -> "无网络，已暂存本机，联网后自动上传"
                    }
                )
            } catch (e: Exception) {
                _state.update { it.copy(saving = false, error = e.toUserMessage()) }
            }
        }
    }
}

@Composable
fun LedgerQuickScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val vm: LedgerViewModel = com.village.population.ui.containerViewModel { LedgerViewModel(it.metaRepository) }
    val state by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.loadMeta() }

    Scaffold(topBar = { AppTopBar(title = "台账速记", onBack = onBack) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(title = "条口与类型") {
                // 条口用胶囊片而不是下拉弹窗（设计稿画法）：条口只有水利/民政/卫健三个，
                // 点一下就能选中，弹窗再选一次是白白多一次点击
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    state.categories.forEach { category ->
                        AppChip(
                            text = category.name,
                            selected = state.category == category.code,
                            onClick = { vm.onCategory(category.code) },
                        )
                    }
                    if (state.categories.isEmpty()) {
                        Text(
                            "条口配置未取到，请检查网络后重进本页",
                            style = MaterialTheme.typography.bodySmall,
                            color = AppTheme.tokens.ink3,
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
                PickerField(
                    label = "工作类型",
                    value = state.workTypes.firstOrNull { it.value == state.workType }?.label.orEmpty(),
                    options = state.workTypes,
                    onSelect = { option -> vm.onField { it.copy(workType = option?.value.orEmpty()) } },
                    enabled = state.category.isNotBlank(),
                    searchable = false,
                    allowClear = true,
                )
                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "标题",
                    value = state.title,
                    onValueChange = { v -> vm.onField { it.copy(title = v) } },
                    placeholder = "如：3 组河道打草",
                )
            }

            SectionCard(title = "工作量") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FormField(
                        label = "发生日期",
                        value = state.recordDate,
                        onValueChange = { v -> vm.onField { it.copy(recordDate = v) } },
                        placeholder = "yyyy-MM-dd",
                        modifier = Modifier.weight(1f),
                    )
                    FormField(
                        label = "人工费（元）",
                        value = state.laborCost,
                        onValueChange = { v -> vm.onField { it.copy(laborCost = v) } },
                        keyboardType = KeyboardType.Decimal,
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FormField(
                        label = "发票金额（元）",
                        value = state.invoiceCost,
                        onValueChange = { v -> vm.onField { it.copy(invoiceCost = v) } },
                        keyboardType = KeyboardType.Decimal,
                        modifier = Modifier.weight(1f),
                    )
                    FormField(
                        label = "发票号",
                        value = state.invoiceNo,
                        onValueChange = { v -> vm.onField { it.copy(invoiceNo = v) } },
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "机械费已从台账字段中去掉（V011），不要再往备注里折算。",
                    style = MaterialTheme.typography.bodySmall,
                    color = AppTheme.tokens.ink3,
                )
            }

            SectionCard(title = "其他") {
                FormField(
                    label = "责任人",
                    value = state.responsible,
                    onValueChange = { v -> vm.onField { it.copy(responsible = v) } },
                )
                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "地点",
                    value = state.location,
                    onValueChange = { v -> vm.onField { it.copy(location = v) } },
                )
                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "内容",
                    value = state.detail,
                    onValueChange = { v -> vm.onField { it.copy(detail = v) } },
                    singleLine = false,
                )
                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "备注",
                    value = state.remark,
                    onValueChange = { v -> vm.onField { it.copy(remark = v) } },
                    singleLine = false,
                )
            }

            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }

            Button(
                onClick = {
                    vm.save { message ->
                        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
                        onBack()
                    }
                },
                enabled = !state.saving,
                shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                Text(if (state.saving) "保存中…" else "保存台账")
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
