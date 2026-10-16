package com.village.population.ui.navigation

import androidx.compose.foundation.background
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

@Composable
fun AppRoot() {
    val container = LocalAppContainer.current
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

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
    // 早于这一步发出的请求会打到占位地址上，全部失败
    LaunchedEffect(Unit) {
        container.bootstrap()
        ready = true
        container.syncManager.requestSync()
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
            ) {
                composable(Routes.LOGIN) {
                    LoginScreen(
                        onLoggedIn = {
                            navController.navigate(Routes.HOME) {
                                popUpTo(0) { inclusive = true }
                            }
                        },
                    )
                }

                composable(Routes.HOME) {
                    HomeScreen(
                        // Tab 落点走 switchTab（与底栏完全同一套栈语义），
                        // 其余页面（新增人员、拍照留痕…）正常压栈
                        onNavigate = { route ->
                            if (isTabRoute(route)) switchTab(route) else navController.navigate(route)
                        },
                    )
                }

                composable(Routes.PERSONS) {
                    PersonListScreen(
                        onOpenPerson = { id -> navController.navigate(Routes.personDetail(id)) },
                        onCreatePerson = { navController.navigate(Routes.personEdit(0)) },
                    )
                }

                composable(
                    route = Routes.PERSON_DETAIL,
                    arguments = listOf(navArgument("personId") { type = NavType.IntType }),
                ) { entry ->
                    val personId = entry.arguments?.getInt("personId") ?: 0
                    PersonDetailScreen(
                        personId = personId,
                        onBack = { navController.popBackStack() },
                        onEdit = { navController.navigate(Routes.personEdit(personId)) },
                        onCapture = { navController.navigate(Routes.capture(personId)) },
                    )
                }

                composable(
                    route = Routes.PERSON_EDIT,
                    arguments = listOf(navArgument("personId") { type = NavType.IntType }),
                ) { entry ->
                    val personId = entry.arguments?.getInt("personId") ?: 0
                    PersonEditScreen(
                        personId = personId,
                        onDone = { navController.popBackStack() },
                    )
                }

                composable(Routes.PENDING) {
                    // 不再从这里跳人员详情：待核查记录用的是 import_pending.id，
                    // 与 person.id 是两套编号，且这条记录本来就还没有正式人员。
                    // 详情改为在本页弹窗展示（见 PendingScreen）。
                    PendingScreen()
                }

                composable(
                    route = "${Routes.CAPTURE}?personId={personId}",
                    arguments = listOf(
                        navArgument("personId") { type = NavType.IntType; defaultValue = 0 },
                    ),
                ) { entry ->
                    CaptureScreen(
                        personId = entry.arguments?.getInt("personId")?.takeIf { it > 0 },
                        onBack = { navController.popBackStack() },
                    )
                }

                composable(Routes.PROFILE) {
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