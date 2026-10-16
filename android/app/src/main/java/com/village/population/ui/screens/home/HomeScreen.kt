package com.village.population.ui.screens.home

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.data.remote.dto.DashboardDto
import com.village.population.data.remote.dto.PendingSummaryDto
import com.village.population.data.remote.dto.QuickGroupDto
import com.village.population.data.remote.dto.TagDto
import com.village.population.data.repository.FocusGroupQuery
import com.village.population.data.repository.MetaRepository
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.components.AppDivider
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.GrowRow
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.SectionCard
import com.village.population.ui.components.StatCard
import com.village.population.ui.components.StatTone
import com.village.population.ui.components.clickableNoRipple
import com.village.population.ui.components.parseHexColor
import com.village.population.ui.navigation.Routes
import com.village.population.ui.theme.AppTheme
import com.village.population.util.DateText
import com.village.population.util.toUserMessage
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val dashboard: DashboardDto? = null,
    val groups: List<QuickGroupDto> = emptyList(),
    val pending: PendingSummaryDto? = null,
    /** 标签字典，用来把重点人群的 tagCodes 翻译成 tagIds。取不到就是空表 */
    val tags: List<TagDto> = emptyList(),
    val fromCache: Boolean = false,
    val savedAt: Long = 0L,
    val note: String? = null,
)

class HomeViewModel(private val meta: MetaRepository) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                // 四个请求互不依赖，并发发出（串行会让首屏多等三个来回）
                val dashboard = async { meta.dashboard() }
                val groups = async { meta.quickGroups() }
                val pending = async { meta.pendingSummary() }
                // 标签字典只服务于「点重点人群跳列表」这一个动作，
                // 拿不到（无权限/没缓存）不该把整个工作台变成错误页，所以单独消化
                val tags = async { runCatching { meta.personTags().value }.getOrDefault(emptyList()) }

                val d = dashboard.await()
                val g = groups.await()
                _state.update {
                    it.copy(
                        loading = false,
                        dashboard = d.value,
                        groups = g.value,
                        pending = runCatching { pending.await() }.getOrNull(),
                        tags = tags.await(),
                        fromCache = d.fromCache || g.fromCache,
                        savedAt = maxOf(d.savedAt, g.savedAt),
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.toUserMessage()) }
            }
        }
    }
}

