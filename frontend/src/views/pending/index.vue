<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">待核查人员</h2>
        <div class="vp-page-subtitle">导入时身份证号缺失或非法的记录，补录确认后方可进入正式档案</div>
      </div>
    </div>

    <!-- 概览 -->
    <div class="summary-grid">
      <div class="summary-card" :class="{ active: query.status === '' }" @click="setStatus('')">
        <div class="sv">{{ summary.total ?? 0 }}</div>
        <div class="sl">全部</div>
      </div>
      <div class="summary-card warn" :class="{ active: query.status === 'PENDING' }" @click="setStatus('PENDING')">
        <div class="sv">{{ summary.byStatus?.PENDING ?? 0 }}</div>
        <div class="sl">待核查</div>
      </div>
      <div class="summary-card ok" :class="{ active: query.status === 'RESOLVED' }" @click="setStatus('RESOLVED')">
        <div class="sv">{{ summary.byStatus?.RESOLVED ?? 0 }}</div>
        <div class="sl">已入库</div>
      </div>
      <div class="summary-card muted" :class="{ active: query.status === 'IGNORED' }" @click="setStatus('IGNORED')">
        <div class="sv">{{ summary.byStatus?.IGNORED ?? 0 }}</div>
        <div class="sl">已忽略</div>
      </div>
      <div class="summary-card reason">
        <div class="sv">{{ summary.byReason?.ID_CARD_MISSING ?? 0 }}</div>
        <div class="sl">身份证为空</div>
      </div>
      <div class="summary-card reason">
        <div class="sv">{{ summary.byReason?.ID_CARD_INVALID ?? 0 }}</div>
        <div class="sl">身份证非法</div>
      </div>
    </div>

    <div class="vp-container">
      <div class="vp-search-bar">
        <el-input v-model="query.keyword" placeholder="姓名 / 身份证号 / 手机号" clearable style="width: 220px" @keyup.enter="doSearch" @clear="doSearch">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="query.status" placeholder="状态" style="width: 120px" @change="doSearch">
          <el-option label="全部" value="" />
          <el-option label="待核查" value="PENDING" />
          <el-option label="已入库" value="RESOLVED" />
          <el-option label="已忽略" value="IGNORED" />
        </el-select>
        <el-select v-model="query.reason" placeholder="原因" clearable style="width: 140px" @change="doSearch">
          <el-option label="身份证为空" value="ID_CARD_MISSING" />
          <el-option label="身份证非法" value="ID_CARD_INVALID" />
        </el-select>
        <el-input v-model="query.batchNo" placeholder="批次号" clearable style="width: 170px" @keyup.enter="doSearch" @clear="doSearch" />
        <el-button type="primary" @click="doSearch">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <div class="grow" />
        <el-button v-if="auth.hasPermission('excel:import')" :disabled="!selected.length" @click="batchIgnore">批量忽略</el-button>
        <el-button v-if="auth.hasPermission('excel:import')" type="danger" :disabled="!selected.length" @click="batchDelete">批量删除</el-button>
      </div>

      <el-table :data="list" v-loading="loading" row-key="id" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46" :selectable="(row: any) => row.status !== 'RESOLVED'" />
        <el-table-column prop="name" label="姓名" width="90" />
        <el-table-column label="待核查原因" width="150">
          <template #default="{ row }">
            <el-tooltip :content="row.reason_text || ''" placement="top" :disabled="!row.reason_text">
              <el-tag size="small" :type="row.reason === 'ID_CARD_MISSING' ? 'warning' : 'danger'">
                {{ reasonLabel(row.reason) }}
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="身份证号" width="190">
          <template #default="{ row }">
            <span v-if="row.id_card" class="mono">{{ row.id_card }}</span>
            <span v-else class="empty-val">未填写</span>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" width="130">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column prop="hukou_address" label="户籍地址" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.hukou_address || '—' }}</template>
        </el-table-column>
        <el-table-column prop="batch_no" label="批次 / 行号" width="150">
          <template #default="{ row }">
            <span class="mono">{{ row.batch_no }}</span>
            <span class="row-no">第 {{ row.row_no }} 行</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTag(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">补录</el-button>
            <el-button v-if="row.status !== 'RESOLVED'" link type="success" size="small" @click="confirmRow(row)">确认入库</el-button>
            <el-button v-if="row.status !== 'RESOLVED'" link size="small" @click="ignoreRow(row)">忽略</el-button>
            <el-button link type="danger" size="small" @click="removeRow(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无待核查记录" :image-size="70" />
        </template>
      </el-table>

      <div class="pagination">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @current-change="load" @size-change="doSearch" />
      </div>
    </div>

    <!-- 补录 -->
    <el-dialog v-model="editVisible" title="补录待核查信息" width="620px">
      <el-form :model="form" label-width="100px">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="姓名"><el-input v-model="form.name" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="性别">
              <el-select v-model="form.gender" clearable style="width: 100%">
                <el-option label="男" value="MALE" /><el-option label="女" value="FEMALE" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="身份证号"><el-input v-model="form.idCard" placeholder="补录后校验位会自动校验" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="出生日期"><el-input v-model="form.birthDate" placeholder="YYYY-MM-DD" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="手机号"><el-input v-model="form.phone" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="备用手机号"><el-input v-model="form.phoneBackup" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="户籍地址"><el-input v-model="form.hukouAddress" /></el-form-item>
        <el-form-item label="居住地址"><el-input v-model="form.liveAddress" /></el-form-item>
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="所属村庄"><el-input v-model="form.village" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="网格编号"><el-input v-model="form.gridNo" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="家庭编号"><el-input v-model="form.familyNo" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="与户主关系"><el-input v-model="form.relation" placeholder="户主 / 妻 / 子 …" /></el-form-item>
        <el-form-item label="处理备注"><el-input v-model="form.handleNote" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { pendingApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const summary = ref<any>({});
const selected = ref<any[]>([]);

const query = reactive<any>({ page: 1, pageSize: 20, keyword: '', status: 'PENDING', reason: '', batchNo: '' });

const editVisible = ref(false);
const form = reactive<any>({ id: null });

function reasonLabel(r: string) { return { ID_CARD_MISSING: '身份证为空', ID_CARD_INVALID: '身份证非法' }[r] || r; }
function statusLabel(s: string) { return { PENDING: '待核查', RESOLVED: '已入库', IGNORED: '已忽略' }[s] || s; }
function statusTag(s: string): any { return { PENDING: 'warning', RESOLVED: 'success', IGNORED: 'info' }[s] || 'info'; }

async function load() {
  loading.value = true;
  try {
    const params: any = { ...query };
    if (!params.status) delete params.status;
    if (!params.reason) delete params.reason;
    if (!params.batchNo) delete params.batchNo;
    if (!params.keyword) delete params.keyword;
    const res = await pendingApi.list(params);
    list.value = res.data.list;
    total.value = res.data.total;
  } finally { loading.value = false; }
}
function doSearch() { query.page = 1; load(); }
function setStatus(s: string) { query.status = s; doSearch(); }
function reset() { Object.assign(query, { page: 1, keyword: '', status: '', reason: '', batchNo: '' }); load(); }

function onSelectionChange(rows: any[]) { selected.value = rows; }

function openEdit(row: any) {
  Object.assign(form, {
    id: row.id,
    name: row.name || '',
    gender: row.gender || null,
    idCard: row.id_card || '',
    birthDate: row.birth_date ? String(row.birth_date).slice(0, 10) : '',
    phone: row.phone || '',
    phoneBackup: row.phone_backup || '',
    hukouAddress: row.hukou_address || '',
    liveAddress: row.live_address || '',
    village: row.village || '',
    gridNo: row.grid_no || '',
    familyNo: row.family_no || '',
    relation: row.relation || '',
    handleNote: row.handle_note || '',
  });
  editVisible.value = true;
}
async function saveEdit() {
  saving.value = true;
  try {
    await pendingApi.update(form.id, { ...form });
    ElMessage.success('已保存');
    editVisible.value = false;
    load();
    loadSummary();
  } finally { saving.value = false; }
}

async function confirmRow(row: any) {
  if (!row.id_card) {
    ElMessage.warning('该记录尚无身份证号，请先补录');
    openEdit(row);
    return;
  }
  try {
    await ElMessageBox.confirm(`确认将「${row.name}」写入正式人员档案？`, '确认入库', { type: 'warning', confirmButtonText: '确认入库', cancelButtonText: '取消' });
  } catch { return; }
  await pendingApi.confirm(row.id);
  ElMessage.success('已确认入库');
  load();
  loadSummary();
}

async function ignoreRow(row: any) {
  try {
    await ElMessageBox.confirm(`忽略后将不进入正式档案，可随时在「已忽略」中找回。确认忽略「${row.name}」？`, '忽略确认', { type: 'info', confirmButtonText: '确认忽略', cancelButtonText: '取消' });
  } catch { return; }
  await pendingApi.ignore(row.id);
  ElMessage.success('已忽略');
  load();
  loadSummary();
}

async function batchIgnore() {
  try {
    await ElMessageBox.confirm(`确认忽略选中的 ${selected.value.length} 条记录？`, '批量忽略', { type: 'info' });
  } catch { return; }
  // 一次请求搞定：逐条调用在选了几十条时会打几十个请求，中途失败还会留下半批状态
  const res: any = await pendingApi.batchIgnore(selected.value.map((r) => r.id));
  ElMessage.success(res?.message || '已忽略');
  selected.value = [];
  load();
  loadSummary();
}

async function removeRow(row: any) {
  try {
    await ElMessageBox.confirm(`删除后不可恢复。确认删除「${row.name}」这条待核查记录？`, '删除确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' });
  } catch { return; }
  await pendingApi.remove(row.id);
  ElMessage.success('已删除');
  load();
  loadSummary();
}

async function batchDelete() {
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selected.value.length} 条待核查记录？此操作不可恢复。`, '批量删除', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' });
  } catch { return; }
  await pendingApi.batchDelete(selected.value.map((r) => r.id));
  ElMessage.success('已删除');
  selected.value = [];
  load();
  loadSummary();
}

async function loadSummary() {
  const res = await pendingApi.summary();
  summary.value = res.data;
}

onMounted(() => {
  load();
  loadSummary();
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.summary-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.summary-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 14px 16px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--transition-fast);
}
.summary-card:hover { border-color: var(--color-primary); }
.summary-card.active { border-color: var(--color-primary); background: var(--color-primary-light); }
.summary-card .sv { font-size: var(--font-size-xl); font-weight: 700; color: var(--color-text-primary); }
.summary-card.warn .sv { color: #F76B15; }
.summary-card.ok .sv { color: #0E7C6B; }
.summary-card.muted .sv { color: var(--color-text-secondary); }
.summary-card.reason { cursor: default; }
.summary-card.reason:hover { border-color: transparent; }
.summary-card .sl { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-top: 2px; }
.grow { flex: 1; }
.mono { font-family: var(--vp-font-mono, monospace); font-size: var(--font-size-xs); }
.row-no { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-left: 6px; }
.empty-val { color: #F76B15; }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
@media (max-width: 1100px) { .summary-grid { grid-template-columns: repeat(3, 1fr); } }
</style>
