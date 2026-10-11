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
            <el-alert type="info" :closable="false" style="margin-top: 16px">
              <div class="rule-list">
                <div>1. 模板共 12 列，依次为：姓名、性别、出生日期、身份证号、手机号、户籍地址、实际居住地址、所属村庄、网格编号、家庭编号、与户主关系、备用手机号（第 12 列可留空）。</div>
                <div>2. 身份证号自动校验并查重；已存在的档案不会被覆盖；网格/家庭编号须先在系统中建好。</div>
                <div>3. <b>身份证号为空或非法的行不会进入正式档案</b>，会转入「待核查人员」列表，补录确认后再入库。</div>
                <div>4. 同一批次号禁止重复提交。</div>
              </div>
            </el-alert>
          </div>

          <div class="section-head">
            <div class="card-title">导入任务记录</div>
            <el-button link :loading="loading" @click="loadTasks">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
          </div>
          <el-table :data="tasks" v-loading="loading">
            <el-table-column prop="batch_no" label="批次号" min-width="160" show-overflow-tooltip />
            <el-table-column label="类型" width="104">
              <template #default="{ row }">
                <el-tag size="small" :type="row.task_type === 'KEY_GROUP' ? 'warning' : 'info'" effect="plain">
                  {{ row.task_type === 'KEY_GROUP' ? '重点人群' : '人口档案' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="importStatusTag(row)">{{ importStatusLabel(row) }}</el-tag>
                <div v-if="isStale(row)" class="stale-tip">已超过 10 分钟未结束</div>
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
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="operator_name" label="导入人" min-width="110" />
            <el-table-column prop="created_at" label="导入时间" min-width="160" />
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button v-if="row.fail_count > 0" link type="primary" size="small" @click="downloadErrors(row)">下载错误行</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!tasks.length && !loading" description="暂无导入任务" :image-size="60" />
        </el-tab-pane>

        <!-- 重点人群名单导入 -->
        <el-tab-pane label="重点人群名单导入" name="keygroup">
          <div class="import-box">
            <div class="steps">
              <el-steps :active="1" align-center>
                <el-step title="下载名单模板" description="5 列：姓名/身份证号/人员类别/依据/生效日期" />
                <el-step title="匹配人员" description="按身份证号定位已有档案" />
                <el-step title="批量打标签" description="党员、退役、优抚、低保、五保、残疾等" />
              </el-steps>
            </div>

            <div class="kg-config">
              <div class="kg-field">
                <span class="kg-label">默认类别</span>
                <el-select v-model="kgForm.defaultCode" placeholder="整张表都是同一类别时可在此指定" clearable filterable style="width: 200px">
                  <el-option v-for="t in kgTypes" :key="t.code" :label="t.label" :value="t.code" />
                </el-select>
              </div>
              <div class="kg-field">
                <span class="kg-label">生效方式</span>
                <el-radio-group v-model="kgForm.applyMode">
                  <el-radio value="ACTIVE">直接生效</el-radio>
                  <el-radio value="AUDIT">敏感标签待审核</el-radio>
                </el-radio-group>
              </div>
            </div>

            <div class="import-actions">
              <el-button v-if="auth.hasPermission('excel:import')" @click="downloadKeyGroupTemplate">
                <el-icon><Download /></el-icon>下载名单模板
              </el-button>
              <el-upload
                v-if="auth.hasPermission('excel:import')"
                :show-file-list="false"
                :before-upload="beforeUpload"
                :http-request="doImportKeyGroup"
                accept=".xlsx,.xls"
              >
                <el-button type="primary"><el-icon><Upload /></el-icon>上传并打标签</el-button>
              </el-upload>
            </div>

            <el-alert type="info" :closable="false" style="margin-top: 16px">
              <div class="rule-list">
                <div>1. 模板共 5 列：<b>姓名、身份证号、人员类别、依据/备注、生效日期</b>（后两列可留空）。</div>
                <div>2. 人员类别可写：{{ kgTypeText }}；也可直接写标签编码（如 VETERAN）。多个类别用逗号分隔。</div>
                <div>3. <b>本导入不新建人员</b>，只按身份证号匹配已有档案并打标签；未匹配到的行会报错并可下载错误行。</div>
                <div>4. 身份证号留空时按姓名匹配，姓名在系统中不唯一会要求补填身份证号，避免张冠李戴。</div>
                <div>5. 已存在的标签自动跳过，不会重复关联；敏感标签（优抚/低保/五保/残疾）默认直接生效，可改为「待审核」。</div>
              </div>
            </el-alert>

            <div v-if="kgResult" class="kg-result">
              <div class="kg-result-title">
                最近一次导入结果
                <el-tag size="small" :type="kgResult.status === 'SUCCESS' ? 'success' : (kgResult.status === 'FAILED' ? 'danger' : 'warning')">
                  {{ kgResult.status === 'SUCCESS' ? '全部成功' : (kgResult.status === 'FAILED' ? '导入失败' : '部分成功') }}
                </el-tag>
              </div>
              <div class="kg-stats">
                <div class="kgs-item"><span class="num">{{ kgResult.total }}</span><span class="lbl">名单行数</span></div>
                <div class="kgs-item"><span class="num">{{ kgResult.matched }}</span><span class="lbl">匹配到人员</span></div>
                <div class="kgs-item is-ok"><span class="num">{{ kgResult.tagged }}</span><span class="lbl">新增标签</span></div>
                <div class="kgs-item"><span class="num">{{ kgResult.skipped }}</span><span class="lbl">已存在跳过</span></div>
                <div class="kgs-item is-bad"><span class="num">{{ kgResult.fail }}</span><span class="lbl">未匹配/失败</span></div>
              </div>
              <div class="kg-result-ops">
                <el-button v-if="kgResult.fail" link type="primary" size="small" @click="downloadErrors({ id: kgResult.taskId })">下载错误行</el-button>
                <el-button link type="primary" size="small" @click="$router.push('/persons')">查看人员档案</el-button>
                <el-button link type="primary" size="small" @click="$router.push('/key-groups')">查看重点人群</el-button>
              </div>
            </div>
          </div>
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
import { ref, reactive, computed, onMounted } from 'vue';
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
  { key: 'phone_backup', label: '备用手机号' },
  { key: 'hukou_address', label: '户籍地址' },
  { key: 'live_address', label: '实际居住地址' },
  { key: 'grid_name', label: '所属网格' },
  { key: 'family_name', label: '所属家庭' },
  { key: 'status', label: '人员状态' },
];
const exportForm = reactive({ fields: exportFields.map((f) => f.key) });

const STATUS_LABEL: Record<string, string> = { PENDING: '待处理', RUNNING: '处理中', SUCCESS: '成功', FAILED: '失败', PARTIAL: '部分成功' };
const STATUS_TAG: Record<string, any> = { SUCCESS: 'success', FAILED: 'danger', PARTIAL: 'warning', RUNNING: 'primary', PENDING: 'info' };
function statusLabel(s: string) { return STATUS_LABEL[s] || s; }
function statusTag(s: string): any { return STATUS_TAG[s] || 'info'; }

/**
 * 导入是同步执行，正常几秒内结束；若长时间停留在 RUNNING，
 * 多半是进程重启或导入途中报错（后端会自动收敛），此处提前显示「已中断」避免一直转圈。
 */
const STALE_MS = 10 * 60 * 1000;
function isStale(row: any) {
  if (row.status !== 'RUNNING' || !row.created_at) return false;
  const t = new Date(String(row.created_at).replace(/-/g, '/')).getTime();
  return Number.isFinite(t) && Date.now() - t > STALE_MS;
}
/** 导入任务状态文案：卡住的任务按失败展示 */
function importStatusLabel(row: any) {
  if (isStale(row)) return '已中断';
  return statusLabel(row.status);
}
function importStatusTag(row: any): any {
  return isStale(row) ? 'danger' : statusTag(row.status);
}

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
    const d = res.data;
    const pendingTip = d.pending ? `，${d.pending} 条转入待核查` : '';
    ElMessage.success({ message: `导入完成：成功 ${d.success} 条，失败 ${d.fail} 条${pendingTip}`, duration: 4000 });
    loadTasks();
  } catch (e) {
    // 错误已由拦截器提示；这里刷新列表，让用户看到该批次被标记为「失败」而不是一直处理中
    loadTasks();
  } finally {
    loading.value = false;
  }
}

