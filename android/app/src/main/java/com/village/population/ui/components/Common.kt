package com.village.population.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.village.population.ui.theme.AppShapes
import com.village.population.ui.theme.AppTheme

/**
 * 设计稿里字号小于正文一档的几处固定样式。
 *
 * 为什么不并进 [com.village.population.ui.theme] 的 Typography：那几个槽位是
 * 「页面级」层级（标题/正文/辅助），而这些都是组件内部的小字（字段标签、
 * 徽章、数据格标签），跟着组件走——改组件时看得见，不会被页面层级淹没。
 * 字号是设计稿按「阅读舒适度」校订后的值，不是随手取的。
 */

/** 10.5sp：字段标签、人群行的小注（设计稿 `.fld-label` / `.grp-name .by-age`） */
val HintTextStyle = TextStyle(fontSize = 10.5.sp, lineHeight = 15.sp)

/** 11sp：数据格标签（设计稿 `.stat .sl`） */
val StatLabelStyle = TextStyle(fontSize = 11.sp, lineHeight = 15.sp)

/** 11sp：列表行副标题（设计稿 `.p-meta` / `.p-id`） */
val MetaTextStyle = TextStyle(fontSize = 11.sp, lineHeight = 16.sp)

/** 10sp：徽章 / 标签胶囊（设计稿 `.p-tag` / `.pv-badge`） */
val PillTextStyle = TextStyle(fontSize = 10.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold)

/** 13.5sp：输入框文字（设计稿 `.fld-input`） */
val FieldTextStyle = TextStyle(fontSize = 13.5.sp, lineHeight = 20.sp)

/** 13sp：信息行的值（设计稿 `.irow .v`，500 字重） */
val InfoValueStyle = TextStyle(fontSize = 13.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium)

/**
 * 页头，对应设计稿 v3 的 `.topbar`：**不加底色、深色字**。
 *
 * 这一条是 v3 改版的核心决策：旧版这里是一根通档品牌蓝条（白字），
 * 整块大面积品牌色显沉，而「报数 / 查人」的界面更需要干净的浅色阅读区。
 * 设计稿把品牌感全部收进首页头像那一颗小锚点，页头只留标题本身：
 * 透明底跟随页面灰、标题 18sp 加粗墨色、返回键是 32dp 白底细描边小方块。
 *
 * 返回键的触摸目标比视觉大一圈（40dp 容器包 32dp 视觉）：设计稿画的是
 * 视觉尺寸，但 32dp 实打实按下去在户外戴手套时太小，容器不改变外观。
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AppTopBar(
    title: String,
    onBack: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    val tokens = AppTheme.tokens
    TopAppBar(
        title = {
            Text(
                title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleMedium.copy(fontSize = 18.sp),
                fontWeight = FontWeight.Bold,
                color = tokens.ink,
            )
        },
        navigationIcon = {
            if (onBack != null) {
                Box(
                    Modifier
                        .size(40.dp)
                        .clickableNoRipple(true, onBack),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .size(32.dp)
                            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp))
                            .border(1.dp, tokens.line, RoundedCornerShape(12.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回",
                            tint = tokens.ink2,
                            modifier = Modifier.size(17.dp),
                        )
                    }
                }
            }
        },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = Color.Transparent,
            titleContentColor = tokens.ink,
            navigationIconContentColor = tokens.ink2,
            actionIconContentColor = tokens.ink2,
        ),
    )
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier, text: String = "加载中…") {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            androidx.compose.material3.CircularProgressIndicator()
            Spacer(Modifier.height(12.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium, color = AppTheme.tokens.ink3)
        }
    }
}

@Composable
fun ErrorBox(
    message: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            Icon(
                Icons.Filled.ErrorOutline,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
            )
            Spacer(Modifier.height(12.dp))
            Text(message, style = MaterialTheme.typography.bodyLarge)
            if (onRetry != null) {
                Spacer(Modifier.height(16.dp))
                androidx.compose.material3.TextButton(onClick = onRetry) { Text("重试") }
            }
        }
    }
}

@Composable
fun EmptyBox(message: String = "暂无数据", modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Filled.Inbox,
                contentDescription = null,
                tint = AppTheme.tokens.ink3,
            )
            Spacer(Modifier.height(8.dp))
            Text(message, color = AppTheme.tokens.ink3)
        }
    }
}

/**
 * 离线/降级提示横幅，对应设计稿的 `.amber-banner`（琥珀底 + 描边 + 琥珀字）。
 *
 * 明确告诉用户「这是旧数据」比默默展示缓存更重要——村里报数字是要负责的，
 * 拿着三天前的数字开会和拿今天的数字开会，后果完全不同。
 * 用琥珀而不是红：数据没坏，只是不新，红色会把「需要留意」说成「出事了」。
 */
