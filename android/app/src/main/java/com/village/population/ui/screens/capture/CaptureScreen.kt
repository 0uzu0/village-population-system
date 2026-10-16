package com.village.population.ui.screens.capture

import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.items
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
import coil.request.ImageRequest
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
import com.village.population.ui.theme.AppShapes
import com.village.population.util.DateText
import com.village.population.util.isNetworkProblem
import com.village.population.util.toUserMessage
import kotlinx.coroutines.launch
import java.io.File

/** 提示的三种性质：成功 / 降级（已入队） / 失败。分开是因为它们该长的样子完全不同 */
private enum class CapLevel { OK, WARN, ERROR }

private data class CapMessage(val text: String, val level: CapLevel)

/**
 * 已经拿到内容的待上传照片。
 *
 * 类型存在的意义是**把「文件」和「它的拍照时间」绑在一起流转**：
 * 分开存两个 state，早晚会有人只改其中一个（比如换了一张图却沿用上一次的时间），
 * 那样的照片会因为名字对不上而在服务器上永远找不到。
 */
private data class PendingPhoto(val file: File, val takenAt: Long)

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
    /** 已经拿到内容、可以预览的那张。**只有在照片真的写好了之后才被赋值** */
    var pending by remember { mutableStateOf<PendingPhoto?>(null) }
    /** 相机还没返回结果前，那个正在等着被写入的文件 */
    var staging by remember { mutableStateOf<PendingPhoto?>(null) }
    /** 放大查看预览 */
    var viewing by remember { mutableStateOf(false) }
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

    /**
     * 生成本机暂存文件。
     *
     * ## 目录为什么是 filesDir 而不是 cacheDir
     * 这个文件在无网时会作为离线队列的**附件**挂上好几天等着补传。
     * cacheDir 被设计成「系统可以随时回收」，在系统清理或用户在设置里点一下
     * 「清除缓存」之后就会出现「队列里有记录、文件却没了」——那条记录永远传不上去，
     * 照片等于永久丢失。filesDir 不会被随手请走，代价是要自己记得删（各处都在这么做）。
     *
     * ## 名字为什么一定不重复
     * Coil 对 `File` 的缓存键是**文件路径**。上一版的预览正是栽在这里：
     * `photoFile` 在**按下拍照键的那一刻**就被塞进 state，那时相机还没写盘，
     * Coil 于是对着一个 0 字节的空文件发起加载，结果自然是空白；
     * 等照片真的写好了，`photoFile` 仍是同一个 File 对象，state 没变 →
     * 不重组 → 不重新加载，「拍完照预览是白的」就是这么来的。
     * 现在改成「拿到成功的返回且文件非空才进 state」，并保证每次文件名都不重复，
     * 两道保险各断一条错链：既不会去加载空文件，也不会被上一次的缓存糊弄过去。
     */
    fun newPhotoFile(at: Long): File {
        val dir = File(context.filesDir, "captures").apply { mkdirs() }
        val base = "IMG_${DateText.fileStamp(at)}"
        var f = File(dir, "$base.jpg")
        var n = 2
        while (f.exists()) {
            f = File(dir, "$base-$n.jpg")
            n++
        }
        return f
    }

    /** 丢掉当前这张（连同磁盘上的暂存文件一起），回到「还没照片」的状态 */
    fun discard() {
        pending?.file?.delete()
        pending = null
        viewing = false
    }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val staged = staging ?: return@rememberLauncherForActivityResult
        staging = null
        val file = staged.file
        // 取消时多数相机会留下一个 0 字节的空文件。必须删掉：
        // 留着它就是留了个永远读不出图来的「预览」，用户会以为自己拍成功了
        if (!ok || file.length() <= 0L) {
            file.delete()
            message = if (ok) CapMessage("没有拍到照片，请重新拍摄", CapLevel.ERROR)
            else CapMessage("已取消拍摄", CapLevel.WARN)
            return@rememberLauncherForActivityResult
        }
        // 换掉上一张：旧文件继续占着磁盘是浪费，
        // 更糟的是它和当前这张同名的可能性存在——那样 Coil 会把上一张的画面又显示出来
        pending?.file?.delete()
        pending = staged
        message = CapMessage("照片已就绪，确认后上传", CapLevel.OK)
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
                if (file.length() <= 0L) {
                    file.delete()
                    message = CapMessage("读取所选图片失败：内容为空", CapLevel.ERROR)
                    return@runCatching
                }
                pending?.file?.delete()
                pending = PendingPhoto(file, at)
                message = CapMessage("已选择图片，确认后上传", CapLevel.OK)
            }.onFailure { message = CapMessage("读取所选图片失败：${it.message}", CapLevel.ERROR) }
        }
    }

    fun beginCapture() {
        // 拍照时间取「按下拍照键」的时刻：相机 App 写盘时间比它晚不了几秒，
        // 而这已经是拿到 EXIF 之前最准的一刻（不为了几秒去引一个 EXIF 解析库）
        val staged = PendingPhoto(newPhotoFile(System.currentTimeMillis()), System.currentTimeMillis())
        staging = staged
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", staged.file)
        takePicture.launch(uri)
    }

    fun startUpload() {
        val photo = pending ?: return
        val file = photo.file
        val linked = person
        if (linked == null) {
            message = CapMessage("请先选择这张照片要挂到谁身上", CapLevel.ERROR)
            return
        }
        if (!FileRepository.isAllowed(file.name)) {
            message = CapMessage("仅支持 PDF / JPG / JPEG / PNG / WEBP", CapLevel.ERROR)
            return
        }
        // 拍照时间优先用「真的那一刻」；拿不到才退到文件的最后修改时间。
        // 少退一步（比如直接用 System.currentTimeMillis()）就等于把「哪天去谁家拍的」
        // 改写成「哪天补传的」——离线几天回来补传，这条线索就永久丢了
        val at = photo.takenAt.takeIf { it > 0 } ?: file.lastModified().takeIf { it > 0 } ?: System.currentTimeMillis()
        uploading = true
        scope.launch {
            try {
                container.fileRepository.upload(
                    file = file,
                    bizType = BIZ_TYPE_PERSON,
                    bizId = linked.id,
                    capturedAt = at,
                )
                // 上传成功才删本机暂存：删早了会导致「队列里有记录、文件没了」，
                // 那条记录会永远躺在队列里，照片永久丢失
                file.delete()
                pending = null
                viewing = false
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
                    pending = null
                    viewing = false
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
                        shape = RoundedCornerShape(AppShapes.control),
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
                        shape = RoundedCornerShape(AppShapes.control),
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) {
                        Icon(Icons.Filled.PhotoCamera, contentDescription = null)
                        Text("  拍照")
                    }
                    OutlinedButton(
                        onClick = { pickImage.launch("image/*") },
                        shape = RoundedCornerShape(AppShapes.control),
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) {
                        Icon(Icons.Filled.Image, contentDescription = null)
                        Text("  从相册选")
                    }
                }
            }

            pending?.let { photo ->
                val file = photo.file
                SectionCard(title = "预览") {
                    /**
                     * Coil 对 File 的缓存键默认是**文件路径**。这里靠「文件名不重复」已经断了这条链，
                     * 再把「最后修改时间 + 大小」并进键里加一层保险：万一哪天路径被复用
                     * （同名写入、某些机型把 HEIC 原地转 JPEG），预览也不会停在旧画面上。
                     * 关掉磁盘缓存：本机已经在盘上了，再抄一份进 Coil 的盘缓存纯属浪费。
                     */
                    val request = remember(file, file.length(), file.lastModified()) {
                        ImageRequest.Builder(context)
                            .data(file)
                            .memoryCacheKey("${file.absolutePath}#${file.lastModified()}#${file.length()}")
                            .diskCacheKey(null)
                            .build()
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(260.dp)
                            .clickableNoRipple(true) { viewing = true }
                            .background(tokens.quiet, RoundedCornerShape(10.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        AsyncImage(
                            model = request,
                            contentDescription = "待上传照片",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    // 文件名就是拍照时间，连同具体时刻一起显示：
                    // 「这是不是刚才那张」「时间对不对」只能由用户自己核对——
                    // 一旦后台按错的时间落盘，光从列表里看不出来哪里错了
                    Text(
                        file.name,
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.ink3,
                    )
                    Text(
                        "拍摄 ${DateText.formatTimestamp(photo.takenAt)} · ${file.length() / 1024} KB",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.ink3,
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(
                            onClick = ::discard,
                            shape = RoundedCornerShape(AppShapes.control),
                            modifier = Modifier.height(48.dp),
                        ) { Text("删除重拍") }
                        Button(
                            onClick = ::startUpload,
                            enabled = !uploading && person != null,
                            shape = RoundedCornerShape(AppShapes.control),
                            modifier = Modifier
                                .weight(1f)
                                .height(48.dp),
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
                        shape = RoundedCornerShape(AppShapes.control),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("立即同步") }
                }
            }
        }
    }

    val pendingForViewer = pending
    if (viewing && pendingForViewer != null) {
        PendingPhotoViewer(
            photo = pendingForViewer,
            onDismiss = { viewing = false },
            onDelete = { discard() },
        )
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
 * 待上传照片的放大查看。
 *
 * 除了看图，这一屏还必须能**直接删掉**——「拍糊了」「拍到的是隔壁老王」这类判断
 * 只有在看清原图之后才做得出来，让人退回列表再去找删除按钮是多一次来回。
 */
@Composable
private fun PendingPhotoViewer(
    photo: PendingPhoto,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
) {
    val context = LocalContext.current
    val tokens = AppTheme.tokens
    val file = photo.file
    val request = remember(file) {
        ImageRequest.Builder(context)
            .data(file)
            .memoryCacheKey("${file.absolutePath}#viewer#${file.lastModified()}#${file.length()}")
            .diskCacheKey(null)
            .build()
    }

    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(AppShapes.card), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(12.dp)) {
                AsyncImage(
                    model = request,
                    contentDescription = "待上传照片",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 200.dp, max = 460.dp),
                )
                Spacer(Modifier.height(8.dp))
                Text(file.name, style = MaterialTheme.typography.bodySmall, color = tokens.ink3)
                Text(
                    "拍摄 ${DateText.formatTimestamp(photo.takenAt)} · ${file.length() / 1024} KB",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                )
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    // 本机暂存的照片还没上传，删除只是丢掉一个本地文件，没有不可逆后果，
                    // 所以不需要二次确认；真正的「不可恢复」发生在上传之后（见详情页那一处）
                    TextButton(onClick = onDelete) { Text("删除重拍", color = MaterialTheme.colorScheme.error) }
                    Spacer(Modifier.width(8.dp))
                    TextButton(onClick = onDismiss) { Text("关闭") }
                }
            }
        }
    }
}

