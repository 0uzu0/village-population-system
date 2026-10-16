package com.village.population.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
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
import com.village.population.ui.screens.ledger.LedgerQuickScreen
import com.village.population.ui.screens.login.LoginScreen
import com.village.population.ui.screens.pending.PendingScreen
import com.village.population.ui.screens.person.PersonDetailScreen
import com.village.population.ui.screens.person.PersonEditScreen
import com.village.population.ui.screens.person.PersonListScreen
import com.village.population.ui.screens.profile.ProfileScreen
import kotlinx.coroutines.launch

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val PERSONS = "persons"
    const val PENDING = "pending"
    const val PROFILE = "profile"
    const val LEDGER = "ledger"
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

@Composable
fun AppRoot() {
    val container = LocalAppContainer.current
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var ready by remember { mutableStateOf(false) }

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
                NavigationBar {
                    TABS.forEach { tab ->
                        NavigationBarItem(
                            selected = currentRoute == tab.route,
                            onClick = {
                                if (currentRoute != tab.route) {
                                    navController.navigate(tab.route) {
                                        // 底部 Tab 之间切换不该堆栈，否则返回键要点很多次才退出
                                        popUpTo(Routes.HOME) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                }
                            },
                            icon = {
                                TabIcon(tab.route, badge = if (tab.route == Routes.PENDING) pendingOps else 0)
                            },
                            label = { Text(tab.label) },
                        )
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
                        onNavigate = { route -> navController.navigate(route) },
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
                    PendingScreen(
                        onOpenPerson = { id -> navController.navigate(Routes.personDetail(id)) },
                    )
                }

                composable(Routes.LEDGER) {
                    LedgerQuickScreen(onBack = { navController.popBackStack() })
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