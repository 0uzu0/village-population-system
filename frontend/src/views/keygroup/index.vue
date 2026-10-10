<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">重点人群</h2>
        <div class="vp-page-subtitle">按标签精准筛查，交集/并集口径清晰可辨</div>
      </div>
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

      <!-- 当前筛选条件：以可移除的标签呈现，便于逐个拆解条件 -->
      <div class="filter-chips">
        <span class="chips-label">当前筛选</span>
        <template v-if="activeChips.length">
          <el-tag v-for="c in activeChips" :key="c.key" closable type="info" effect="light" @close="removeChip(c.key)">
            {{ c.text }}
          </el-tag>
        </template>
        <span v-else class="chips-empty">未设置筛选条件，当前展示全部人口</span>
      </div>
    </div>

    <!-- 结果 -->
    <div class="vp-container">
      <div class="result-header">
        <div class="result-title">
          符合条件：<span class="count">{{ total }}</span> 人
          <span v-if="stats.grids?.length" class="result-sub">· 覆盖 {{ stats.grids.length }} 个网格</span>
        </div>
        <el-button v-if="auth.hasPermission('keygroup:export')" :disabled="!total" @click="doExport">
          <el-icon><Download /></el-icon>导出结果
        </el-button>
      </div>

      <!-- 结果分布 -->
      <div v-if="total" class="result-stats">
        <div class="rs-block">
          <div class="rs-title">性别构成</div>
          <div class="rs-bars">
            <div v-for="g in genderStats" :key="g.key" class="rs-row">
              <span class="rs-name">{{ g.label }}</span>
              <div class="rs-bar"><div class="rs-fill" :style="{ width: g.pct + '%', background: g.color }" /></div>
              <span class="rs-num">{{ g.count }}</span>
            </div>
          </div>
        </div>
        <div class="rs-block">
          <div class="rs-title">网格分布（Top 6）</div>
          <div class="rs-bars">
            <div v-for="g in gridStats" :key="g.key" class="rs-row">
              <span class="rs-name">{{ g.key }}</span>
              <div class="rs-bar"><div class="rs-fill" :style="{ width: g.pct + '%', background: '#5B5BD6' }" /></div>
              <span class="rs-num">{{ g.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <el-table :data="list" v-loading="loading" @row-click="(row: any) => $router.push(`/persons/${row.id}`)" class="result-table">
        <el-table-column prop="name" label="姓名" width="90" />
        <el-table-column prop="person_no" label="编号" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.personNo || '—' }}</template>
        </el-table-column>
        <el-table-column prop="gender" label="性别" width="60">
          <template #default="{ row }">{{ row.gender === 'MALE' ? '男' : '女' }}</template>
        </el-table-column>
        <el-table-column prop="age" label="年龄" width="70">
          <template #default="{ row }">{{ row.age ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="idCard" label="身份证号" width="170" show-overflow-tooltip />
        <el-table-column prop="phone" label="手机号" width="130">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column prop="phoneBackup" label="备用手机号" width="130">
          <template #default="{ row }">{{ row.phoneBackup || '—' }}</template>
        </el-table-column>
        <el-table-column label="命中标签" min-width="180">
          <template #default="{ row }">
            <template v-if="row.tags?.length">
              <TagPill
                v-for="t in row.tags.slice(0, 3)"
                :key="t.id"
                :name="t.name"
                :color="t.color"
                :highlight="isHitTag(t.id)"
                style="margin-right: 4px"
              />
              <el-tag v-if="row.tags.length > 3" size="small" type="info">+{{ row.tags.length - 3 }}</el-tag>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="gridName" label="网格" width="110">
          <template #default="{ row }">{{ row.gridName || '—' }}</template>
        </el-table-column>
        <el-table-column prop="familyName" label="家庭" width="110">
          <template #default="{ row }">{{ row.familyName || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="70" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="$router.push(`/persons/${row.id}`)">详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="activeChips.length ? '没有符合当前条件的人员，可尝试放宽条件' : '暂无人员数据'" :image-size="80" />
        </template>
      </el-table>

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
import TagPill from '@/components/TagPill.vue';

const auth = useAuthStore();
const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const quick = ref<any[]>([]);
const personTags = ref<any[]>([]);
const familyTags = ref<any[]>([]);
const grids = ref<any[]>([]);
const stats = ref<any>({ gender: [], grids: [] });
const hitTagIds = ref<number[]>([]);

