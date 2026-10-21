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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.SectionCard
import com.village.population.ui.components.SkeletonBlock
import com.village.population.ui.components.clickableNoRipple
import com.village.population.ui.components.parseHexColor
import com.village.population.ui.components.tabular
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

            // 四个请求互不依赖，并发发出（串行会让首屏多等三个来回）。
            //
            // ⚠️ 每一路都必须用 runCatching 包成 Result，**不能只在外面套一个 try/catch**。
            // 这是本项目踩过的真实事故（用户报「APK 一进就退」）：
            //   1. 第一路 await() 抛异常 → 被外层 catch 接住；
            //   2. 此时其余几路协程仍在跑，随后它们也失败（服务端 502 / 断网时必然如此）；
            //   3. 已经没有人 await 它们了，异常顺着 Job 冒泡到 viewModelScope；
            //   4. viewModelScope 没配 CoroutineExceptionHandler → 交给线程默认处理器 → 进程被杀。
            // 表现就是冷启动进工作台瞬间闪退，而网络正常时四路全成功、这条路径永远走不到，
            // 所以本地/模拟器极难复现。改成 Result 之后 async 本身永远不会失败，从根上堵死。
            val dashboard = async { runCatching { meta.dashboard() } }
            val groups = async { runCatching { meta.quickGroups() } }
            val pending = async { runCatching { meta.pendingSummary() } }
            // 标签字典只服务于「点重点人群跳列表」这一个动作，
            // 拿不到（无权限/没缓存）不该把整个工作台变成错误页，所以单独消化
            val tags = async { runCatching { meta.personTags().value }.getOrDefault(emptyList()) }

            val d = dashboard.await()
            val g = groups.await()
            val p = pending.await()
            val t = tags.await()

            // 人口口径是工作台的主内容，它和重点人群口径失败才算整页失败；
            // 待核查数字是角标性质的次要信息，失败就留空，不该遮住主数字
            val primary = d.exceptionOrNull() ?: g.exceptionOrNull()
            if (primary != null) {
                _state.update { it.copy(loading = false, error = primary.toUserMessage()) }
                return@launch
            }

            val dv = d.getOrNull()
            val gv = g.getOrNull()
            _state.update {
                it.copy(
                    loading = false,
                    dashboard = dv?.value,
                    groups = gv?.value.orEmpty(),
                    pending = p.getOrNull(),
                    tags = t,
                    fromCache = (dv?.fromCache ?: false) || (gv?.fromCache ?: false),
                    savedAt = maxOf(dv?.savedAt ?: 0L, gv?.savedAt ?: 0L),
                )
            }
        }
    }
}

/**
 * 工作台骨架屏：形状照着真实布局排——头像行、口径说明、两片快捷瓦片、
 * 人口概况四格、重点人群列表。数据回来时不会整页重排，只是把灰条换成真字。
 */
