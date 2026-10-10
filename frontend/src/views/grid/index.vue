<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">网格管理</h2>
        <div class="vp-page-subtitle">共 {{ total }} 个网格</div>
      </div>
      <el-button v-if="auth.hasPermission('grid:manage')" type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>新增网格
      </el-button>
    </div>

    <div class="vp-container">
      <div class="vp-search-bar">
        <el-input v-model="query.keyword" placeholder="搜索网格名称 / 编号" clearable style="width: 240px" @keyup.enter="doSearch" @clear="doSearch">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="doSearch">查询</el-button>
      </div>

      <div class="grid-cards">
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
          <div class="grid-foot">
            <span>负责人：{{ g.manager || '—' }}</span>
            <el-button v-if="auth.hasPermission('grid:manage')" link type="primary" size="small" @click="openEdit(g)">编辑</el-button>
          </div>
        </div>
      </div>
      <el-empty v-if="!list.length && !loading" description="暂无网格" />

      <div class="pagination">
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
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { gridApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 12, keyword: '' });
const formVisible = ref(false);
const form = reactive<any>({ id: null, gridNo: '', name: '', manager: '', staff: '', description: '' });

async function load() {
  loading.value = true;
  try {
    const res = await gridApi.list({ ...query });
    list.value = res.data.list;
    total.value = res.data.total;
  } finally { loading.value = false; }
}
function doSearch() { query.page = 1; load(); }
function openCreate() { Object.assign(form, { id: null, gridNo: '', name: '', manager: '', staff: '', description: '' }); formVisible.value = true; }
function openEdit(g: any) { Object.assign(form, { id: g.id, gridNo: g.grid_no, name: g.name, manager: g.manager || '', staff: g.staff || '', description: g.description || '' }); formVisible.value = true; }
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
.grid-meta { display: flex; gap: 32px; margin: 16px 0; }
.meta-item .num { font-size: 22px; font-weight: 700; }
.meta-item .lbl { font-size: 12px; color: var(--color-text-secondary); }
.grid-foot { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--color-text-secondary); }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
@media (max-width: 768px) { .grid-cards { grid-template-columns: 1fr; } }
</style>
