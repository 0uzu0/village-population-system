package com.village.population.ui.screens.person

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
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
import com.village.population.data.remote.dto.TagDto
import com.village.population.data.remote.dto.VillageDto
import com.village.population.data.repository.MetaRepository
import com.village.population.data.repository.PersonRepository
import com.village.population.data.repository.SubmitResult
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.FormField
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.PickerField
import com.village.population.ui.components.PickerOption
import com.village.population.ui.components.SectionCard
import com.village.population.util.IdCard
import com.village.population.util.PersonText
import com.village.population.util.toUserMessage
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * 编辑表单状态。
 *
 * `loading` / `loaded` 这两个标志是后补的，起因是一个很难看的失败方式：
 * 打开编辑页时表单会**先渲染成一片空白**（状态初值就是空串），档案要等
 * 网络回来才填进去。在村里那种没信号或信号很差的院子里，这片空白会持续
 * 几秒到几十秒；用户不知道它在加载，只知道「这人的信息全没了」。
 * 更糟的是此时点保存：表单持有一堆空值，一提交就会把原来的档案**覆盖成空**。
 *
 * 所以现在：读档案期间不给表单（避免误以为档案是空的），
 * 读失败时明确报错并**禁止保存**（宁可让人退回详情页，也不能让他把数据改没了）。
 */
data class PersonEditUiState(
    /** 正在读取既有档案 */
    val loading: Boolean = false,
    /** 编辑模式下档案已成功取回；新增模式下恒为 true */
    val loaded: Boolean = true,
    val saving: Boolean = false,
    val villages: List<VillageDto> = emptyList(),
    /** 可选的个人标签（用于「人口标签」多选） */
    val personTags: List<TagDto> = emptyList(),
    /** 已选中的标签 id。null 表示「尚未决定」（新增时也没打标签），保存时按空集合提交 */
    val tagIds: List<Int> = emptyList(),
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
    /** 读取档案失败（整页错误） */
    val loadError: String? = null,
    /** 表单校验/保存失败（表单内提示） */
    val error: String? = null,
)

