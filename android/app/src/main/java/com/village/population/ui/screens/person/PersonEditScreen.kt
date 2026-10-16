package com.village.population.ui.screens.person

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.data.remote.dto.PersonCreateRequest
import com.village.population.data.remote.dto.VillageDto
import com.village.population.data.repository.MetaRepository
import com.village.population.data.repository.PersonRepository
import com.village.population.data.repository.SubmitResult
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.FormField
import com.village.population.ui.components.PickerField
import com.village.population.ui.components.PickerOption
import com.village.population.ui.components.SectionCard
import com.village.population.util.IdCard
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PersonEditUiState(
    val loading: Boolean = false,
    val saving: Boolean = false,
    val villages: List<VillageDto> = emptyList(),
    val name: String = "",
    val idCard: String = "",
    val gender: String? = null,
    val birthDate: String = "",
    val phone: String = "",
    val phoneBackup: String = "",
    val village: String? = null,
    val hukouAddress: String = "",
    val liveAddress: String = "",
    val relation: String = "",
    val remark: String = "",
    val idCardHint: String? = null,
    val error: String? = null,
)

class PersonEditViewModel(
    private val personRepo: PersonRepository,
    private val metaRepo: MetaRepository,
    private val personId: Int,
) : ViewModel() {

    private val _state = MutableStateFlow(PersonEditUiState())
    val state: StateFlow<PersonEditUiState> = _state.asStateFlow()

    val isEdit: Boolean get() = personId > 0

    fun init() {
        viewModelScope.launch {
            runCatching { metaRepo.villages().value }.onSuccess { villages ->
                _state.update { it.copy(villages = villages) }
            }
            if (isEdit) {
                _state.update { it.copy(loading = true) }
                runCatching { personRepo.detail(personId).value }.onSuccess { p ->
                    _state.update {
                        it.copy(
                            loading = false,
                            name = p.name,
                            idCard = p.idCard.orEmpty(),
                            gender = p.gender,
                            birthDate = p.birthDate.orEmpty(),
                            phone = p.phone.orEmpty(),
                            phoneBackup = p.phoneBackup.orEmpty(),
                            village = p.village,
                            hukouAddress = p.hukouAddress.orEmpty(),
                            liveAddress = p.liveAddress.orEmpty(),
                            relation = p.relation.orEmpty(),
                            remark = p.remark.orEmpty(),
                        )
                    }
                }.onFailure { e ->
                    _state.update { it.copy(loading = false, error = e.toUserMessage()) }
                }
            }
        }
    }

    fun onField(update: (PersonEditUiState) -> PersonEditUiState) = _state.update(update)

    /**
     * 身份证输入即解析。
     *
     * 与后端 `prepareIdentity` 同一口径：**身份证是出生日期与性别的权威来源**。
     * 校验位不对时立刻提示（而不是等上传后被退回，那时人已经离开走访现场了）；
     * 月日不存在（如 02-30）时不写出生日期，避免把不存在的日期写进档案导致年龄算错。
     */
    fun onIdCard(value: String) {
        val cleaned = value.trim().uppercase()
        _state.update { it.copy(idCard = cleaned, idCardHint = null, error = null) }
        if (cleaned.length < 15) return

        when (val result = IdCard.validate(cleaned)) {
            is IdCard.Result.Invalid -> _state.update { it.copy(idCardHint = result.message) }
            is IdCard.Result.Valid -> _state.update {
                it.copy(
                    idCardHint = if (result.birthDate == null) {
                        "号码本身合法，但其中的出生日期不存在（如 02-30），请手动核对出生日期"
                    } else {
                        "已按证件号带出出生日期与性别"
                    },
                    gender = result.gender ?: it.gender,
                    birthDate = result.birthDate ?: it.birthDate,
                )
            }
        }
    }

    fun save(onSaved: (SubmitResult) -> Unit) {
        val s = _state.value
        if (s.name.isBlank()) {
            _state.update { it.copy(error = "姓名必填") }
            return
        }
        if (s.idCard.isNotBlank() && IdCard.validate(s.idCard) is IdCard.Result.Invalid) {
            _state.update { it.copy(error = "身份证号不正确，请检查后再保存") }
            return
        }

        val request = PersonCreateRequest(
            name = s.name.trim(),
            gender = s.gender,
            birthDate = s.birthDate.takeIf { it.isNotBlank() },
            idCard = s.idCard.takeIf { it.isNotBlank() },
            phone = s.phone.takeIf { it.isNotBlank() },
            phoneBackup = s.phoneBackup.takeIf { it.isNotBlank() },
            village = s.village,
            hukouAddress = s.hukouAddress.takeIf { it.isNotBlank() },
            liveAddress = s.liveAddress.takeIf { it.isNotBlank() },
            relation = s.relation.takeIf { it.isNotBlank() },
            remark = s.remark.takeIf { it.isNotBlank() },
        )

        viewModelScope.launch {
            _state.update { it.copy(saving = true, error = null) }
            try {
                val result = if (isEdit) personRepo.update(personId, request) else personRepo.create(request)
                _state.update { it.copy(saving = false) }
                onSaved(result)
            } catch (e: Exception) {
                _state.update { it.copy(saving = false, error = e.toUserMessage()) }
            }
        }
    }
}

