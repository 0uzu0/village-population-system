<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">Excel 导入导出</h2>
        <div class="vp-page-subtitle">批量数据处理 · 校验、预览、错误行下载、任务记录</div>
      </div>
    </div>

    <div class="vp-container">
      <el-tabs v-model="activeTab">
        <!-- 导入 -->
        <el-tab-pane label="数据导入" name="import">
          <div class="import-box">
            <div class="steps">
              <el-steps :active="1" align-center>
                <el-step title="下载模板" description="按标准模板填写数据" />
                <el-step title="上传校验" description="自动校验身份证/网格/家庭" />
                <el-step title="导入结果" description="查看成功失败与错误行" />
              </el-steps>
            </div>
            <div class="import-actions">
              <el-button v-if="auth.hasPermission('excel:import')" @click="downloadTemplate">
                <el-icon><Download /></el-icon>下载导入模板
              </el-button>
              <el-upload
                v-if="auth.hasPermission('excel:import')"
                :show-file-list="false"
                :before-upload="beforeUpload"
                :http-request="doImport"
                accept=".xlsx,.xls"
              >
                <el-button type="primary"><el-icon><Upload /></el-icon>上传并导入</el-button>
              </el-upload>
            </div>
            <el-alert title="导入规则：身份证号自动校验并查重；已存在的档案不会被覆盖；网格/家庭编号须先存在；同一批次禁止重复提交。" type="info" :closable="false" style="margin-top: 16px" />
          </div>

          <div class="card-title" style="margin-top: 24px">导入任务记录</div>
          <el-table :data="tasks" v-loading="loading" @row-click="(row:any)=>viewErrors(row)">
            <el-table-column prop="batch_no" label="批次号" width="160" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }"><el-tag size="small" :type="statusTag(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="total_rows" label="总行数" width="80" />
            <el-table-column prop="success_count" label="成功" width="70" />
            <el-table-column prop="fail_count" label="失败" width="70" />
            <el-table-column prop="operator_name" label="导入人" width="100" />
            <el-table-column prop="created_at" label="导入时间" width="160" />
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button v-if="row.fail_count > 0" link type="primary" size="small" @click.stop="downloadErrors(row)">下载错误行</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!tasks.length && !loading" description="暂无导入任务" :image-size="60" />
        </el-tab-pane>

        <!-- 导出 -->
        <el-tab-pane label="数据导出" name="export">
          <div class="export-box">
            <div class="card-title">导出配置</div>
            <el-form label-width="110px">
              <el-form-item label="导出字段">
                <el-checkbox-group v-model="exportForm.fields">
                  <el-checkbox v-for="f in exportFields" :key="f.key" :value="f.key">{{ f.label }}</el-checkbox>
                </el-checkbox-group>
              </el-form-item>
            </el-form>
            <el-button v-if="auth.hasPermission('excel:export')" type="primary" :loading="exporting" @click="doExport">
              <el-icon><Download /></el-icon>生成导出文件
            </el-button>
          </div>

          <div class="card-title" style="margin-top: 24px">导出任务记录</div>
          <el-table :data="exportTasks" v-loading="exportLoading">
            <el-table-column prop="name" label="任务名称" />
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }"><el-tag size="small" :type="statusTag(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="operator_name" label="操作人" width="100" />
            <el-table-column prop="created_at" label="时间" width="160" />
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button v-if="row.status === 'SUCCESS'" link type="primary" size="small" @click="downloadExport(row)">下载</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!exportTasks.length && !exportLoading" description="暂无导出任务" :image-size="60" />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { excelApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const activeTab = ref('import');
const loading = ref(false);
const exportLoading = ref(false);
const exporting = ref(false);
const tasks = ref<any[]>([]);
const exportTasks = ref<any[]>([]);

const exportFields = [
  { key: 'person_no', label: '人员编号' },
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性别' },
  { key: 'birth_date', label: '出生日期' },
  { key: 'id_card', label: '身份证号' },
  { key: 'phone', label: '手机号' },
  { key: 'hukou_address', label: '户籍地址' },
  { key: 'live_address', label: '实际居住地址' },
  { key: 'grid_name', label: '所属网格' },
  { key: 'family_name', label: '所属家庭' },
  { key: 'status', label: '人员状态' },
];
const exportForm = reactive({ fields: exportFields.map((f) => f.key) });

function statusLabel(s: string) { return { PENDING: '待处理', RUNNING: '处理中', SUCCESS: '成功', FAILED: '失败', PARTIAL: '部分成功' }[s] || s; }
function statusTag(s: string): any { return { SUCCESS: 'success', FAILED: 'danger', PARTIAL: 'warning', RUNNING: 'primary', PENDING: 'info' }[s] || 'info'; }

function beforeUpload(file: File) {
  const ok = /\.(xlsx|xls)$/i.test(file.name);
  if (!ok) ElMessage.error('仅支持 .xlsx / .xls 文件');
  return ok;
}

async function doImport(options: any) {
  const fd = new FormData();
  fd.append('file', options.file);
  fd.append('batchNo', `IMP${Date.now()}`);
  loading.value = true;
  try {
    const res: any = await excelApi.import(fd);
    ElMessage.success(`导入完成：成功 ${res.data.success} 条，失败 ${res.data.fail} 条`);
    loadTasks();
  } catch (e) {
    // 错误已提示
  } finally {
    loading.value = false;
  }
}

async function downloadTemplate() {
  const res: any = await excelApi.template();
  const blob = new Blob([res.data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'population_import_template.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

async function loadTasks() {
  loading.value = true;
  try {
    const res = await excelApi.importTasks({ page: 1, pageSize: 50 });
    tasks.value = res.data.list;
  } finally { loading.value = false; }
}

async function viewErrors(row: any) {
  if (row.fail_count > 0) {
    const res = await excelApi.importErrors(row.id);
    // 简单弹窗展示
    ElMessage.info(`批次 ${row.batch_no} 失败 ${row.fail_count} 行，可下载错误行查看详情`);
  }
}

async function downloadErrors(row: any) {
  const res: any = await excelApi.downloadErrors(row.id);
  const blob = new Blob([res.data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `import_errors_${row.id}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

async function doExport() {
  exporting.value = true;
  try {
    const res: any = await excelApi.export({ ...exportForm });
    ElMessage.success(`导出完成，共 ${res.data.total} 条`);
    loadExportTasks();
  } finally { exporting.value = false; }
}

async function loadExportTasks() {
  exportLoading.value = true;
  try {
    const res = await excelApi.exportTasks();
    exportTasks.value = res.data;
  } finally { exportLoading.value = false; }
}

async function downloadExport(row: any) {
  const res: any = await excelApi.downloadExport(row.id);
  const blob = new Blob([res.data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `population_export_${row.id}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

onMounted(() => {
  loadTasks();
  loadExportTasks();
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.card-title { font-size: 15px; font-weight: 600; margin-bottom: 14px; }
.import-box { padding: 8px 0; }
.steps { margin-bottom: 20px; }
.import-actions { display: flex; gap: 12px; align-items: center; }
.export-box { padding: 4px 0; }
</style>
