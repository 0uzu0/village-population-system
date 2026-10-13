<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">专项条口台账</h2>
        <div class="vp-page-subtitle">各条口工作记录与人工 / 机械 / 发票费用管理，支持上传合同 PDF 与发票图片</div>
      </div>
      <div class="header-actions">
        <el-button @click="goStatistics">
          <el-icon><DataAnalysis /></el-icon>统计分析
        </el-button>
      </div>
    </div>

    <div class="vp-container">
      <!-- 筛选栏 -->
      <div class="filter-bar">
        <el-select v-model="filters.category" placeholder="条口" clearable style="width: 140px" @change="onCategoryChange">
          <el-option v-for="c in categories" :key="c.code" :label="c.name" :value="c.code" />
        </el-select>
        <el-select v-model="filters.workType" placeholder="工作类型" clearable style="width: 150px">
          <el-option v-for="w in workTypeOptions" :key="w.code" :label="w.name" :value="w.code" />
        </el-select>
        <el-input v-model="filters.keyword" placeholder="标题 / 地点 / 负责人 / 发票号" clearable style="width: 220px" @keyup.enter="loadData" />
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 260px"
        />
        <el-button type="primary" @click="loadData"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
        <el-button v-if="auth.hasPermission('ledger:manage')" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新增台账
        </el-button>
      </div>

      <!-- 列表 -->
      <el-table :data="rows" v-loading="loading" border stripe class="ledger-table">
        <el-table-column prop="recordDate" label="日期" width="120" />
        <el-table-column prop="categoryName" label="条口" width="110" />
        <el-table-column prop="workTypeName" label="工作类型" width="130" />
        <el-table-column prop="title" label="事项" min-width="180" show-overflow-tooltip />
        <el-table-column prop="location" label="地点" width="140" show-overflow-tooltip />
        <el-table-column prop="gridName" label="网格" width="120" />
        <el-table-column label="人工费" width="110" align="right">
          <template #default="{ row }">{{ money(row.laborCost) }}</template>
        </el-table-column>
        <el-table-column label="机械费" width="110" align="right">
          <template #default="{ row }">{{ money(row.machineryCost) }}</template>
        </el-table-column>
        <el-table-column label="发票费" width="110" align="right">
          <template #default="{ row }">{{ money(row.invoiceCost) }}</template>
        </el-table-column>
        <el-table-column label="合计" width="120" align="right">
          <template #default="{ row }"><b>{{ money(row.totalCost) }}</b></template>
        </el-table-column>
        <el-table-column label="附件" width="70" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.attachmentCount" size="small" type="info">{{ row.attachmentCount }}</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="responsible" label="负责人" width="110" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">查看</el-button>
            <el-button v-if="auth.hasPermission('ledger:manage')" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="auth.hasPermission('ledger:manage')" link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="pager"
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="(p: number) => { page = p; loadData(); }"
      />
    </div>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑台账' : '新增台账'" width="760px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="条口" prop="category">
              <el-select v-model="form.category" placeholder="请选择" style="width: 100%" @change="onFormCategoryChange">
                <el-option v-for="c in categories" :key="c.code" :label="c.name" :value="c.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="工作类型" prop="workType">
              <el-select v-model="form.workType" placeholder="请选择" style="width: 100%">
                <el-option v-for="w in formWorkTypes" :key="w.code" :label="w.name" :value="w.code" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="工作日期" prop="recordDate">
              <el-date-picker v-model="form.recordDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="网格" prop="gridId">
              <el-select v-model="form.gridId" placeholder="可选" clearable filterable style="width: 100%">
                <el-option v-for="g in grids" :key="g.id" :label="g.name" :value="g.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="事项标题" prop="title">
          <el-input v-model="form.title" placeholder="如：新河河道打草" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="地点/河段" prop="location">
              <el-input v-model="form.location" placeholder="如：新河村段" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="负责人" prop="responsible">
              <el-input v-model="form.responsible" placeholder="经办人" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="人工费" prop="laborCost">
              <el-input-number v-model="form.laborCost" :min="0" :precision="2" :step="100" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="机械费" prop="machineryCost">
              <el-input-number v-model="form.machineryCost" :min="0" :precision="2" :step="100" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="发票费" prop="invoiceCost">
              <el-input-number v-model="form.invoiceCost" :min="0" :precision="2" :step="100" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="发票号" prop="invoiceNo">
              <el-input v-model="form.invoiceNo" placeholder="可选" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="工作内容" prop="detail">
          <el-input v-model="form.detail" type="textarea" :rows="3" placeholder="工作明细" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" placeholder="可选" />
        </el-form-item>
        <el-form-item label="附件">
          <AttachmentUploader v-model="form.attachments" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-dialog v-model="detailVisible" title="台账详情" width="720px">
      <el-descriptions v-if="detail" :column="2" border>
        <el-descriptions-item label="条口">{{ detail.categoryName }}</el-descriptions-item>
        <el-descriptions-item label="工作类型">{{ detail.workTypeName }}</el-descriptions-item>
        <el-descriptions-item label="工作日期">{{ detail.recordDate }}</el-descriptions-item>
        <el-descriptions-item label="网格">{{ detail.gridName || '—' }}</el-descriptions-item>
        <el-descriptions-item label="事项标题" :span="2">{{ detail.title }}</el-descriptions-item>
        <el-descriptions-item label="地点/河段">{{ detail.location || '—' }}</el-descriptions-item>
        <el-descriptions-item label="负责人">{{ detail.responsible || '—' }}</el-descriptions-item>
        <el-descriptions-item label="人工费">{{ money(detail.laborCost) }}</el-descriptions-item>
        <el-descriptions-item label="机械费">{{ money(detail.machineryCost) }}</el-descriptions-item>
        <el-descriptions-item label="发票费">{{ money(detail.invoiceCost) }}</el-descriptions-item>
        <el-descriptions-item label="合计"><b>{{ money(detail.totalCost) }}</b></el-descriptions-item>
        <el-descriptions-item label="发票号">{{ detail.invoiceNo || '—' }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{ detail.remark || '—' }}</el-descriptions-item>
        <el-descriptions-item label="工作内容" :span="2">{{ detail.detail || '—' }}</el-descriptions-item>
      </el-descriptions>
      <div v-if="detail?.attachments?.length" class="detail-attachments">
        <div class="da-title">附件（{{ detail.attachments.length }}）</div>
        <div v-for="f in detail.attachments" :key="f.id" class="da-item">
          <el-icon><Document v-if="f.fileType === 'pdf'" /><Picture v-else /></el-icon>
          <span>{{ f.fileName }}</span>
          <el-button link type="primary" size="small" @click="previewFile(f)">预览</el-button>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, Plus, DataAnalysis, Document, Picture } from '@element-plus/icons-vue';