@Composable
fun OfflineBanner(text: String, modifier: Modifier = Modifier) {
    val t = AppTheme.tokens
    Surface(
        color = t.amberBg,
        contentColor = t.amber,
        shape = RoundedCornerShape(AppShapes.panel),
        border = BorderStroke(1.dp, t.amberLine),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 11.dp, vertical = 9.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                Icons.Filled.CloudOff,
                contentDescription = null,
                tint = t.amber,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text,
                style = MaterialTheme.typography.bodySmall,
                color = t.amber,
            )
        }
    }
}

/** 指标块的色调档位，对应设计稿 `.stat` / `.stat.q`。
 *
 *  只有两档：首要数字（品牌浅底）与参照数字（安静灰）。
 *  原第三档 Green 是家庭户数专用——改版时按设计稿删掉：一屏四张卡里
 *  出现第三种底色，会把平级的四个数字读出主次，而家庭户数与户籍/常住
 *  本质都是参照数，不该比总人口更「跳」。 */
enum class StatTone {
    /** 品牌极浅底 + 品牌字（在册人口这类首要数字） */
    Primary,

    /** 中性极浅底 + 二级墨色字（家庭户数/户籍/常住这类参照数字，不能跟首要数字抢眼） */
    Quiet,
}

/** 指标块，对应设计稿的 `.stat`：15dp 圆角（卡内元素，比卡片收一档）+ 23sp 数字 + 11sp 标签 */
@Composable
fun StatCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    tone: StatTone = StatTone.Primary,
    hint: String? = null,
    onClick: (() -> Unit)? = null,
) {
    val t = AppTheme.tokens
    val bg = when (tone) {
        StatTone.Primary -> t.brandFaint
        StatTone.Quiet -> t.quiet
    }
    val fg = when (tone) {
        StatTone.Primary -> t.brand
        StatTone.Quiet -> t.ink2
    }
    // 标签色也跟着分档：主指标标签二级墨、参照指标三级墨（设计稿 .stat.p/.stat.q .sl）
    val labelFg = when (tone) {
        StatTone.Primary -> t.ink2
        StatTone.Quiet -> t.ink3
    }
    Surface(
        color = bg,
        shape = RoundedCornerShape(AppShapes.stat),
        // 安静档按设计稿补 1px 浅描边：它没有品牌色「压」着，描边替它把边界说清
        border = if (tone == StatTone.Quiet) BorderStroke(1.dp, t.line2) else null,
        // 只加阴影、不加 tonalElevation：tonal 会给卡片叠一层品牌色染色，
        // 与设计稿里「白卡就是白卡」的取值对不上；阴影才是层次的来源
        shadowElevation = AppShapes.cardElevation,
        tonalElevation = 0.dp,
        modifier = if (onClick != null) modifier.clickableNoRipple(true, onClick) else modifier,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 11.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                value,
                style = MaterialTheme.typography.titleLarge,
                color = fg,
                // 设计稿 .stat .sv 是 800：报数的场合数字要「砸」在屏幕上
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                label,
                style = StatLabelStyle,
                color = labelFg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (hint != null) {
                Text(
                    hint,
                    style = MaterialTheme.typography.bodySmall,
                    color = t.ink3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * 分区卡片，对应设计稿的 `.card`：白底 + 20dp 圆角 + 1px 浅描边 + 4dp 柔和阴影。
 *
 * 标题前那根 3×12 的品牌色竖条是设计稿的签名元素：一屏里会有五六个卡片，
 * 光靠字号区分标题和内容在强光下不够，一根色条能让人一眼扫到分区。
 * 描边不是装饰——个别低端机的 Layer 合成会裁掉阴影，描边保证层次不消失。
 */
@Composable
fun SectionCard(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(AppShapes.card),
        border = BorderStroke(1.dp, AppTheme.tokens.line2),
        shadowElevation = AppShapes.cardElevation,
        tonalElevation = 0.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(width = 3.dp, height = 12.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(AppTheme.tokens.brand),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.tokens.ink,
                )
            }
            Spacer(Modifier.height(10.dp))
            content()
        }
    }
}

/** 「标签：值」一行。值缺失时显示占位符，而不是留白（留白会被误认为字段不存在）
 *
 *  `onValueClick` 非空时值按品牌色渲染并可点：电话号码就是用它接 dial 的——
 *  颜色就是「这一行能按」的提示，纯可点不给颜色线索等于没有。 */
@Composable
fun InfoRow(
    label: String,
    value: String?,
    modifier: Modifier = Modifier,
    onValueClick: (() -> Unit)? = null,
) {
    Row(modifier.fillMaxWidth().padding(vertical = 7.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = AppTheme.tokens.ink3,
            modifier = Modifier.width(82.dp),
        )
        Text(
            value?.takeIf { it.isNotBlank() } ?: "—",
            style = InfoValueStyle,
            color = if (onValueClick != null) AppTheme.tokens.brandStrong else AppTheme.tokens.ink,
            modifier = if (onValueClick != null) {
                Modifier.weight(1f).clickableNoRipple(true, onValueClick)
            } else {
                Modifier.weight(1f)
            },
        )
    }
}

/** [InfoRows] 的一行。onClick 非空时值按品牌色渲染并可点（电话号码用它接拨号） */
data class InfoEntry(
    val label: String,
    val value: String?,
    val onClick: (() -> Unit)? = null,
)

/** 一组信息行，行与行之间 1px 细线分隔（设计稿 `.irow + .irow`）。
 *
 *  单独封一组而不是逐行手写分隔线：分组的依据是「这些行讲的是同一件事」，
 *  写在一处就不会漏。 */
@Composable
fun InfoRows(
    vararg rows: InfoEntry,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        rows.forEachIndexed { index, row ->
            if (index > 0) AppDivider()
            InfoRow(row.label, row.value, onValueClick = row.onClick)
        }
    }
}

