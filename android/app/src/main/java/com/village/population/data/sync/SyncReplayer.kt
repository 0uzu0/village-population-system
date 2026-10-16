package com.village.population.data.sync

import com.village.population.data.local.queue.OpType
import com.village.population.data.local.queue.QueuedOp
import com.village.population.data.remote.ApiExecutor
import com.village.population.data.remote.ApiService
import com.village.population.data.remote.dto.AddTagRequest
import com.village.population.data.remote.dto.BatchIdsRequest
import com.village.population.data.remote.dto.PersonCreateRequest
import com.village.population.data.repository.FileRepository
import kotlinx.serialization.json.Json
import java.io.File

/**
 * 把离线队列里的一条操作真正执行掉。
 *
 * 单独拆出来的原因：它是**纯逻辑**（只有 api/exec/json 三个依赖，不碰 Android 框架），
 * 因此可以直接写 JVM 单元测试——离线重放这种「平时不会走、出问题就很难查」的路径，
 * 恰恰是最需要测试的地方。
 */
class SyncReplayer(
    private val api: ApiService,
    private val exec: ApiExecutor,
    private val files: FileRepository,
    private val json: Json,
) {

    suspend fun replay(op: QueuedOp) {
        when (op.type) {
            OpType.CREATE_PERSON -> exec.data {
                api.createPerson(json.decodeFromString(PersonCreateRequest.serializer(), op.payload))
            }

            OpType.UPDATE_PERSON -> {
                val id = op.refId ?: return
                exec.data {
                    api.updatePerson(id, json.decodeFromString(PersonCreateRequest.serializer(), op.payload))
                }
            }

            OpType.ADD_PERSON_TAG -> {
                val id = op.refId ?: return
                exec.run {
                    api.addPersonTag(id, json.decodeFromString(AddTagRequest.serializer(), op.payload))
                }
            }

            // 待核查：入队时只存了 ids（与批量接口同一个结构），逐条重放
            OpType.PENDING_IGNORE -> {
                val ids = json.decodeFromString(BatchIdsRequest.serializer(), op.payload).ids
                for (id in ids) exec.run { api.ignorePending(id) }
            }

            OpType.PENDING_CONFIRM -> {
                val ids = json.decodeFromString(BatchIdsRequest.serializer(), op.payload).ids
                for (id in ids) exec.run { api.confirmPending(id) }
            }

            // 拍照留痕：本地文件还在就传，已经被清理掉就当作完成，避免队列永远清不空。
            //
            // **必须把 bizType/bizId/capturedAt 一起带上**。这里曾经只调 files.upload(file)，
            // 结果所有「断网时拍的照片」在联网补传后都成了没有归属的孤儿附件：
            // 用户在前台按人查照片，一张都看不到；而且时间戳变成了补传时刻，
            // 「哪天去谁家拍的」也一起丢了。这三个字段是这次修复的核心，不要精简掉。
            OpType.UPLOAD_FILE -> {
                val path = op.localFile ?: return
                val file = File(path)
                if (!file.exists()) return
                files.upload(
                    file = file,
                    bizType = op.bizType,
                    bizId = op.refId,
                    capturedAt = op.capturedAt,
                )
            }

            // 未知类型（比如旧版本队列里遗留的）直接当作处理完，不能让它卡住后面的操作
            else -> Unit
        }
    }
}
