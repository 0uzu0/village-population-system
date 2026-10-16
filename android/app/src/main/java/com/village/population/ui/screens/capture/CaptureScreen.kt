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
import com.village.population.ui.components.SectionCard
import com.village.population.util.isNetworkProblem
import com.village.population.util.toUserMessage
import kotlinx.coroutines.launch
import java.io.File

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
    val pendingOps by container.queue.size.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var photoFile by remember { mutableStateOf<File?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var uploading by remember { mutableStateOf(false) }

    fun newPhotoFile(): File {
        val dir = File(context.cacheDir, "captures").apply { mkdirs() }
        return File(dir, "IMG_${System.currentTimeMillis()}.jpg")
    }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) message = "照片已就绪，可预览后上传"
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
                message = "已选择图片，可预览后上传"
            }.onFailure { message = "读取所选图片失败：${it.message}" }
        }
    }

    fun startUpload() {
        val file = photoFile ?: return
        if (!FileRepository.isAllowed(file.name)) {
            message = "仅支持 PDF / JPG / JPEG / PNG / WEBP"
            return
        }
        uploading = true
        scope.launch {
            try {
                container.fileRepository.upload(file, bizType = personId?.let { "PERSON" }, bizId = personId)
                file.delete()
                photoFile = null
                message = "上传成功"
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
                    message = "当前无网络，照片已暂存本机（队列 $pendingOps 条），联网后自动上传"
                } else {
                    message = e.toUserMessage()
                }
            } finally {
                uploading = false
            }
        }
    }

    Scaffold(topBar = { AppTopBar(title = "拍照留痕", onBack = onBack) }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(title = "拍摄 / 选择照片") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
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
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) {
                        Icon(Icons.Filled.PhotoCamera, contentDescription = null)
                        Text("  拍照")
                    }
                    OutlinedButton(
                        onClick = { pickImage.launch("image/*") },
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
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                        color = MaterialTheme.colorScheme.outline,
                    )
                    Spacer(Modifier.height(10.dp))
                    Button(
                        onClick = ::startUpload,
                        enabled = !uploading,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text(if (uploading) "上传中…" else "上传") }
                }
            }

            message?.let {
                Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.secondary)
            }

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
                            message = "已请求同步，请稍后查看「我的 → 离线数据」"
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("立即同步") }
                }
            }
        }
    }
}