/**
 * 输入框盒子，对应设计稿 `.fld-input`：白底 + 1px 描边 + 14dp 圆角 + 最小高度 40dp。
 *
 * 为什么不用 Material 的 `OutlinedTextField`：它的浮动标签会把标签「吃」进边框
 * 缺口里，而设计稿的门面形态是**标签独立在盒子上方**（12sp 三级灰），
 * 盒子本身只装内容。默认控件的高度（56dp+）也比设计稿的 40dp 高出一截，
 * 一屏六七个字段排下来，表单会被撑得比设计稿长三分之一。
 */
@Composable
fun FieldBox(
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val t = AppTheme.tokens
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(AppShapes.control),
        border = BorderStroke(1.dp, t.line),
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickableNoRipple(enabled, onClick) else Modifier),
    ) {
        Row(
            Modifier
                .defaultMinSize(minHeight = 40.dp)
                .padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (leading != null) {
                leading()
                Spacer(Modifier.width(8.dp))
            }
            Box(Modifier.weight(1f)) { content() }
            if (trailing != null) {
                Spacer(Modifier.width(8.dp))
                trailing()
            }
        }
    }
}

/** 设计稿 `.fld-input.ph` 的占位色：比 ink3 更轻一档，避免占位文字被读成已填内容 */
private val FieldPlaceholderColor = Color(0xFFA6AEBC)

