package com.village.population.ui.screens.capture

import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.village.population.data.local.queue.OpType
import com.village.population.data.local.queue.QueuedOp
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.repository.FileRepository
import com.village.population.data.repository.PersonQuery
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.SectionCard
import com.village.population.ui.components.clickableNoRipple
import com.village.population.ui.theme.AppTheme
import com.village.population.util.DateText
import com.village.population.util.isNetworkProblem
import com.village.population.util.toUserMessage
import kotlinx.coroutines.launch
import java.io.File

/** 提示的三种性质：成功 / 降级（已入队） / 失败。分开是因为它们该长的样子完全不同 */
private enum class CapLevel { OK, WARN, ERROR }

private data class CapMessage(val text: String, val level: CapLevel)

/**
 * 拍照留痕。
 *
 * **一张照片必须挂到某个人身上**，这是这一屏的核心约束：
 *  · 本地暂存文件名、后台显示文件名都以**拍照时间**开头（`IMG_20261016-193012.jpg`），
 *    拍照时间同时作为 `capturedAt` 上报，后端据此命名落盘文件；
 *  · 归属（personId → 后端的 bizType/bizId）在上传与离线入队时都必须带上。
 *    曾经离线补传时把归属丢了，导致「断网时拍的照片」联网后变成查不到的孤儿附件。
 * 所以没选人时不给上传——宁可让用户多点一下，也不要产生对不上人的照片。
 *
 * 两条路径都**不需要申请相机或存储权限**：
 *  · 拍照走系统相机的 ACTION_IMAGE_CAPTURE，把应用私有目录里的临时文件
 *    通过 FileProvider 授权给它（这也是为什么清单里没有 CAMERA 权限）；
 *  · 选图走 SAF，由系统文件选择器把 URI 授权给本应用。
 */
