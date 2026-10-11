<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">网格管理</h2>
        <div class="vp-page-subtitle">
          {{ dimension === 'grid' ? `共 ${total} 个网格` : `共 ${villageList.length} 个村庄` }}
        </div>
      </div>
      <el-button v-if="dimension === 'grid' && auth.hasPermission('grid:manage')" type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>新增网格
      </el-button>
    </div>

    <div class="vp-container">
      <div class="vp-search-bar">
        <el-radio-group v-model="dimension" @change="onDimensionChange">
          <el-radio-button value="grid">按网格</el-radio-button>
          <el-radio-button value="village">按小村庄</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="query.keyword"
          :placeholder="dimension === 'grid' ? '搜索网格名称 / 编号' : '搜索村庄名称'"
          clearable style="width: 240px" @keyup.enter="doSearch" @clear="doSearch"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="doSearch">查询</el-button>
        <span class="dim-hint">
          {{ dimension === 'grid' ? '按网格统计在册人口与家庭' : '村庄取自人员档案的「所属村庄」字段，如艾园村、仓门口村' }}
        </span>
      </div>

      <!-- 网格维度 -->
      <div v-if="dimension === 'grid'" class="grid-cards">
        <div v-for="g in list" :key="g.id" class="grid-card">
          <div class="grid-head">
            <div class="grid-icon"><el-icon><Grid /></el-icon></div>
            <div class="grid-title">
              <div class="name">{{ g.name }}</div>
              <div class="no">{{ g.grid_no }}</div>
            </div>
            <el-tag size="small" :type="g.status ? 'success' : 'info'">{{ g.status ? '启用' : '停用' }}</el-tag>
          </div>
          <div class="grid-meta">
            <div class="meta-item"><div class="num">{{ g.person_count }}</div><div class="lbl">人口</div></div>
            <div class="meta-item"><div class="num">{{ g.family_count }}</div><div class="lbl">家庭</div></div>
          </div>
          <div class="focus-grid">
            <div v-for="m in focusMetrics" :key="m.key" class="focus-item" :title="m.label">
              <span class="fi-num">{{ g[m.key] ?? 0 }}</span>
              <span class="fi-lbl">{{ m.label }}</span>
            </div>
          </div>
          <div class="grid-foot">
            <span>负责人：{{ g.manager || '—' }}</span>
            <div class="foot-actions">
              <el-button link type="primary" size="small" @click="viewPersons({ gridId: g.id })">人员</el-button>
              <el-button v-if="auth.hasPermission('grid:manage')" link type="primary" size="small" @click="openEdit(g)">编辑</el-button>
              <el-button
                v-if="auth.hasPermission('grid:manage')"
                link type="danger" size="small" @click="removeGrid(g)"
              >删除</el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 村庄维度 -->
      <div v-else class="grid-cards">
        <div v-for="v in villageList" :key="v.name" class="grid-card">
          <div class="grid-head">
            <div class="grid-icon is-village"><el-icon><HomeFilled /></el-icon></div>
            <div class="grid-title">
              <div class="name">{{ v.name }}</div>
              <div class="no">{{ v.grid_names || '未关联网格' }}</div>
            </div>
          </div>
          <div class="grid-meta">
            <div class="meta-item"><div class="num">{{ v.person_count }}</div><div class="lbl">人口</div></div>
            <div class="meta-item"><div class="num">{{ v.family_count }}</div><div class="lbl">家庭</div></div>
          </div>
          <div class="focus-grid">
            <div v-for="m in focusMetrics" :key="m.key" class="focus-item" :title="m.label">
              <span class="fi-num">{{ v[m.key] ?? 0 }}</span>
              <span class="fi-lbl">{{ m.label }}</span>
            </div>
          </div>
          <div class="grid-foot">
            <span>村庄</span>
            <div class="foot-actions">
              <el-button link type="primary" size="small" @click="viewPersons({ village: v.name })">人员</el-button>
            </div>
          </div>
        </div>
      </div>

      <el-empty v-if="!currentList.length && !loading" :description="dimension === 'grid' ? '暂无网格' : '暂无村庄数据（人员档案中「所属村庄」为空）'" />

      <div v-if="dimension === 'grid'" class="pagination">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" layout="total, prev, pager, next" @current-change="load" />
      </div>
    </div>

    <el-dialog v-model="formVisible" :title="form.id ? '编辑网格' : '新增网格'" width="480px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="网格编号" required><el-input v-model="form.gridNo" /></el-form-item>
        <el-form-item label="网格名称" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="负责人"><el-input v-model="form.manager" /></el-form-item>
        <el-form-item label="网格员"><el-input v-model="form.staff" placeholder="多个用逗号分隔" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { gridApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const loading = ref(false);
const saving = ref(false);
const list = ref<any[]>([]);
const villageList = ref<any[]>([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 12, keyword: '' });
/** 统计维度：grid=按网格，village=按小村庄 */
const dimension = ref<'grid' | 'village'>('grid');
const formVisible = ref(false);
const form = reactive<any>({ id: null, gridNo: '', name: '', manager: '', staff: '', description: '' });

/** 重点人群指标（字段与后端 grid.ts / FOCUS_TAGS 对应） */
const focusMetrics = [
  { key: 'party_count', label: '党员' },
  { key: 'disabled_count', label: '残疾' },
  { key: 'extreme_poverty_count', label: '五保' },
  { key: 'low_income_count', label: '低保' },
  { key: 'veteran_count', label: '退役' },
  { key: 'preferential_count', label: '优抚' },
];
const currentList = computed(() => (dimension.value === 'grid' ? list.value : villageList.value));

async function load() {
  if (dimension.value === 'village') return loadVillages();
  loading.value = true;
  try {
    const res = await gridApi.list({ ...query });
    list.value = res.data.list;
    total.value = res.data.total;
  } finally { loading.value = false; }
}

async function loadVillages() {
  loading.value = true;
  try {
    const res: any = await gridApi.villages({ keyword: query.keyword });
    villageList.value = res.data.list;
    total.value = res.data.total;
  } finally { loading.value = false; }
}

function onDimensionChange() {
  query.page = 1;
  load();
}
function doSearch() { query.page = 1; load(); }

/** 跳转到人员列表并带入网格 / 村庄筛选 */
function viewPersons(params: { gridId?: number; village?: string }) {
  router.push({ path: '/persons', query: params as any });
}
function openCreate() { Object.assign(form, { id: null, gridNo: '', name: '', manager: '', staff: '', description: '' }); formVisible.value = true; }
function openEdit(g: any) { Object.assign(form, { id: g.id, gridNo: g.grid_no, name: g.name, manager: g.manager || '', staff: g.staff || '', description: g.description || '' }); formVisible.value = true; }

/** 删除网格（物理删除，不可恢复；网格下仍有在册人员/家庭时后端会拒绝） */
async function removeGrid(g: any) {
  try {
    await ElMessageBox.confirm(
      `将删除网格「${g.name}」。若网格下仍有在册人员或家庭，需先转移或删除后才能删除网格。是否继续？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch { return; }
  try {
    await gridApi.remove(g.id);
    ElMessage.success('网格已删除');
    load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败');
  }
}
async function saveForm() {
  if (!form.gridNo || !form.name) { ElMessage.warning('请填写编号和名称'); return; }
  saving.value = true;
  try {
    if (form.id) await gridApi.update(form.id, form);
    else await gridApi.create(form);
    ElMessage.success('保存成功');
    formVisible.value = false;
    load();
  } finally { saving.value = false; }
}

onMounted(load);
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.grid-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.grid-card { background: var(--color-bg-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-card); padding: 20px; transition: box-shadow var(--transition-base); }
.grid-card:hover { box-shadow: var(--shadow-hover); }
.grid-head { display: flex; align-items: center; gap: 12px; }
.grid-icon { width: 40px; height: 40px; border-radius: 12px; background: var(--color-purple-light); color: var(--color-purple); display: flex; align-items: center; justify-content: center; }
.grid-title { flex: 1; }
.grid-title .name { font-weight: 600; }
.grid-title .no { font-size: 12px; color: var(--color-text-secondary); }
.grid-meta { display: flex; gap: 32px; margin: 16px 0 12px; }
.meta-item .num { font-size: 22px; font-weight: 700; }
.meta-item .lbl { font-size: 12px; color: var(--color-text-secondary); }
/* 重点人群：6 个指标均分两行，空白处也能铺满卡片 */
.focus-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.focus-item { display: flex; align-items: baseline; gap: 4px; background: var(--color-bg-subtle); border-radius: var(--radius-button); padding: 6px 8px; }
.fi-num { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.fi-lbl { font-size: 12px; color: var(--color-text-secondary); }
.grid-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 13px; color: var(--color-text-secondary); }
.foot-actions { display: flex; align-items: center; gap: 2px; }
.dim-hint { font-size: 12px; color: var(--color-text-secondary); margin-left: auto; }
.grid-icon.is-village { background: var(--color-cyan-light); color: var(--color-cyan); }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
@media (max-width: 768px) { .grid-cards { grid-template-columns: 1fr; } }
</style>