/** 普通文本输入，对应设计稿 `.fld`：标签在上（10.5sp 三级灰）+ 白盒在下 */
@Composable
fun FormField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    singleLine: Boolean = true,
    enabled: Boolean = true,
    supportingText: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    onImeAction: (() -> Unit)? = null,
) {
    // 显式传 KeyboardActions 会覆盖平台默认的「完成即收起键盘」，
    // 所以收起必须自己做：上门登记里键盘曾因此挡住底部保存按钮、
    // 点「完成」毫无反应，用户只能杀应用
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    Column(modifier.fillMaxWidth()) {
        Text(label, style = HintTextStyle, color = AppTheme.tokens.ink3)
        Spacer(Modifier.height(5.dp))
        FieldBox(enabled = enabled) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                textStyle = FieldTextStyle.copy(color = AppTheme.tokens.ink),
                cursorBrush = SolidColor(AppTheme.tokens.brand),
                singleLine = singleLine,
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                keyboardActions = KeyboardActions(onDone = {
                    keyboard?.hide()
                    focusManager.clearFocus()
                    onImeAction?.invoke()
                }),
                decorationBox = { inner ->
                    Box(Modifier.fillMaxWidth()) {
                        if (value.isEmpty() && placeholder != null) {
                            Text(placeholder, style = FieldTextStyle, color = FieldPlaceholderColor)
                        }
                        inner()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (supportingText != null) {
            Spacer(Modifier.height(3.dp))
            Text(supportingText, style = HintTextStyle, color = AppTheme.tokens.ink3)
        }
    }
}

/** 无标签输入盒：标签由所在行的左侧一列承担时用（待核查编辑弹窗的行内输入）。
 *  与 [FormField] 同一只盒子，区别只在标签在哪儿——盒子长得不一样，
 *  同一屏里就会读出两种输入框。 */
@Composable
fun PlainField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    enabled: Boolean = true,
) {
    FieldBox(modifier = modifier, enabled = enabled) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            textStyle = FieldTextStyle.copy(color = AppTheme.tokens.ink),
            cursorBrush = SolidColor(AppTheme.tokens.brand),
            singleLine = true,
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth()) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(placeholder, style = FieldTextStyle, color = FieldPlaceholderColor)
                    }
                    inner()
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * 搜索框，对应设计稿 `.search`：白盒 + 搜索图标 + 回车即搜。
 * 单独封一个而不是直接用 FormField：它没有标签、有前置图标、带清空按钮，
 * 三处列表都在用，写成一处才好一起调。
 */