import { ledgerApi, gridApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import request from '@/api/request';
import AttachmentUploader, { type Attachment } from '@/components/AttachmentUploader.vue';

const router = useRouter();
const auth = useAuthStore();

interface Category { code: string; name: string; workTypes: { code: string; name: string }[]; }
const categories = ref<Category[]>([]);
const workTypeOptions = ref<{ code: string; name: string }[]>([]);
const grids = ref<{ id: number; name: string }[]>([]);

const rows = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const dateRange = ref<string[]>([]);

const filters = reactive({ category: '', workType: '', keyword: '' });

function onCategoryChange() {
  filters.workType = '';
  workTypeOptions.value = categories.value.find((c) => c.code === filters.category)?.workTypes || [];
}

async function loadData() {
  loading.value = true;
  try {
    const params: any = {
      page: page.value,
      pageSize: pageSize.value,
      category: filters.category || undefined,
      workType: filters.workType || undefined,
      keyword: filters.keyword || undefined,
      start: dateRange.value?.[0],
      end: dateRange.value?.[1],
    };
    const res: any = await ledgerApi.list(params);
    rows.value = res.data.list;
    total.value = res.data.total;
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  filters.category = '';
  filters.workType = '';
  filters.keyword = '';
  dateRange.value = [];
  workTypeOptions.value = [];
  page.value = 1;
  loadData();
}

function money(n: number) {
  return '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---- 弹窗表单 ----
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const formRef = ref();
const formWorkTypes = ref<{ code: string; name: string }[]>([]);

const emptyForm = () => ({
  category: '', workType: '', recordDate: '', location: '', gridId: null as number | null,
  title: '', detail: '', laborCost: 0, machineryCost: 0, invoiceCost: 0,
  invoiceNo: '', responsible: '', remark: '', attachments: [] as Attachment[],
});
const form = reactive(emptyForm());

const rules = {
  category: [{ required: true, message: '请选择条口', trigger: 'change' }],
  workType: [{ required: true, message: '请选择工作类型', trigger: 'change' }],
  recordDate: [{ required: true, message: '请选择工作日期', trigger: 'change' }],
  title: [{ required: true, message: '请输入事项标题', trigger: 'blur' }],
};

function onFormCategoryChange() {
  form.workType = '';
  formWorkTypes.value = categories.value.find((c) => c.code === form.category)?.workTypes || [];
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, emptyForm());
  formWorkTypes.value = [];
  dialogVisible.value = true;
}

async function openEdit(row: any) {
  editingId.value = row.id;
  const res: any = await ledgerApi.detail(row.id);
  const d = res.data;
  Object.assign(form, {
    category: d.category, workType: d.workType, recordDate: d.recordDate, location: d.location,
    gridId: d.gridId, title: d.title, detail: d.detail, laborCost: d.laborCost, machineryCost: d.machineryCost,
    invoiceCost: d.invoiceCost, invoiceNo: d.invoiceNo, responsible: d.responsible, remark: d.remark,
    attachments: d.attachments || [],
  });
  formWorkTypes.value = categories.value.find((c) => c.code === d.category)?.workTypes || [];
  dialogVisible.value = true;
}

async function save() {
  await formRef.value.validate();
  saving.value = true;
  try {
    const payload = {
      ...form,
      attachmentIds: form.attachments.map((a) => a.id),
    };
    if (editingId.value) {
      await ledgerApi.update(editingId.value, payload);
      ElMessage.success('已更新');
    } else {
      await ledgerApi.create(payload);
      ElMessage.success('已创建');
    }
    dialogVisible.value = false;
    loadData();
  } finally {
    saving.value = false;
  }
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除「${row.title}」？`, '提示', { type: 'warning' });
  await ledgerApi.remove(row.id);
  ElMessage.success('已删除');
  loadData();
}

// ---- 详情 ----
const detailVisible = ref(false);
const detail = ref<any>(null);

async function openDetail(row: any) {
  const res: any = await ledgerApi.detail(row.id);
  detail.value = res.data;
  detailVisible.value = true;
}

async function previewFile(f: Attachment) {
  const resp: any = await request.get(`/files/${f.id}`, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data as Blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function goStatistics() {
  router.push('/ledgers/statistics');
}

onMounted(async () => {
  const meta: any = await ledgerApi.meta();
  categories.value = meta.data;
  const g: any = await gridApi.list({ pageSize: 500 });
  grids.value = g.data.list;
  loadData();
});
</script>

<style scoped>
.header-actions {
  display: flex;
  gap: 8px;
}
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.ledger-table {
  width: 100%;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.detail-attachments {
  margin-top: 16px;
  border-top: 1px solid var(--color-border);
  padding-top: 12px;
}
.da-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  margin-bottom: 8px;
}
.da-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
</style>
