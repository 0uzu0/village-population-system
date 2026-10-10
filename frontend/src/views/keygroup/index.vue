<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">重点人群</h2>
        <div class="vp-page-subtitle">按标签精准筛查，交集/并集口径清晰可辨</div>
      </div>
      <el-button v-if="auth.hasPermission('keygroup:export')" @click="doExport">
        <el-icon><Download /></el-icon>导出结果
      </el-button>
    </div>

    <!-- 快捷入口 -->
    <div class="vp-container">
      <div class="card-title">常用快捷入口</div>
      <div class="quick-grid">
        <div v-for="g in quick" :key="g.code" class="quick-card" @click="setQuickTag(g.code)">
          <div class="num">{{ g.count }}</div>
          <div class="lbl">{{ g.label }}</div>
        </div>
      </div>
      <div class="note">注：各标签人数存在交叉，不可简单相加</div>
    </div>

    <!-- 筛选条件 -->
    <div class="vp-container">
      <div class="card-title">筛选条件</div>
      <div class="vp-search-bar">
        <el-select v-model="query.tagIds" placeholder="个人标签（可多选）" multiple filterable collapse-tags style="width: 280px">
          <el-option v-for="t in personTags" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
        <el-radio-group v-model="query.tagMode">
          <el-radio-button value="ANY">并集（命中任一）</el-radio-button>
          <el-radio-button value="ALL">交集（全部命中）</el-radio-button>
        </el-radio-group>
        <el-select v-model="query.familyTagIds" placeholder="家庭标签" multiple filterable collapse-tags style="width: 220px">
          <el-option v-for="t in familyTags" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
        <el-select v-model="query.gridId" placeholder="网格" clearable filterable style="width: 130px">
          <el-option v-for="g in grids" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
        <el-input-number v-model="query.minAge" :min="0" :max="150" placeholder="最小年龄" controls-position="right" style="width: 110px" />
        <span class="sep">—</span>
        <el-input-number v-model="query.maxAge" :min="0" :max="150" placeholder="最大年龄" controls-position="right" style="width: 110px" />
        <el-button type="primary" @click="doSearch"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>

      <!-- 当前筛选条件明确展示 -->
      <el-alert v-if="filterSummary" :title="`当前筛选：${filterSummary}`" type="info" :closable="false" style="margin-top: 8px" />
    </div>

    <!-- 结果 -->
    <div class="vp-container">
      <div class="card-title">符合条件：<span class="count">{{ total }}</span> 人</div>
      <el-table :data="list" v-loading="loading">
        <el-table-column prop="name" label="姓名" width="90" />
        <el-table-column prop="person_no" label="编号" width="120" show-overflow-tooltip />
        <el-table-column prop="gender" label="性别" width="60">
          <template #default="{ row }">{{ row.gender === 'MALE' ? '男' : '女' }}</template>
        </el-table-column>
        <el-table-column prop="birthDate" label="出生日期" width="110" />
        <el-table-column prop="idCard" label="身份证号" width="150" show-overflow-tooltip />
        <el-table-column prop="gridName" label="网格" width="100" />
        <el-table-column prop="familyName" label="家庭" width="110" />
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }"><el-tag size="small">{{ statusLabel(row.status) }}</el-tag></template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" description="无符合条件人员" />
      <div class="pagination">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @current-change="load" @size-change="doSearch" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { keyGroupApi, tagApi, gridApi, excelApi } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const quick = ref<any[]>([]);
const personTags = ref<any[]>([]);
const familyTags = ref<any[]>([]);
const grids = ref<any[]>([]);
const filterSummary = ref('');

const query = reactive<any>({ page: 1, pageSize: 20, tagIds: [], tagMode: 'ANY', familyTagIds: [], gridId: null, minAge: null, maxAge: null });

function statusLabel(s: string) { return { NORMAL: '正常', MOVED_IN: '迁入', MOVED_OUT: '迁出', CANCELLED: '注销' }[s] || s; }

async function load() {
  loading.value = true;
  try {
    const params: any = { ...query };
    if (query.tagIds.length) params.tagIds = query.tagIds.join(',');
    else delete params.tagIds;
    if (query.familyTagIds.length) params.familyTagIds = query.familyTagIds.join(',');
    else delete params.familyTagIds;
    const res = await keyGroupApi.query(params);
    list.value = res.data.page.list;
    total.value = res.data.page.total;
    filterSummary.value = res.data.filter?.summary || '';
  } finally { loading.value = false; }
}
function doSearch() { query.page = 1; load(); }
function reset() { Object.assign(query, { page: 1, tagIds: [], tagMode: 'ANY', familyTagIds: [], gridId: null, minAge: null, maxAge: null }); filterSummary.value = ''; load(); }

function setQuickTag(code: string) {
  const tag = personTags.value.find((t) => t.code === code);
  if (!tag) return;
  query.tagIds = [tag.id];
  query.tagMode = 'ANY';
  query.familyTagIds = [];
  query.gridId = null;
  query.minAge = null;
  query.maxAge = null;
  doSearch();
}

async function doExport() {
  const params: any = {
    gridId: query.gridId,
    minAge: query.minAge,
    maxAge: query.maxAge,
  };
  if (query.tagIds.length) params.tagIds = query.tagIds.join(',');
  if (query.familyTagIds.length) params.familyTagIds = query.familyTagIds.join(',');
  const res: any = await excelApi.export(params);
  ElMessage.success(`导出完成，共 ${res.data.total} 条，请到 Excel 页面下载`);
}

onMounted(async () => {
  load();
  const [q, pt, ft, g] = await Promise.all([
    keyGroupApi.quick(),
    tagApi.definitions({ pageSize: 200, objectType: 'PERSON' }),
    tagApi.definitions({ pageSize: 200, objectType: 'FAMILY' }),
    gridApi.list({ pageSize: 100 }),
  ]);
  quick.value = q.data.list;
  personTags.value = pt.data.list;
  familyTags.value = ft.data.list;
  grids.value = g.data.list;
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.card-title { font-size: 15px; font-weight: 600; margin-bottom: 14px; }
.count { color: var(--color-primary); font-size: 20px; }
.quick-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 12px; }
.quick-card { background: var(--color-bg-subtle); border-radius: var(--radius-button); padding: 14px; text-align: center; cursor: pointer; transition: all var(--transition-fast); border: 1px solid transparent; }
.quick-card:hover { border-color: var(--color-primary); background: var(--color-primary-light); }
.quick-card .num { font-size: 22px; font-weight: 700; color: var(--color-primary); }
.quick-card .lbl { font-size: 13px; color: var(--color-text-regular); margin-top: 4px; }
.note { font-size: 12px; color: var(--color-text-secondary); margin-top: 10px; }
.sep { color: var(--color-text-secondary); }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
@media (max-width: 900px) { .quick-grid { grid-template-columns: repeat(4, 1fr); } }
</style>
