package com.village.population.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.village.population.ui.theme.AppTheme

/**
 * 统一的页头，对应设计稿的 `.bar`：**品牌蓝底 + 白字**。
 *
 * 为什么不用默认的白底页头：移动端每一屏内容都是白卡片，白底页头会和内容糊成一片，
 * 用户一眼分不清「这是标题栏」还是「这是第一张卡片」。整块品牌色把层级一次拉开，
 * 也顺带统一了状态栏底色（状态栏在 Activity 里跟随主题设定）。
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AppTopBar(
    title: String,
    onBack: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    TopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
            }
        },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = AppTheme.tokens.brand,
            titleContentColor = Color.White,
            navigationIconContentColor = Color.White,
            actionIconContentColor = Color.White,
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
 * 离线/降级提示横幅，对应设计稿的 `.banner`（琥珀底 + 描边 + 琥珀字）。
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
        shape = RoundedCornerShape(9.dp),
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

/** 指标块的色调档位，对应设计稿 `.stat` / `.stat` 绿底 / `.stat.q` */
enum class StatTone {
    /** 品牌极浅底 + 品牌字（在册人口这类首要数字） */
    Primary,

    /** 绿底 + 绿字（家庭户数） */
    Green,

    /** 中性极浅底 + 二级墨色字（户籍/常住这类参照数字，不能跟首要数字抢眼） */
    Quiet,
}

/** 指标块，对应设计稿的 `.stat` */
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
        StatTone.Green -> t.greenBg
        StatTone.Quiet -> t.quiet
    }
    val fg = when (tone) {
        StatTone.Primary -> t.brand
        StatTone.Green -> t.green
        StatTone.Quiet -> t.ink2
    }
    Surface(
        color = bg,
        shape = RoundedCornerShape(10.dp),
        modifier = if (onClick != null) modifier.clickableNoRipple(true, onClick) else modifier,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 11.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                value,
                style = MaterialTheme.typography.titleLarge,
                color = fg,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                label,
                style = MaterialTheme.typography.bodySmall,
                color = t.ink2,
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
 * 详情页里的分组卡片，对应设计稿的 `.scard`。
 * 标题前那根 3×12 的品牌色竖条是设计稿的签名元素：一屏里会有五六个卡片，
 * 光靠字号区分标题和内容在强光下不够，一根色条能让人一眼扫到分区。
 */
@Composable
fun SectionCard(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
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
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.tokens.ink,
                )
            }
            Spacer(Modifier.height(10.dp))
            content()
        }
    }
}

/** 「标签：值」一行。值缺失时显示占位符，而不是留白（留白会被误认为字段不存在） */
@Composable
fun InfoRow(label: String, value: String?, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = AppTheme.tokens.ink3,
            modifier = Modifier.width(92.dp),
        )
        Text(
            value?.takeIf { it.isNotBlank() } ?: "—",
            style = MaterialTheme.typography.bodyLarge,
            color = AppTheme.tokens.ink,
            modifier = Modifier.weight(1f),
        )
    }
}

/** 普通文本输入，形状对齐设计稿 `.fld`（白底 + 1px 描边 + 10px 圆角） */
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
    keyboardType: androidx.compose.ui.text.input.KeyboardType = androidx.compose.ui.text.input.KeyboardType.Text,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it) } },
        singleLine = singleLine,
        enabled = enabled,
        isError = false,
        shape = RoundedCornerShape(10.dp),
        supportingText = supportingText?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * 搜索框，对应设计稿 `.fld` 里的「🔍 搜姓名 / 身份证号 / 手机号」。
 * 单独封一个而不是直接用 FormField：它没有 label、有搜索图标、回车即搜，
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
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, style = MaterialTheme.typography.bodyMedium) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        trailingIcon = {
            if (value.isNotEmpty()) {
                IconButton(onClick = { onValueChange(""); onSearch?.invoke() }) {
                    Icon(Icons.Filled.Close, contentDescription = "清空")
                }
            }
        },
        singleLine = true,
        shape = RoundedCornerShape(10.dp),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSearch?.invoke() }),
        modifier = modifier.fillMaxWidth(),
    )
}