@Composable
fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    onSearch: (() -> Unit)? = null,
) {
    // 同 FormField：自定义 KeyboardActions 后收起键盘要自己做
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    FieldBox(
        modifier = modifier,
        leading = {
            Icon(
                Icons.Filled.Search,
                contentDescription = null,
                tint = AppTheme.tokens.ink3,
                modifier = Modifier.size(16.dp),
            )
        },
        trailing = {
            if (value.isNotEmpty()) {
                Box(
                    Modifier
                        .size(24.dp)
                        .clickableNoRipple(true) { onValueChange(""); onSearch?.invoke() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "清空",
                        tint = AppTheme.tokens.ink3,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        },
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = FieldTextStyle.copy(color = AppTheme.tokens.ink),
            cursorBrush = SolidColor(AppTheme.tokens.brand),
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = {
                keyboard?.hide()
                focusManager.clearFocus()
                onSearch?.invoke()
            }),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth()) {
                    if (value.isEmpty()) {
                        Text(placeholder, style = FieldTextStyle, color = FieldPlaceholderColor)
                    }
                    inner()
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** 弹窗里的内嵌搜索框（与 [SearchField] 同一形态，供选人 / 选村弹窗复用） */
@Composable
fun InlineSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    onSearch: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    // 同 FormField：自定义 KeyboardActions 后收起键盘要自己做
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    FieldBox(
        modifier = modifier,
        leading = {
            Icon(
                Icons.Filled.Search,
                contentDescription = null,
                tint = AppTheme.tokens.ink3,
                modifier = Modifier.size(16.dp),
            )
        },
        trailing = trailing,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = FieldTextStyle.copy(color = AppTheme.tokens.ink),
            cursorBrush = SolidColor(AppTheme.tokens.brand),
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = {
                keyboard?.hide()
                focusManager.clearFocus()
                onSearch?.invoke()
            }),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth()) {
                    if (value.isEmpty()) {
                        Text(placeholder, style = FieldTextStyle, color = FieldPlaceholderColor)
                    }
                    inner()
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * 胶囊筛选片，对应设计稿 `.chip` / `.chip.on` / `.chip.warn`。
 *
 * 选中态是**浅蓝底 + 深蓝字**而不是实底蓝白字：实底蓝的视觉重量和主按钮一样重，
 * 一排筛选片里会跳出一个「假主操作」；浅蓝底足够表达「已选中」，又不抢动作位。
 * `warn` 是红色档，专供「当前筛着某个重点人群」——它在说「这是个待清理的筛选」。
 */
@Composable
fun AppChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    trailingIcon: ImageVector? = null,
    selectedIcon: ImageVector? = null,
    warn: Boolean = false,
) {
    val t = AppTheme.tokens
    val bg = when {
        warn -> t.redBg
        selected -> t.brandLight
        else -> MaterialTheme.colorScheme.surface
    }
    val fg = when {
        warn -> t.red
        selected -> t.brandStrong
        else -> t.ink2
    }
    Surface(
        color = bg,
        shape = RoundedCornerShape(AppShapes.chip),
        // 选中/告警两档按设计稿去掉描边（border-color: transparent）
        border = if (selected || warn) null else BorderStroke(1.dp, t.line),
        modifier = modifier.clickableNoRipple(true, onClick),
    ) {
        Row(
            Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val icon = when {
                selected && selectedIcon != null -> selectedIcon
                trailingIcon != null -> trailingIcon
                else -> null
            }
            if (icon != null) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(4.dp))
            }
            Text(
                text,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (selected || warn) FontWeight.SemiBold else FontWeight.Normal,
                color = fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
        }
    }
}

/**
 * 单选/多选芯片，对应设计稿 `.fchip` / `.fchip.on`（上门登记的性别、人口标签）。
 *
 * 不用 Material 的 `FilterChip`：默认样式带勾选图标、内边距与圆角都是另一套，
 * 和筛选片 `AppChip` 摆在一屏里会读出两种「选中态」，而它们其实是同一种语义。
 */
@Composable
fun OptionChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val t = AppTheme.tokens
    Surface(
        color = if (selected) t.brandLight else MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(AppShapes.chip),
        border = if (selected) null else BorderStroke(1.dp, t.line),
        modifier = modifier.clickableNoRipple(true, onClick),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) t.brandStrong else t.ink2,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
        )
    }
}

/**
 * 标签胶囊，对应设计稿 `.p-tag` / `.pv-badge`：10sp 半粗体彩色胶囊。
 *
 * 底色取本色 14% 透明度、字用本色：后端标签色是任意 HEX，没法给每个色相
 * 都配一个「官方底色档」，按透明度铺开是唯一对任意色都成立的做法，
 * 且与设计稿「底色淡、文字浓」的双色关系一致。
 */
@Composable
fun TagPill(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = color.copy(alpha = 0.14f),
        shape = RoundedCornerShape(AppShapes.chip),
        modifier = modifier,
    ) {
        Text(
            text,
            style = PillTextStyle,
            color = color,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.5.dp),
        )
    }
}

/** 主按钮，对应设计稿 `.btn-primary`：品牌实底 + 白字 + 14dp 圆角（详情页「编辑」） */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val t = AppTheme.tokens
    Surface(
        color = if (enabled) t.brand else t.ink3,
        shape = RoundedCornerShape(AppShapes.control),
        shadowElevation = AppShapes.cardElevation,
        tonalElevation = 0.dp,
        modifier = modifier
            .fillMaxWidth()
            .height(50.dp)
            .clickableNoRipple(enabled, onClick),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.5.sp),
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
        }
    }
}

