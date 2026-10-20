package com.village.population.ui.screens.person

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.remote.dto.VillageDto
import com.village.population.data.repository.PersonQuery
import com.village.population.data.repository.PersonRepository
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.PendingFilter
import com.village.population.ui.components.AppChip
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.EmptyBox
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.InlineSearchField
import com.village.population.ui.components.MetaTextStyle
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.PersonListSkeleton
import com.village.population.ui.components.SearchField
import com.village.population.ui.components.TagPill
import com.village.population.ui.components.tabular
import com.village.population.ui.components.clickableNoRipple
import com.village.population.ui.components.parseHexColor
import com.village.population.ui.theme.AppShapes
import com.village.population.ui.theme.AppTheme
import com.village.population.util.DateText
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PersonListUiState(
    val query: PersonQuery = PersonQuery(),
    val list: List<PersonDto> = emptyList(),
    val total: Int = 0,
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
    val fromCache: Boolean = false,
    val savedAt: Long = 0L,
    val villages: List<VillageDto> = emptyList(),
    /** 从工作台某个重点人群跳过来时记下来源名称，列表上要显示，见下方说明 */
    val filterLabel: String? = null,
) {
    val hasMore: Boolean get() = list.size < total

    /**
     * 用户是否真的加过筛选（决定要不要露出「重置」）。
     *
     * 特意**不算 activeOnly**：它默认就是 true，把它算进来的话「重置」会永远显示，
     * 而按下去什么都不会变——那种按钮只会让人误以为列表已经被筛过了。
     */
    val hasUserFilter: Boolean
        get() = !query.activeOnly || query.village != null || query.keyword.isNotBlank() ||
            query.tagIds.isNotEmpty() || query.minAge != null || query.maxAge != null ||
            filterLabel != null
}