const query = reactive<any>({ page: 1, pageSize: 20, tagIds: [] as number[], tagMode: 'ANY', familyTagIds: [] as number[], gridId: null, minAge: null, maxAge: null });

function statusLabel(s: string) { return { NORMAL: '正常', MOVED_IN: '迁入', MOVED_OUT: '迁出', CANCELLED: '注销' }[s] || s; }
function tagName(id: number) { return personTags.value.find((t: any) => t.id === id)?.name || `#${id}`; }
function familyTagName(id: number) { return familyTags.value.find((t: any) => t.id === id)?.name || `#${id}`; }
function gridName(id: number) { return grids.value.find((g: any) => g.id === id)?.name || `#${id}`; }
function isHitTag(id: number) { return hitTagIds.value.includes(id); }

/** 把当前筛选条件拆成可单独移除的标签 */
const activeChips = computed(() => {
  const chips: { key: string; text: string }[] = [];
  if (query.tagIds.length) {
    chips.push({
      key: 'tagIds',
      text: `个人标签（${query.tagMode === 'ALL' ? '交集' : '并集'}）：${query.tagIds.map(tagName).join('、')}`,
    });
  }
  if (query.familyTagIds.length) {
    chips.push({ key: 'familyTagIds', text: `家庭标签：${query.familyTagIds.map(familyTagName).join('、')}` });
  }
  if (query.gridId) chips.push({ key: 'gridId', text: `网格：${gridName(query.gridId)}` });
  if (query.minAge != null || query.maxAge != null) {
    chips.push({ key: 'age', text: `年龄：${query.minAge ?? 0} - ${query.maxAge ?? '不限'} 岁` });
  }
  return chips;
});

function removeChip(key: string) {
  if (key === 'tagIds') query.tagIds = [];
  else if (key === 'familyTagIds') query.familyTagIds = [];
  else if (key === 'gridId') query.gridId = null;
  else if (key === 'age') { query.minAge = null; query.maxAge = null; }
  doSearch();
}

/** 性别构成：转中文并按占比排序 */
const genderStats = computed(() => {
  const rows = stats.value.gender || [];
  const sum = rows.reduce((a: number, r: any) => a + r.count, 0) || 1;
  return rows.map((r: any) => ({
    key: r.key,
    label: r.key === 'MALE' ? '男' : r.key === 'FEMALE' ? '女' : '未知',
    count: r.count,
    pct: Math.round((r.count / sum) * 100),
    color: r.key === 'MALE' ? '#3978F6' : r.key === 'FEMALE' ? '#0E7C6B' : '#B0B7C3',
  }));
});
const gridStats = computed(() => {
  const rows = (stats.value.grids || []).slice(0, 6);
  const max = rows.reduce((a: number, r: any) => Math.max(a, r.count), 0) || 1;
  return rows.map((r: any) => ({ key: r.key, count: r.count, pct: Math.round((r.count / max) * 100) }));
});

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
    stats.value = res.data.stats || { gender: [], grids: [] };
    hitTagIds.value = res.data.filter?.tagIds || [];
  } finally { loading.value = false; }
}
function doSearch() { query.page = 1; load(); }
function reset() {
  Object.assign(query, { page: 1, tagIds: [], tagMode: 'ANY', familyTagIds: [], gridId: null, minAge: null, maxAge: null });
  load();
}

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

/* 筛选条件标签 */
.filter-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--color-border); }
.chips-label { font-size: 13px; color: var(--color-text-secondary); margin-right: 2px; }
.chips-empty { font-size: 13px; color: var(--color-text-secondary); }

/* 结果区 */
.result-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.result-title { font-size: 15px; font-weight: 600; }
.result-sub { font-size: 13px; font-weight: 400; color: var(--color-text-secondary); margin-left: 6px; }
.result-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.rs-block { background: var(--color-bg-subtle); border-radius: var(--radius-button); padding: 12px 14px; }
.rs-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 10px; }
.rs-row { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
.rs-row:last-child { margin-bottom: 0; }
.rs-name { width: 76px; font-size: 12px; color: var(--color-text-regular); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-bar { flex: 1; height: 8px; background: var(--color-border-light, #EEF1F5); border-radius: 4px; overflow: hidden; }
.rs-fill { height: 100%; border-radius: 4px; transition: width var(--transition-fast); }
.rs-num { width: 46px; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
.result-table { cursor: pointer; }
.muted { color: var(--color-text-secondary); }

@media (max-width: 900px) {
  .quick-grid { grid-template-columns: repeat(4, 1fr); }
  .result-stats { grid-template-columns: 1fr; }
}
</style>
