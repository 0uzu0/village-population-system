package com.village.population.ui.navigation

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.FactCheck
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.screens.capture.CaptureScreen
import com.village.population.ui.screens.home.HomeScreen
import com.village.population.ui.screens.login.LoginScreen
import com.village.population.ui.screens.pending.PendingScreen
import com.village.population.ui.screens.person.PersonDetailScreen
import com.village.population.ui.screens.person.PersonEditScreen
import com.village.population.ui.screens.person.PersonListScreen
import com.village.population.ui.screens.profile.ProfileScreen
import com.village.population.ui.theme.AppTheme
import com.village.population.ui.update.UpdateDialogs
import kotlinx.coroutines.launch

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val PERSONS = "persons"
    const val PENDING = "pending"
    const val PROFILE = "profile"
    const val CAPTURE = "capture"

    private const val PERSON_DETAIL_BASE = "person"
    private const val PERSON_EDIT_BASE = "personEdit"

    const val PERSON_DETAIL = "$PERSON_DETAIL_BASE/{personId}"
    const val PERSON_EDIT = "$PERSON_EDIT_BASE/{personId}"

    fun personDetail(id: Int) = "$PERSON_DETAIL_BASE/$id"

    /** personId = 0 表示新增 */
    fun personEdit(id: Int = 0) = "$PERSON_EDIT_BASE/$id"

    fun capture(personId: Int? = null) =
        if (personId == null) CAPTURE else "$CAPTURE?personId=$personId"
}

/** 底部导航的四项。顺序即「用得最多的排最前」：查人 > 看板 > 待核查 > 我的 */
private data class Tab(val route: String, val label: String)

private val TABS = listOf(
    Tab(Routes.HOME, "工作台"),
    Tab(Routes.PERSONS, "人口"),
    Tab(Routes.PENDING, "待核查"),
    Tab(Routes.PROFILE, "我的"),
)

/** 某个路由是不是底部 Tab 的落点 */
private fun isTabRoute(route: String): Boolean = TABS.any { it.route == route }

/**
 * 每个导航目的地都套这层「点击盾」。
 *
 * 换页动画期间旧目的地还在组合树里：新屏的空白处如果没有点击消费者，
 * 手指事件会**穿透**到旧屏同坐标的可点击控件上。复现路径：人口列表 →
 * 底栏切工作台，手快在新屏空白处再点一下——那一下落在还没退场的人口行上，
 * 直接误开人员详情。
 *
 * 盾只消费「子级没吃掉的点击」：按钮 / 列表行 / 滚动 / 长按都先被子级处理，
 * 行为不变；只有落在空白处的点击会被截住，不再漏给前一屏。
 */
private fun Modifier.shieldClickThrough(): Modifier =
    pointerInput(Unit) { detectTapGestures { } }

