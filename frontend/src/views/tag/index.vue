<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">人口标签</h2>
        <div class="vp-page-subtitle">标签体系支持配置扩展，是系统业务核心</div>
      </div>
      <el-button v-if="auth.hasPermission('tag:manage')" type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>新增标签
      </el-button>
    </div>

    <div class="vp-container">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="标签定义" name="defs">
          <div class="vp-search-bar">
            <el-input v-model="query.keyword" placeholder="搜索标签名称/编码/别名" clearable style="width: 220px" @keyup.enter="doSearch" @clear="doSearch" />
            <el-select v-model="query.categoryId" placeholder="分类" clearable filterable style="width: 150px" @change="doSearch">
              <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <el-select v-model="query.objectType" placeholder="对象类型" clearable style="width: 120px" @change="doSearch">
              <el-option label="个人" value="PERSON" /><el-option label="家庭" value="FAMILY" />
            </el-select>
            <el-button type="primary" @click="doSearch">查询</el-button>
          </div>

          <el-table :data="list" v-loading="loading" row-key="id">
            <el-table-column prop="name" label="标签名称" width="140">
              <template #default="{ row }">
                <el-tag :color="row.color" style="color: #fff">{{ row.name }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="code" label="编码" width="160" show-overflow-tooltip />
            <el-table-column prop="alias" label="别名" width="100">
              <template #default="{ row }">{{ row.alias || '—' }}</template>
            </el-table-column>
            <el-table-column prop="category_name" label="分类" width="110" />
            <el-table-column prop="object_type" label="对象" width="70">
              <template #default="{ row }">{{ row.object_type === 'PERSON' ? '个人' : '家庭' }}</template>
            </el-table-column>
            <el-table-column label="使用人数" width="90">
              <template #default="{ row }">{{ row.object_type === 'PERSON' ? row.person_count : row.family_count }}</template>
            </el-table-column>
            <el-table-column label="敏感" width="60">
              <template #default="{ row }"><el-tag v-if="row.is_sensitive" size="small" type="warning">敏感</el-tag><span v-else>—</span></template>
            </el-table-column>
            <el-table-column prop="enabled" label="状态" width="70">
              <template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button v-if="auth.hasPermission('tag:manage')" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
                <el-button v-if="auth.hasPermission('tag:manage')" link :type="row.enabled ? 'warning' : 'success'" size="small" @click="toggle(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination">
            <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" layout="total, prev, pager, next" @current-change="load" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="标签历史" name="history">
          <el-table :data="history" v-loading="historyLoading">
            <el-table-column prop="tag_name" label="标签" width="140" />
            <el-table-column prop="object_type" label="对象类型" width="90">
              <template #default="{ row }">{{ row.object_type === 'PERSON' ? '个人' : '家庭' }}</template>
            </el-table-column>
            <el-table-column prop="object_id" label="对象ID" width="90" />
            <el-table-column prop="action" label="动作" width="90">
              <template #default="{ row }">{{ actionLabel(row.action) }}</template>
            </el-table-column>
            <el-table-column prop="operator_name" label="操作人" width="100" />
            <el-table-column prop="created_at" label="时间" width="160" />
          </el-table>
          <el-empty v-if="!history.length && !historyLoading" description="暂无标签变更记录" :image-size="60" />
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 新增/编辑标签 -->
    <el-dialog v-model="formVisible" :title="form.id ? '编辑标签' : '新增标签'" width="560px">
      <el-form :model="form" label-width="100px">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="标签名称" required><el-input v-model="form.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="标签编码" required><el-input v-model="form.code" placeholder="大写字母/数字/下划线" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="所属分类"><el-select v-model="form.categoryId" filterable style="width: 100%"><el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="对象类型"><el-radio-group v-model="form.objectType"><el-radio value="PERSON">个人</el-radio><el-radio value="FAMILY">家庭</el-radio></el-radio-group></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="别名"><el-input v-model="form.alias" placeholder="如 五保户" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="标签颜色"><el-color-picker v-model="form.color" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="标签说明"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="允许重复"><el-switch v-model="form.allowDuplicate" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="敏感标签"><el-switch v-model="form.isSensitive" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="需要审核"><el-switch v-model="form.needAudit" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
        </el-row>
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
import { tagApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const activeTab = ref('defs');
const list = ref<any[]>([]);
const total = ref(0);
const categories = ref<any[]>([]);
const history = ref<any[]>([]);
const historyLoading = ref(false);

const query = reactive({ page: 1, pageSize: 50, keyword: '', categoryId: null as number | null, objectType: '' });
const formVisible = ref(false);
const form = reactive<any>({ id: null, name: '', code: '', categoryId: null, objectType: 'PERSON', alias: '', color: '#3978F6', description: '', allowDuplicate: 0, isSensitive: 0, needAudit: 0 });

function actionLabel(a: string) { return { ADD: '添加', REMOVE: '移除', DISABLE: '停用', ENABLE: '启用' }[a] || a; }

async function load() {
  loading.value = true;
  try {
    const res = await tagApi.definitions({ ...query });
    list.value = res.data.list;
    total.value = res.data.total;
  } finally { loading.value = false; }
}
function doSearch() { query.page = 1; load(); }
function openCreate() { Object.assign(form, { id: null, name: '', code: '', categoryId: categories.value[0]?.id || null, objectType: 'PERSON', alias: '', color: '#3978F6', description: '', allowDuplicate: 0, isSensitive: 0, needAudit: 0 }); formVisible.value = true; }
function openEdit(row: any) { Object.assign(form, { id: row.id, name: row.name, code: row.code, categoryId: row.category_id, objectType: row.object_type, alias: row.alias || '', color: row.color, description: row.description || '', allowDuplicate: row.allow_duplicate, isSensitive: row.is_sensitive, needAudit: row.need_audit }); formVisible.value = true; }
async function saveForm() {
  if (!form.name || !form.code) { ElMessage.warning('请填写名称和编码'); return; }
  saving.value = true;
  try {
    if (form.id) await tagApi.updateDefinition(form.id, form);
    else await tagApi.createDefinition(form);
    ElMessage.success('保存成功');
    formVisible.value = false;
    load();
  } finally { saving.value = false; }
}
async function toggle(row: any) {
  await tagApi.toggleDefinition(row.id);
  ElMessage.success(row.enabled ? '已停用' : '已启用');
  load();
}
async function loadHistory() {
  historyLoading.value = true;
  try {
    const res = await tagApi.history({ page: 1, pageSize: 50 });
    history.value = res.data.list;
  } finally { historyLoading.value = false; }
}

onMounted(async () => {
  load();
  loadHistory();
  const c = await tagApi.categories();
  categories.value = c.data;
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
