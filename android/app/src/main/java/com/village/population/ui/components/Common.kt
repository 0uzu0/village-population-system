package com.village.population.ui.components

import android.provider.Settings
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
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

/** 11sp：列表行副标题（设计稿 `.p-meta` / `.p-id`） */
val MetaTextStyle = TextStyle(fontSize = 11.sp, lineHeight = 16.sp)

/** 10sp：徽章 / 标签胶囊（设计稿 `.p-tag` / `.pv-badge`） */
val PillTextStyle = TextStyle(fontSize = 10.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold)

/** 13.5sp：输入框文字（设计稿 `.fld-input`） */
val FieldTextStyle = TextStyle(fontSize = 13.5.sp, lineHeight = 20.sp)

/** 13sp：信息行的值（设计稿 `.irow .v`，500 字重） */
val InfoValueStyle = TextStyle(fontSize = 13.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium)

/**
 * 数字用等宽字形（tabular figures）。
 *
 * 默认的比例数字里「1」比「8」窄一半，于是报数界面上一列人数、一列指标
 * 会随数字变化左右跳动，逐个对比时眼睛要不断重新找位。手机系统的数字字体
 * 都自带 tnum 变体，开一个开关就能对齐，是这类界面最便宜的一处体面。
 */
fun TextStyle.tabular(): TextStyle = copy(fontFeatureSettings = "tnum")

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
    // 与 [EmptyBox] 同一套骨架：圆牌图标 + 一句人话 + 一颗按钮。
    // 错误态最容易做坏的地方是「只剩一行报错」——用户看完不知道下一步干什么。
    // 重试因此是一颗 44dp 的按钮，而不是一行点得中的小字：出错的时候，
    // 全屏只有这一个动作，它值得被看见（也值得一个够大的触摸目标）。
    val t = AppTheme.tokens
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 40.dp, vertical = 32.dp),
        ) {
            Box(
                Modifier.size(56.dp).background(t.redBg, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.ErrorOutline,
                    contentDescription = null,
                    tint = t.red,
                    modifier = Modifier.size(26.dp),
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = t.ink2,
            )
            if (onRetry != null) {
                Spacer(Modifier.height(16.dp))
                ActionButton("重试", onRetry, filled = false)
            }
        }
    }
}

/**
 * 空状态。
 *
 * 「暂无数据」四个字几乎从不解决问题：用户看到的是空白，需要的是**为什么空**和
 * **接下来能做什么**。所以这里给三样东西——一句说明（描述）、一个图标、以及一个
 * 直接可执行的动作（比如「清空筛选」「新增人员」）。没有动作可给时按钮不出现，
 * 不要摆一颗按不出效果的按钮。
 */