class PersonListViewModel(
    private val repo: PersonRepository,
    private val meta: com.village.population.data.repository.MetaRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(PersonListUiState())
    val state: StateFlow<PersonListUiState> = _state.asStateFlow()

    /**
     * 进入页面时应用外部传来的筛选（工作台点某个重点人群跳过来）。
     *
     * 必须把来源名称一起记住并显示：一个「只显示 62 人」的列表如果看不出是被筛过的，
     * 使用者会以为档案丢了人——尤其是从「低保对象 62 人」点进来的时候。
     */
    fun applyPendingFilter(pending: PendingFilter) {
        _state.update { it.copy(query = pending.query, filterLabel = pending.label) }
        load()
    }

    fun onKeyword(value: String) = _state.update { it.copy(query = it.query.copy(keyword = value, page = 1)) }

    fun search() = load()

    fun toggleActiveOnly() {
        _state.update { it.copy(query = it.query.copy(activeOnly = !it.query.activeOnly, page = 1)) }
        load()
    }

    fun onVillage(value: String?) {
        _state.update { it.copy(query = it.query.copy(village = value, page = 1)) }
        load()
    }

    /** 只清掉「重点人群」这一路筛选，保留用户自己输的搜索词与村庄 */
    fun clearFocusFilter() {
        _state.update { it.copy(query = it.query.copy(tagIds = emptyList(), minAge = null, maxAge = null, page = 1), filterLabel = null) }
        load()
    }

    fun clearFilters() {
        _state.update { it.copy(query = PersonQuery(), filterLabel = null) }
        load()
    }

    fun loadVillages() {
        viewModelScope.launch {
            runCatching { meta.villages().value }.onSuccess { villages ->
                _state.update { it.copy(villages = villages) }
            }
        }
    }

    fun load(append: Boolean = false) {
        viewModelScope.launch {
            val current = _state.value
            _state.update {
                it.copy(
                    loading = !append,
                    loadingMore = append,
                    error = null,
                )
            }
            try {
                val page = repo.list(current.query)
                val merged = if (append) current.list + page.value.list else page.value.list
                _state.update {
                    it.copy(
                        list = merged,
                        total = page.value.total,
                        loading = false,
                        loadingMore = false,
                        fromCache = page.fromCache,
                        savedAt = page.savedAt,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loadingMore = false, error = e.toUserMessage()) }
            }
        }
    }

    fun loadMore() {
        val current = _state.value
        if (current.loading || current.loadingMore || !current.hasMore) return
        _state.update { it.copy(query = it.query.copy(page = it.query.page + 1)) }
        load(append = true)
    }

    /**
     * 首屏加载 / 从详情返回时的「原地刷新」。
     *
     * 原先这里一律走 `load()`：从人员详情按返回键回到列表，`LaunchedEffect(Unit)`
     * 会重新跑一遍，而 `load()` 是「清空并只取第 1 页」——列表被截回 20 条，
     * 用户翻了半天的位置连同滚动位置一起没了，观感就是「返回后永远回到第一个人」。
     *
     * 现在的语义分两种：
     *  · 列表还空着（首次进入 / 换了筛选条件）→ 正常加载；
     *  · 列表已有数据（返回本页）→ 按**当前已加载的条数**重取一次覆盖写回，
     *    条数与 id 顺序都不变，LazyColumn 的滚动位置自然保住，
     *    同时还能拿到详情/编辑里刚改过的姓名与标签。
     * 刷新失败静默忽略：一次后台刷新失败不该让用户丢掉已经翻到的位置。
     */
    fun initOrRefresh() {
        val current = _state.value
        if (current.list.isEmpty()) {
            load()
            return
        }
        // 超过一页上限就不刷新了：分多次取反而会让列表条数抖动，位置更不稳
        if (current.list.size > MAX_REFRESH_PAGE_SIZE) return
        viewModelScope.launch {
            val window = current.query.copy(page = 1, pageSize = current.list.size)
            try {
                val page = repo.list(window)
                _state.update {
                    it.copy(
                        list = page.value.list,
                        total = page.value.total,
                        fromCache = page.fromCache,
                        savedAt = page.savedAt,
                        error = null,
                    )
                }
            } catch (_: Exception) {
                // 静默：保留原有列表
            }
        }
    }

    private companion object {
        /** 与后端 /persons 的 pageSize 上限（200）对齐 */
        const val MAX_REFRESH_PAGE_SIZE = 200
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PersonListScreen(
    onOpenPerson: (Int) -> Unit,
    onCreatePerson: () -> Unit,
) {
    val container = LocalAppContainer.current
    val tokens = AppTheme.tokens
    val vm: PersonListViewModel = com.village.population.ui.containerViewModel {
        PersonListViewModel(it.personRepository, it.metaRepository)
    }
    val state by vm.state.collectAsStateWithLifecycle()
    var villagePickerOpen by remember { mutableStateOf(false) }
    // rememberLazyListState 内部是 rememberSaveable：从详情返回时 NavHost 会按
    // 目的地恢复保存态，滚动位置跟着回来。少了它，每次重组都是从第 0 项开始。
    val listState = rememberLazyListState()

    LaunchedEffect(Unit) {
        vm.loadVillages()
        // 消费一次性筛选（工作台跳过来时带的）
        val pending = container.personFilterBus.consume()
        // 带筛选过来必须整体重载（筛选条件变了，旧列表不能留），
        // 其余情况（含从详情/编辑返回）走原地刷新，保住已加载条数与滚动位置
        if (pending != null) vm.applyPendingFilter(pending) else vm.initOrRefresh()
    }

    Scaffold(
        topBar = {
            // 标题即设计稿 .topbar：透明底 + 18sp 加粗墨色（见 AppTopBar）
            AppTopBar(
                title = "人口档案",
                actions = {
                    // 总数放在标题栏右侧（设计稿的 `.bar .rt`）：
                    // 放在内容区会跟着列表一起滚走，而「筛选后到底有多少人」是要随时能看见的
                    Text(
                        "共 ${state.total} 人",
                        style = MaterialTheme.typography.bodyMedium.tabular(),
                        color = tokens.ink2,
                        modifier = Modifier.padding(end = 16.dp),
                    )
                },
            )
        },
        floatingActionButton = {
            // 设计稿 .fab：52dp 方圆角（18dp 圆角）纯图标按钮，不是带文字的延长丸——
            // 「新增」两个字占掉按钮一半宽度，而加号本身已经说清了动作；
            // 品牌底 + 白字（Material 默认用的是 primaryContainer，浅蓝底上放浅蓝字，
            // 在户外的强光下几乎看不见）
            FloatingActionButton(
                onClick = onCreatePerson,
                shape = RoundedCornerShape(18.dp),
                containerColor = tokens.brand,
                contentColor = androidx.compose.ui.graphics.Color.White,
                // 阴影与卡片同一档（4dp）。FAB 没有 shadowElevation 命名参数，
                // 走 FloatingActionButtonDefaults.elevation（默认 defaultElevation
                // 6dp 比卡片还重，悬浮件比内容层还「糊」不符合层次关系）
                elevation = FloatingActionButtonDefaults.elevation(
                    defaultElevation = AppShapes.cardElevation,
                ),
                modifier = Modifier.size(52.dp),
            ) {
                Icon(
                    Icons.Filled.Add,
                    contentDescription = "新增人员",
                    modifier = Modifier.size(22.dp),
                )
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Column(
                Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // 缓存横幅放在最上面（设计稿位置）：它是在说「下面这一屏数据别太当真」，
                // 得先看到它再看数字，压在列表下面就成了马后炮
                if (state.fromCache) {
                    OfflineBanner("离线数据（${DateText.describeAge(state.savedAt)}），联网后会自动刷新")
                }

                SearchField(
                    value = state.query.keyword,
                    onValueChange = vm::onKeyword,
                    placeholder = "搜姓名 / 身份证号 / 手机号",
                    onSearch = { vm.search() },
                )

                // 筛选片用 FlowRow 自动换行，不再用「一行 + 横向滚动」：
                // 手机上这一排本来就能凑到 4 个（在册/村庄/重点人群/重置），
                // 横向滚动会把最后一个直接挤出屏幕——用户看不到「重置」，
                // 只会觉得筛选区坏了、还退不出筛选。换行后每个 chip 都在可见范围内。
                FlowRow(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    AppChip(
                        text = "仅看在册",
                        selected = state.query.activeOnly,
                        onClick = { vm.toggleActiveOnly() },
                        // 选中时跟一枚对勾（设计稿 .chip.on 里的 check）：
                        // 「已选上」这件事不能只靠底色——色弱用户在户外更认形状
                        selectedIcon = Icons.Filled.Check,
                    )
                    AppChip(
                        text = state.query.village?.take(6) ?: "按村庄",
                        selected = state.query.village != null,
                        onClick = { villagePickerOpen = true },
                    )
                    // 筛完必须让人**看得见筛了什么**：从「低保对象 62 人」点进来却只看到
                    // 「共 62 人」，使用者会怀疑是漏了人，而不是意识到当前是筛选结果。
                    // 用 warn 红色档（设计稿 .chip.warn）：它在说「这是个待清理的筛选」，
                    // 点一下就清，跟普通选中态区分开
                    state.filterLabel?.let { label ->
                        AppChip(
                            text = "重点人群：$label",
                            selected = false,
                            warn = true,
                            onClick = { vm.clearFocusFilter() },
                            trailingIcon = Icons.Filled.Clear,
                        )
                    }
                    // 「重置」只在**用户真的加过筛选**时出现。
                    // 原先的条件里有 activeOnly，而它默认就是 true —— 等于这一颗按钮
                    // 永远挂在那里。一颗常驻却按了没变化的按钮比没有更糟：
                    // 它会让人以为当前列表是被筛过的。
                    if (state.hasUserFilter) {
                        AppChip(text = "重置", selected = false, onClick = { vm.clearFilters() })
                    }
                }
            }

            when {
                // 首屏用骨架屏而不是居中转圈：村里网络慢，转圈只说明「在等」，
                // 骨架说明「马上有一列人，长这样」，等的是同一段时间但页面不像空的
                state.loading -> PersonListSkeleton()
                state.error != null -> ErrorBox(state.error!!) { vm.load() }
                state.list.isEmpty() -> if (state.hasUserFilter) {
                    EmptyBox(
                        message = "没有找到匹配的村民",
                        description = "换个关键词试试，或者清空筛选看全部在册人员",
                        actionLabel = "清空筛选",
                        onAction = { vm.clearFilters() },
                        icon = Icons.Filled.SearchOff,
                    )
                } else {
                    EmptyBox(
                        message = "还没有人员档案",
                        description = "可以从电脑端批量导入，也可以直接在这里新增一个人",
                        actionLabel = "新增人员",
                        onAction = onCreatePerson,
                        icon = Icons.Filled.PersonAdd,
                    )
                }
                else -> LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 88.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.list, key = { it.id }) { person ->
                        PersonRow(person) { onOpenPerson(person.id) }
                    }
                    if (state.hasMore) {
                        item {
                            LaunchedEffect(state.list.size) { vm.loadMore() }
                            // 这里是**自动**加载（滑到底就触发），所以文案不能写
                            // 「上拉加载更多」——用户不需要上拉，看到的是一行提示在等。
                            // 加一枚 14dp 的转圈，是为了让「怎么不动了」这一秒有交代。
                            Row(
                                Modifier.fillMaxWidth().padding(16.dp),
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(14.dp),
                                    strokeWidth = 2.dp,
                                    color = tokens.ink3,
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "正在加载更多…",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = tokens.ink3,
                                )
                            }
                        }
                    } else {
                        item {
                            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    "已显示全部 ${state.total} 人",
                                    style = MaterialTheme.typography.bodySmall.tabular(),
                                    color = tokens.ink3,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (villagePickerOpen) {
        VillageChooserDialog(
            villages = state.villages,
            current = state.query.village,
            onDismiss = { villagePickerOpen = false },
            onSelect = {
                vm.onVillage(it)
                villagePickerOpen = false
            },
        )
    }
}

/**
 * 村庄选择弹窗。
 *
 * 单独写而不用 PickerField：村庄有上百个，而且这里还要显示每村人数——
 * 「村名 + 人数」能帮网格员确认自己选的是不是想看的那个村（同名村并不罕见）。
 */
@Composable
private fun VillageChooserDialog(
    villages: List<VillageDto>,
    current: String?,
    onDismiss: () -> Unit,
    onSelect: (String?) -> Unit,
) {
    var keyword by remember { mutableStateOf("") }
    val tokens = AppTheme.tokens
    val filtered = remember(keyword, villages) {
        if (keyword.isBlank()) villages else villages.filter { it.name.contains(keyword, ignoreCase = true) }
    }
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(AppShapes.card),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("选择村庄", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(10.dp))
                InlineSearchField(
                    value = keyword,
                    onValueChange = { keyword = it },
                    placeholder = "搜索村名",
                )
                Spacer(Modifier.height(10.dp))
                LazyColumn(Modifier.height((filtered.size.coerceIn(1, 8) * 52 + 8).dp)) {
                    items(filtered, key = { it.name }) { village ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(village.name) }
                                .padding(vertical = 14.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                village.name,
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = if (village.name == current) FontWeight.Bold else FontWeight.Normal,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "${village.personCount} 人",
                                style = MaterialTheme.typography.bodyMedium,
                                color = tokens.ink2,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    androidx.compose.material3.TextButton(onClick = { onSelect(null) }) { Text("不限村庄") }
                    androidx.compose.material3.TextButton(onClick = onDismiss) { Text("取消") }
                }
            }
        }
    }
}

/**
 * 人员行，对应设计稿的 `.p-card`：44dp 头像圆牌 + 姓名（性别年龄随行）+
 * 证件号 · 村庄 + 标签胶囊。
 *
 * 第二行放证件号而不是网格/住址：现场核人靠的是「年纪 + 尾号」，
 * 号码能对上就基本确认是同一个人；住址那一列在村里几乎都是同一个村名，没有区分度。
 *
 * 这里用完整号码、不做脱敏：这一屏就是拿着手机对着人核身份的，
 * 抹掉前 6 位与中间位之后反而没法逐位核对。号码太长时按行尾省略，
 * 点进详情能看到完整的。
 *
 * 卡片化（设计稿 v3 定稿）：20dp 圆角 + 4dp 阴影 + 1px 浅描边兜底 + 16dp 级留白，
 * 与首页指标卡、分区卡同一套 [AppShapes]；头像圆牌把视觉重心收到左侧，
 * 扫读时先落点再落到文字。
 *
 * 标签为什么排在文字下方而不是设计稿画右侧竖列：真实数据一个人挂四五个
 * 标签是常事（低保 + 残疾 + 老年 + 党员…），竖列会把卡片撑到半屏高；
 * 成排换行在标签多时只增高不撑宽，与设计稿的胶囊样式（.p-tag 10sp 彩色胶囊）
 * 保持一致。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PersonRow(person: PersonDto, onClick: () -> Unit) {
    val tokens = AppTheme.tokens
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(AppShapes.card),
        shadowElevation = AppShapes.cardElevation,
        tonalElevation = 0.dp,
        // 1px 浅描边兜底：个别低端机 Layer 合成会裁掉阴影，描边保证层次不消失
        border = BorderStroke(1.dp, tokens.line),
        modifier = Modifier.fillMaxWidth().clickableNoRipple(true, onClick),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(44.dp)
                    .background(tokens.brandLight, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    person.name.take(1),
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 17.sp),
                    fontWeight = FontWeight.Bold,
                    color = tokens.brandStrong,
                )
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        person.name,
                        // 设计稿 .p-name 15px 700：列表行不是标题，用 20sp 会把
                        // 一屏能扫的人数砍掉一半
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = tokens.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.width(6.dp))
                    // 性别年龄是纯文字而不是徽章（设计稿 .p-name span 11px 三级灰）：
                    // 它是名字的补充说明，做成彩色小方块会跟真正的标签胶囊抢注意力
                    Text(
                        "${if (person.gender == "FEMALE") "女" else "男"} · " +
                            "${person.age ?: DateText.ageOf(person.birthDate) ?: "?"} 岁",
                        style = MetaTextStyle,
                        color = tokens.ink3,
                        maxLines = 1,
                    )
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    listOfNotNull(
                        person.idCard?.takeIf { it.isNotBlank() },
                        person.village?.takeIf { it.isNotBlank() },
                    ).joinToString(" · ").ifBlank { "—" },
                    style = MetaTextStyle,
                    color = tokens.ink2,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (person.tags.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        person.tags.take(4).forEach { tag ->
                            TagPill(tag.name, parseHexColor(tag.color, tokens.brand))
                        }
                        if (person.tags.size > 4) {
                            TagPill("+${person.tags.size - 4}", tokens.ink3)
                        }
                    }
                }
            }
        }
    }
}
