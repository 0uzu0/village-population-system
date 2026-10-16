package com.village.population.ui.screens.person

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import com.village.population.ui.components.DotLabel
import com.village.population.ui.components.EmptyBox
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.SearchField
import com.village.population.ui.components.clickableNoRipple
import com.village.population.ui.components.parseHexColor
import com.village.population.ui.theme.AppTheme
import com.village.population.util.DateText
import com.village.population.util.Mask
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
}

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

    LaunchedEffect(Unit) {
        vm.loadVillages()
        // 消费一次性筛选（工作台跳过来时带的）
        val pending = container.personFilterBus.consume()
        if (pending != null) vm.applyPendingFilter(pending) else vm.load()
    }

    Scaffold(
        topBar = {
            AppTopBar(
                title = "人口查询",
                actions = {
                    // 总数放在标题栏右侧（设计稿的 `.bar .rt`）：
                    // 放在内容区会跟着列表一起滚走，而「筛选后到底有多少人」是要随时能看见的
                    Text(
                        "共 ${state.total} 人",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(end = 16.dp),
                    )
                },
            )
        },
        floatingActionButton = {
            // 品牌底 + 白字（设计稿的 `.fab`）；Material 默认用的是 primaryContainer，
            // 浅蓝底上放浅蓝字，在户外的强光下几乎看不见
            ExtendedFloatingActionButton(
                onClick = onCreatePerson,
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("新增") },
                containerColor = tokens.brand,
                contentColor = androidx.compose.ui.graphics.Color.White,
            )
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

                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AppChip(
                        text = "仅看在册",
                        selected = state.query.activeOnly,
                        onClick = { vm.toggleActiveOnly() },
                    )
                    AppChip(
                        text = state.query.village?.take(6) ?: "按村庄",
                        selected = state.query.village != null,
                        onClick = { villagePickerOpen = true },
                    )
                    // 筛完必须让人**看得见筛了什么**：从「低保对象 62 人」点进来却只看到
                    // 「共 62 人」，使用者会怀疑是漏了人，而不是意识到当前是筛选结果
                    state.filterLabel?.let { label ->
                        AppChip(
                            text = "重点人群：$label",
                            selected = true,
                            onClick = { vm.clearFocusFilter() },
                            trailingIcon = Icons.Filled.Clear,
                        )
                    }
                    if (state.query.activeOnly || state.query.village != null) {
                        AppChip(text = "重置", selected = false, onClick = { vm.clearFilters() })
                    }
                }
            }

            when {
                state.loading -> LoadingBox()
                state.error != null -> ErrorBox(state.error!!) { vm.load() }
                state.list.isEmpty() -> EmptyBox("没有符合条件的在册人员")
                else -> LazyColumn(
                    contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 88.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.list, key = { it.id }) { person ->
                        PersonRow(person) { onOpenPerson(person.id) }
                    }
                    if (state.hasMore) {
                        item {
                            LaunchedEffect(state.list.size) { vm.loadMore() }
                            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    if (state.loadingMore) "加载中…" else "上拉加载更多",
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
            shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("选择村庄", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = keyword,
                    onValueChange = { keyword = it },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    placeholder = { Text("搜索村名") },
                    singleLine = true,
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth(),
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
 * 人员行，对应设计稿的 `.pitem`：
 * 第一行「姓名 + 性别年龄」、第二行「脱敏证件号 · 村庄」、第三行标签。
 *
 * 第二行放脱敏证件号而不是网格/住址：现场核人靠的是「年纪 + 尾号」，
 * 证件号能对上就基本确认是同一个人；住址那一列在村里几乎都是同一个村名，没有区分度。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PersonRow(person: PersonDto, onClick: () -> Unit) {
    val tokens = AppTheme.tokens
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(11.dp),
        modifier = Modifier.fillMaxWidth().clickableNoRipple(true, onClick),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    person.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = tokens.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.width(7.dp))
                DotLabel(
                    "${if (person.gender == "FEMALE") "女" else "男"} · " +
                        "${person.age ?: DateText.ageOf(person.birthDate) ?: "?"} 岁",
                    tokens.ink2,
                )
            }
            Spacer(Modifier.height(3.dp))
            Text(
                listOfNotNull(
                    Mask.idCard(person.idCard).takeIf { it.isNotBlank() },
                    person.village?.takeIf { it.isNotBlank() },
                ).joinToString(" · ").ifBlank { "—" },
                style = MaterialTheme.typography.bodySmall,
                color = tokens.ink3,
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
                        DotLabel(tag.name, parseHexColor(tag.color, tokens.brand))
                    }
                    if (person.tags.size > 4) {
                        DotLabel("+${person.tags.size - 4}", tokens.ink3)
                    }
                }
            }
        }
    }
}