@Composable
private fun HomeSkeleton() {
    val t = AppTheme.tokens
    Column(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SkeletonBlock(Modifier.size(44.dp), height = 44.dp, corner = 22.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                SkeletonBlock(Modifier.fillMaxWidth(0.5f), height = 18.dp)
                Spacer(Modifier.height(7.dp))
                SkeletonBlock(Modifier.fillMaxWidth(0.28f), height = 12.dp)
            }
        }
        // 主数字卡：一块大数字 + 一行三个参照值 + 口径折叠行。
        // 骨架形状必须跟着真布局改——数据回来时整页重排，比多看半秒转圈更难受
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(AppShapes.card),
            border = BorderStroke(1.dp, t.line2),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp)) {
                SkeletonBlock(Modifier.fillMaxWidth(0.2f), height = 11.dp)
                Spacer(Modifier.height(6.dp))
                SkeletonBlock(Modifier.fillMaxWidth(0.42f), height = 38.dp, corner = 10.dp)
                Spacer(Modifier.height(14.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    repeat(3) {
                        SkeletonBlock(Modifier.weight(1f), height = 15.dp)
                    }
                }
                Spacer(Modifier.height(14.dp))
                SkeletonBlock(Modifier.fillMaxWidth(0.55f), height = 11.dp)
            }
        }
        // 两片快捷瓦片
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            repeat(2) {
                Surface(
                    color = t.brandFaint,
                    shape = RoundedCornerShape(AppShapes.panel),
                    border = BorderStroke(1.dp, t.line2),
                    modifier = Modifier.weight(1f),
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SkeletonBlock(Modifier.size(36.dp), height = 36.dp, corner = 18.dp)
                        Spacer(Modifier.width(9.dp))
                        SkeletonBlock(Modifier.fillMaxWidth(0.7f), height = 14.dp)
                    }
                }
            }
        }
        // 待办条
        Surface(
            color = t.amberBg,
            shape = RoundedCornerShape(AppShapes.panel),
            border = BorderStroke(1.dp, t.amberLine),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier.padding(horizontal = 12.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SkeletonBlock(Modifier.size(7.dp), height = 7.dp, corner = 4.dp)
                Spacer(Modifier.width(10.dp))
                SkeletonBlock(Modifier.fillMaxWidth(0.42f), height = 13.dp)
            }
        }
        // 重点人群列表
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(AppShapes.card),
            border = BorderStroke(1.dp, t.line2),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                SkeletonBlock(Modifier.fillMaxWidth(0.24f), height = 14.dp)
                repeat(4) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SkeletonBlock(Modifier.size(9.dp), height = 9.dp, corner = 5.dp)
                        Spacer(Modifier.width(10.dp))
                        SkeletonBlock(Modifier.fillMaxWidth(0.4f), height = 13.dp)
                        Spacer(Modifier.weight(1f))
                        SkeletonBlock(Modifier.width(34.dp), height = 15.dp)
                    }
                }
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
            HomeSkeleton()
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
            }

            if (state.fromCache) {
                item {
                    OfflineBanner(
                        "当前显示的是本地缓存数据（${DateText.describeAge(state.savedAt)}），" +
                            "只可作为参考，上报口径请以联网结果为准。"
                    )
                }
            }

            // 主数字卡（设计稿 v4 · M1/M2）：一屏之内只回答一个数——在册多少人。
            // 原先四张等大指标卡里，「总人口」和「家庭户数」占同样面积，
            // 而开会要报的只有第一个；三个参照值现在收进同一张卡的一行。
            state.dashboard?.let { d ->
                item {
                    PopulationHeroCard(d) { onNavigate(Routes.PERSONS) }
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

            // 待核查：从白卡改成琥珀条（设计稿 S2）。
            // 它是这一屏唯一「今天必须办」的事，值得一条自己的颜色；
            // 白卡在四张卡片里读作「还有一个数据块」，会被顺手划过去。
            // 0 条时整条不出现——用绿色写「没有待办」只会在首屏多一行噪音。
            state.pending?.let { p ->
                if (p.total > 0) {
                    item {
                        PendingTodoBar(p.total) { onNavigate(Routes.PENDING) }
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
                                // 年龄类改由形状表达（空心点 + 「按年龄」胶囊），
                                // 不再挂「按年龄自动判定，无需打标签」那行小字（设计稿 M3）
                                byAge = group.byAge,
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
 * 主数字卡，对应设计稿 v4 的 `.hero-stat`（M1 + M2）。
 *
 * ## 为什么是「一个 40sp」
 * 旧版是四张等大指标卡（总人口 / 家庭户数 / 流动 / 户籍），四个数字一样大、
 * 一样重、一样占面积。但村里开周会要报的只有第一个——「我们村在册多少人」。
 * 另外三个是解释这个数的参照值，平级摆放等于告诉看的人「四个都重要」，
 * 于是每次都得逐个读一遍才知道哪个是主角。
 * 现在：一个 40sp 的主数字，三个参照值在同一张卡里排成一行 15sp。
 *
 * ## 为什么右侧写「在册 = 正常 + 迁入」而不是拆两个数
 * 后端 `/statistics/dashboard` 目前只下发 totalPopulation（已按在册口径过滤）
 * 与户籍/流动两档，**没有按人员状态（正常 / 迁入）拆分的字段**。
 * 设计稿在这一格画的是「正常 1241 / 迁入 45」。要真给这两个数，得改接口，
 * 而老版本 APP 拿不到新字段时会显示 0——「正常 0 / 迁入 0」比不显示更糟。
 * 所以这里放的是口径文字：同样回答了「这个 1286 是怎么算出来的」，
 * 且不会因为接口没跟上而撒谎。等哪天真的需要拆状态，再补字段不迟。
 *
 * ## 口径说明为什么折叠（M2）
 * 它是报数要负责的一句话，不能删；但它是**每次进来都读一遍就够**的信息，
 * 旧版占 76dp 固定压在主数字上面，第三次之后就是噪音。
 * 收成一行「仅统计在册人口 · 口径说明」，点开是逐字原文。
 */
@Composable
private fun PopulationHeroCard(d: DashboardDto, onOpenList: () -> Unit) {
    val t = AppTheme.tokens
    var caliberOpen by remember { mutableStateOf(false) }
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(AppShapes.card),
        border = BorderStroke(1.dp, t.line2),
        shadowElevation = AppShapes.cardElevation,
        tonalElevation = 0.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "在册人口",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = t.ink3,
                    )
                    Spacer(Modifier.height(2.dp))
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            "${d.totalPopulation}",
                            // 40sp：全应用唯一一处。半米外要能读出这个数（见 Theme 的 displaySmall 注释）
                            style = MaterialTheme.typography.displaySmall.tabular(),
                            color = t.ink,
                            maxLines = 1,
                            // 数字本身也可点：主数字是「全村人」的入口，
                            // 看到数想翻名单是紧接着的下一个动作
                            modifier = Modifier.clickableNoRipple(true, onOpenList),
                        )
                        Spacer(Modifier.width(5.dp))
                        Text(
                            "人",
                            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
                            color = t.ink3,
                            modifier = Modifier.padding(bottom = 7.dp),
                        )
                    }
                }
                Text(
                    "在册 = 正常 + 迁入\n已迁出 · 已死亡不计入",
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp, lineHeight = 18.sp),
                    color = t.ink3,
                    textAlign = TextAlign.End,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
            }

            Spacer(Modifier.height(11.dp))
            AppDivider()
            Spacer(Modifier.height(9.dp))

            // 三个参照值：同一个数的三种切法，平铺一行、同一字重——
            // 它们之间没有主次，谁都不能比旁边的大一号
            Row(Modifier.fillMaxWidth()) {
                RefStat("户籍", d.hukouCount, Modifier.weight(1f))
                RefStat("流动", d.floatingCount, Modifier.weight(1f))
                RefStat("家庭户", d.familyCount, Modifier.weight(1f))
            }

            Spacer(Modifier.height(10.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    // 整行可点，最小高度 44dp：箭头只有 13dp，靠它点不中（M7）
                    .heightIn(min = 44.dp)
                    .clickableNoRipple(true) { caliberOpen = !caliberOpen },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Filled.Info,
                    contentDescription = null,
                    tint = t.ink3,
                    modifier = Modifier.size(13.dp),
                )
                Spacer(Modifier.width(5.dp))
                Text(
                    "仅统计在册人口 · 口径说明",
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                    color = t.ink3,
                )
                Icon(
                    Icons.Filled.ExpandMore,
                    contentDescription = if (caliberOpen) "收起口径说明" else "展开口径说明",
                    tint = t.ink3,
                    modifier = Modifier
                        .size(13.dp)
                        .rotate(if (caliberOpen) 180f else 0f),
                )
            }
            if (caliberOpen) {
                // 展开态文案与旧版逐字一致：改成折叠只是改「什么时候看」，
                // 不能顺手把口径改写一遍——那是另一件事，要单独评审
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "数据口径：仅统计在册人口（正常 / 迁入），已迁出、已死亡不计入；重点人群之间存在交叉，不可相加。",
                        style = MaterialTheme.typography.bodySmall,
                        color = t.ink2,
                    )
                    Text(
                        "流动人口 = 户籍不在本村、暂住本村的人员；在册人口 = 户籍人口 + 流动人口（两者互斥）",
                        style = MaterialTheme.typography.bodySmall,
                        color = t.ink2,
                    )
                }
                Spacer(Modifier.height(4.dp))
            }
        }
    }
}