/**
 * 动作按钮，对应设计稿 `.btn-fill` / `.btn-line`（拍照留痕屏的按钮对）。
 *
 * 与 [PrimaryButton] 的分工是**体量**：这一对是 12.5sp 600 字重 + 12dp 圆角、
 * 44dp 高、可并排（`.cam-btns` / `.pv-btns` 两颗一组），用在卡片内部的
 * 「拍照 / 从相册选 / 删除重拍 / 上传」这类行内动作上；[PrimaryButton] 是
 * 14.5sp 700 + 50dp 定高的页面级主按钮（详情页「编辑」）。两者若同屏出现，
 * 体量必须分得开，否则并排两颗「大按钮」会打架，也分不清谁是主操作。
 *
 * `filled = true` 是品牌实底白字（.btn-fill，表示「继续」）；
 * `false` 是白底细描边二级墨字（.btn-line，表示「退路 / 次要」）。
 * 成对出现时一实一虚——这是设计稿给这两个语义分配的视觉重量。
 *
 * `height` 默认 44dp；与 [PrimaryButton]（50dp）并排于同一行时传 50dp，
 * 让两颗按钮顶天立地对齐（长表单底部的「保存 + 返回」就是这种排法）。
 */
@Composable
fun ActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    filled: Boolean = false,
    icon: ImageVector? = null,
    height: Dp = 44.dp,
) {
    val t = AppTheme.tokens
    Surface(
        color = if (filled) (if (enabled) t.brand else t.ink3) else MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        border = if (!filled) BorderStroke(1.dp, t.line) else null,
        shadowElevation = if (filled) AppShapes.cardElevation else 0.dp,
        tonalElevation = 0.dp,
        modifier = modifier
            .height(height)
            .clickableNoRipple(enabled, onClick),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(
                text,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                fontWeight = FontWeight.SemiBold,
                color = if (filled) Color.White else t.ink2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * 重点人群一行，对应设计稿 `.grp-row`：色点 + 名称 + 人数 + 「人」。
 *
 * `showCard = false` 时不铺自己的白底：把若干行放进同一张 `SectionCard` 里时
 * 由父卡片提供底色，行与行之间用 [AppDivider] 分隔——这样「这些行属于同一组」
 * 才看得出来。每行各是一张白卡的话，一屏九张卡片排下来完全没有分组感。
 */
@Composable
fun GrowRow(
    label: String,
    count: Int,
    dotColor: Color,
    modifier: Modifier = Modifier,
    hint: String? = null,
    showCard: Boolean = true,
    onClick: () -> Unit,
) {
    Surface(
        color = if (showCard) MaterialTheme.colorScheme.surface else Color.Transparent,
        shape = RoundedCornerShape(AppShapes.card),
        modifier = modifier.fillMaxWidth().clickableNoRipple(true, onClick),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                // 横移不在这里给：父卡片已有 16dp 内边距，再收一层就比设计稿深了
                .padding(horizontal = if (showCard) 12.dp else 0.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(9.dp).clip(CircleShape).background(dotColor))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.tokens.ink,
                )
                if (hint != null) {
                    Text(hint, style = HintTextStyle, color = AppTheme.tokens.ink3)
                }
            }
            // 人数是墨色而不是品牌色：这一行要读的是「多少人」，不是「点我」——
            // 行本身可点已经由箭头暗示，数字再上品牌色就跟主操作抢眼
            Text(
                "$count",
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp),
                fontWeight = FontWeight.ExtraBold,
                color = AppTheme.tokens.ink,
            )
            Spacer(Modifier.width(1.dp))
            Text("人", style = HintTextStyle, color = AppTheme.tokens.ink3)
        }
    }
}

/** 卡片内的行分隔线。用它而不是留白：一列同类行之间，白底上的细线才读得出「这是同一组」 */
@Composable
fun AppDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(AppTheme.tokens.line2))
}