@Composable
fun HomeScreen(onNavigate: (String) -> Unit) {
    val context = LocalContext.current
    val container = LocalAppContainer.current
    val vm: HomeViewModel = com.village.population.ui.containerViewModel { HomeViewModel(it.metaRepository) }
    val state by vm.state.collectAsStateWithLifecycle()
    val user by container.session.user.collectAsStateWithLifecycle()

    // 每次进入工作台都重新拉一次：新增了人、处理了待核查之后，指标应该跟着动。
    // 无网时会自动降级到缓存并显示离线提示条。
    LaunchedEffect(Unit) { vm.load() }

    Column(Modifier.fillMaxSize()) {
        if (state.loading && state.dashboard == null) {
            LoadingBox()
            return@Column
        }
        if (state.error != null && state.dashboard == null) {
            ErrorBox(state.error!!) { vm.load() }
            return@Column
        }

        val tokens = AppTheme.tokens
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            // 问候行：头像圆牌 + 问候 + 今天日期 + 口径说明。
            // 设计稿的首页第一屏就是「谁、什么时候、看的是什么口径」，三样齐了才敢往外报数
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(38.dp)
                            .background(tokens.brandLight, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            (user?.displayName ?: "村").take(1),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = tokens.brandStrong,
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "你好，${user?.displayName ?: "网格员"}",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = tokens.ink,
                        )
                        Text(
                            DateText.today(),
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.ink3,
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                // 口径说明常驻在首屏顶部：这套数字要拿去开会、填报表，
                // 什么算进来、什么不算，必须跟数字一起出现，不能藏在帮助页里
                Text(
                    "数据口径：仅统计在册人口（正常 / 迁入），已迁出、已死亡不计入；各人群之间存在交叉，不可相加。",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                )
            }

            if (state.fromCache) {
                item {
                    OfflineBanner(
                        "当前显示的是本地缓存数据（${DateText.describeAge(state.savedAt)}），" +
                            "只可作为参考，上报口径请以联网结果为准。"
                    )
                }
            }

            // 快捷动作：移动端真正高频的两件事（台账速记已去掉——那是对着大表格整理
            // 金额与发票号的活，手机屏幕做不了也做不好，留在电脑端）
            item {
                SectionCard(title = "快捷操作") {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        QuickActionTile(
                            "上门登记",
                            Icons.Filled.PersonAdd,
                            Modifier.weight(1f),
                        ) { onNavigate(Routes.personEdit(0)) }
                        QuickActionTile(
                            "拍照留痕",
                            Icons.Filled.PhotoCamera,
                            Modifier.weight(1f),
                        ) { onNavigate(Routes.capture()) }
                    }
                }
            }

            state.dashboard?.let { d ->
                item {
                    SectionCard(title = "人口概况") {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatCard(
                                "总人口", "${d.hukouCount + d.residentCount}",
                                Modifier.weight(1f), StatTone.Primary,
                                onClick = { onNavigate(Routes.PERSONS) },
                            )
                            StatCard("家庭户数", "${d.familyCount}", Modifier.weight(1f), StatTone.Green)
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatCard("常住人口", "${d.residentCount}", Modifier.weight(1f), StatTone.Quiet)
                            StatCard("户籍人口", "${d.hukouCount}", Modifier.weight(1f), StatTone.Quiet)
                        }
                        // 总人口是「户籍 + 常住」直接相加，而一个人可以既是户籍人口
                        // 又是常住人口（两个口径有交叉）。不写这句，看到三个数对不上
                        // 会以为是算错了，实际是有意按需求采用的默认口径。
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "总人口 = 户籍人口 + 常住人口（两者存在交叉，相加为默认统计口径）",
                            style = MaterialTheme.typography.bodySmall,
                            color = AppTheme.tokens.ink3,
                        )
                    }
                }
            }

            // 重点人群：**整块装进同一张卡片**，行与行之间用细线分隔。
            // 原先每个族群各是一张独立白卡，一屏九张白卡排下来，
            // 「这些条目属于同一个分组」这件事完全没有表达出来——这正是
            // 「重点人群分割显示不明显」的根因。现在一卡一组、线内分条，一眼就能扫完。
            //
            // 没有数据时**整块不显示**（不摆「暂无数据」的空位）：空提示只占地方，
            // 而这一屏上还有别的内容要显示。
            if (state.groups.isNotEmpty()) {
                item {
                    SectionCard(title = "重点人群") {
                        state.groups.forEachIndexed { index, group ->
                            if (index > 0) {
                                Box(Modifier.padding(start = 18.dp)) { AppDivider() }
                            }
                            GrowRow(
                                label = group.label,
                                count = group.count,
                                dotColor = parseHexColor(group.color, tokens.brand),
                                hint = if (group.byAge) "按年龄自动判定，无需打标签" else null,
                                showCard = false,
                            ) {
                                // 把族群翻译成筛选条件：
                                //  · 年龄类（老年/未成年）按出生日期筛，跟他有没有标签无关；
                                //  · 身份类按标签筛，且必须用 tagCodes（党员 = 正式 + 预备），
                                //    只用 code 会少一截人。
                                val query = FocusGroupQuery.build(group, state.tags)
                                if (query == null) {
                                    // 解析不出标签就**不要跳**：不加筛选地跳过去，
                                    // 等于把「低保对象 62 人」变成一个全村 1200 人的名单，
                                    // 用户不会知道是筛错了，只会以为名单本来就这样。
                                    Toast.makeText(
                                        context,
                                        "本机还没有标签字典（需要联网同步一次），暂时无法按「${group.label}」筛选",
                                        Toast.LENGTH_LONG,
                                    ).show()
                                } else {
                                    container.personFilterBus.post(query, group.label)
                                    onNavigate(Routes.PERSONS)
                                }
                            }
                        }
                    }
                }
            }

            state.pending?.let { p ->
                item {
                    SectionCard(title = "待核查人员") {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "共 ${p.total} 条待处理",
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.SemiBold,
                                color = if (p.total > 0) tokens.amber else tokens.ink2,
                            )
                            Spacer(Modifier.weight(1f))
                            androidx.compose.material3.TextButton(onClick = { onNavigate(Routes.PENDING) }) {
                                Text("去处理")
                            }
                        }
                        Text(
                            "来源：Excel 导入时身份证号为空或非法的记录，需要逐条补齐或忽略。",
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.ink3,
                        )
                    }
                }
            }

            state.note?.let {
                item {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.ink3,
                    )
                }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

/**
 * 快捷入口，对应设计稿的 `.qa`：品牌极浅底 + 图标 + 文字。
 *
 * 图标放进品牌浅底的圆牌里（而不是裸露一个小图标）：只剩两个入口时，
 * 卡片里会空出一大块，圆牌把视觉重心压回中间，看起来才是一个完整的按钮而不是半张空卡。
 */
@Composable
private fun QuickActionTile(
    label: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val tokens = AppTheme.tokens
    Surface(
        color = tokens.brandFaint,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(11.dp),
        modifier = modifier.clickableNoRipple(true, onClick),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(34.dp).background(tokens.brandLight, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tokens.brandStrong, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(9.dp))
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = tokens.ink,
            )
        }
    }
}