@Composable
fun EmptyBox(
    message: String = "暂无数据",
    modifier: Modifier = Modifier,
    description: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    icon: ImageVector = Icons.Filled.Inbox,
) {
    val t = AppTheme.tokens
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 40.dp, vertical = 32.dp),
        ) {
            // 图标放进一枚安静的圆牌：裸图标在整屏空白里没有重量，会被读成装饰
            Box(
                Modifier.size(56.dp).background(t.quiet, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = t.ink3, modifier = Modifier.size(26.dp))
            }
            Spacer(Modifier.height(14.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = t.ink2,
            )
            if (description != null) {
                Spacer(Modifier.height(6.dp))
                Text(
                    description,
                    style = MaterialTheme.typography.bodySmall,
                    color = t.ink3,
                )
            }
            if (actionLabel != null && onAction != null) {
                Spacer(Modifier.height(16.dp))
                ActionButton(actionLabel, onAction, filled = false)
            }
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
 *  颜色就是「这一行能按」的提示，纯可点不给颜色线索等于没有。
 *
 *  `dense = true` 把行距从 7dp 收到 5dp（设计稿 `detail .kv{padding:5px 0}`）：
 *  人员详情有七八行成组的字段，每行省 4dp，一屏就能多露出一组信息。 */
@Composable
fun InfoRow(
    label: String,
    value: String?,
    modifier: Modifier = Modifier,
    dense: Boolean = false,
    onValueClick: (() -> Unit)? = null,
) {
    val empty = value.isNullOrBlank()
    Row(modifier.fillMaxWidth().padding(vertical = if (dense) 5.dp else 7.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = AppTheme.tokens.ink3,
            modifier = Modifier.width(82.dp),
        )
        // 空值写「未登记」而不是一个破折号：13sp 的「—」在下一条分隔线上面
        // 只有一根短横，看着像残留的下划线（截图里就是这样），也不说明任何事。
        // 「未登记」是村里填表时的原话，读到的人知道"这一栏确实没填"，而不是"坏了"。
        // 占位用三级墨色：它是"没有内容"，不能和真实值一样黑
        Text(
            if (empty) "未登记" else value.orEmpty(),
            style = InfoValueStyle,
            color = when {
                empty -> AppTheme.tokens.ink3
                onValueClick != null -> AppTheme.tokens.brandStrong
                else -> AppTheme.tokens.ink
            },
            modifier = if (onValueClick != null && !empty) {
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
    dense: Boolean = false,
) {
    Column(modifier.fillMaxWidth()) {
        rows.forEachIndexed { index, row ->
            if (index > 0) AppDivider()
            InfoRow(row.label, row.value, dense = dense, onValueClick = row.onClick)
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

/**
 * 占位文字色现在走令牌（`tokens.placeholder`）。
 *
 * 原先这里写死 #A6AEBC，压白盒只有 2.24:1——「请选择」「搜索姓名…」这类
 * **告诉用户该填什么**的字，是全屏最该看清的一行之一，却几乎糊进底纹里。
 * 令牌化之后它还顺手解决了另一个问题：深色档原先也在用这个浅灰，夜间偏亮。
 */
private val FieldPlaceholderColor: Color
    @Composable get() = AppTheme.tokens.placeholder

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

/**
 * 密码输入：与 [FormField] 同一只盒子，只是内容遮成圆点、盒尾多一枚眼睛。
 *
 * 登录页原先直接用 Material 的 `OutlinedTextField`——它是全应用唯一一处
 * 「浮动标签 + 56dp 盒高」的输入框，跟其余表单（标签在上、白盒 40dp）是两套语言。
 * 用户第一眼看到的就是登录页，第一眼看到的控件却是个例外，后面每一屏都成了例外。
 */
@Composable
fun PasswordField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    visible: Boolean,
    onToggleVisible: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    onImeAction: (() -> Unit)? = null,
) {
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    Column(modifier.fillMaxWidth()) {
        Text(label, style = HintTextStyle, color = AppTheme.tokens.ink3)
        Spacer(Modifier.height(5.dp))
        FieldBox(
            trailing = {
                // 触摸目标 32dp：视觉只有 16dp 的眼睛，直接当点击区太小
                Box(
                    Modifier
                        .size(32.dp)
                        .clickableNoRipple(true, onToggleVisible),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (visible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = if (visible) "隐藏密码" else "显示密码",
                        tint = AppTheme.tokens.ink3,
                        modifier = Modifier.size(16.dp),
                    )
                }
            },
        ) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = FieldTextStyle.copy(color = AppTheme.tokens.ink),
                cursorBrush = SolidColor(AppTheme.tokens.brand),
                singleLine = true,
                visualTransformation = if (visible) {
                    VisualTransformation.None
                } else {
                    PasswordVisualTransformation()
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
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
        // 50dp 是**最小**高度而不是固定高度：系统字号调到 1.3～2.0 的村干部
        // 不在少数（这也是本应用把正文字号统一抬大的原因），固定高度会在那一档
        // 把「保 存」裁掉半个字。文字撑得更高时按钮跟着长，比裁字体面。
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 50.dp)
            .tapRipple(enabled, onClick),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 13.dp),
        ) {
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.5.sp),
                fontWeight = FontWeight.Bold,
                color = Color.White,
                maxLines = 1,
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
 * `false` 是白底细描边二级墨字（.btn-line，表示「退路 / 次要」）；
 * `soft = true` 是品牌浅底 + 品牌深字（卡片内的主操作：一列卡片里每张都有
 * 一颗实底蓝按钮会刷出一片蓝，而它又比「忽略」重要，不能退回描边档）。
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
    soft: Boolean = false,
    icon: ImageVector? = null,
    height: Dp = 44.dp,
) {
    val t = AppTheme.tokens
    val container = when {
        filled -> if (enabled) t.brand else t.ink3
        soft -> if (enabled) t.brandLight else t.quiet
        else -> MaterialTheme.colorScheme.surface
    }
    val content = when {
        filled -> Color.White
        soft -> if (enabled) t.brandStrong else t.ink3
        else -> if (enabled) t.ink2 else t.ink3
    }
    Surface(
        color = container,
        shape = RoundedCornerShape(12.dp),
        border = if (!filled && !soft) BorderStroke(1.dp, t.line) else null,
        shadowElevation = if (filled) AppShapes.cardElevation else 0.dp,
        tonalElevation = 0.dp,
        // 同 PrimaryButton：`height` 只是下限，字号放大时按钮跟着长，不裁字
        modifier = modifier
            .defaultMinSize(minHeight = height)
            .tapRipple(enabled, onClick),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(
                text,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                fontWeight = FontWeight.SemiBold,
                color = content,
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
 *
 * `byAge = true` 是**年龄类族群**（老年人、未成年人）专用的表达：
 * 它们不是打标签打出来的，而是按出生日期算出来的。
 * 旧版给这类行挂一行「按年龄自动判定，无需打标签」的小字——同一句话在九行里
 * 出现两次，每次占 15dp，还打断竖向扫读；而它和「低保对象」这种真标签在视觉上
 * 完全没有区别，看的人要读完整行才知道「这一类不是标签」。
 * 现在改成两个形状信号：色点变**空心**、名字后面跟一枚「按年龄」小胶囊。
 * 区别从「多读一行字」变成「一眼看形状」，行高同时从 44 收到 40dp。
 */
@Composable
fun GrowRow(
    label: String,
    count: Int,
    dotColor: Color,
    modifier: Modifier = Modifier,
    hint: String? = null,
    byAge: Boolean = false,
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
                // 40dp 行高（设计稿 .grp-row height:40px）：一行 40 是「一列数字」
                // 仍然能被逐行比对的上限，再高就滑不完九类，再低则触摸目标不够
                .heightIn(min = 40.dp)
                // 横移不在这里给：父卡片已有 16dp 内边距，再收一层就比设计稿深了
                .padding(horizontal = if (showCard) 12.dp else 0.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 空心 / 实心两态：实心是「挂在这个人身上的标签」，空心是「系统算出来的」
            Box(
                Modifier
                    .size(9.dp)
                    .clip(CircleShape)
                    .then(
                        if (byAge) {
                            Modifier.border(1.5.dp, AppTheme.tokens.ink3, CircleShape)
                        } else {
                            Modifier.background(dotColor)
                        }
                    ),
            )
            Spacer(Modifier.width(10.dp))
            // 名称 + 「按年龄」胶囊包成一个整体，由它独占中间那一段宽度。
            //
            // 这里踩过一个坑：先前标签文字自己 weight(1f, fill = false)、后面再放一个
            // weight(1f) 的占位，两个权重在 Compose 里是**平分**剩余宽度的——文字只拿到
            // 一半，「老年人（≥60岁）」正好被切在括号里，变成「老年人（≥6…」。
            // 现在只留一个权重：外层 Row 吃满中间，内层文字 fill = false 按需取宽，
            // 文字短时胶囊紧跟在名称后面（设计稿就是这个排法），文字长时先压缩名称。
            Row(
                Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.tokens.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (byAge) {
                    Spacer(Modifier.width(6.dp))
                    // 「按年龄」灰底胶囊：比正文小一号、比说明文字实，读作「这是个属性」
                    Surface(
                        color = AppTheme.tokens.quiet,
                        shape = RoundedCornerShape(AppShapes.chip),
                    ) {
                        Text(
                            "按年龄",
                            style = PillTextStyle,
                            color = AppTheme.tokens.ink3,
                            maxLines = 1,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.5.dp),
                        )
                    }
                }
            }
            // hint 保留给真正的补充说明（目前无调用方传值）；
            // 年龄类不再走 hint —— 那一行小字正是本次要消掉的东西
            if (hint != null && !byAge) {
                Spacer(Modifier.width(6.dp))
                Text(hint, style = HintTextStyle, color = AppTheme.tokens.ink3, maxLines = 1)
            }
            // 人数贴着右边缘：中间那段已被上面的 Row(weight(1f)) 吃满，
            // 这里不再需要额外的 weight 占位（多一个权重就会回头去分文字的地盘）
            // 人数是墨色而不是品牌色：这一行要读的是「多少人」，不是「点我」——
            // 行本身可点已经由箭头暗示，数字再上品牌色就跟主操作抢眼
            Text(
                "$count",
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp).tabular(),
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

/**
 * 可折叠的分组行，对应设计稿 `.fold-row`（人员详情页的「服务台账」「变更记录」）。
 *
 * 人员详情原先七张卡平铺、约 1950dp（接近三屏），其中「服务台账」「变更记录」
 * 是**偶尔才看**的内容，却和「基本信息」占同样的篇幅。折叠不是把功能藏起来：
 * 标题行里写清「里面有什么」（银行账号 · 补贴 · 健康评估），要查的人一眼知道
 * 该展开哪一条；不查的人少滚两屏。
 *
 * 几个刻意的选择：
 *  · 竖条用 `line` 而不是品牌色——折叠行是低频分组，用品牌色会把「这里重要」
 *    喊得比上面的「基本信息」还响；
 *  · 触摸目标整行 ≥44dp，不只是那枚 13dp 的箭头：户外戴手套点箭头很难点中；
 *  · 展开与否由调用方持有（不在这里 remember）：设计稿要求折叠状态不跨页面记忆，
 *    状态放在屏幕里，离开这一屏自然复位。
 */
@Composable
fun CollapsibleRow(
    title: String,
    summary: String?,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val t = AppTheme.tokens
    val rotation by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (expanded) 180f else 0f,
        label = "fold-arrow",
    )
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 44.dp)
                .clickableNoRipple(true, onToggle)
                .padding(vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(width = 3.dp, height = 12.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(t.line),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp),
                fontWeight = FontWeight.SemiBold,
                color = t.ink2,
                maxLines = 1,
            )
            if (summary != null) {
                Spacer(Modifier.width(8.dp))
                Text(
                    summary,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                    color = t.ink3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Spacer(Modifier.weight(1f))
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.Filled.ExpandMore,
                contentDescription = if (expanded) "收起$title" else "展开$title",
                tint = t.ink3,
                modifier = Modifier.size(16.dp).rotate(rotation),
            )
        }
        if (expanded) {
            Column(Modifier.fillMaxWidth().padding(start = 11.dp, bottom = 6.dp)) { content() }
        }
    }
}

/**
 * 细进度条，对应设计稿 `.pbar`（待核查的「已处理 / 总数」）。
 *
 * 为什么待核查需要它：十几条记录堆在列表里是一个**没有终点的清单**，
 * 人在这种清单前的默认反应是关掉它。一条 6dp 的进度条把「还剩多少」变成
 * 一个可见的、会变短的东西——同样一批活，有终点感才会开始做。
 *
 * 0 与满两个边界单独处理：宽度 0 会画出一条圆角残影，宽度满时不该再露出底色。
 */
@Composable
fun ThinProgressBar(
    progress: Float,
    modifier: Modifier = Modifier,
    color: Color = AppTheme.tokens.brand,
    track: Color = AppTheme.tokens.line2,
) {
    val safe = progress.coerceIn(0f, 1f)
    Box(
        modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(track),
    ) {
        if (safe > 0f) {
            Box(
                Modifier
                    .fillMaxWidth(safe)
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(color),
            )
        }
    }
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

/**
 * 带按压反馈的可点击修饰符 —— **只给按钮用**。
 *
 * 列表卡片与筛选片一直是 `clickableNoRipple`（设计稿要的是原生设置页那种安静感，
 * 一屏十几张卡每张都荡开一圈水波会很吵）。但按钮是另一回事：点「保存」之后
 * 要等一个网络来回，如果按下去连一点反馈都没有，用户会怀疑没点上、再点一次。
 * 所以按钮保留一层很淡的水波（10% 墨色，不是品牌色——品牌色的涟漪在实底蓝按钮上
 * 看不见，在浅底按钮上又太跳）。
 */
@Composable
fun Modifier.tapRipple(enabled: Boolean = true, onClick: () -> Unit): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val tint = AppTheme.tokens.ink.copy(alpha = 0.10f)
    // ⚠️ 必须 this.then(...) / this 收尾。早先这里直接返回一个新建的 Modifier，
    // 调用方链在它前面的东西（fillMaxWidth、weight、padding、background…）会被**整个丢掉**：
    // 表现为吸底条的「保存」缩成文字大小的一小块、宽度不再撑满，
    // 而代码里明明写着 weight(1f) —— 排查时极难往这个工具函数上想。
    return if (enabled) {
        this.then(
            Modifier.clickable(
                interactionSource = interaction,
                indication = ripple(color = tint),
                onClick = onClick,
            )
        )
    } else {
        this
    }
}

/**
 * 骨架屏的呼吸透明度。
 *
 * 交给系统的「移除动画」开关管：无障碍设置里关掉动画的人，屏幕上不该有东西
 * 自顾自地闪。关掉时给一个稳定的中间值，骨架仍然在，只是不动。
 */
@Composable
private fun skeletonAlpha(): Float {
    val context = LocalContext.current
    val animate = remember(context) {
        runCatching {
            Settings.Global.getFloat(
                context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f,
            ) > 0f
        }.getOrDefault(true)
    }
    if (!animate) return 0.8f
    val transition = rememberInfiniteTransition(label = "skeleton")
    val alpha by transition.animateFloat(
        initialValue = 0.5f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 850, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "skeleton-alpha",
    )
    return alpha
}

/** 骨架块：代表「这里将有一行字 / 一张图」 */
@Composable
fun SkeletonBlock(
    modifier: Modifier = Modifier,
    height: Dp = 12.dp,
    corner: Dp = 6.dp,
    alpha: Float = skeletonAlpha(),
) {
    Box(
        modifier
            .height(height)
            .clip(RoundedCornerShape(corner))
            .background(AppTheme.tokens.line2.copy(alpha = alpha)),
    )
}

/**
 * 人员卡片骨架，与 [com.village.population.ui.screens.person.PersonRow] 同形。
 *
 * 为什么要做骨架而不是居中转圈：村里网络慢的时候首屏常常要一两秒，
 * 转圈只告诉用户「在等」，骨架告诉用户「马上就有一列人，长这样」——
 * 等的是同一段时间，但页面不会看起来像空了。形状也必须跟真行一致，
 * 否则数据一到整页跳一下，比多看半秒转圈更难受。
 */
@Composable
fun PersonRowSkeleton(modifier: Modifier = Modifier) {
    val alpha = skeletonAlpha()
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(AppShapes.card),
        border = BorderStroke(1.dp, AppTheme.tokens.line2),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SkeletonBlock(
                Modifier.size(44.dp),
                height = 44.dp,
                corner = 22.dp,
                alpha = alpha,
            )
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                SkeletonBlock(Modifier.fillMaxWidth(0.42f), height = 14.dp, alpha = alpha)
                Spacer(Modifier.height(8.dp))
                SkeletonBlock(Modifier.fillMaxWidth(0.72f), height = 11.dp, alpha = alpha)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    SkeletonBlock(Modifier.width(46.dp), height = 16.dp, corner = 9.dp, alpha = alpha)
                    SkeletonBlock(Modifier.width(38.dp), height = 16.dp, corner = 9.dp, alpha = alpha)
                }
            }
        }
    }
}

/** 人员列表的整屏骨架（首屏加载用，替代居中转圈） */
@Composable
fun PersonListSkeleton(modifier: Modifier = Modifier, count: Int = 6) {
    Column(
        modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        repeat(count) { PersonRowSkeleton() }
    }
}