@Composable
fun CaptureScreen(personId: Int?, onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val context = LocalContext.current
    val tokens = AppTheme.tokens
    val pendingOps by container.queue.size.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    /** 这张照片要挂到谁身上。从人员详情进来时已经确定，从工作台进来要现选 */
    var person by remember { mutableStateOf<PersonDto?>(null) }
    var pickerOpen by remember { mutableStateOf(false) }
    var photoFile by remember { mutableStateOf<File?>(null) }
    /** 拍照时间。上传/入队都带着它，后端以它命名 */
    var capturedAt by remember { mutableStateOf<Long?>(null) }
    var message by remember { mutableStateOf<CapMessage?>(null) }
    var uploading by remember { mutableStateOf(false) }

    // 从人员详情进来时只带了一个 id：把它解析成「姓名 + 村庄」摆出来。
    // 光显示「将关联到人员 #42」等于让人自己去记编号，出了错也看不出来。
    LaunchedEffect(personId) {
        if (personId != null) {
            runCatching { container.personRepository.detail(personId).value }
                .onSuccess { person = it }
        }
    }

    /** 本地暂存名与后台命名同一格式：日期时间开头，谁的文件一眼按时间排出来 */
    fun newPhotoFile(at: Long): File {
        val dir = File(context.cacheDir, "captures").apply { mkdirs() }
        return File(dir, "IMG_${DateText.fileStamp(at)}.jpg")
    }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) message = CapMessage("照片已就绪，可预览后上传", CapLevel.OK)
    }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) {
            // 复制到应用私有目录：SAF 给的权限可能只在本次会话有效，
            // 直接拿 URI 入队，过一会儿再上传就会读不到
            runCatching {
                // 相册里的老照片要按**当时拍的时刻**命名，而不是「今天导入的时刻」；
                // 取不到 DATE_TAKEN（部分来源不提供）就退回当前时间
                val at = readTakenAt(context, uri) ?: System.currentTimeMillis()
                val file = newPhotoFile(at)
                context.contentResolver.openInputStream(uri)?.use { input ->
                    file.outputStream().use { output -> input.copyTo(output) }
                }
                photoFile = file
                capturedAt = at
                message = CapMessage("已选择图片，可预览后上传", CapLevel.OK)
            }.onFailure { message = CapMessage("读取所选图片失败：${it.message}", CapLevel.ERROR) }
        }
    }

    fun beginCapture() {
        // 拍照时间取「按下拍照键」的时刻：相机 App 写盘时间比它晚不了几秒，
        // 而这已经是拿到 EXIF 之前最准的一刻（不为了几秒去引一个 EXIF 解析库）
        val at = System.currentTimeMillis()
        val file = newPhotoFile(at)
        photoFile = file
        capturedAt = at
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        takePicture.launch(uri)
    }

    fun startUpload() {
        val file = photoFile ?: return
        val linked = person
        if (linked == null) {
            message = CapMessage("请先选择这张照片要挂到谁身上", CapLevel.ERROR)
            return
        }
        if (!FileRepository.isAllowed(file.name)) {
            message = CapMessage("仅支持 PDF / JPG / JPEG / PNG / WEBP", CapLevel.ERROR)
            return
        }
        val at = capturedAt ?: file.lastModified().takeIf { it > 0 } ?: System.currentTimeMillis()
        uploading = true
        scope.launch {
            try {
                container.fileRepository.upload(
                    file = file,
                    bizType = BIZ_TYPE_PERSON,
                    bizId = linked.id,
                    capturedAt = at,
                )
                file.delete()
                photoFile = null
                capturedAt = null
                message = CapMessage("已上传，并关联到「${linked.name}」", CapLevel.OK)
            } catch (e: Exception) {
                if (e.isNetworkProblem()) {
                    // 网络问题才入队；业务错误（如权限不足）当场告诉用户，排队重试没意义。
                    // 归属与拍照时间要一起入队——否则补传上去的就是对不上人的孤儿照片。
                    container.queue.enqueue(
                        QueuedOp(
                            type = OpType.UPLOAD_FILE,
                            label = "上传现场照片 ${file.name}",
                            localFile = file.absolutePath,
                            refId = linked.id,
                            bizType = BIZ_TYPE_PERSON,
                            capturedAt = at,
                        )
                    )
                    photoFile = null
                    capturedAt = null
                    message = CapMessage(
                        "当前无网络，照片已暂存本机（队列 $pendingOps 条），联网后自动上传并关联到「${linked.name}」",
                        CapLevel.WARN,
                    )
                } else {
                    message = CapMessage(e.toUserMessage(), CapLevel.ERROR)
                }
            } finally {
                uploading = false
            }
        }
    }

    Scaffold(topBar = { AppTopBar(title = "拍照留痕", onBack = onBack) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            // 关联人员在最前面：先确定「拍的是谁」，再去拍。
            // 反过来（先拍再想挂给谁）在走访现场很容易拍完就忘了选
            SectionCard(title = "关联人员") {
                val linked = person
                if (linked == null) {
                    Text(
                        "还没有选人。现场照片要挂到具体的人身上，才能在这个人的详情里查到。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = tokens.ink3,
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(
                        onClick = { pickerOpen = true },
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                    ) {
                        Icon(Icons.Filled.Person, contentDescription = null)
                        Text("  选择人员")
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                linked.name,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = tokens.ink,
                            )
                            Text(
                                listOfNotNull(
                                    if (linked.gender == "FEMALE") "女" else "男",
                                    (linked.age ?: DateText.ageOf(linked.birthDate))?.let { "$it 岁" },
                                    linked.village?.takeIf { it.isNotBlank() },
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.ink3,
                            )
                        }
                        TextButton(onClick = { pickerOpen = true }) { Text("更换") }
                    }
                }
            }

            SectionCard(title = "拍摄 / 选择照片") {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Filled.PhotoCamera,
                        contentDescription = null,
                        tint = tokens.brand,
                        modifier = Modifier.size(38.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "拍照或从相册选择",
                        style = MaterialTheme.typography.bodyLarge,
                        color = tokens.ink,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "不需要申请相机与存储权限\n照片经系统相机 / 文件选择器授权写入",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.ink3,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = ::beginCapture,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) {
                        Icon(Icons.Filled.PhotoCamera, contentDescription = null)
                        Text("  拍照")
                    }
                    OutlinedButton(
                        onClick = { pickImage.launch("image/*") },
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) {
                        Icon(Icons.Filled.Image, contentDescription = null)
                        Text("  从相册选")
                    }
                }
            }

            photoFile?.let { file ->
                SectionCard(title = "预览") {
                    Box(
                        Modifier.fillMaxWidth().height(260.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        AsyncImage(
                            model = file,
                            contentDescription = "待上传照片",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    // 文件名就是拍照时间，显示出来让用户自己核对「这是不是刚拍的那张」
                    Text(
                        "${file.name}（${file.length() / 1024} KB）",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.ink3,
                    )
                    Spacer(Modifier.height(10.dp))
                    Button(
                        onClick = ::startUpload,
                        enabled = !uploading && person != null,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Text(
                            when {
                                uploading -> "上传中…"
                                person == null -> "请先选择关联人员"
                                else -> "上传到「${person?.name}」"
                            }
                        )
                    }
                }
            }

            // 结果提示按性质换样子：失败必须是红的，入队要跟「缓存数据」用同一种琥珀横幅，
            // 全用绿色会让「上传失败」看起来也像成功了
            message?.let { m ->
                when (m.level) {
                    CapLevel.WARN -> OfflineBanner(m.text)
                    CapLevel.OK -> Text(m.text, style = MaterialTheme.typography.bodyLarge, color = tokens.green)
                    CapLevel.ERROR -> Text(
                        m.text,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            OfflineBanner(
                "上传失败（通常是没信号）时会自动暂存，本地文件与「关联人员」一起保留，联网后自动重传。"
            )

            if (pendingOps > 0) {
                SectionCard(title = "待同步") {
                    Text(
                        "本机有 $pendingOps 条待同步记录，将在有网络时自动上传。",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = {
                            container.syncManager.requestSync()
                            message = CapMessage("已请求同步，请稍后查看「我的 → 待同步记录」", CapLevel.OK)
                        },
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("立即同步") }
                }
            }
        }
    }

    if (pickerOpen) {
        PersonPickerDialog(
            onDismiss = { pickerOpen = false },
            onPick = {
                person = it
                pickerOpen = false
            },
        )
    }
}

/** 归属类型。与后端 file.ts 的 BIZ_TYPES 一致——这里只可能是人员照片 */
private const val BIZ_TYPE_PERSON = "PERSON"

/**
 * 相册图片的原始拍摄时间（MediaStore 的 DATE_TAKEN，毫秒）。
 * 不同来源（云盘、微信保存的照片）可能没有这个字段，取不到就返回 null 由调用方兜底。
 */
private fun readTakenAt(context: Context, uri: Uri): Long? = runCatching {
    context.contentResolver
        .query(uri, arrayOf(MediaStore.Images.Media.DATE_TAKEN), null, null, null)
        ?.use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0).takeIf { it > 0 } else null }
}.getOrNull()

/**
 * 选人弹窗。
 *
 * 为什么不复用 PickerField：候选人是**上千人**，而且必须能按姓名/身份证号/手机号搜——
 * 那是一个走接口的分页查询，不是本地的十几个选项。同一个原因也用在村庄选择上。
 */
@Composable
private fun PersonPickerDialog(
    onDismiss: () -> Unit,
    onPick: (PersonDto) -> Unit,
) {
    val container = LocalAppContainer.current
    val tokens = AppTheme.tokens
    val scope = rememberCoroutineScope()
    var keyword by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<PersonDto>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun search() {
        scope.launch {
            loading = true
            error = null
            runCatching {
                container.personRepository.list(
                    PersonQuery(keyword = keyword.trim(), pageSize = 20)
                ).value.list
            }
                .onSuccess { results = it }
                .onFailure { error = it.toUserMessage() }
            loading = false
        }
    }

    LaunchedEffect(Unit) { search() }

    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(16.dp)) {
                Text("选择关联人员", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = keyword,
                    onValueChange = { keyword = it },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    placeholder = { Text("搜姓名 / 身份证号 / 手机号") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        TextButton(onClick = { search() }) { Text("搜索") }
                    },
                )
                Spacer(Modifier.height(10.dp))
                when {
                    loading -> Box(
                        Modifier.fillMaxWidth().height(120.dp),
                        contentAlignment = Alignment.Center,
                    ) { androidx.compose.material3.CircularProgressIndicator() }

                    error != null -> Box(
                        Modifier.fillMaxWidth().height(120.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    }

                    results.isEmpty() -> Box(
                        Modifier.fillMaxWidth().height(120.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("没有匹配的在册人员", color = tokens.ink3)
                    }

                    else -> androidx.compose.foundation.lazy.LazyColumn(
                        Modifier.height((results.size.coerceIn(1, 6) * 62 + 8).dp)
                    ) {
                        androidx.compose.foundation.lazy.items(results, key = { it.id }) { item ->
                            Column(
                                Modifier
                                    .fillMaxWidth()
                                    .clickableNoRipple(true) { onPick(item) }
                                    .padding(vertical = 9.dp, horizontal = 4.dp),
                            ) {
                                Text(
                                    item.name,
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = tokens.ink,
                                )
                                Text(
                                    listOfNotNull(
                                        if (item.gender == "FEMALE") "女" else "男",
                                        (item.age ?: DateText.ageOf(item.birthDate))?.let { "$it 岁" },
                                        item.village?.takeIf { it.isNotBlank() },
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = tokens.ink3,
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) { Text("取消") }
                }
            }
        }
    }
}
