package com.village.population.ui.screens.capture

import android.net.Uri
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
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.village.population.data.local.queue.OpType
import com.village.population.data.local.queue.QueuedOp
import com.village.population.data.repository.FileRepository
import com.village.population.ui.LocalAppContainer
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.SectionCard
import com.village.population.ui.theme.AppTheme
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
 * 两条路径都**不需要申请相机或存储权限**：
 *  · 拍照走系统相机的 ACTION_IMAGE_CAPTURE，把应用私有目录里的临时文件
 *    通过 FileProvider 授权给它（这也是为什么清单里没有 CAMERA 权限）；
 *  · 选图走 SAF，由系统文件选择器把 URI 授权给本应用。
 *
 * 上传失败（通常是没信号）时入离线队列，本地文件先留着，联网后自动重传并删除。
 */
@Composable
fun CaptureScreen(personId: Int?, onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val context = LocalContext.current
    val tokens = AppTheme.tokens
    val pendingOps by container.queue.size.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var photoFile by remember { mutableStateOf<File?>(null) }
    var message by remember { mutableStateOf<CapMessage?>(null) }
    var uploading by remember { mutableStateOf(false) }

    fun newPhotoFile(): File {
        val dir = File(context.cacheDir, "captures").apply { mkdirs() }
        return File(dir, "IMG_${System.currentTimeMillis()}.jpg")
    }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) message = CapMessage("照片已就绪，可预览后上传", CapLevel.OK)
    }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) {
            // 复制到应用私有目录：SAF 给的权限可能只在本次会话有效，
            // 直接拿 URI 入队，过一会儿再上传就会读不到
            runCatching {
                val target = newPhotoFile()
                context.contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use { output -> input.copyTo(output) }
                }
                photoFile = target
                message = CapMessage("已选择图片，可预览后上传", CapLevel.OK)
            }.onFailure { message = CapMessage("读取所选图片失败：${it.message}", CapLevel.ERROR) }
        }
    }

    fun startUpload() {
        val file = photoFile ?: return
        if (!FileRepository.isAllowed(file.name)) {
            message = CapMessage("仅支持 PDF / JPG / JPEG / PNG / WEBP", CapLevel.ERROR)
            return
        }
        uploading = true
        scope.launch {
            try {
                container.fileRepository.upload(file, bizType = personId?.let { "PERSON" }, bizId = personId)
                file.delete()
                photoFile = null
                message = CapMessage("上传成功", CapLevel.OK)
            } catch (e: Exception) {
                if (e.isNetworkProblem()) {
                    // 网络问题才入队；业务错误（如权限不足）当场告诉用户，排队重试没意义
                    container.queue.enqueue(
                        QueuedOp(
                            type = OpType.UPLOAD_FILE,
                            label = "上传现场照片 ${file.name}",
                            localFile = file.absolutePath,
                            refId = personId,
                        )
                    )
                    photoFile = null
                    message = CapMessage(
                        "当前无网络，照片已暂存本机（队列 $pendingOps 条），联网后自动上传",
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
                        onClick = {
                            val file = newPhotoFile()
                            photoFile = file
                            val uri = FileProvider.getUriForFile(
                                context,
                                "${context.packageName}.fileprovider",
                                file,
                            )
                            takePicture.launch(uri)
                        },
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
                if (personId != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "将关联到人员 #$personId",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.ink3,
                    )
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
                    Text(
                        "${file.name}（${file.length() / 1024} KB）",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.ink3,
                    )
                    Spacer(Modifier.height(10.dp))
                    Button(
                        onClick = ::startUpload,
                        enabled = !uploading,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text(if (uploading) "上传中…" else "上传") }
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
                "上传失败（通常是没信号）时会自动暂存，本地文件保留，联网后自动重传。"
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
}