/** ===== 重点人群名单导入 ===== */
const kgTypes = ref<any[]>([]);
const kgForm = reactive({ defaultCode: '', applyMode: 'ACTIVE' });
const kgResult = ref<any>(null);
const kgTypeText = computed(() => kgTypes.value.map((t: any) => t.label).join('、'));

async function loadKgTypes() {
  try {
    const res: any = await excelApi.keyGroupTypes();
    kgTypes.value = res.data;
  } catch { kgTypes.value = []; }
}

async function downloadKeyGroupTemplate() {
  const res: any = await excelApi.keyGroupTemplate();
  const blob = new Blob([res.data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'keygroup_import_template.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

async function doImportKeyGroup(options: any) {
  const fd = new FormData();
  fd.append('file', options.file);
  fd.append('batchNo', `KG${Date.now()}`);
  if (kgForm.defaultCode) fd.append('defaultCode', kgForm.defaultCode);
  fd.append('applyMode', kgForm.applyMode);
  loading.value = true;
  try {
    const res: any = await excelApi.importKeyGroup(fd);
    kgResult.value = res.data;
    const d = res.data;
    ElMessage.success({
      message: `匹配 ${d.matched} 人，新增标签 ${d.tagged} 条${d.skipped ? `，跳过 ${d.skipped} 条` : ''}${d.fail ? `，失败 ${d.fail} 条` : ''}`,
      duration: 4000,
    });
    loadTasks();
  } catch {
    loadTasks();
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
  loadKgTypes();
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.card-title { font-size: var(--font-size-base); font-weight: 600; margin-bottom: 14px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 24px; }
.stale-tip { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 2px; }
.import-box { padding: 8px 0; }
.steps { margin-bottom: 20px; }
.import-actions { display: flex; gap: 12px; align-items: center; }
.export-box { padding: 4px 0; }
.rule-list { line-height: 1.9; font-size: var(--font-size-sm); }
.muted { color: var(--color-text-secondary); }
/* 重点人群导入 */
.kg-config { display: flex; flex-wrap: wrap; gap: 20px; align-items: center; margin-bottom: 14px; }
.kg-field { display: flex; align-items: center; gap: 8px; }
.kg-label { font-size: var(--font-size-sm); color: var(--color-text-regular); }
.kg-result {
  margin-top: 16px; padding: 16px; border: 1px solid var(--color-border);
  border-radius: var(--radius-button); background: var(--color-bg-subtle);
}
.kg-result-title { font-size: var(--font-size-base); font-weight: 600; display: flex; align-items: center; gap: 8px; }
.kg-stats { display: flex; flex-wrap: wrap; gap: 28px; margin: 12px 0; }
.kgs-item { display: flex; flex-direction: column; }
.kgs-item .num { font-size: var(--font-size-lg); font-weight: 700; line-height: 1.2; }
.kgs-item .lbl { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.kgs-item.is-ok .num { color: var(--color-success); }
.kgs-item.is-bad .num { color: var(--color-danger); }
.kg-result-ops { display: flex; gap: 8px; }
</style>
