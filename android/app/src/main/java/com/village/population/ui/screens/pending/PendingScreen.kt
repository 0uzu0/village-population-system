package com.village.population.ui.screens.pending

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
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
import com.village.population.ui.components.ActionButton
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.EmptyBox
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.HintTextStyle
import com.village.population.ui.components.InfoEntry
import com.village.population.ui.components.InfoRows
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.PlainField
import com.village.population.ui.components.PillTextStyle
import com.village.population.ui.components.SearchField
import com.village.population.ui.theme.AppShapes
import com.village.population.ui.theme.AppTheme
import com.village.population.util.FormRules
import com.village.population.util.IdCard
import com.village.population.util.PersonText
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
                // 只看「待核查」：不传 status 会把已入库/已忽略的记录一起带回来
                //（后端按 status 排序但不过滤），确认入库后记录就不消失了
                val page = meta.pendingList(page = 1, pageSize = 50, keyword = _state.value.keyword, status = "PENDING")
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

    /**
     * 就地修正待核查记录并保存。
     *
     * 只把**改动过的**字段发给后端：patch 里多一个键，就可能把原本正确的值
     * 覆盖成空串，所以界面上没动过的输入框不进 patch。
     * 这个动作与「确认入库」一样要求当场有结论（改完要立刻看到新值），
     * 因此不走离线队列——无网时直接报错，让用户知道没保存成功。
     */
    fun updatePending(id: Int, patch: Map<String, String?>, onResult: (Boolean, String) -> Unit) {
        if (patch.isEmpty()) {
            onResult(true, "没有需要保存的修改")
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(working = true) }
            try {
                meta.updatePending(id, patch)
                _state.update { it.copy(working = false) }
                // 重新拉列表：让卡片上显示的姓名/身份证等与新值一致，
                // 否则保存成功后界面还是旧值，用户会以为没生效
                load()
                onResult(true, "已保存")
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
                    // 忽略操作不会产生 Pending（那是「建档缺身份证」的结果），
                    // 这里兜底处理，避免将来 SubmitResult 新增分支时此处编译失败
                    is com.village.population.data.repository.SubmitResult.Pending -> {
                        _state.update { it.copy(working = false) }
                        onResult(false, "操作结果异常，请重试")
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

    Scaffold(
        // 标题栏（设计稿 .topbar「待核查」）：透明底 + 18sp 加粗墨色。
        // 这一屏此前没有页头，进来先看见一块琥珀横幅，像「出了什么事」——
        // 而它只是一屏待办的来源说明，不该抢在标题前面
        topBar = { AppTopBar(title = "待核查") },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Column(
                Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // 来源说明用琥珀横幅（设计稿 amber-banner）：这一屏的每条记录
                // 都来自同一个「导入时证件有问题」的原因，说明白来源，
                // 网格员才知道要逐条补什么。原先是行灰字，一扫就过。
                // 16dp 圆角（.amber-banner）比白卡收一档——它是告示面板，不是卡片
                Surface(
                    color = tokens.amberBg,
                    shape = RoundedCornerShape(AppShapes.panel),
                    border = BorderStroke(1.dp, tokens.amberLine),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "来源：Excel 导入时身份证号为空或非法的记录，需要逐条补齐或忽略。共 ${state.total} 条待处理。",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.amber,
                        modifier = Modifier.padding(horizontal = 13.dp, vertical = 11.dp),
                    )
                }
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
                    // 批量忽略是次操作（设计稿 .btn-line）：白底细描边 + 二级墨字。
                    // 文字色特意不用品牌蓝——这一排的头等语义是「已勾选几条」，
                    // 批量动作再上品牌色会跟它抢；紧凑高度（约 30dp）也比
                    // 行内大按钮更配这行只有一行文字的选择栏
                    OutlinedButton(
                        onClick = { vm.batchIgnore(toast) },
                        enabled = state.selected.isNotEmpty() && !state.working,
                        shape = RoundedCornerShape(AppShapes.control),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = tokens.ink2),
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
        PendingDetailDialog(
            row = row,
            saving = state.working,
            onDismiss = { detail = null },
            onSave = { patch ->
                vm.updatePending(row.id, patch) { ok, message ->
                    toast(ok, message)
                    // 保存成功后关掉弹窗（列表已在 ViewModel 里刷新）；
                    // 失败则留在原地，让人接着改或改用其它方式处理
                    if (ok) detail = null
                }
            },
        )
    }
}

/**
 * 待核查**编辑**弹窗。
 *
 * 原先这里是纯只读的一屏字段——网格员在村里核对时发现身份证号抄错了一位，
 * 只能记住、回去开电脑改，或者干脆放弃这条。现在直接就地改完保存。
 *
 * 两个刻意保留的约束：
 * 1. **身份证号原样展示、不做任何格式化**——这一屏存在的意义就是拿它去核对，
 *    抹掉或加空格都会让核对无从下手；
 * 2. 待核查原因、导入批次、导入时间是**系统判定/来源信息**，不可编辑，
 *    仍以只读 InfoRow 展示，避免把「为什么被拦下」这条线索改没了。
 */
@Composable
private fun PendingDetailDialog(
    row: PendingDto,
    saving: Boolean,
    onDismiss: () -> Unit,
    onSave: (Map<String, String?>) -> Unit,
) {
    // 初值取档案当前值；只在提交时与初值比对，得到真正改动过的字段
    var name by remember(row.id) { mutableStateOf(row.name.orEmpty()) }
    var gender by remember(row.id) { mutableStateOf(row.gender.orEmpty()) }
    var birthDate by remember(row.id) { mutableStateOf(row.birthDate.orEmpty()) }
    var idCard by remember(row.id) { mutableStateOf(row.idCard.orEmpty()) }
    var phone by remember(row.id) { mutableStateOf(row.phone.orEmpty()) }
    var phoneBackup by remember(row.id) { mutableStateOf(row.phoneBackup.orEmpty()) }
    var village by remember(row.id) { mutableStateOf(row.village.orEmpty()) }
    var gridNo by remember(row.id) { mutableStateOf(row.gridNo.orEmpty()) }
    var familyNo by remember(row.id) { mutableStateOf(row.familyNo.orEmpty()) }
    var relation by remember(row.id) { mutableStateOf(row.relation.orEmpty()) }
    var hukouAddress by remember(row.id) { mutableStateOf(row.hukouAddress.orEmpty()) }
    var liveAddress by remember(row.id) { mutableStateOf(row.liveAddress.orEmpty()) }
    var handleNote by remember(row.id) { mutableStateOf(row.handleNote.orEmpty()) }

    // 身份证解析提示（见下方身份证行的 onValueChange）：
    // null = 还没输到能判定的长度，不占地方
    var idCardHint by remember(row.id) { mutableStateOf<String?>(null) }
    var idCardHintError by remember(row.id) { mutableStateOf(false) }

    // 提交前的本地校验提示。为什么要有：后端对这些字段是「超了/格式不对就整单 400」，
    // 而这一屏的输入框全是自由文本，很容易打进一个后端不认的值（如性别写了「男 」）。
    // 在这里先说清楚是哪一栏，比让网格员对着一条 400 猜要省事得多。
    var formError by remember(row.id) { mutableStateOf<String?>(null) }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(AppShapes.card),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(
                Modifier
                    .padding(16.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Text("编辑待核查记录", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    "该记录尚未进入正式档案，可就地修正后保存，或回到列表「确认」「忽略」。",
                    style = MaterialTheme.typography.bodySmall,
                    color = AppTheme.tokens.ink3,
                )
                Spacer(Modifier.height(10.dp))

                EditableRow("姓名", name, { name = it })
                // 性别输入框显示「男 / 女」、提交值是 MALE / FEMALE（与后端口径一致）。
                // 少了这层转换，身份证联动带出来的就是英文字符串，用户看不懂自己改了什么
                EditableRow(
                    "性别",
                    value = when (gender) {
                        "MALE" -> "男"
                        "FEMALE" -> "女"
                        else -> gender
                    },
                    onValueChange = { input ->
                        gender = when (input.trim()) {
                            "男" -> "MALE"
                            "女" -> "FEMALE"
                            else -> input.trim()
                        }
                    },
                )
                EditableRow("出生日期", birthDate, { birthDate = it }, placeholder = "yyyy-MM-dd")
                // 身份证输入即解析，与上门登记页（PersonEditScreen.onIdCard）
                // 同一口径：证件是性别与出生日期的权威来源，抄录员最容易抄错
                // 的就是这两位，由证件带出可以免掉整类错误。联动的值会随 patch
                // 一起提交（它们相对初值有变化，天然进入「改动过的字段」）。
                EditableRow(
                    "身份证号",
                    idCard,
                    onValueChange = { input ->
                        val cleaned = input.trim().uppercase()
                        idCard = cleaned
                        idCardHint = null
                        idCardHintError = false
                        // 用 if/else 收口，不用 return@：lambda 隐式 label 是调用处
                        // 函数名 EditableRow，写 @onValueChange（参数名）编译器不认，
                        // 会报 'return' is prohibited here
                        if (cleaned.length < 15) {
                            // 仍在输入中：不动字段、不出错
                        } else {
                            when (val result = IdCard.validate(cleaned)) {
                                is IdCard.Result.Invalid -> {
                                    idCardHint = result.message
                                    idCardHintError = true
                                }
                                is IdCard.Result.Valid -> {
                                    // 校验位合法 ≠ 月日存在（如 02-30）：这种只提示、
                                    // 不动 gender/birthDate，让用户自己核对后手改
                                    idCardHint = if (result.birthDate == null) {
                                        "号码合法，但其中的出生日期不存在，请手动核对出生日期"
                                    } else {
                                        "已按证件号带出出生日期与性别"
                                    }
                                    result.gender?.let { gender = it }
                                    result.birthDate?.let { birthDate = it }
                                }
                            }
                        }
                    },
                    placeholder = "15 位或 18 位",
                    hint = idCardHint,
                    hintError = idCardHintError,
                )
                EditableRow("本人电话", phone, { phone = it })
                EditableRow("备用电话", phoneBackup, { phoneBackup = it })
                EditableRow("所属村庄", village, { village = it })
                EditableRow("网格编号", gridNo, { gridNo = it })
                EditableRow("家庭编号", familyNo, { familyNo = it })
                EditableRow("与户主关系", relation, { relation = it })
                EditableRow("户籍地址", hukouAddress, { hukouAddress = it })
                EditableRow("现居住地址", liveAddress, { liveAddress = it })
                EditableRow("处理备注", handleNote, { handleNote = it })

                Spacer(Modifier.height(6.dp))
                // 系统判定与来源信息保持只读，成组一行一线（设计稿 .irow + .irow）
                InfoRows(
                    InfoEntry("待核查原因", row.reasonText?.takeIf { it.isNotBlank() } ?: reasonLabel(row.reason)),
                    InfoEntry("导入批次", listOfNotNull(row.batchNo, row.rowNo?.let { "第 $it 行" }).joinToString(" · ")),
                    InfoEntry("导入时间", row.createdAt),
                )

                Spacer(Modifier.height(10.dp))
                // 本地校验提示放在按钮正上方：用户刚点完保存，视线就在这一带
                formError?.let {
                    Text(
                        it,
                        style = HintTextStyle,
                        color = AppTheme.tokens.red,
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }
                // 弹窗底部的行动对同样走设计稿按钮词表：保存是主操作（实钮），
                // 取消是退路（虚钮）。此前保存用的是 Material Button 默认样式——
                // 全圆角胶囊，与设计稿的其他按钮不是一套语言
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        text = "取消",
                        onClick = onDismiss,
                        enabled = !saving,
                        modifier = Modifier.width(96.dp),
                    )
                    ActionButton(
                        text = if (saving) "保存中…" else "保存",
                        onClick = {
                            // 只提交改动过的字段：多带一个键就可能把正确值覆盖成空串
                            val patch = buildMap<String, String?> {
                                if (name != row.name.orEmpty()) put("name", name)
                                if (gender != row.gender.orEmpty()) {
                                    // 界面上填「男/女」，提交给后端的必须是 MALE/FEMALE：
                                    // 后端是 zod 枚举，中文会直接 400
                                    put("gender", FormRules.genderCode(gender) ?: gender)
                                }
                                if (birthDate != row.birthDate.orEmpty()) put("birthDate", birthDate)
                                if (idCard != row.idCard.orEmpty()) put("idCard", idCard)
                                if (phone != row.phone.orEmpty()) put("phone", phone)
                                if (phoneBackup != row.phoneBackup.orEmpty()) put("phoneBackup", phoneBackup)
                                if (village != row.village.orEmpty()) put("village", village)
                                if (gridNo != row.gridNo.orEmpty()) put("gridNo", gridNo)
                                if (familyNo != row.familyNo.orEmpty()) put("familyNo", familyNo)
                                if (relation != row.relation.orEmpty()) put("relation", relation)
                                if (hukouAddress != row.hukouAddress.orEmpty()) put("hukouAddress", hukouAddress)
                                if (liveAddress != row.liveAddress.orEmpty()) put("liveAddress", liveAddress)
                                if (handleNote != row.handleNote.orEmpty()) put("handleNote", handleNote)
                            }
                            val error = validatePatch(patch)
                            if (error != null) {
                                formError = error
                            } else {
                                formError = null
                                onSave(patch)
                            }
                        },
                        enabled = !saving,
                        filled = true,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

/** 编辑弹窗里的一行：左侧固定宽度标签 + 右侧单行输入框，与只读 InfoRow 对齐 */
@Composable
private fun EditableRow(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String? = null,
    hint: String? = null,
    hintError: Boolean = false,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = HintTextStyle,
                color = AppTheme.tokens.ink3,
                modifier = Modifier.width(84.dp),
            )
            // 用项目的 PlainField（设计稿 .fld-input 那只白盒）而不是另起一套：
            // 同在一个弹窗里，输入框跟别处长得一样才不会读出「两个系统」
            PlainField(
                value = value,
                onValueChange = onValueChange,
                placeholder = placeholder,
                modifier = Modifier.weight(1f),
            )
        }
        // 输入框下方的提示行（身份证解析结果）：错误用红、带出成功用品牌色，
        // 颜色承担「要不要停下来看一眼」的判断
        if (hint != null) {
            Text(
                hint,
                style = HintTextStyle,
                color = if (hintError) AppTheme.tokens.red else AppTheme.tokens.brandStrong,
                modifier = Modifier.padding(start = 84.dp, top = 3.dp),
            )
        }
    }
}

/**
 * 待核查补录的**本地**校验，逐条对应后端 `updateSchema`。
 *
 * 只校验 patch 里出现的键：这一屏是「只提交改动过的字段」，
 * 没动过的栏位即使原本不合法（例如历史数据里性别是空的）也不该拦住保存。
 */
private fun validatePatch(patch: Map<String, String?>): String? {
    patch["name"]?.let { value ->
        if (value.isBlank()) return "姓名不能为空"
        FormRules.lengthError("姓名", value, FormRules.NAME_MAX)?.let { return it }
    }
    // 空串 = 用户清空了性别。后端把空串按「未填」处理（不会 400），这里放行
    patch["gender"]?.let { value ->
        if (value.isNotBlank() && FormRules.genderCode(value) == null) {
            return "性别只能填「男」或「女」"
        }
    }
    patch["birthDate"]?.let { value -> FormRules.dateError("出生日期", value)?.let { return it } }
    patch["phone"]?.let { FormRules.lengthError("本人电话", it, FormRules.PHONE_MAX)?.let { e -> return e } }
    patch["phoneBackup"]?.let { FormRules.lengthError("备用电话", it, FormRules.PHONE_MAX)?.let { e -> return e } }
    patch["village"]?.let { FormRules.lengthError("所属村庄", it, FormRules.VILLAGE_MAX)?.let { e -> return e } }
    patch["gridNo"]?.let { FormRules.lengthError("网格编号", it, FormRules.CODE_MAX)?.let { e -> return e } }
    patch["familyNo"]?.let { FormRules.lengthError("家庭编号", it, FormRules.CODE_MAX)?.let { e -> return e } }
    patch["hukouAddress"]?.let { FormRules.lengthError("户籍地址", it, FormRules.ADDRESS_MAX)?.let { e -> return e } }
    patch["liveAddress"]?.let { FormRules.lengthError("现居住地址", it, FormRules.ADDRESS_MAX)?.let { e -> return e } }
    patch["handleNote"]?.let { FormRules.lengthError("处理备注", it, FormRules.HANDLE_NOTE_MAX)?.let { e -> return e } }
    return null
}

/** 待核查原因码 → 中文；与后端 import_pending.reason 的取值一致 */
private fun reasonLabel(reason: String?): String? = when (reason) {
    "ID_CARD_MISSING" -> "身份证号缺失"
    "ID_CARD_INVALID" -> "身份证号非法"
    null -> null
    else -> reason
}

/**
 * 待核查卡片，对应设计稿 `.pv-card`：白底大圆角卡 + 姓名 + 原因徽章 + 主次操作。
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
    // 设计稿 .pv-card：白底 + 20dp 圆角 + 柔和阴影 + 1px 浅描边。
    // 旧版这里还带一条 3dp 琥珀竖条（QCard）——v3 已把「待处理」的表达
    // 从竖条改成行内原因徽章：竖条只说「这张卡要处理」，而「**为什么**」
    // （证件缺失 / 证件非法）才是动手前必须知道的信息
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(AppShapes.card),
        border = BorderStroke(1.dp, tokens.line2),
        shadowElevation = AppShapes.cardElevation,
        tonalElevation = 0.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 13.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = checked, onCheckedChange = { onToggle() })
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            row.name ?: "（无姓名）",
                            // 设计稿 .pv-name 14.5px 700：行标题，不是页面标题
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold,
                            color = tokens.ink,
                        )
                        // 原因徽章（设计稿 pv-badge）：缺失=红、非法=琥珀。
                        // 「为什么这条要核查」做成行内徽章而不是只在副标题文字里——
                        // 副标题扫一眼就过，徽章是形状+颜色双重编码，扫列表时先抓住它
                        val (badge, badgeBg, badgeFg) = when (row.reason) {
                            "ID_CARD_MISSING" -> Triple("身份证缺失", tokens.redBg, tokens.red)
                            "ID_CARD_INVALID" -> Triple("身份证非法", tokens.amberBg, tokens.amber)
                            else -> Triple(null, tokens.quiet, tokens.ink3)
                        }
                        if (badge != null) {
                            Spacer(Modifier.width(7.dp))
                            Surface(
                                color = badgeBg,
                                shape = RoundedCornerShape(AppShapes.chip),
                            ) {
                                Text(
                                    badge,
                                    style = PillTextStyle,
                                    color = badgeFg,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.5.dp),
                                )
                            }
                        }
                        // 状态徽章：这一行在源表里就已经迁出/死亡。
                        // 「确认入库」不会让他变成正常人口（后端沿用 person_status），
                        // 入库后他在所有在册名单里都看不到——动手前必须让人知道。
                        PersonText.statusLabel(row.personStatus)?.let { label ->
                            Spacer(Modifier.width(7.dp))
                            Surface(
                                color = tokens.quiet,
                                shape = RoundedCornerShape(AppShapes.chip),
                            ) {
                                Text(
                                    label,
                                    style = PillTextStyle,
                                    color = tokens.ink3,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.5.dp),
                                )
                            }
                        }
                    }
                    Text(
                        listOfNotNull(
                            row.idCard?.takeIf { it.isNotBlank() } ?: "身份证号缺失",
                            row.village?.takeIf { it.isNotBlank() },
                            row.reasonText?.takeIf { it.isNotBlank() } ?: reasonLabel(row.reason),
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.ink2,
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
                // 主操作按钮按问题类型命名（设计稿 pv-btn.ok：补全信息 / 修正证件号），
                // 打开的就是编辑弹窗：这条记录本来就缺/错在证件号，第一动作当然是改它，
                // 而不是笼统一个「确认入库」——那反而要想一下「确认什么」。
                // 确认入库保留为右侧文字按钮：证件号核对无误、直接放行时才用得上。
                // （设计稿每张卡只画了两个按钮；保留第三个是刻意的功能取舍——
                //  「确认入库」对应后端查重建人的重动作，不能没有入口）
                Button(
                    onClick = onOpen,
                    enabled = !working,
                    shape = RoundedCornerShape(AppShapes.control),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = tokens.brandLight,
                        contentColor = tokens.brandStrong,
                    ),
                ) {
                    Text(
                        when (row.reason) {
                            "ID_CARD_MISSING" -> "补全信息"
                            "ID_CARD_INVALID" -> "修正证件号"
                            else -> "详情"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                // 忽略是次操作（设计稿 pv-btn.skip）：安静灰底 + 细描边，
                // 与主操作拉开「可点但别急着点」的距离
                OutlinedButton(
                    onClick = onIgnore,
                    enabled = !working,
                    shape = RoundedCornerShape(AppShapes.control),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        containerColor = tokens.quiet,
                        contentColor = tokens.ink3,
                    ),
                    border = BorderStroke(1.dp, tokens.line2),
                ) { Text("忽略", style = MaterialTheme.typography.bodySmall) }
                Spacer(Modifier.weight(1f))
                // 确认入库降为文字按钮并去掉装饰箭头：它不再是这条卡的主路径，
                // 只服务「证件号核对无误、直接放行」的场景。带箭头的实体样式
                // 会让它看起来跟主操作一样重要，而它恰恰是最少见的一条路
                TextButton(onClick = onConfirm, enabled = !working) {
                    Text("确认入库", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