class PersonEditViewModel(
    private val personRepo: PersonRepository,
    private val metaRepo: MetaRepository,
    private val personId: Int,
) : ViewModel() {

    private val _state = MutableStateFlow(PersonEditUiState(loaded = personId <= 0))
    val state: StateFlow<PersonEditUiState> = _state.asStateFlow()

    val isEdit: Boolean get() = personId > 0

    /** 档案没读回来就不允许保存——否则一次误触就能把人家的档案清空 */
    val canSave: Boolean get() = !_state.value.saving && (!isEdit || _state.value.loaded)

    fun init() {
        if (!isEdit) {
            // 新增：只需要村庄下拉与标签选项，表单本来就是空的
            viewModelScope.launch {
                val villages = async { runCatching { metaRepo.villages().value }.getOrDefault(emptyList()) }
                // 标签选项取自缓存优先的 personTags：走访前连过一次网，
                // 到村里没信号也能正常显示标签列表（与重点人群入口同一份缓存）
                val tags = async { runCatching { metaRepo.personTags().value }.getOrDefault(emptyList()) }
                _state.update {
                    it.copy(villages = villages.await(), personTags = tags.await())
                }
            }
            return
        }

        _state.update { it.copy(loading = true, loadError = null) }
        viewModelScope.launch {
            try {
                // 村庄列表、标签选项与人员档案互不依赖，并发发出。
                // 串行的话「打开编辑页」要白等三个来回，而这段时间屏幕上什么都没有。
                val villages = async { runCatching { metaRepo.villages().value }.getOrDefault(emptyList()) }
                val tags = async { runCatching { metaRepo.personTags().value }.getOrDefault(emptyList()) }
                val person = async { personRepo.detail(personId).value }
                val p = person.await()
                _state.update {
                    it.copy(
                        loading = false,
                        loaded = true,
                        villages = villages.await(),
                        personTags = tags.await(),
                        // 已有标签回填：tagIds 是「全量覆盖」语义，
                        // 不回填的话保存时会把该人员原有标签清空
                        tagIds = p.tags.map { it.id },
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
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loadError = e.toUserMessage()) }
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
        // 兜底：档案还没读回来之前不允许提交，否则会用空表单覆盖掉既有档案
        if (isEdit && !s.loaded) {
            _state.update { it.copy(error = "档案尚未读取完成，请稍后重试（或返回详情页重新进入）") }
            return
        }
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
            // 全量覆盖语义：把多选框里的值原样提交。
            // 编辑时 tagIds 已回填，用户没改动也会原样发回，不会被清空
            tagIds = s.tagIds,
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

// FlowRow（人口标签那排 chip 用它自动换行）目前仍是实验性 API。
// 项目没有开全局 -opt-in，因此按既有做法在使用处单独标注
// （同 PersonDetailScreen / PersonListScreen 的处理方式）
@OptIn(ExperimentalLayoutApi::class)
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
        // 关键：档案没读回来之前**不渲染表单**。
        // 先给一个空表单再异步填进去，用户在加载期间看到的就是「这人的信息全没了」，
        // 而且他一旦直接点保存，空值会把原档案覆盖掉。
        if (state.loading) {
            LoadingBox(Modifier.padding(padding), "正在读取档案…")
            return@Scaffold
        }
        if (state.loadError != null) {
            ErrorBox(
                "读取档案失败：${state.loadError}\n为避免用空白表单覆盖掉原档案，已暂停编辑。",
                Modifier.padding(padding),
            ) { vm.init() }
            return@Scaffold
        }
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // 错误提示放最上面。原先放在按钮上方——那在一张长表单里等于看不见，
            // 用户只看到「点了保存没反应」。
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }

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
                // 与户主关系改成「从固定几项里选」，不再自由填写。
                // 数据库里存的是编码（HEAD/SPOUSE/…，PC 端下拉框用的就是这套），
                // 自由填写会写进「户主」「妻」这类中文，于是同一条字段在两端显示不同的字、
                // 也没法按关系统计。选项与 PC 的 el-option 保持一致（见 PersonText.RELATIONS）。
                PickerField(
                    label = "与户主关系",
                    value = PersonText.relation(state.relation),
                    options = PersonText.RELATIONS.map { PickerOption(it.first, it.second) },
                    onSelect = { option -> vm.onField { it.copy(relation = option?.value ?: "") } },
                    placeholder = "请选择",
                    allowClear = true,
                )
            }

            // 人口标签：建档时就挂上，不必先保存再回详情页逐个去加。
            // 用一排可点选的 chip 而不是下拉多选——一个人身上常挂好几个标签，
            // chip 一屏能看全、点一下就切换，比在小屏上开弹层勾选快得多。
            SectionCard(title = "人口标签") {
                if (state.personTags.isEmpty()) {
                    Text(
                        "暂无可用标签（可在 PC 端「人口标签」中维护）",
                        style = MaterialTheme.typography.bodySmall,
                        color = com.village.population.ui.theme.AppTheme.tokens.ink3,
                    )
                } else {
                    Text(
                        if (state.tagIds.isEmpty()) "未选择" else "已选 ${state.tagIds.size} 项",
                        style = MaterialTheme.typography.bodySmall,
                        color = com.village.population.ui.theme.AppTheme.tokens.ink3,
                    )
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.foundation.layout.FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        state.personTags.forEach { tag ->
                            androidx.compose.material3.FilterChip(
                                selected = tag.id in state.tagIds,
                                onClick = {
                                    vm.onField { s ->
                                        s.copy(
                                            tagIds = if (tag.id in s.tagIds) s.tagIds - tag.id else s.tagIds + tag.id,
                                        )
                                    }
                                },
                                label = { Text(tag.name) },
                            )
                        }
                    }
                }
            }

            SectionCard(title = "备注") {
                FormField(
                    label = "备注",
                    value = state.remark,
                    onValueChange = { v -> vm.onField { it.copy(remark = v) } },
                    singleLine = false,
                )
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
                    // 档案没读回来就不给点：空表单提交会把原档案覆盖成空
                    enabled = vm.canSave,
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
