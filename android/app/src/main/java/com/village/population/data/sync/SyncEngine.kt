package com.village.population.data.sync

import com.village.population.data.local.queue.OfflineQueue
import com.village.population.data.local.queue.QueuedOp
import com.village.population.data.remote.ApiException
import java.io.IOException

/** 一次同步的结果。UI 与 Worker 都按它决定后续动作 */
sealed interface SyncOutcome {
    /** 队列空，没什么可做的 */
    data object NothingToDo : SyncOutcome

    /** 没登录，不处理 */
    data object NotSignedIn : SyncOutcome

    /** 全部/部分处理完成。[exhausted] > 0 表示有记录重试到头了，需要用户手动处理 */
    data class Done(val sent: Int, val exhausted: Int, val shouldRetry: Boolean) : SyncOutcome

    /** 网络仍然不通，本次中止（保留重试次数，等系统再次调度） */
    data class NetworkDown(val sent: Int, val remaining: Int) : SyncOutcome

    /** 登录态失效，停止并通知 UI */
    data class SessionExpired(val sent: Int, val remaining: Int) : SyncOutcome
}

/**
 * 离线队列的执行引擎（纯逻辑，可单元测试）。
 *
 * 处理顺序与失败策略都是有讲究的：
 *  - **先进先出**：同一条走访路线上先采的人先入库，避免出现「家庭成员引用了还没建的人」；
 *  - 网络不通立刻中止整轮（而不是逐条重试到底）：村里信号时有时无，
 *    连续重试只会耗电，不如把剩余次数留给下一次系统调度；
 *  - 业务性失败（身份证重复、校验位错误）标记为「到底了」并不再自动重试——
 *    这类错误重试一万次结果都一样，只会让队列看起来永远同步不完。
 */
class SyncEngine(
    private val queue: OfflineQueue,
    private val replayer: SyncReplayer,
    /**
     * 只依赖一个「取 token」的函数，而不是整个 SessionState。
     * 这样引擎就是纯逻辑，可以在 JVM 上直接测——离线重放这种
     * 「平时不会走、一出问题就难查」的路径，恰恰最需要测试覆盖。
     */
    private val tokenProvider: () -> String?,
) {

    suspend fun run(): SyncOutcome {
        if (tokenProvider().isNullOrBlank()) return SyncOutcome.NotSignedIn

        val ops = queue.all()
        if (ops.isEmpty()) return SyncOutcome.NothingToDo

        var sent = 0
        for (op in ops) {
            if (op.exhausted) continue
            try {
                replayer.replay(op)
                queue.removeWithFile(op)
                sent++
            } catch (e: ApiException) {
                if (e.isUnauthorized) {
                    return SyncOutcome.SessionExpired(sent, queue.count())
                }
                if (e.retryable) {
                    val next = op.copy(attempts = op.attempts + 1, lastError = e.message)
                    queue.update(next)
                } else {
                    // 业务不可恢复：一次到位标记为「重试到底」，保留在列表里让用户看到原因
                    queue.update(op.copy(attempts = QueuedOp.MAX_ATTEMPTS, lastError = e.message))
                }
            } catch (e: IOException) {
                queue.update(op.copy(attempts = op.attempts + 1, lastError = e.message))
                return SyncOutcome.NetworkDown(sent, queue.count())
            }
        }

        val remaining = queue.all()
        return SyncOutcome.Done(
            sent = sent,
            exhausted = remaining.count { it.exhausted },
            shouldRetry = remaining.any { !it.exhausted },
        )
    }
}
