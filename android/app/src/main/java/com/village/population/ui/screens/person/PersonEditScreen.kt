package com.village.population.ui.screens.person

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
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
import com.village.population.ui.components.ActionButton
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.FormField
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.OptionChip
import com.village.population.ui.components.PickerField
import com.village.population.ui.components.PickerOption
import com.village.population.ui.components.PrimaryButton
import com.village.population.ui.components.SectionCard
import com.village.population.ui.theme.AppTheme
import com.village.population.util.FormRules
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
    /** 读取档案时拿到的版本号，保存时原样带回（乐观锁） */
    val rowVersion: Int = 0,
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
                        // 编辑期间的并发保护：保存时带回这个版本号，
                        // 有人先改过就会 409 而不是被静默覆盖
                        rowVersion = p.rowVersion,
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
        // 本地先按后端 zod 的上限拦一遍：这些字段超长后端只会回一句
        // 「too_big」，而此刻人还在走访现场，不可能知道是哪一栏超了
        validate(s)?.let { message ->
            _state.update { it.copy(error = message) }
            return
        }

        val request = PersonCreateRequest(
            name = s.name.trim(),
            // 性别是枚举：未选时为 null，会被 JSON 配置整个省掉（后端 optional），
            // 绝不能发 ""，否则 zod 枚举直接拒掉
            gender = s.gender,
            /*
             * 文本字段一律**原样提交**，不做 takeIf{isNotBlank()} 收成 null。
             *
             * 这是与后端「清空」语义对齐的关键：后端收到 '' 会把该列落成 NULL，
             * 收到 undefined（null 被 explicitNulls=false 省掉的效果）则视为
             * 「本次没提交这个字段」而保持原值。早先这里统一收成 null，
             * 于是「删掉电话再保存」显示成功，回列表电话还在——假成功。
             */
            birthDate = s.birthDate.trim(),
            idCard = s.idCard.trim(),
            phone = s.phone.trim(),
            phoneBackup = s.phoneBackup.trim(),
            // 村庄是下拉选择，清空入口不存在，null 即「未选/不改」
            village = s.village,
            hukouAddress = s.hukouAddress.trim(),
            liveAddress = s.liveAddress.trim(),
            relation = s.relation,
            remark = s.remark.trim(),
            // 全量覆盖语义：把多选框里的值原样提交。
            // 编辑时 tagIds 已回填，用户没改动也会原样发回，不会被清空
            tagIds = s.tagIds,
            // 新增时不带版本号（后端跳过校验），编辑时必须带
            rowVersion = if (isEdit) s.rowVersion else null,
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

    /**
     * 提交前的本地校验。顺序按「用户最可能出错的先后」：
     * 身份标识 → 证件 → 日期 → 联系方式 → 地址 → 备注。
     * 所有上限都取自 [FormRules]（与后端 zod 一一对应）。
     */
    private fun validate(s: PersonEditUiState): String? {
        if (s.name.isBlank()) return "姓名必填"
        FormRules.lengthError("姓名", s.name.trim(), FormRules.NAME_MAX)?.let { return it }
        if (s.idCard.isNotBlank() && IdCard.validate(s.idCard) is IdCard.Result.Invalid) {
            return "身份证号不正确，请检查后再保存"
        }
        FormRules.dateError("出生日期", s.birthDate)?.let { return it }
        FormRules.lengthError("本人电话", s.phone, FormRules.PHONE_MAX)?.let { return it }
        FormRules.lengthError("备用电话", s.phoneBackup, FormRules.PHONE_MAX)?.let { return it }
        FormRules.lengthError("户籍地址", s.hukouAddress, FormRules.ADDRESS_MAX)?.let { return it }
        FormRules.lengthError("现居住地址", s.liveAddress, FormRules.ADDRESS_MAX)?.let { return it }
        FormRules.lengthError("所属村庄", s.village.orEmpty(), FormRules.VILLAGE_MAX)?.let { return it }
        FormRules.lengthError("备注", s.remark, FormRules.REMARK_MAX)?.let { return it }
        return null
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
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current

    LaunchedEffect(personId) { vm.init() }

    // 保存逻辑提到 Scaffold 外面：按钮搬进吸底操作条后，这段逻辑不能跟着
    // 一堆布局代码埋在底栏里，读代码时要能一眼看到"点保存会发生什么"
    val onSave: () -> Unit = {
        vm.save { result ->
            when (result) {
                is SubmitResult.Sent -> onDone()

                // 未填身份证号：后端**没有建正式档案**，而是转进了待核查。
                // 留在本页说明去向，不要返回列表——那里找不到这个人，
                // 用户会以为数据丢了再录一遍，待核查里就多一条重复。
                is SubmitResult.Pending -> {
                    val no = result.pendingId?.let { "（记录 #$it）" }.orEmpty()
                    resultMessage = "未填写身份证号，已转入待核查人员$no；" +
                        "到「待核查」补录身份证后点「确认入库」即可建档"
                }

                is SubmitResult.Queued -> {
                    // 明确告诉用户「数据没丢」，否则他会以为保存失败而反复点
                    resultMessage = "当前无网络，${result.label} 已暂存本机，联网后会自动上传"
                }
            }
        }
    }

    Scaffold(
        // 键盘避让**只在这一处**做，加在整个骨架上：骨架收缩到键盘上方，topBar 不动，
        // 吸底条贴着键盘上沿，内容区拿到「收缩后高度 − topBar − 吸底条」。
        //
        // ⚠️ 踩过的坑（v2.4.3 用户截图：点进输入框，整张表单消失、只剩一根输入框
        // 浮在顶上）：当时内容区加了一次 imePadding()、SaveBar 内部又加了一次。
        // SaveBar 在 bottomBar 里，它的 padding 会被算进「条的高度」，Scaffold 再从
        // 内容区把这一坨让出来 → 内容区高度直接归零。**吸底条内部永远不要再加
        // imePadding()**，只留 navigationBarsPadding()。
        modifier = Modifier.imePadding(),
        topBar = {
            AppTopBar(
                title = if (vm.isEdit) "编辑人员" else "上门登记",
                onBack = onDone,
            )
        },
        // 保存条吸底（不再是内容流末尾那颗孤零零的蓝按钮）：
        // 这张表单有十几张卡片，主操作跟着内容滚到最后一行，用户要么先滚到底
        // 才找得到保存，要么在半途以为"这页没法保存"。吸底条给三件事——
        // 一条分隔线（说明它不属于内容，是这一屏的工具）、
        // 一颗全宽 50dp 主按钮、以及"刚发生了什么"贴在按钮上方。
        // 加载中与加载失败时不显示：那时表单还没出来，能点的只有重试。
        bottomBar = {
            if (!state.loading && state.loadError == null) {
                SaveBar(
                    message = resultMessage,
                    saving = state.saving,
                    canSave = vm.canSave,
                    onSave = onSave,
                    onDone = onDone,
                )
            }
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
                // 键盘避让交给外层 Scaffold 统一处理，这里不再加 imePadding()：
                // 两处都加会把键盘高度扣两次，内容区被压成 0（键盘一弹表单就没了）
                .verticalScroll(rememberScrollState())
                // 点空白处收起键盘。子级（输入框/芯片）吃掉的点击到不了这里，
                // 只有落在空白处的点击会触发收起
                .pointerInput(Unit) {
                    detectTapGestures {
                        keyboard?.hide()
                        focusManager.clearFocus()
                    }
                }
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

                // 性别芯片（设计稿 .fchip/.fchip.on）：白底细边 ⇄ 浅蓝底深蓝字。
                // 不用 Material FilterChip——它的默认样式带勾选、尺寸另一套，
                // 会和人口档案那排筛选片读出两种「选中态」，而它们是同一种语义
                Text("性别", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("MALE" to "男", "FEMALE" to "女").forEach { (value, label) ->
                        OptionChip(
                            text = label,
                            selected = state.gender == value,
                            onClick = { vm.onField { it.copy(gender = value) } },
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
                    // 户籍/流动口径互斥（总人口 = 户籍 + 流动，两者不交叉）：
                    // 选中一方时自动取消另一方。后端 syncPersonTags 还有
                    // 「户籍优先」兜底，这里前置拦截是为了让用户当场看到结果。
                    Text(
                        "户籍人口与流动人口互斥：选中一方会自动取消另一方",
                        style = MaterialTheme.typography.bodySmall,
                        color = com.village.population.ui.theme.AppTheme.tokens.ink3,
                    )
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.foundation.layout.FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        state.personTags.forEach { tag ->
                            OptionChip(
                                text = tag.name,
                                selected = tag.id in state.tagIds,
                                onClick = {
                                    vm.onField { s ->
                                        if (tag.id in s.tagIds) {
                                            s.copy(tagIds = s.tagIds - tag.id)
                                        } else {
                                            // 标签互斥（数据驱动）：互斥组与组内优先级都来自
                                            // 后端标签字典，客户端不再判断具体编码。
                                            // 同组已有更高优先级的标签时不加这一枚——
                                            // 后端同样会拒绝，在这里就先给出正确结果。
                                            val group = tag.exclusiveGroup
                                            if (group == null) {
                                                s.copy(tagIds = s.tagIds + tag.id)
                                            } else {
                                                val stronger = s.personTags.any {
                                                    it.exclusiveGroup == group &&
                                                        it.id != tag.id &&
                                                        it.exclusivePriority < tag.exclusivePriority &&
                                                        it.id in s.tagIds
                                                }
                                                if (stronger) {
                                                    s
                                                } else {
                                                    val weaker = s.personTags
                                                        .filter {
                                                            it.exclusiveGroup == group &&
                                                                it.id != tag.id &&
                                                                it.exclusivePriority > tag.exclusivePriority
                                                        }
                                                        .map { it.id }
                                                        .toSet()
                                                    s.copy(tagIds = (s.tagIds + tag.id) - weaker)
                                                }
                                            }
                                        }
                                    }
                                },
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

            // 底部留白收窄：真正的"底"由吸底条承担，这里只是最后一张卡与条之间的呼吸
            Spacer(Modifier.height(8.dp))
        }
    }
}

/**
 * 表单底部吸底操作条。
 *
 * 为什么不是"内容流末尾一颗全宽按钮"：这张表单十几张卡片，那颗按钮在屏幕上
 * 只出现在滚到底的那一刻；而它一旦出现，又是页面最后一行下面孤零零一条蓝色，
 * 上不着卡、下不着地——用户的原话是"在底部有点突兀"。
 *
 * 吸底条把它变成"这一屏的工具"：一条细线与内容分开、白底托住、与系统手势区
 * 隔开；按钮永远是全宽 50dp，滚到哪儿都按得到。键盘弹出时整条随**外层 Scaffold**
 * 的 imePadding 抬起（而不是被键盘盖住，也不是自己吃一遍 ime 高度），
 * 刚发生的提示（转入待核查 / 已暂存本机）也贴在这里
 * ——它是对刚才那次点击的回应，就该出现在按钮旁边。
 */
@Composable
private fun SaveBar(
    message: String?,
    saving: Boolean,
    canSave: Boolean,
    onSave: () -> Unit,
    onDone: () -> Unit,
) {
    val t = AppTheme.tokens
    Surface(
        color = MaterialTheme.colorScheme.surface,
        // 12dp 是"压得住内容"的一档：条与滚动的内容之间要有明确分界，
        // 否则滚到一半会以为按钮是卡片的一部分
        shadowElevation = 12.dp,
        tonalElevation = 0.dp,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                // 只留手势区留白。键盘避让由外层 Scaffold 的 imePadding() 统一负责：
                // 若在条内部再加一次，Scaffold 会把「键盘高度」当成条的高度从内容区让出，
                // 内容区归零，整张表单消失。
                .navigationBarsPadding(),
        ) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(t.line2))
            Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                if (message != null) {
                    Text(
                        message,
                        style = MaterialTheme.typography.bodySmall,
                        color = t.ink2,
                    )
                    Spacer(Modifier.height(8.dp))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryButton(
                        text = if (saving) "保存中…" else "保存",
                        onClick = onSave,
                        enabled = canSave,
                        modifier = Modifier.weight(1f),
                    )
                    if (message != null) {
                        // 返回只在"发生了需要解释的事"时出现：平时它和页头的
                        // 返回键重复，占着一半宽度；出事之后它是"我不改了，退出去"，
                        // 与保存并排才合理
                        ActionButton(
                            text = "返回",
                            onClick = onDone,
                            modifier = Modifier.width(96.dp),
                            height = 50.dp,
                        )
                    }
                }
            }
        }
    }
}