/**
 * 相册图片的原始拍摄时间（MediaStore 的 DATE_TAKEN）。
 *
 * `DATE_TAKEN` 的单位历史上是秒、现在多数机型给毫秒，同一张图换个来源也可能不一致
 * （本地相机拍摄 vs 云盘同步、微信转发）。这里统一折算成毫秒后再往下用，
 * 判断逻辑见 `toMillis`。取不到就返回 null，由调用方兜底到「现在」。
 */
private fun readTakenAt(context: Context, uri: Uri): Long? = runCatching {
    context.contentResolver
        .query(uri, arrayOf(MediaStore.Images.Media.DATE_TAKEN), null, null, null)
        ?.use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else null }
}.getOrNull()?.let { toMillis(it) }

/**
 * 把 DATE_TAKEN 统一折算成**毫秒**。
 *
 * `DATE_TAKEN` 的单位在历史上是秒、现在多数机型给毫秒，同一张图换个来源也可能不一致
 * （本地相机拍摄 vs 云盘同步、微信转发）。
 *
 * 这里统一折算成毫秒后再往下用：本机要用这个值给暂存文件命名，
 * 少一位多一位都会被格式化到 1970 年。判据与后端 `normalizeCapturedAt` 完全一致
 * ——10 位及以下按秒处理。
 */
private fun toMillis(raw: Long): Long? = when {
    raw <= 0L -> null
    raw < 100_000_000_000L -> raw * 1000
    else -> raw
}

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
        Surface(shape = RoundedCornerShape(AppShapes.card), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(16.dp)) {
                Text("选择关联人员", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = keyword,
                    onValueChange = { keyword = it },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    placeholder = { Text("搜姓名 / 身份证号 / 手机号") },
                    singleLine = true,
                    shape = RoundedCornerShape(AppShapes.control),
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

                    else -> LazyColumn(
                        Modifier.height((results.size.coerceIn(1, 6) * 62 + 8).dp)
                    ) {
                        items(results, key = { it.id }) { item ->
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
