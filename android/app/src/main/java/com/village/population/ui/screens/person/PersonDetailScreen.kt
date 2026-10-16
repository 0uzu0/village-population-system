package com.village.population.ui.screens.person

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoCamera
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
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.village.population.data.remote.dto.FileDto
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.repository.FileRepository
import com.village.population.data.repository.PersonRepository
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.BottomAction
import com.village.population.ui.components.BottomActionBar
import com.village.population.ui.components.DotLabel
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.InfoRow
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.SectionCard
import com.village.population.ui.components.clickableNoRipple
import com.village.population.ui.components.parseHexColor
import com.village.population.ui.theme.AppTheme
import com.village.population.ui.theme.AppShapes
import com.village.population.util.DateText
import com.village.population.util.PersonText
import com.village.population.util.dial
import com.village.population.util.toUserMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

data class PersonDetailUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val person: PersonDto? = null,
    val fromCache: Boolean = false,
    val savedAt: Long = 0L,
    val message: String? = null,
    /** 这个人的现场照片（按拍照时间倒序，后端已排好） */
    val photos: List<FileDto> = emptyList(),
    val photosLoading: Boolean = false,
    /** 正在放大查看的那张（null = 没在看） */
    val viewing: FileDto? = null,
)

class PersonDetailViewModel(
    private val repo: PersonRepository,
    private val files: FileRepository,
    private val personId: Int,
) : ViewModel() {

    private val _state = MutableStateFlow(PersonDetailUiState())
    val state: StateFlow<PersonDetailUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val result = repo.detail(personId)
                _state.update {
                    it.copy(
                        loading = false,
                        person = result.value,
                        fromCache = result.fromCache,
                        savedAt = result.savedAt,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.toUserMessage()) }
            }
        }
    }

    /**
     * 现场照片。**失败不转成整页错误**：照片是附加信息，
     * 权限不足或断网时人物档案本身仍然要看得到，不能因为图片区而整页报错。
     */
    fun loadPhotos() {
        viewModelScope.launch {
            _state.update { it.copy(photosLoading = true) }
            runCatching { files.list(bizType = "PERSON", bizId = personId).list }
                .onSuccess { list -> _state.update { it.copy(photos = list, photosLoading = false) } }
                .onFailure { _state.update { it.copy(photosLoading = false) } }
        }
    }

    fun view(photo: FileDto?) = _state.update { it.copy(viewing = photo) }

    fun consumeMessage() = _state.update { it.copy(message = null) }

    /**
     * 删除一张现场照片。
     *
     * 后端会连同磁盘上的物理文件一起删，**不可恢复**，
     * 所以调用之前必须由 UI 层向用户要一次确认（见 PhotoViewerDialog）。
     * 失败时把后端给的中文原因透到页面上：常见的两种是「只能删除自己上传的文件」
     * 和权限不足，含糊一句「删除失败」会让人反复重试。
     */
    fun removePhoto(photo: FileDto) {
        viewModelScope.launch {
            runCatching { files.remove(photo.id) }
                .onSuccess {
                    _state.update {
                        it.copy(
                            photos = it.photos.filterNot { p -> p.id == photo.id },
                            viewing = null,
                            message = "已删除这张现场照片",
                        )
                    }
                }
                .onFailure { _state.update { s -> s.copy(message = it.toUserMessage()) } }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PersonDetailScreen(
    personId: Int,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onCapture: () -> Unit,
) {
    val context = LocalContext.current
    val tokens = AppTheme.tokens
    val container = LocalAppContainer.current
    val vm: PersonDetailViewModel = com.village.population.ui.containerViewModel {
        PersonDetailViewModel(it.personRepository, it.fileRepository, personId)
    }
    val state by vm.state.collectAsStateWithLifecycle()

    // 每次进入这一屏都重拉一次：Navigation Compose 只组合当前目的地，
    // 从「拍照留痕」回来时本屏会重新进入组合，新上传的照片立刻就能看到。
    LaunchedEffect(personId) {
        vm.load()
        vm.loadPhotos()
    }

    val person = state.person

    Scaffold(
        topBar = {
            // 标题用固定的「人员详情」而不是人名：人名就在下面第一张卡片上，
            // 页头再写一遍会挤掉返回键右侧的空间，滚动时也没有额外信息量
            AppTopBar(title = "人员详情", onBack = onBack)
        },
        bottomBar = {
            if (person != null) {
                // 操作栏固定底部（设计稿画法）：单手可及，比原先挤在右上角的三个小图标好按
                val actions = buildList {
                    if (person.phone?.isNotBlank() == true) {
                        add(BottomAction("打电话", Icons.Filled.Call) { context.dial(person.phone) })
                    }
                    add(BottomAction("拍照留痕", Icons.Filled.PhotoCamera, onCapture))
                    add(BottomAction("编辑资料", Icons.Filled.Edit, onEdit))
                }
                BottomActionBar(actions)
            }
        },
    ) { padding ->
        when {
            state.loading && person == null -> LoadingBox(Modifier.padding(padding))
            state.error != null && person == null -> ErrorBox(state.error!!, Modifier.padding(padding)) { vm.load() }
            person == null -> ErrorBox("人员不存在", Modifier.padding(padding))
            else -> Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                if (state.fromCache) {
                    OfflineBanner("离线缓存数据（${DateText.describeAge(state.savedAt)}）")
                }

                // 删除照片这类操作的结果。显示几秒自己消失：
                // 操作已经成功了，再留一行常驻文字会让页面看起来像还有事没办完
                state.message?.let { msg ->
                    LaunchedEffect(msg) {
                        delay(2500L)
                        vm.consumeMessage()
                    }
                    Text(msg, style = MaterialTheme.typography.bodyMedium, color = tokens.green)
                }

                // 身份卡（设计稿首页那张卡）：头像 + 姓名 + 状态 + 一行摘要
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    shape = RoundedCornerShape(AppShapes.card),
                    shadowElevation = AppShapes.cardElevation,
                    tonalElevation = 0.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(44.dp)
                                .background(tokens.brandLight, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Filled.Person,
                                contentDescription = null,
                                tint = tokens.brandStrong,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                        Spacer(Modifier.width(11.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    person.name,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = tokens.ink,
                                )
                                Spacer(Modifier.width(6.dp))
                                val (statusText, statusColor) = statusTag(person.status)
                                DotLabel(statusText, statusColor)
                            }
                            Text(
                                listOfNotNull(
                                    if (person.gender == "FEMALE") "女" else "男",
                                    (person.age ?: DateText.ageOf(person.birthDate))?.let { "$it 岁" },
                                    person.village?.takeIf { it.isNotBlank() },
                                    person.gridName?.takeIf { it.isNotBlank() },
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.ink3,
                            )
                        }
                    }
                }

                // 现场照片：拍照留痕的落点。
                // 没有照片时整块不显示——空白区块只占地方；「拍照留痕」按钮常驻在底部操作栏，
                // 入口并没有因此消失。照片按拍照时间倒序（后端排好），文件名本身也带着
                // 「哪天拍的、拍的谁」，所以不额外补一行说明文字。
                if (state.photos.isNotEmpty()) {
                    SectionCard(title = "现场照片（${state.photos.size}）") {
                        androidx.compose.foundation.layout.FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                            maxItemsInEachRow = 3,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            state.photos.forEach { photo ->
                                PhotoThumb(photo) { vm.view(photo) }
                            }
                        }
                    }
                }

                SectionCard(title = "基本信息") {
                    InfoRow("身份证号", person.idCard)
                    InfoRow("本人电话", person.phone)
                    InfoRow("备用电话", person.phoneBackup)
                    InfoRow("出生日期", person.birthDate)
                    InfoRow("年龄", (person.age ?: DateText.ageOf(person.birthDate))?.let { "$it 岁" })
                    InfoRow("人员编号", person.personNo)
                    InfoRow("人员状态", PersonText.status(person.status))
                }

                SectionCard(title = "户籍与居住") {
                    InfoRow("所属村庄", person.village)
                    InfoRow("所属网格", person.gridName)
                    InfoRow("户籍地址", person.hukouAddress)
                    InfoRow("现居住地址", person.liveAddress)
                }

                // 「与户主关系」只出现在家庭这一处。原先「户籍与居住」也重复列了一行，
                // 同一个值在两处出现，改了其中一个字段会让人怀疑另一个怎么没变。
                SectionCard(title = "家庭") {
                    InfoRow("所属家庭", person.familyName)
                    InfoRow("与户主关系", PersonText.relation(person.relation))
                }

                SectionCard(title = "重点人群") {
                    if (person.tags.isEmpty()) {
                        Text(
                            "暂无标签。身份类人群（党员、低保、残疾等）通过打标签认定；" +
                                "老年人、未成年人按出生日期自动判定，不需要打标签。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.ink3,
                        )
                    } else {
                        PersonTags(person)
                    }
                }

                SectionCard(title = "服务台账") {
                    InfoRow("银行账号", person.bankAccount)
                    InfoRow("月补贴金额", person.subsidyAmount?.let { "$it 元/月" })
                    InfoRow("家庭情况", person.familyCondition)
                    InfoRow("健康评估", person.healthAssessment)
                }

                person.disability?.let { d ->
                    SectionCard(title = "残疾档案") {
                        InfoRow("残疾类别", d.type)
                        InfoRow("残疾等级", d.levelLabel ?: d.level)
                        InfoRow("残疾证号", d.card)
                        InfoRow("监护人", d.guardianName)
                        InfoRow("监护人电话", d.guardianPhone)
                        InfoRow("备注", d.remark)
                    }
                }

                SectionCard(title = "备注") {
                    Text(
                        person.remark?.takeIf { it.isNotBlank() } ?: "—",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }

                if (person.changes.isNotEmpty()) {
                    SectionCard(title = "变更记录（最近 ${person.changes.size} 条）") {
                        person.changes.forEach { change ->
                            Column(Modifier.padding(vertical = 6.dp)) {
                                Text(
                                    "${change.fieldName ?: "字段"}：${change.oldValue ?: "空"} → ${change.newValue ?: "空"}",
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                Text(
                                    listOfNotNull(
                                        change.changeType,
                                        change.reason,
                                        change.createdAt,
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = tokens.ink3,
                                )
                            }
                        }
                    }
                }

                Text(
                    "数据来源：${person.dataSource ?: "—"}　更新时间：${person.updatedAt ?: "—"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                )
                Spacer(Modifier.height(20.dp))
            }
        }
    }

    state.viewing?.let { photo ->
        PhotoViewerDialog(
            photo = photo,
            onDismiss = { vm.view(null) },
            onDelete = { vm.removePhoto(photo) },
        )
    }
}

/**
 * 标签区：色片 + 「生效/状态」两列。
 *
 * 用 FlowRow 而不是 Row：一个人身上挂六七个标签是常事（低保 + 残疾 + 老年…），
 * 单行的 Row 会把超出部分直接切掉——患者看不到自己已经被打过的标签，
 * 会以为没登记上，然后重复打一遍。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PersonTags(person: PersonDto) {
    val tokens = AppTheme.tokens
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        person.tags.forEach { tag ->
            DotLabel(tag.name, parseHexColor(tag.color, tokens.brand))
        }
    }
    Spacer(Modifier.height(8.dp))
    person.tags.forEach { tag ->
        InfoRow(
            tag.name,
            listOfNotNull(
                tag.effectDate?.let { "生效 $it" },
                tag.status?.takeIf { it != "ACTIVE" }?.let { "状态 $it" },
            ).joinToString("，").ifBlank { "有效" },
        )
    }
}

/**
 * 现场照片缩略图。
 *
 * 图片接口要 Bearer 头，把 URL 直接丢给 `<img>` 那种做法必然 401，
 * 所以必须先由 FileRepository 取回字节落到本地缓存文件，再交给 Coil 渲染
 * （见 FileRepository.imageFile）。取不到就显示一块占位底，
 * 不让整张卡片因为一张图而整块空掉。
 */
@Composable
private fun PhotoThumb(photo: FileDto, onClick: () -> Unit) {
    val files = LocalAppContainer.current.fileRepository
    val tokens = AppTheme.tokens
    val file by androidx.compose.runtime.produceState<File?>(null, photo.id) {
        value = runCatching { files.imageFile(photo.id) }.getOrNull()
    }
    Surface(
        color = tokens.quiet,
        shape = RoundedCornerShape(AppShapes.card),
        shadowElevation = AppShapes.cardElevation,
        tonalElevation = 0.dp,
        modifier = Modifier
            .width(84.dp)
            .height(84.dp)
            .clickableNoRipple(file != null, onClick),
    ) {
        val loaded = file
        if (loaded == null) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                if (photo.id > 0) {
                    androidx.compose.material3.CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                    )
                }
            }
        } else {
            AsyncImage(
                model = loaded,
                contentDescription = photo.fileName,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/**
 * 现场照片的说明文字：**拍摄时间优先**，没有才说上传时间。
 *
 * 后端 `file.ts` 已经把 DATETIME 按北京时间格式化成朴素文本下发，
 * 所以这里**直接显示原串**、不再做一次解析。以前服务端给的是 UTC 的 ISO 串
 * （13:00 拍的照片是 `2026-10-16T05:00:00.000Z`），谁在客户端随意一截就是 05:00，
 * 「刚拍的照片显示成八小时前」就是这么来的：把换算放在两处，一定会有一处算错。
 *
 * 离线补传的照片，两者能差好几天——标明是哪一个，看的人才知道该信哪个。
 */
private fun photoTimeLabel(photo: FileDto): String? =
    when {
        !photo.capturedAt.isNullOrBlank() -> "拍摄 ${photo.capturedAt}"
        !photo.createdAt.isNullOrBlank() -> "上传 ${photo.createdAt}"
        else -> null
    }

/**
 * 放大查看，并在这一屏直接删除。
 *
 * 「是不是拍错了、要不要留着」这个判断只有在看清原图之后才做得出来——
 * 让人退出去再找删除按钮，等于把一次能完成的动作拆成两趟。
 * 不左右滑动：需求是「确认这张对不对」，不是当相册翻。
 */
@Composable
private fun PhotoViewerDialog(
    photo: FileDto,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
) {
    val files = LocalAppContainer.current.fileRepository
    val tokens = AppTheme.tokens
    var confirming by remember { mutableStateOf(false) }
    val file by produceState<File?>(null, photo.id) {
        value = runCatching { files.imageFile(photo.id) }.getOrNull()
    }
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(AppShapes.card), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(12.dp)) {
                val loaded = file
                if (loaded != null) {
                    AsyncImage(
                        model = loaded,
                        contentDescription = photo.fileName,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 420.dp),
                    )
                } else {
                    Box(
                        Modifier.fillMaxWidth().height(200.dp),
                        contentAlignment = Alignment.Center,
                    ) { androidx.compose.material3.CircularProgressIndicator() }
                }
                Spacer(Modifier.height(8.dp))
                // 文件名就是「拍照时间-谁-编号」（后端按拍照时间生成），
                // 放在这里刚好当作这张照片的说明
                Text(
                    photo.fileName ?: "现场照片",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                )
                photoTimeLabel(photo)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = tokens.ink3)
                }
                Spacer(Modifier.height(6.dp))
                if (confirming) {
                    // 二次确认必须说清「不可恢复」：后端删库记录的同时会删掉物理文件，
                    // 删完既不能在界面上找回，也没有回收站
                    Text(
                        "删除后无法恢复，确定要删除这张现场照片？",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    if (confirming) {
                        TextButton(onClick = { confirming = false }) { Text("取消") }
                        Spacer(Modifier.width(8.dp))
                        TextButton(onClick = onDelete) {
                            Text("确认删除", color = MaterialTheme.colorScheme.error)
                        }
                    } else {
                        TextButton(onClick = { confirming = true }) {
                            Text("删除", color = MaterialTheme.colorScheme.error)
                        }
                        Spacer(Modifier.width(8.dp))
                        TextButton(onClick = onDismiss) { Text("关闭") }
                    }
                }
            }
        }
    }
}

/** 状态徽标：在册给绿色，迁出/死亡给中性或红色——一眼能看出这个人还算不算在册数里 */
@Composable
private fun statusTag(status: String): Pair<String, androidx.compose.ui.graphics.Color> {
    val tokens = AppTheme.tokens
    return when (status) {
        "NORMAL", "MOVED_IN" -> "在册" to tokens.green
        "DEAD" -> "已死亡" to tokens.red
        else -> "已迁出" to tokens.ink3
    }
}