@Composable
fun PersonEditScreen(personId: Int, onDone: () -> Unit) {
    val vm: PersonEditViewModel = com.village.population.ui.containerViewModel {
        PersonEditViewModel(it.personRepository, it.metaRepository, personId)
    }
    val state by vm.state.collectAsStateWithLifecycle()
    var resultMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(personId) { vm.init() }

    Scaffold(
        topBar = {
            AppTopBar(
                title = if (vm.isEdit) "编辑人员" else "上门登记",
                onBack = onDone,
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(title = "身份信息") {
                FormField(
                    label = "姓名 *",
                    value = state.name,
                    onValueChange = { v -> vm.onField { it.copy(name = v, error = null) } },
                )
                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "身份证号",
                    value = state.idCard,
                    onValueChange = vm::onIdCard,
                    placeholder = "18 位，用于自动带出出生日期与性别",
                    keyboardType = KeyboardType.Ascii,
                    supportingText = state.idCardHint,
                )
                Spacer(Modifier.height(10.dp))

                Text("性别", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("MALE" to "男", "FEMALE" to "女").forEach { (value, label) ->
                        androidx.compose.material3.FilterChip(
                            selected = state.gender == value,
                            onClick = { vm.onField { it.copy(gender = value) } },
                            label = { Text(label) },
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "出生日期",
                    value = state.birthDate,
                    onValueChange = { v -> vm.onField { it.copy(birthDate = v) } },
                    placeholder = "yyyy-MM-dd",
                    // 有身份证号时出生日期由证件决定，不给改——这是后端也遵守的口径
                    enabled = state.idCard.isBlank(),
                    supportingText = if (state.idCard.isNotBlank()) "由身份证号决定，如需修改请清空身份证号" else null,
                )
            }

            SectionCard(title = "联系方式") {
                FormField(
                    label = "本人电话",
                    value = state.phone,
                    onValueChange = { v -> vm.onField { it.copy(phone = v) } },
                    keyboardType = KeyboardType.Phone,
                )
                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "备用电话",
                    value = state.phoneBackup,
                    onValueChange = { v -> vm.onField { it.copy(phoneBackup = v) } },
                    keyboardType = KeyboardType.Phone,
                )
            }

            SectionCard(title = "居住信息") {
                PickerField(
                    label = "所属村庄",
                    value = state.village.orEmpty(),
                    options = state.villages.map { PickerOption(it.name, it.name) },
                    onSelect = { option -> vm.onField { it.copy(village = option?.value) } },
                )
                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "户籍地址",
                    value = state.hukouAddress,
                    onValueChange = { v -> vm.onField { it.copy(hukouAddress = v) } },
                )
                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "现居住地址",
                    value = state.liveAddress,
                    onValueChange = { v -> vm.onField { it.copy(liveAddress = v) } },
                )
                Spacer(Modifier.height(10.dp))
                FormField(
                    label = "与户主关系",
                    value = state.relation,
                    onValueChange = { v -> vm.onField { it.copy(relation = v) } },
                    placeholder = "户主 / 配偶 / 子女 …",
                )
            }

            SectionCard(title = "备注") {
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
            resultMessage?.let {
                Text(it, color = MaterialTheme.colorScheme.secondary, style = MaterialTheme.typography.bodyMedium)
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = {
                        vm.save { result ->
                            when (result) {
                                is SubmitResult.Sent -> onDone()
                                is SubmitResult.Queued -> {
                                    // 明确告诉用户「数据没丢」，否则他会以为保存失败而反复点
                                    resultMessage = "当前无网络，${result.label} 已暂存本机，联网后会自动上传"
                                }
                            }
                        }
                    },
                    enabled = !state.saving,
                    modifier = Modifier.weight(1f).height(52.dp),
                ) {
                    Text(if (state.saving) "保存中…" else "保存")
                }
                if (resultMessage != null) {
                    androidx.compose.material3.OutlinedButton(
                        onClick = onDone,
                        modifier = Modifier.width(96.dp).height(52.dp),
                    ) { Text("返回") }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
