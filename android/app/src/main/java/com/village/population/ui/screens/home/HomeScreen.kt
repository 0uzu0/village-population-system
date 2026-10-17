package com.village.population.ui.screens.home

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.village.population.ui.theme.AppShapes
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
            // 卡片间距 12dp（设计稿 token#6「宽松留白」：卡片内 16dp、卡间距 12dp）
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // 头部（设计稿 v3「浅色简洁头卡」）：不加底色，跟随页面灰底。
            // 品牌蓝不做大面积色块，只收在头像这一颗锚点里——大面积品牌色显沉，
            // 报数界面更需要干净的浅色阅读区
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(44.dp)
                            .background(tokens.brand, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            (user?.displayName ?: "村").take(1),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "你好，${user?.displayName ?: "网格员"}",
                            // 设计稿 .hero-hi 是 20px 700：问候是头卡的主文字，
                            // 用指标数字那一档（23sp）会把「报数」的层级抢走
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = tokens.ink,
                        )
                        Spacer(Modifier.height(3.dp))
                        // 「10月17日 星期六」而不是 ISO 串：头卡是给眼睛扫的，
                        // 2026-10-17 这种写法要逐位读，中文日期一眼就知道是哪天
                        Text(
                            DateText.todayCn(),
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.ink3,
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
                // 口径说明独立成卡（设计稿 v3）：原先是紧贴头部的灰色小字，
                // 开会报数的人最需要的一句话反而是全屏最不显眼的元素。
                // 淡蓝底 + 深蓝字 + info 图标，紧跟头部但已不属于头卡。
                // 16dp 圆角（.caliber）比白卡收一档——它是衬底面板，不是卡片
                Surface(
                    color = tokens.brandFaint,
                    shape = RoundedCornerShape(AppShapes.panel),
                    border = BorderStroke(1.dp, tokens.line2),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Icon(
                            Icons.Filled.Info,
                            contentDescription = null,
                            tint = tokens.brandStrong,
                            modifier = Modifier.size(15.dp).padding(top = 2.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "数据口径：仅统计在册人口（正常 / 迁入），已迁出、已死亡不计入；各人群之间存在交叉，不可相加。",
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.brandStrong,
                        )
                    }
                }
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
            // 金额与发票号的活，手机屏幕做不了也做不好，留在电脑端）。
            // 两片瓦片**直接排在内容区**（设计稿 .qa-row）：不再套分区卡——
            // 只有两个入口时，「快捷操作」这张卡加它的标题行占了整整一屏的 1/6，
            // 而标题并没有传达任何额外信息
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
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

            state.dashboard?.let { d ->
                item {
                    SectionCard(title = "人口概况") {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatCard(
                                "总人口", "${d.hukouCount + d.residentCount}",
                                Modifier.weight(1f), StatTone.Primary,
                                onClick = { onNavigate(Routes.PERSONS) },
                            )
                            // 家庭户数与户籍/常住同为参照数字，统一安静灰底（设计稿 v3）：
                            // 四张卡三种底色会把平级数字读出主次
                            StatCard("家庭户数", "${d.familyCount}", Modifier.weight(1f), StatTone.Quiet)
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
                                // 设计稿 .pend-num 15px 700：这是待办计数，
                                // 用正文 17sp 会把它从「提示」抬成「内容」
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold,
                                color = if (p.total > 0) tokens.amber else tokens.ink2,
                            )
                            Spacer(Modifier.weight(1f))
                            // 「去处理」做成品牌实底胶囊（设计稿 btn-go）：
                            // 这一屏唯一需要用户立刻去办的事，值得一个实色按钮，
                            // TextButton 的视觉重量撑不起「待办」的语气
                            Button(
                                onClick = { onNavigate(Routes.PENDING) },
                                shape = RoundedCornerShape(AppShapes.chip),
                                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 7.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = tokens.brand,
                                    contentColor = Color.White,
                                ),
                            ) { Text("去处理", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold) }
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
 * 快捷入口，对应设计稿的 `.qa-tile`：品牌极浅底 + 36dp 圆牌图标 + 13.5sp 标签。
 *
 * 图标放进品牌浅底的圆牌里（而不是裸露一个小图标）：只剩两个入口时，
 * 大片空白会把视觉重心扯散，圆牌把它压回中间，看起来才是一个完整的按钮。
 * 16dp 圆角 + 1px 浅描边（.qa-tile）：与白卡 20dp 收一档，衬底面板不是卡片。
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
        shape = RoundedCornerShape(AppShapes.panel),
        border = BorderStroke(1.dp, tokens.line2),
        modifier = modifier.clickableNoRipple(true, onClick),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(36.dp).background(tokens.brandLight, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tokens.brandStrong, modifier = Modifier.size(17.dp))
            }
            Spacer(Modifier.width(9.dp))
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge.copy(fontSize = 13.5.sp),
                fontWeight = FontWeight.SemiBold,
                color = tokens.ink,
            )
        }
    }
}