/** 主数字卡里的一个参照值：15sp 数字 + 11.5sp 标签，横向排开 */
@Composable
private fun RefStat(label: String, value: Int, modifier: Modifier = Modifier) {
    val t = AppTheme.tokens
    Row(modifier, verticalAlignment = Alignment.Bottom) {
        Text(
            "$value",
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp).tabular(),
            fontWeight = FontWeight.Bold,
            color = t.ink,
            maxLines = 1,
        )
        Spacer(Modifier.width(4.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
            color = t.ink3,
            maxLines = 1,
            modifier = Modifier.padding(bottom = 1.dp),
        )
    }
}

/**
 * 待办条，对应设计稿 S2 的待核查琥珀条：圆点 + 「N 条待核查」+ 说明 + 「去处理 ›」。
 *
 * 三个选择都有明确理由：
 *  · 琥珀而不是红：TODO 没坏，只是「待办」，红色会说成「出事了」；
 *  · 整条做成一个可点区域而不是右侧一颗小按钮：44dp 高的条在拇指区，
 *    比一颗 60dp 宽的胶囊好按得多；
 *  · 只在 > 0 时出现：没有待办的时候还留一条「0 条待核查」，
 *    等于每天在首屏提醒一次「有件不存在的事」。
 */
@Composable
private fun PendingTodoBar(total: Int, onClick: () -> Unit) {
    val t = AppTheme.tokens
    Surface(
        color = t.amberBg,
        shape = RoundedCornerShape(AppShapes.panel),
        border = BorderStroke(1.dp, t.amberLine),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickableNoRipple(true, onClick),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(7.dp).background(t.amber, CircleShape))
            Spacer(Modifier.width(8.dp))
            Text(
                "$total 条待核查",
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp).tabular(),
                fontWeight = FontWeight.Bold,
                color = t.amber,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "身份证号缺失",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                color = t.amber.copy(alpha = 0.85f),
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                "去处理",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                fontWeight = FontWeight.SemiBold,
                color = t.amber,
            )
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = t.amber,
                modifier = Modifier.size(16.dp),
            )
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
