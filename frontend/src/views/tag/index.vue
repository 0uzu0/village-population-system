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
          <!-- 概览 -->
          <div class="def-summary">
            <div class="ds-item"><span class="ds-num">{{ total }}</span><span class="ds-lbl">标签总数</span></div>
            <div class="ds-item"><span class="ds-num ok">{{ enabledCount }}</span><span class="ds-lbl">启用中</span></div>
            <div class="ds-item"><span class="ds-num muted">{{ total - enabledCount }}</span><span class="ds-lbl">已停用</span></div>
            <div class="ds-item"><span class="ds-num warn">{{ sensitiveCount }}</span><span class="ds-lbl">敏感标签</span></div>
            <div class="ds-item ds-grow"><span class="ds-num">{{ categories.length }}</span><span class="ds-lbl">标签分类</span></div>
          </div>

          <!-- 分类快捷筛选 -->
          <div class="cat-chips">
            <span class="cc-label">分类</span>
            <el-tag :effect="query.categoryId === null ? 'dark' : 'light'" type="primary" class="cc-tag" @click="setCategory(null)">全部</el-tag>
            <el-tag v-for="c in categories" :key="c.id" :effect="query.categoryId === c.id ? 'dark' : 'light'" type="info" class="cc-tag" @click="setCategory(c.id)">
              {{ c.name }}
            </el-tag>
          </div>

          <div class="vp-search-bar">
            <el-input v-model="query.keyword" placeholder="搜索标签名称/编码/别名" clearable style="width: 220px" @keyup.enter="doSearch" @clear="doSearch">
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-select v-model="query.objectType" placeholder="对象类型" clearable style="width: 120px" @change="doSearch">
              <el-option label="个人" value="PERSON" /><el-option label="家庭" value="FAMILY" />
            </el-select>
            <el-select v-model="query.enabled" placeholder="状态" clearable style="width: 110px" @change="doSearch">
              <el-option label="启用" :value="1" /><el-option label="停用" :value="0" />
            </el-select>
            <el-button type="primary" @click="doSearch">查询</el-button>
            <el-button @click="resetDefQuery">重置</el-button>
            <div class="grow" />
            <el-radio-group v-model="viewMode" size="small">
              <el-radio-button value="table">表格</el-radio-button>
              <el-radio-button value="card">卡片</el-radio-button>
            </el-radio-group>
          </div>

          <!-- 表格视图 -->
          <!-- 数据不足一屏时撑满可用区域，避免下方大片空白 -->
          <el-table
            v-if="viewMode === 'table'" :data="list" v-loading="loading" row-key="id"
            class="table-view" :style="{ minHeight: 'calc(100vh - 420px)' }"
          >
            <el-table-column prop="name" label="标签名称" width="150">
              <template #default="{ row }">
                <div class="tag-cell">
                  <TagPill :name="row.name" :color="row.color" dot />
                  <el-tooltip v-if="row.description" :content="row.description" placement="top">
                    <el-icon class="info-icon"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="code" label="编码" width="160" show-overflow-tooltip>
              <template #default="{ row }"><span class="mono">{{ row.code }}</span></template>
            </el-table-column>
            <el-table-column prop="alias" label="别名" width="100">
              <template #default="{ row }">{{ row.alias || '—' }}</template>
            </el-table-column>
            <el-table-column prop="category_name" label="分类" width="110">
              <template #default="{ row }">{{ row.category_name || '—' }}</template>
            </el-table-column>
            <el-table-column prop="object_type" label="对象" width="70">
              <template #default="{ row }">
                <el-tag size="small" :type="row.object_type === 'PERSON' ? 'primary' : 'success'" effect="plain">
                  {{ row.object_type === 'PERSON' ? '个人' : '家庭' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="使用数" width="90">
              <template #default="{ row }">
                {{ row.object_type === 'PERSON' ? row.person_count : row.family_count }}
                <span class="unit">{{ row.object_type === 'PERSON' ? '人' : '户' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="属性" width="130">
              <template #default="{ row }">
                <el-tag v-if="row.is_sensitive" size="small" type="warning" effect="plain">敏感</el-tag>
                <el-tag v-if="row.need_audit" size="small" type="info" effect="plain">需审核</el-tag>
                <el-tag v-if="row.allow_duplicate" size="small" effect="plain">可重复</el-tag>
                <span v-if="!row.is_sensitive && !row.need_audit && !row.allow_duplicate" class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-switch
                  v-if="auth.hasPermission('tag:manage')"
                  v-model="row.enabled"
                  :active-value="1"
                  :inactive-value="0"
                  size="small"
                  @change="() => toggle(row)"
                />
                <el-tag v-else size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button v-if="auth.hasPermission('tag:manage')" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
                <el-button
                  v-if="auth.hasPermission('tag:manage')"
                  link type="danger" size="small" @click="removeDefinition(row)"
                >删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty description="没有符合条件的标签，可新增或调整筛选条件" :image-size="70" />
            </template>
          </el-table>

          <!-- 卡片视图：按分类分组，一屏看清整套标签体系 -->
          <div v-else v-loading="loading" class="card-view">
            <div v-for="g in groupedList" :key="g.key" class="cv-group">
              <div class="cv-title">
                {{ g.name }}
                <span class="cv-count">{{ g.items.length }}</span>
              </div>
              <div class="cv-items">
                <div v-for="row in g.items" :key="row.id" class="cv-item" :class="{ 'is-off': !row.enabled }">
                  <div class="cvi-head">
                    <TagPill :name="row.name" :color="row.color" dot />
                    <el-tag size="small" effect="plain" :type="row.object_type === 'PERSON' ? 'primary' : 'success'">
                      {{ row.object_type === 'PERSON' ? '个人' : '家庭' }}
                    </el-tag>
                    <el-tag v-if="row.is_sensitive" size="small" type="warning" effect="plain">敏感</el-tag>
                    <el-tag v-if="!row.enabled" size="small" type="info" effect="plain">停用</el-tag>
                  </div>
                  <div class="cvi-code mono">{{ row.code }}</div>
                  <div class="cvi-desc">{{ row.description || '暂无说明' }}</div>
                  <div class="cvi-foot">
                    <span>{{ row.object_type === 'PERSON' ? row.person_count : row.family_count }}{{ row.object_type === 'PERSON' ? ' 人' : ' 户' }}</span>
                    <div v-if="auth.hasPermission('tag:manage')" class="cvi-ops">
                      <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
                      <el-button link :type="row.enabled ? 'warning' : 'success'" size="small" @click="toggle(row)">
                        {{ row.enabled ? '停用' : '启用' }}
                      </el-button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <el-empty v-if="!groupedList.length && !loading" description="没有符合条件的标签，可新增或调整筛选条件" :image-size="70" />
          </div>

          <div class="pagination">
            <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @current-change="load" @size-change="doSearch" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="标签历史" name="history">
          <div class="vp-search-bar">
            <el-select v-model="historyQuery.objectType" placeholder="对象类型" clearable style="width: 120px" @change="doSearchHistory">
              <el-option label="个人" value="PERSON" /><el-option label="家庭" value="FAMILY" />
            </el-select>
            <el-select v-model="historyQuery.action" placeholder="动作" clearable style="width: 120px" @change="doSearchHistory">
              <el-option label="添加" value="ADD" /><el-option label="移除" value="REMOVE" />
              <el-option label="停用" value="DISABLE" /><el-option label="启用" value="ENABLE" />
            </el-select>
            <el-select v-model="historyQuery.tagId" placeholder="标签" clearable filterable style="width: 180px" @change="doSearchHistory">
              <el-option v-for="t in allTags" :key="t.id" :label="t.name" :value="t.id" />
            </el-select>
            <el-button type="primary" @click="doSearchHistory">查询</el-button>
          </div>

          <el-table :data="history" v-loading="historyLoading" row-key="id">
            <el-table-column prop="tag_name" label="标签" width="140" />
            <el-table-column prop="object_type" label="对象类型" width="90">
              <template #default="{ row }">{{ row.object_type === 'PERSON' ? '个人' : '家庭' }}</template>
            </el-table-column>
            <el-table-column prop="object_name" label="对象名称" width="140">
              <template #default="{ row }">{{ row.object_name || `ID ${row.object_id}` }}</template>
            </el-table-column>
            <el-table-column prop="action" label="动作" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.action === 'ADD' ? 'success' : 'warning'">{{ actionLabel(row.action) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="operator_name" label="操作人" width="100">
              <template #default="{ row }">{{ row.operator_name || '—' }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || '—' }}</template>
            </el-table-column>
            <el-table-column prop="created_at" label="时间" width="170">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
          <div class="pagination">
            <el-pagination
              v-model:current-page="historyQuery.page"
              v-model:page-size="historyQuery.pageSize"
              :total="historyTotal"
              layout="total, prev, pager, next"
              @current-change="loadHistory"
            />
          </div>
          <el-empty v-if="!history.length && !historyLoading" description="暂无标签变更记录（为人员/家庭添加或移除标签后会在此显示）" :image-size="60" />
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
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { tagApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import TagPill from '@/components/TagPill.vue';

const auth = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const activeTab = ref('defs');
const list = ref<any[]>([]);
const total = ref(0);
const categories = ref<any[]>([]);
const history = ref<any[]>([]);
const historyLoading = ref(false);
const historyTotal = ref(0);
const allTags = ref<any[]>([]);
const historyQuery = reactive({ page: 1, pageSize: 20, objectType: '', action: '', tagId: null as number | null });

const query = reactive<any>({ page: 1, pageSize: 50, keyword: '', categoryId: null as number | null, objectType: '', enabled: '' });

// 视图模式记忆：表格 / 卡片的选择存入本地，离开页面再回来仍保持上次的选择
const VIEW_MODE_KEY = 'vp:tag:viewMode';
const viewMode = ref<'table' | 'card'>((localStorage.getItem(VIEW_MODE_KEY) as 'table' | 'card') || 'table');
watch(viewMode, (v) => localStorage.setItem(VIEW_MODE_KEY, v));
const formVisible = ref(false);
const form = reactive<any>({ id: null, name: '', code: '', categoryId: null, objectType: 'PERSON', alias: '', color: '#3978F6', description: '', allowDuplicate: 0, isSensitive: 0, needAudit: 0 });

function actionLabel(a: string) { return { ADD: '添加', REMOVE: '移除', DISABLE: '停用', ENABLE: '启用' }[a] || a; }

/** 概览统计：基于当前筛选结果计算 */
const enabledCount = computed(() => list.value.filter((r: any) => r.enabled).length);
const sensitiveCount = computed(() => list.value.filter((r: any) => r.is_sensitive).length);

/** 卡片视图：按分类分组展示 */
const groupedList = computed(() => {
  const map = new Map<string, { key: string; name: string; items: any[] }>();
  for (const r of list.value) {
    const key = String(r.category_id ?? 'none');
    const name = r.category_name || '未分类';
    if (!map.has(key)) map.set(key, { key, name, items: [] });
    map.get(key)!.items.push(r);
  }
  return [...map.values()];
});

function setCategory(id: number | null) { query.categoryId = id; doSearch(); }
function resetDefQuery() {
  Object.assign(query, { page: 1, keyword: '', categoryId: null, objectType: '', enabled: '' });
  load();
}

async function load() {
  loading.value = true;
  try {
    const params: any = { ...query };
    if (params.categoryId === null) delete params.categoryId;
    if (params.enabled === '' || params.enabled === null) delete params.enabled;
    if (!params.objectType) delete params.objectType;
    if (!params.keyword) delete params.keyword;
    const res = await tagApi.definitions(params);
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
/** 删除标签定义（物理删除，不可恢复；已被引用的标签后端会拒绝删除并提示先停用） */
async function removeDefinition(row: any) {
  try {
    await ElMessageBox.confirm(
      `将删除标签「${row.name}」。若该标签已被人员或家庭引用，需先解除引用或停用。是否继续？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch { return; }
  try {
    await tagApi.removeDefinition(row.id);
    ElMessage.success('标签已删除');
    load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败');
  }
}

async function toggle(row: any) {
  await tagApi.toggleDefinition(row.id);
  ElMessage.success(row.enabled ? '已停用' : '已启用');
  load();
}
async function loadHistory() {
  historyLoading.value = true;
  try {
    const res = await tagApi.history({ ...historyQuery });
    history.value = res.data.list || [];
    historyTotal.value = res.data.total || 0;
  } catch {
    history.value = [];
    historyTotal.value = 0;
  } finally { historyLoading.value = false; }
}
function doSearchHistory() { historyQuery.page = 1; loadHistory(); }

function formatTime(v: any) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 切换到「标签历史」时重新加载，避免看到的是进入页面时的旧数据
watch(activeTab, (tab) => { if (tab === 'history') loadHistory(); });

onMounted(async () => {
  load();
  loadHistory();
  const c = await tagApi.categories();
  categories.value = c.data;
  // 历史筛选下拉用的全量标签（不受定义列表分页/筛选影响）
  try {
    const t = await tagApi.definitions({ page: 1, pageSize: 500 });
    allTags.value = t.data?.list || [];
  } catch { allTags.value = []; }
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
.grow { flex: 1; }
.mono { font-family: var(--vp-font-mono, monospace); font-size: 12px; }
.muted { color: var(--color-text-secondary); }
.unit { font-size: 12px; color: var(--color-text-secondary); margin-left: 2px; }

/* 概览 */
.def-summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 14px; }
.ds-item { background: var(--color-bg-subtle); border-radius: var(--radius-button); padding: 12px 14px; }
.ds-num { display: block; font-size: 22px; font-weight: 700; color: var(--color-primary); }
.ds-num.ok { color: #0E7C6B; }
.ds-num.warn { color: #F76B15; }
.ds-num.muted { color: var(--color-text-secondary); }
.ds-lbl { font-size: 13px; color: var(--color-text-secondary); }

/* 分类快捷筛选 */
.cat-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.cc-label { font-size: 13px; color: var(--color-text-secondary); }
.cc-tag { cursor: pointer; }

/* 表格内标签 */
.tag-cell { display: flex; align-items: center; gap: 6px; }
.info-icon { color: var(--color-text-secondary); cursor: help; font-size: 14px; }

/* 卡片视图：内容不足时也撑满可用区域，避免下方大片空白 */
.card-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: calc(100vh - 420px);
}
.cv-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 10px; }
.cv-count { font-size: 12px; font-weight: 400; color: var(--color-text-secondary); margin-left: 6px; }
/* auto-fit：空轨道会塌陷，卡片自动拉伸填满整行宽度（auto-fill 会在右侧留白） */
.cv-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.cv-item {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  padding: 12px;
  transition: all var(--transition-fast);
}
.cv-item:hover { border-color: var(--color-primary); box-shadow: var(--shadow-card); }
.cv-item.is-off { opacity: 0.62; }
.cvi-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.cvi-code { color: var(--color-text-secondary); margin-bottom: 4px; }
.cvi-desc { font-size: 12px; color: var(--color-text-regular); min-height: 32px; flex: 1; }
.cvi-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 12px; color: var(--color-text-secondary); }
.cvi-ops { display: flex; gap: 2px; }

@media (max-width: 1100px) { .def-summary { grid-template-columns: repeat(3, 1fr); } }
</style>