data class PickerOption(val value: String, val label: String)

/**
 * 选择器。
 *
 * 用「弹窗 + 列表 + 搜索」而不是下拉菜单：村庄有上百个，
 * ExposedDropdownMenu 在长列表下既难滑也难搜，而网格员在村里选地址时手上可能还拿着东西。
 * 收起态对应设计稿 `.fld-input.sel`：标签在上、白盒在下、盒尾一枚下拉角。
 */
@Composable
fun PickerField(
    label: String,
    value: String,
    options: List<PickerOption>,
    onSelect: (PickerOption?) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "请选择",
    enabled: Boolean = true,
    searchable: Boolean = true,
    allowClear: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    var keyword by remember { mutableStateOf("") }

    Column(modifier) {
        Text(label, style = HintTextStyle, color = AppTheme.tokens.ink3)
        Spacer(Modifier.height(5.dp))
        FieldBox(
            enabled = enabled,
            onClick = if (enabled) { { open = true } } else null,
            trailing = {
                if (allowClear && value.isNotBlank()) {
                    Box(
                        Modifier
                            .size(24.dp)
                            .clickableNoRipple(true) { onSelect(null) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filled.Close,
                            contentDescription = "清空",
                            tint = AppTheme.tokens.ink3,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                } else {
                    Icon(
                        Icons.Filled.ArrowDropDown,
                        contentDescription = null,
                        tint = AppTheme.tokens.ink3,
                        modifier = Modifier.size(20.dp),
                    )
                }
            },
        ) {
            Text(
                value.ifBlank { placeholder },
                style = FieldTextStyle,
                color = if (value.isBlank()) FieldPlaceholderColor else AppTheme.tokens.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }

    if (open) {
        val filtered = remember(keyword, options) {
            if (keyword.isBlank()) options
            else options.filter { it.label.contains(keyword, ignoreCase = true) }
        }
        Dialog(onDismissRequest = { open = false; keyword = "" }) {
            Surface(shape = RoundedCornerShape(AppShapes.card), color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.padding(16.dp)) {
                    Text(label, style = MaterialTheme.typography.titleMedium)
                    if (searchable && options.size > 8) {
                        Spacer(Modifier.height(10.dp))
                        InlineSearchField(
                            value = keyword,
                            onValueChange = { keyword = it },
                            placeholder = "搜索",
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    // 最多显示 8 行，再多就滚动，避免弹窗高度超出屏幕把「取消」顶出去
                    val listHeight = (options.size.coerceIn(1, 8) * 52 + 8).dp
                    LazyColumn(Modifier.height(listHeight)) {
                        items(filtered, key = { it.value }) { option ->
                            Text(
                                option.label,
                                style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickableNoRipple(true) {
                                        onSelect(option)
                                        open = false
                                        keyword = ""
                                    }
                                    .padding(vertical = 14.dp, horizontal = 4.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        androidx.compose.material3.TextButton(onClick = { open = false; keyword = "" }) {
                            Text("取消")
                        }
                    }
                }
            }
        }
    }
}

/** 无涟漪点击：列表与只读输入框不需要水波纹，视觉上更接近原生设置页 */
fun Modifier.clickableNoRipple(enabled: Boolean = true, onClick: () -> Unit): Modifier =
    then(
        if (enabled) {
            Modifier.clickable(
                // interactionSource / indication 同时给默认值才会出现水波纹，
                // indication = null 即可关掉它
                interactionSource = MutableInteractionSource(),
                indication = null,
                onClick = onClick,
            )
        } else {
            Modifier
        }
    )

/** 把后端给的 #RRGGBB 解析成 Color；解析不了就用兜底色，不让页面崩 */
fun parseHexColor(hex: String?, fallback: Color): Color {
    val clean = hex?.trim()?.removePrefix("#") ?: return fallback
    return runCatching {
        when (clean.length) {
            6 -> Color(0xFF000000L or clean.toLong(16))
            8 -> Color(clean.toLong(16))
            else -> fallback
        }
    }.getOrDefault(fallback)
}
