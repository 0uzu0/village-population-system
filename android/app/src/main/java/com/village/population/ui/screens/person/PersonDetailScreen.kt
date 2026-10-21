package com.village.population.ui.screens.person

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.material3.Icon
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.shadow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.village.population.data.remote.dto.FileDto
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.repository.FileRepository
import com.village.population.data.repository.PersonRepository
import kotlinx.coroutines.CancellationException
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.components.ActionButton
import com.village.population.ui.components.AppDivider
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.CollapsibleRow
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.InfoEntry
import com.village.population.ui.components.InfoRows
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.SectionCard
import com.village.population.ui.components.TagPill
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
            // 页头再写一遍会挤掉返回键右侧的空间，滚动时也没有额外信息量。
            //
            // 「编辑」放在右上角而不是内容流末尾：上一版是滚到底才出现的一颗
            // 全宽蓝按钮，页面读完之后孤零零挂在最后一行「数据来源」下面，
            // 既像状态条又像广告条，视觉上没有落点。详情页的主操作属于标题栏
            // ——它不随滚动消失，也不占用内容区的垂直空间。
            AppTopBar(
                title = "人员详情",
                onBack = onBack,
                actions = {
                    Box(
                        Modifier
                            .height(44.dp)
                            .clickableNoRipple(true, onEdit)
                            .padding(horizontal = 14.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "编辑",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = tokens.brandStrong,
                        )
                    }
                },
            )
        },
        // 底部操作栏不设：这一屏没有"页面级主按钮"了——编辑进了标题栏，
        // 拨打与拍照在名片下，页面末尾只留数据来源一行小字。
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

                // 名片（设计稿 v4 detail-hero）：**横向**头像 + 姓名 + 性别年龄生日 + 标签，
                // 下方紧跟两枚 44dp 动作按钮（拨打 / 拍照留痕）。
                //
                // 为什么从「居中大头像」改成「横向名片」：上一版是纵向居中排布，
                // 头像 66dp + 名字 + 副标题 + 标签行，光这张卡就 190dp；
                // 而这一屏真正长的是后面七张卡。横向排布把同一批信息压到 100dp 以内，
                // 换来的是「动作按钮能进首屏」——走访时打电话与拍照是最高频的两件事，
                // 原本一个是一行 30dp 的彩色文字、一个是第三张卡里的 TextButton，
                // 都得先找到它们。
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    shape = RoundedCornerShape(AppShapes.card),
                    border = BorderStroke(1.dp, tokens.line2),
                    shadowElevation = AppShapes.cardElevation,
                    tonalElevation = 0.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            // 54dp 头像 + 2dp 白环 + 柔和阴影（设计稿 .d-ava）
                            Box(
                                Modifier
                                    .size(54.dp)
                                    .shadow(AppShapes.cardElevation, CircleShape)
                                    .background(tokens.brandLight, CircleShape)
                                    .border(2.dp, Color.White, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    person.name.take(1),
                                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 21.sp),
                                    fontWeight = FontWeight.Bold,
                                    color = tokens.brandStrong,
                                )
                            }
                            Spacer(Modifier.width(13.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    person.name,
                                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 22.sp),
                                    fontWeight = FontWeight.ExtraBold,
                                    color = tokens.ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Spacer(Modifier.height(2.dp))
                                // 生日不在这里再写一遍：下方「基本信息」有精确日期。
                                // 名片副标题只回答「男的女的、多大」，那是核人时第一眼要的
                                Text(
                                    listOfNotNull(
                                        if (person.gender == "FEMALE") "女" else "男",
                                        (person.age ?: DateText.ageOf(person.birthDate))?.let { "$it 岁" },
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = tokens.ink3,
                                )
                            }
                        }

                        // 标签行独占一整行，不再塞在头像右侧那条窄列里。
                        //
                        // 塞在窄列里的问题是实打实的：那一列只有「卡片宽度 − 头像 54dp
                        // − 间距」≈ 230dp，四个标签加状态就要换行；一旦换行，这一列比
                        // 头像高，行高被撑开，下面的按钮行跟着压上来——真机上就出现过
                        // 标签被按钮切掉半个字。整行摆放后宽度多出 54dp，五个标签能排下，
                        // 排不下也只是自己换行，不会顶到底下的按钮。
                        val (statusText, statusColor) = statusTag(person.status)
                        Spacer(Modifier.height(10.dp))
                        // 状态徽章与标签同一套胶囊（设计稿 .d-tags）：状态其实也是
                        // 一种标签，两种样子摆在一行会读出两种信息层级
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(5.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            TagPill(statusText, statusColor)
                            person.tags.forEach { tag ->
                                TagPill(tag.name, parseHexColor(tag.color, tokens.brand))
                            }
                        }

                        Spacer(Modifier.height(12.dp))

                        // 动作对（M4）：拨打是**实底**——两个手机号任取一个能打的，
                        // 走访时「给他打个电话」比「拍张照」更常发生。
                        //
                        // 按钮上只写「拨打电话」，不再把号码印在按钮里：号码的**正本**
                        // 是下方「基本信息 → 本人电话」，同一个 11 位数字在首屏出现两次，
                        // 既占掉了按钮一半宽度（窄屏上还会被省略号切断），
                        // 也让人怀疑两处是不是同一个号。没号码时这颗按钮直接不出现——
                        // 不做「没有电话」的灰按钮：摆一颗点了没反应的按钮，
                        // 比不摆更让人犹豫。
                        val dialNumber = person.phone?.takeIf { it.isNotBlank() }
                            ?: person.phoneBackup?.takeIf { it.isNotBlank() }
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            if (dialNumber != null) {
                                ActionButton(
                                    text = "拨打电话",
                                    onClick = { context.dial(dialNumber) },
                                    filled = true,
                                    icon = Icons.Filled.Phone,
                                    height = 44.dp,
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            ActionButton(
                                text = "拍照留痕",
                                onClick = onCapture,
                                icon = Icons.Filled.PhotoCamera,
                                height = 44.dp,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }

                // 现场照片：横滑一行，只负责「看」。
                //
                // 这里原本还有两个添加入口（空态整块可点、末尾一枚虚线「+」），
                // 加上名片下的「拍照留痕」，同一个动作在一屏里出现了三次——
                // 用户站在这里会先犹豫「点哪个」。现在统一收归名片下那枚 44dp 按钮，
                // 这张卡不再放任何按钮：有照片就横滑看，没照片就写明「还没有」。
                // 卡本身留着——「查过了，确实没留过痕」和「这屏没有照片分区」
                // 是两件事，前者也是要报给村里知道的信息。
                SectionCard(title = if (state.photos.isEmpty()) "现场照片" else "现场照片（${state.photos.size}）") {
                    if (state.photos.isEmpty()) {
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Filled.Image,
                                contentDescription = null,
                                tint = tokens.ink3,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "还没有现场照片 · 用上方「拍照留痕」拍第一张",
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.ink3,
                            )
                        }
                    } else {
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            items(state.photos, key = { it.id }) { photo ->
                                PhotoThumb(photo) { vm.view(photo) }
                            }
                        }
                    }
                }

                SectionCard(title = "基本信息") {
                    InfoRows(
                        InfoEntry("身份证号", person.idCard),
                        // 电话行直接点按拨号（值渲染成品牌色）：底部操作栏撤掉后，
                        // 这一行就是「打电话」的入口——走访时给人打电话是高频动作，
                        // 不该为它再翻一屏。两条电话都接 dial，空值不可点
                        InfoEntry("本人电话", person.phone, onClick = {
                            person.phone?.let { context.dial(it) }
                        }),
                        InfoEntry("备用电话", person.phoneBackup, onClick = {
                            person.phoneBackup?.let { context.dial(it) }
                        }),
                        // 「年龄」与「人员状态」两行已删：两者在名片上都有——
                        // 年龄在副标题（男 · 71 岁），状态是那枚胶囊（在册）。
                        // 同一个事实写两遍，除了让这张卡变长，还会制造"哪个才是准的"
                        // 的疑问：状态一行写的是后端原值「正常」，胶囊写的是报数用的
                        //「在册」，两种叫法并排放，读的人会以为是两件事。
                        InfoEntry("出生日期", person.birthDate),
                        InfoEntry("人员编号", person.personNo),
                        dense = true
                    )
                }

                SectionCard(title = "户籍与居住") {
                    InfoRows(
                        InfoEntry("所属村庄", person.village),
                        InfoEntry("所属网格", person.gridName),
                        InfoEntry("户籍地址", person.hukouAddress),
                        InfoEntry("现居住地址", person.liveAddress),
                        dense = true
                    )
                }

                // 「与户主关系」只出现在家庭这一处。原先「户籍与居住」也重复列了一行，
                // 同一个值在两处出现，改了其中一个字段会让人怀疑另一个怎么没变。
                SectionCard(title = "家庭") {
                    InfoRows(
                        InfoEntry("所属家庭", person.familyName),
                        InfoEntry("与户主关系", PersonText.relation(person.relation)),
                        dense = true
                    )
                }

                // 「重点人群」这一块 2026-10 按需求整块删掉：
                // 人员详情是「核对这个人是谁」的页面，重点人群是按人群看名单的入口，
                // 两件事混在一起会让详情页变长、也让网格员在核人时分心。
                // 标签本身没丢——顶部身份区仍会展示标签胶囊，重点人群名单在
                // 工作台对应入口进入；要调整标签走「编辑」。

                person.disability?.let { d ->
                    SectionCard(title = "残疾档案") {
                        InfoRows(
                            InfoEntry("残疾类别", d.type),
                            InfoEntry("残疾等级", d.levelLabel ?: d.level),
                            InfoEntry("残疾证号", d.card),
                            InfoEntry("监护人", d.guardianName),
                            // 监护人电话同样可点按拨号
                            InfoEntry("监护人电话", d.guardianPhone, onClick = {
                                d.guardianPhone?.let { context.dial(it) }
                            }),
                            InfoEntry("备注", d.remark),
                            dense = true
                        )
                    }
                }

                // 备注只在有内容时出现：空备注摆一张「—」的卡，等于用 80dp 告诉
                // 看的人「这里没有信息」——而详情页的长短正是这次要压的东西
                person.remark?.takeIf { it.isNotBlank() }?.let { remark ->
                    SectionCard(title = "备注") {
                        Text(remark, style = MaterialTheme.typography.bodyLarge)
                    }
                }

                // 低频分组（设计稿 M4）：服务台账 + 变更记录并成**一张卡的两条折叠行**，
                // 默认收起。两者各自原本都是一张完整白卡（标题行 + 内边距 + 间距），
                // 而它们合起来只有「偶尔查一个银行账号 / 看看最近改了什么」这一种用途。
                // 压成两条 44dp 的行后，这一页从三屏变两屏，且标题里写清里面有什么，
                // 要查的人一眼知道展开哪一条。
                // 展开状态用 `remember` 放在本屏：离开再回来复位成收起（设计稿明确要求
                // 折叠状态不跨页面记忆——记住上次展开了什么只会让下次多一次「收起」）。
                var ledgerOpen by remember { mutableStateOf(false) }
                var changesOpen by remember { mutableStateOf(false) }
                if (person.changes.isNotEmpty() || person.bankAccount != null ||
                    person.subsidyAmount != null || person.familyCondition != null ||
                    person.healthAssessment != null
                ) {
                    Surface(
                        color = MaterialTheme.colorScheme.surface,
                        shape = RoundedCornerShape(AppShapes.card),
                        border = BorderStroke(1.dp, tokens.line2),
                        shadowElevation = AppShapes.cardElevation,
                        tonalElevation = 0.dp,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                            CollapsibleRow(
                                title = "服务台账",
                                summary = "银行账号 · 补贴 · 健康评估",
                                expanded = ledgerOpen,
                                onToggle = { ledgerOpen = !ledgerOpen },
                            ) {
                                InfoRows(
                                    InfoEntry("银行账号", person.bankAccount),
                                    InfoEntry("月补贴金额", person.subsidyAmount?.let { "$it 元/月" }),
                                    InfoEntry("家庭情况", person.familyCondition),
                                    InfoEntry("健康评估", person.healthAssessment),
                                    dense = true
                                )
                            }
                            if (person.changes.isNotEmpty()) {
                                AppDivider(Modifier.padding(start = 11.dp))
                                CollapsibleRow(
                                    title = "变更记录",
                                    summary = "最近 ${person.changes.size} 条",
                                    expanded = changesOpen,
                                    onToggle = { changesOpen = !changesOpen },
                                ) {
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
                        }
                    }
                }

                Text(
                    "数据来源：${person.dataSource ?: "—"}　更新时间：${person.updatedAt ?: "—"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                )
                // 末尾不再放按钮：编辑在标题栏。这里留一口气的余量就够
                Spacer(Modifier.height(16.dp))
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

/** 放大查看时的解码上限（像素）。按 1440 解一张图最多约 8MB 位图，看清原图足够了 */
private const val VIEWER_MAX_PX = 1440

/**
 * 单张照片的加载状态。
 *
 * 修复前只有「文件有没有拿到」两态：拿不到（null）就一直转圈。于是一张永远下不来的
 * 照片会让那一格永远转圈，用户看到的是「整个页面卡住了」；而真正让页面卡住的是
 * 下载跑在主线程上（见 FileRepository.imageFile 的注释）。有了失败态，至少
 * 「下不来」和「还在下」在界面上是两件事，重试也才有个落点。
 */
private sealed interface PhotoLoadState {
    data object Loading : PhotoLoadState
    data object Failed : PhotoLoadState
    data class Ready(val file: File) : PhotoLoadState
}

/**
 * 取一张照片。取消要原样抛出：`runCatching` 会把 CancellationException 也吞掉，
 * 那会让「滑走这一屏」变成一次假的加载失败。
 */
private suspend fun loadPhoto(files: FileRepository, id: Int): PhotoLoadState =
    try {
        PhotoLoadState.Ready(files.imageFile(id))
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        PhotoLoadState.Failed
    }

/**
 * 现场照片缩略图。
 *
 * 图片接口要 Bearer 头，把 URL 直接丢给图片控件那种做法必然 401，
 * 所以必须先由 FileRepository 取回并落到本地缓存文件，再交给 Coil 渲染
 * （见 FileRepository.imageFile）。取不到就显示一块可点按重试的占位底，
 * 不让整张卡片因为一张图而整块空掉，也不让它一直转圈假装还在加载。
 */
@Composable
private fun PhotoThumb(photo: FileDto, onClick: () -> Unit) {
    val files = LocalAppContainer.current.fileRepository
    val tokens = AppTheme.tokens
    // 点一下失败态就加一次，produceState 以它为 key 重跑
    var retry by remember(photo.id) { mutableIntStateOf(0) }
    val load by produceState<PhotoLoadState>(PhotoLoadState.Loading, photo.id, retry) {
        value = PhotoLoadState.Loading
        value = loadPhoto(files, photo.id)
    }
    Surface(
        color = tokens.quiet,
        shape = RoundedCornerShape(AppShapes.card),
        shadowElevation = AppShapes.cardElevation,
        tonalElevation = 0.dp,
        modifier = Modifier
            // 80×56 的横档（设计稿 S4 是 50dp 高的一行横排）：
            // 旧版 84×84 的正方形一屏放不下几张，横档一行能排 4 个，
            // 高度也压下去一半——而缩略图的作用是「认出是哪张」，不是看细节
            .width(80.dp)
            .height(56.dp)
            .clickableNoRipple {
                when (load) {
                    is PhotoLoadState.Ready -> onClick()
                    PhotoLoadState.Failed -> retry++
                    PhotoLoadState.Loading -> Unit
                }
            },
    ) {
        when (val current = load) {
            is PhotoLoadState.Ready -> AsyncImage(
                model = current.file,
                contentDescription = photo.fileName,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )

            PhotoLoadState.Failed -> Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    Icons.Filled.Refresh,
                    contentDescription = null,
                    tint = tokens.ink3,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.height(4.dp))
                Text("点按重试", style = MaterialTheme.typography.bodySmall, color = tokens.ink3)
            }

            PhotoLoadState.Loading -> Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.fillMaxSize(),
            ) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
            }
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
    val context = LocalContext.current
    val tokens = AppTheme.tokens
    var confirming by remember { mutableStateOf(false) }
    var retry by remember(photo.id) { mutableIntStateOf(0) }
    val load by produceState<PhotoLoadState>(PhotoLoadState.Loading, photo.id, retry) {
        value = PhotoLoadState.Loading
        value = loadPhoto(files, photo.id)
    }
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(AppShapes.card), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(12.dp)) {
                when (val current = load) {
                    is PhotoLoadState.Ready -> AsyncImage(
                        model = ImageRequest.Builder(context)
                            .data(current.file)
                            // 显式限一个解码上限：Dialog 里的约束一旦是「无界」，
                            // Coil 会按原图解码，一张 12MP 的现场照片就是 48MB 位图，
                            // 内存不够时就是一次闪退
                            .size(VIEWER_MAX_PX)
                            .build(),
                        contentDescription = photo.fileName,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 420.dp),
                    )

                    PhotoLoadState.Failed -> Box(
                        Modifier.fillMaxWidth().height(200.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                "照片加载失败",
                                style = MaterialTheme.typography.bodyMedium,
                                color = tokens.ink3,
                            )
                            TextButton(onClick = { retry++ }) { Text("重试") }
                        }
                    }

                    PhotoLoadState.Loading -> Box(
                        Modifier.fillMaxWidth().height(200.dp),
                        contentAlignment = Alignment.Center,
                    ) { CircularProgressIndicator() }
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