@Composable
fun AppRoot() {
    val container = LocalAppContainer.current
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val updateController = container.updateController

    var ready by remember { mutableStateOf(false) }

    /**
     * 切到某个底部 Tab。
     *
     * **所有通往 Tab 落点的跳转都必须走这里**，包括工作台上「重点人群」「在册人口」
     * 这些卡片。这正是之前「在人口页点底部『工作台』没反应」的根因：
     * 底栏用了一套 NavOptions（popUpTo + saveState + restoreState），
     * 工作台里的卡片却用了不带任何 options 的裸 navigate()，同一个目的地被两套
     * 不同的栈语义压进去，栈里就出现了「同一个 Tab 有多份、状态各不一样」的情况，
     * 于是返回/切换时会出现「点了没动静」。
     *
     * 现在统一成一条最小规则：
     *  · 弹回 HOME（Tab 的锚点），把中途压进来的页面清掉，返回键一次就退出；
     *  · launchSingleTop 避免同一目的地压两层；
     *  · **不用 saveState/restoreState**——不保留 Tab 内部状态，每次切过去都重新组合，
     *    这也顺带保证看到的是最新数据（列表不会停在三天前的筛选结果上）。
     */
    fun switchTab(route: String) {
        if (navController.currentBackStackEntry?.destination?.route == route) return
        navController.navigate(route) {
            popUpTo(Routes.HOME) { saveState = false }
            launchSingleTop = true
            restoreState = false
        }
    }

    // 冷启动必须先装载服务器地址与 token：拦截器读的是内存镜像，
    // 早于这一步发出的请求会打到占位地址上，全部失败。
    //
    // 整段包 runCatching：这一步读的是持久化设置，虽然 DataStore 已配损坏自愈，
    // 但任何意外（磁盘只读、系统限制）都不该让首屏永远停在「正在启动…」——
    // 宁可降级进登录页，让用户重新登录 / 重设服务器地址。
    LaunchedEffect(Unit) {
        runCatching { container.bootstrap() }
        ready = true
        runCatching { container.syncManager.requestSync() }
    }

    // 启动后台静默检查更新一次：失败不打扰用户，只有真发现新版才弹。
    // 挂在 ready 上，等 bootstrap 装载完毕、首屏请求不再打占位地址后再发起
    LaunchedEffect(ready) {
        if (ready) updateController.check(manual = false)
    }

    val signedIn by container.session.signedIn.collectAsStateWithLifecycle()
    val expiredReason by container.session.expiredReason.collectAsStateWithLifecycle()
    val pendingOps by container.queue.size.collectAsStateWithLifecycle()

    // 当前路由：底部栏要据此决定显示哪几个 Tab、高亮哪一个
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    // 登录态失效：提示一次，确认后回到登录页。不做「静默跳转」——
    // 用户正在填表单时被弹走，且没有任何解释，是体验上最糟糕的一种处理
    if (expiredReason != null) {
        AlertDialog(
            onDismissRequest = { },
            title = { Text("登录已失效") },
            text = { Text("${expiredReason}\n请重新登录后继续操作。未上传的走访记录仍保存在本机，重新登录后可继续同步。") },
            confirmButton = {
                TextButton(onClick = {
                    container.session.consumeExpiredReason()
                    scope.launch {
                        container.logout()
                        navController.navigate(Routes.LOGIN) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                }) { Text("重新登录") }
            },
        )
    }

    // 更新流程的弹窗挂在最外层壳上，与「我的」页手动入口互不干扰
    UpdateDialogs(
        state = updateController.state,
        onDismiss = updateController::dismiss,
        onDownload = updateController::download,
    )

    if (!ready) {
        LoadingBox(text = "正在启动…")
        return
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        bottomBar = {
            val showTabs = signedIn && TABS.any { it.route == currentRoute }
            if (showTabs) {
                // 底栏对应设计稿的 `.nav`：白底、上沿一条细线、选中项走品牌色。
                // 不用 NavigationBar 默认的 surfaceContainer 底色——那个色在浅色主题下
                // 与页面底色非常接近，栏和内容会糊在一起，看不出哪里是边界
                val tokens = AppTheme.tokens
                Column(Modifier.background(MaterialTheme.colorScheme.surface)) {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(tokens.line2))
                    NavigationBar(
                        containerColor = MaterialTheme.colorScheme.surface,
                        tonalElevation = 0.dp,
                    ) {
                        TABS.forEach { tab ->
                            NavigationBarItem(
                                selected = currentRoute == tab.route,
                                onClick = { switchTab(tab.route) },
                                icon = {
                                    TabIcon(tab.route, badge = if (tab.route == Routes.PENDING) pendingOps else 0)
                                },
                                label = { Text(tab.label) },
                                // 选中态胶囊：M3 的 indicator 默认就是全圆角胶囊形，
                                // 这里只需给色（brandLight 浅蓝底）。设计稿选定胶囊而不是
                                // 只换图标色——户外强光下「形状变化」比「色相变化」可靠。
                                // 胶囊形状随 M3 默认提供，不要在这里自定义形状「改进」它。
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = tokens.brand,
                                    selectedTextColor = tokens.brand,
                                    indicatorColor = tokens.brandLight,
                                    unselectedIconColor = tokens.ink3,
                                    unselectedTextColor = tokens.ink3,
                                ),
                            )
                        }
                    }
                }
            }
        },
    ) { innerPadding ->
        Box(Modifier.fillMaxSize().padding(innerPadding)) {
            NavHost(
                navController = navController,
                startDestination = if (signedIn) Routes.HOME else Routes.LOGIN,
                // 换页**不接动画**（微信式瞬时切换），一举解决两个问题：
                //  1. 「人口→工作台手快点空白误入人员详情」的点击穿透。Navigation
                //     Compose 默认是几百毫秒的交叉淡入，动画期间新旧两个目的地同时
                //     在组合树里且都可交互——旧屏（人口列表）在淡出时仍能收到点击，
                //     空白处的手指事件就落在它同坐标的行上。v2.0.1 的「点击盾」只
                //     拦得住旧屏在新屏之下时的事件，旧屏 z 序在上时无能为力；无动画
                //     则旧屏立即出组合树，穿透窗口物理上归零。
                //  2. 「跳转生硬 / 视觉延迟」的观感来源就是这层长淡入淡出——内容
                //     半透明地慢慢浮现。瞬时切换后新屏立即完整呈现、立即可操作。
                enterTransition = { EnterTransition.None },
                exitTransition = { ExitTransition.None },
                popEnterTransition = { EnterTransition.None },
                popExitTransition = { ExitTransition.None },
            ) {
                composable(Routes.LOGIN) {
                    Box(Modifier.fillMaxSize().shieldClickThrough()) {
                        LoginScreen(
                            onLoggedIn = {
                                navController.navigate(Routes.HOME) {
                                    popUpTo(0) { inclusive = true }
                                }
                            },
                        )
                    }
                }

                composable(Routes.HOME) {
                    Box(Modifier.fillMaxSize().shieldClickThrough()) {
                        HomeScreen(
                            // Tab 落点走 switchTab（与底栏完全同一套栈语义），
                            // 其余页面（新增人员、拍照留痕…）正常压栈
                            onNavigate = { route ->
                                if (isTabRoute(route)) switchTab(route) else navController.navigate(route)
                            },
                        )
                    }
                }

                composable(Routes.PERSONS) {
                    Box(Modifier.fillMaxSize().shieldClickThrough()) {
                        PersonListScreen(
                            onOpenPerson = { id -> navController.navigate(Routes.personDetail(id)) },
                            onCreatePerson = { navController.navigate(Routes.personEdit(0)) },
                        )
                    }
                }

                composable(
                    route = Routes.PERSON_DETAIL,
                    arguments = listOf(navArgument("personId") { type = NavType.IntType }),
                ) { entry ->
                    val personId = entry.arguments?.getInt("personId") ?: 0
                    Box(Modifier.fillMaxSize().shieldClickThrough()) {
                        PersonDetailScreen(
                            personId = personId,
                            onBack = { navController.popBackStack() },
                            onEdit = { navController.navigate(Routes.personEdit(personId)) },
                            onCapture = { navController.navigate(Routes.capture(personId)) },
                        )
                    }
                }

                composable(
                    route = Routes.PERSON_EDIT,
                    arguments = listOf(navArgument("personId") { type = NavType.IntType }),
                ) { entry ->
                    val personId = entry.arguments?.getInt("personId") ?: 0
                    Box(Modifier.fillMaxSize().shieldClickThrough()) {
                        PersonEditScreen(
                            personId = personId,
                            onDone = { navController.popBackStack() },
                        )
                    }
                }

                composable(Routes.PENDING) {
                    // 不再从这里跳人员详情：待核查记录用的是 import_pending.id，
                    // 与 person.id 是两套编号，且这条记录本来就还没有正式人员。
                    // 详情改为在本页弹窗展示（见 PendingScreen）。
                    Box(Modifier.fillMaxSize().shieldClickThrough()) {
                        PendingScreen()
                    }
                }

                composable(
                    route = "${Routes.CAPTURE}?personId={personId}",
                    arguments = listOf(
                        navArgument("personId") { type = NavType.IntType; defaultValue = 0 },
                    ),
                ) { entry ->
                    val personId = entry.arguments?.getInt("personId")?.takeIf { it > 0 }
                    Box(Modifier.fillMaxSize().shieldClickThrough()) {
                        CaptureScreen(
                            personId = personId,
                            onBack = { navController.popBackStack() },
                        )
                    }
                }

                composable(Routes.PROFILE) {
                    Box(Modifier.fillMaxSize().shieldClickThrough()) {
                        ProfileScreen(
                            onLoggedOut = {
                                navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TabIcon(route: String, badge: Int) {
    val icon = when (route) {
        Routes.HOME -> Icons.Filled.Home
        Routes.PERSONS -> Icons.Filled.PersonSearch
        Routes.PENDING -> Icons.AutoMirrored.Filled.FactCheck
        else -> Icons.Filled.Person
    }
    if (badge > 0) {
        BadgedBox(badge = { Badge { Text(if (badge > 99) "99+" else "$badge") } }) {
            Icon(icon, contentDescription = null)
        }
    } else {
        Icon(icon, contentDescription = null)
    }
}