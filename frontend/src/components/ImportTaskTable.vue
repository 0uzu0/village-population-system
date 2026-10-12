<template>
  <div class="it-wrap">
    <div class="it-head">
      <div class="it-title">{{ title }}</div>
      <el-button link :loading="loading" @click="emit('refresh')">
        <el-icon><Refresh /></el-icon>刷新
      </el-button>
    </div>

    <el-table :data="tasks" v-loading="loading" row-key="id">
      <el-table-column prop="batch_no" label="批次号" min-width="160" show-overflow-tooltip />
      <el-table-column v-if="showType" label="类型" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="taskTypeTag(row.task_type)" effect="plain">
            {{ taskTypeLabel(row.task_type) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="statusTag(row)">{{ statusLabel(row) }}</el-tag>
          <div v-if="isStale(row)" class="it-stale">已超过 10 分钟未结束</div>
        </template>
      </el-table-column>
      <el-table-column prop="total_rows" label="总行数" width="80" />
      <el-table-column prop="success_count" label="成功" width="70" />
      <el-table-column prop="fail_count" label="失败" width="70" />
      <el-table-column label="待核查" width="90">
        <template #default="{ row }">
          <el-button v-if="row.pending_count" link type="warning" size="small" @click="$router.push('/pending')">
            {{ row.pending_count }} 条
          </el-button>
          <span v-else class="it-muted">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="operator_name" label="导入人" min-width="110" />
      <el-table-column prop="created_at" label="导入时间" min-width="160" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.fail_count > 0" link type="primary" size="small" :loading="downloadingId === row.id" @click="downloadErrors(row)">
            下载错误行
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="emptyText" :image-size="60" />
      </template>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { excelApi } from '@/api';
import { taskTypeLabel, taskTypeTag } from '@/utils/importTask';

const props = withDefaults(
  defineProps<{
    tasks: any[];
    loading?: boolean;
    title?: string;
    /** 是否显示「类型」列（人口档案 / 重点人群 / 专项台账）；单一类型的列表可关闭 */
    showType?: boolean;
    emptyText?: string;
  }>(),
  { loading: false, title: '导入任务记录', showType: true, emptyText: '暂无导入任务' }
);
const emit = defineEmits<{ (e: 'refresh'): void }>();

const downloadingId = ref<number | null>(null);

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待处理', RUNNING: '处理中', SUCCESS: '成功', FAILED: '失败', PARTIAL: '部分成功',
};
const STATUS_TAG: Record<string, any> = {
  SUCCESS: 'success', FAILED: 'danger', PARTIAL: 'warning', RUNNING: 'primary', PENDING: 'info',
};

/**
 * 导入为同步执行，正常几秒内结束；若长时间停留在 RUNNING，
 * 多半是进程重启或导入途中报错（后端会自动收敛），此处提前显示「已中断」避免一直转圈。
 */
const STALE_MS = 10 * 60 * 1000;
function isStale(row: any) {
  if (row.status !== 'RUNNING' || !row.created_at) return false;
  const t = new Date(String(row.created_at).replace(/-/g, '/')).getTime();
  return Number.isFinite(t) && Date.now() - t > STALE_MS;
}
function statusLabel(row: any) {
  return isStale(row) ? '已中断' : STATUS_LABEL[row.status] || row.status;
}
function statusTag(row: any): any {
  return isStale(row) ? 'danger' : STATUS_TAG[row.status] || 'info';
}

function saveBlob(data: any, filename: string) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadErrors(row: any) {
  downloadingId.value = row.id;
  try {
    const res: any = await excelApi.downloadErrors(row.id);
    saveBlob(res.data, `import_errors_${row.id}.xlsx`);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '下载失败');
  } finally {
    downloadingId.value = null;
  }
}
</script>

<style scoped>
.it-wrap { margin-top: 24px; }
.it-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.it-title { font-size: var(--font-size-base); font-weight: 600; }
.it-stale { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 2px; }
.it-muted { color: var(--color-text-secondary); }
</style>
