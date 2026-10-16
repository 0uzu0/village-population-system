package com.village.population.data.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.village.population.PopApplication
import java.util.concurrent.TimeUnit

/**
 * 后台同步 Worker。
 *
 * 用 WorkManager 而不是自己起 Service/Foreground：系统会在有网、有电的时候调度，
 * 息屏后还能继续跑，也不需要申请前台服务权限（村级应用没必要在状态栏常驻一个图标）。
 */
class SyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val container = (applicationContext as PopApplication).container
        return when (val outcome = container.syncEngine.run()) {
            is SyncOutcome.Done -> if (outcome.shouldRetry) Result.retry() else Result.success()
            // 网络不通交给 WorkManager 的退避策略重排
            is SyncOutcome.NetworkDown -> Result.retry()
            // 登录态失效不是「失败」：重试也不会好，等用户重新登录后手动触发
            is SyncOutcome.SessionExpired -> Result.success()
            SyncOutcome.NothingToDo -> Result.success()
            SyncOutcome.NotSignedIn -> Result.success()
        }
    }

    companion object {
        const val UNIQUE_ONESHOT = "offline-queue-sync"
        const val UNIQUE_PERIODIC = "offline-queue-sync-periodic"
    }
}

/** 调度器：应用里所有「触发同步」的入口都从这里走，避免重复入队 */
class SyncManager(private val context: Context) {

    private val workManager get() = WorkManager.getInstance(context)

    private val networkConstraint =
        Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** 立即尝试一次（登录后、手动点「立即同步」、提交失败后） */
    fun requestSync() {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(networkConstraint)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        workManager.enqueueUniqueWork(SyncWorker.UNIQUE_ONESHOT, ExistingWorkPolicy.KEEP, request)
    }

    /**
     * 兜底轮询：每 6 小时一次。
     * WorkManager 的周期任务最小间隔是 15 分钟，但同步这种事的真实触发点是
     * 「用户重新打开应用」和「手动点击」，周期任务只用来兜住「装了就没再打开」的情况，
     * 所以间隔取大一些，省电。
     */
    fun schedulePeriodic() {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(6, TimeUnit.HOURS)
            .setConstraints(networkConstraint)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniquePeriodicWork(
            SyncWorker.UNIQUE_PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }
}