/** 胶囊筛选片，对应设计稿的 `.chip` / `.chip.on`（选中 = 品牌底白字） */
@Composable
fun AppChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    trailingIcon: ImageVector? = null,
) {
    val t = AppTheme.tokens
    Surface(
        color = if (selected) t.brand else MaterialTheme.colorScheme.surface,
        contentColor = if (selected) Color.White else t.ink2,
        shape = RoundedCornerShape(50),
        border = if (selected) null else BorderStroke(1.dp, t.line),
        modifier = modifier.clickableNoRipple(true, onClick),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (trailingIcon != null) {
                Spacer(Modifier.width(4.dp))
                Icon(trailingIcon, contentDescription = null, modifier = Modifier.size(14.dp))
            }
        }
    }
}

/** 重点人群一行，对应设计稿的 `.grow`：色点 + 名称 + 人数 */
@Composable
fun GrowRow(
    label: String,
    count: Int,
    dotColor: Color,
    modifier: Modifier = Modifier,
    hint: String? = null,
    onClick: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(11.dp),
        modifier = modifier.fillMaxWidth().clickableNoRipple(true, onClick),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(dotColor))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.bodyLarge, color = AppTheme.tokens.ink)
                if (hint != null) {
                    Text(hint, style = MaterialTheme.typography.bodySmall, color = AppTheme.tokens.ink3)
                }
            }
            Text(
                "$count",
                style = MaterialTheme.typography.titleMedium,
                color = AppTheme.tokens.brand,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/** 底部操作栏的一项 */
data class BottomAction(val label: String, val icon: ImageVector, val onClick: () -> Unit)

/**
 * 固定底部的操作栏，对应设计稿人员详情页底部的「打电话 / 拍照留痕 / 编辑资料」。
 *
 * 详情页的操作原先挤在页头右上角（三个小图标），要点到得先把拇指伸到屏幕顶端；
 * 挪到底部是单手可及的范围内，也是设计稿明确画出来的做法。
 */
@Composable
fun BottomActionBar(actions: List<BottomAction>, modifier: Modifier = Modifier) {
    val t = AppTheme.tokens
    Surface(
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(1.dp).background(t.line2))
            Row(
                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                actions.forEach { action ->
                    Column(
                        Modifier
                            .weight(1f)
                            .clickableNoRipple(true, action.onClick)
                            .padding(vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(action.icon, contentDescription = null, tint = t.brand, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.height(2.dp))
                        Text(action.label, style = MaterialTheme.typography.bodySmall, color = t.brand)
                    }
                }
            }
        }
    }
}

/**
 * 待核查卡片，对应设计稿的 `.qcard`：白底 + **左侧 3dp 琥珀竖条**。
 * 竖条是在说「这张卡的状态是待处理」，比在卡片里塞一个「待核查」标签更省地方，
 * 一列扫下来也更容易数清有几条。
 */
@Composable
fun QCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(11.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(AppTheme.tokens.amber))
            Column(
                Modifier.weight(1f).padding(start = 12.dp, top = 12.dp, end = 12.dp, bottom = 12.dp),
                content = content,
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
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            placeholder = { Text(placeholder) },
            shape = RoundedCornerShape(10.dp),
            trailingIcon = {
                Row {
                    if (allowClear && value.isNotBlank()) {
                        IconButton(onClick = { onSelect(null) }) {
                            Icon(Icons.Filled.Close, contentDescription = "清空")
                        }
                    }
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .clickableNoRipple(enabled) { open = true },
        )
    }

    if (open) {
        val filtered = remember(keyword, options) {
            if (keyword.isBlank()) options
            else options.filter { it.label.contains(keyword, ignoreCase = true) }
        }
        Dialog(onDismissRequest = { open = false; keyword = "" }) {
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.padding(16.dp)) {
                    Text(label, style = MaterialTheme.typography.titleMedium)
                    if (searchable && options.size > 8) {
                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = keyword,
                            onValueChange = { keyword = it },
                            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                            placeholder = { Text("搜索") },
                            singleLine = true,
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.fillMaxWidth(),
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

/** 小圆点标签，对应设计稿 `.tag`：底色由标签自身色按 14% 透明度铺开，字用本色 */
@Composable
fun DotLabel(text: String, color: Color, modifier: Modifier = Modifier) {
    Surface(
        color = color.copy(alpha = 0.14f),
        shape = RoundedCornerShape(6.dp),
        modifier = modifier,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = color,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

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
