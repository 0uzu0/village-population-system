<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">重点人群</h2>
        <div class="vp-page-subtitle">按标签精准筛查，多标签取交集</div>
      </div>
    </div>

    <!-- 快捷入口 -->
    <div class="vp-container">
      <div class="card-title">常用快捷入口</div>
      <div class="quick-grid">
        <div
          v-for="g in quick"
          :key="g.code"
          class="quick-card"
          :class="{ active: isQuickActive(g) }"
          @click="setQuickTag(g)"
        >
          <div class="num">{{ g.count }}</div>
          <div class="lbl">{{ g.label }}</div>
        </div>
      </div>
      <div class="note">{{ quickNote }}</div>
    </div>

    <!-- 筛选条件 -->
    <div ref="filterCard" class="vp-container">
      <div class="card-title">筛选条件</div>
      <div class="vp-search-bar">
        <el-select v-model="query.tagIds" placeholder="个人标签（可多选，取交集）" multiple filterable collapse-tags style="width: 280px" @change="query.tagMode = 'ALL'">
          <el-option v-for="t in personTags" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
        <el-select v-model="query.gridId" placeholder="网格" clearable filterable style="width: 130px">
          <el-option v-for="g in grids" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
        <el-select v-model="query.villages" placeholder="村庄" clearable filterable multiple collapse-tags style="width: 160px">
          <el-option v-for="v in villages" :key="v" :label="v" :value="v" />
        </el-select>
        <el-checkbox v-model="activeOnly">只看在册（排除已迁出/已死亡）</el-checkbox>
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
        <span v-else class="chips-empty">未设置筛选条件，设置后开始筛查（不会默认展示全部人口）</span>
      </div>
    </div>

    <!-- 结果：未设置筛选条件时不展示全量人口，先引导设置条件 -->
    <div class="vp-container">
      <div v-if="!searched" class="screen-empty">
        <el-empty description="请先在上方设置筛选条件，或从「常用快捷入口」直接查看某类人群" :image-size="90">
          <el-button type="primary" @click="focusFilter">去设置筛选条件</el-button>
        </el-empty>
      </div>
      <template v-else>
      <div class="result-header">
        <div class="result-title">
          符合条件：<span class="count">{{ total }}</span> 人
          <span v-if="stats.grids?.length" class="result-sub">· 覆盖 {{ stats.grids.length }} 个网格</span>
        </div>
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

      <el-table :data="list" v-loading="loading" @row-click="(row: any) => $router.push(toPersonDetail(route, row.id))" class="result-table">
        <el-table-column prop="name" label="姓名" width="90" />
        <el-table-column prop="gender" label="性别" width="60">
          <template #default="{ row }">{{ genderLabel(row.gender) }}</template>
        </el-table-column>
        <el-table-column prop="age" label="年龄" width="70">
          <template #default="{ row }">{{ row.age ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="idCard" label="身份证号" width="170" show-overflow-tooltip />
        <el-table-column prop="phone" label="手机号" width="130">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <!-- 编号与家庭列按需求移除，改为展示户籍地址与现居住地址（走访时用得上） -->
        <el-table-column prop="hukouAddress" label="户籍地址" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.hukouAddress || '—' }}</template>
        </el-table-column>
        <el-table-column prop="liveAddress" label="现居住地址" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.liveAddress || '—' }}</template>
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
              <!-- 折叠起来的标签鼠标悬停看全：一个人常挂四五个标签，
                   只显示 +N 不给他看是哪些，等于把筛查依据藏了一半 -->
              <el-tooltip
                v-if="row.tags.length > 3"
                placement="top"
                :content="row.tags.slice(3).map((t: any) => t.name).join('、')"
              >
                <el-tag size="small" type="info">+{{ row.tags.length - 3 }}</el-tag>
              </el-tooltip>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="gridName" label="网格" width="110">
          <template #default="{ row }">{{ row.gridName || '—' }}</template>
        </el-table-column>
        <!-- 个性化台账列（V008） -->
        <el-table-column prop="disabilityLevelShort" label="残疾等级" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.disability?.level" size="small" :type="levelTag(row.disability.level)" effect="light">
              {{ disabilityLevelShort(row.disability.level) }}
            </el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="监护人" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.disability?.guardianName || '—' }}</template>
        </el-table-column>
        <el-table-column prop="subsidyAmount" label="发放金额" width="100" sortable>
          <template #default="{ row }">
            <span v-if="row.subsidyAmount != null">{{ money(row.subsidyAmount) }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="70" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="$router.push(toPersonDetail(route, row.id))">详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="activeChips.length ? '没有符合当前条件的人员，可尝试放宽条件' : '暂无人员数据'" :image-size="80" />
        </template>
      </el-table>

      <div class="pagination">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @current-change="load" @size-change="doSearch" />
      </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
// 导出功能按需求移除，因此不再引入 excelApi 与权限 store
import { keyGroupApi, tagApi, personApi, gridApi } from '@/api';
import { toPersonDetail } from '@/utils/nav';
// 个性化筛选（特困供养方式 / 残疾等级 / 发放金额 / 监护人）按需求整体移除，
// 因此这里只保留列表「残疾等级」列展示需要的 disabilityLevelShort
import { disabilityLevelShort } from '@/utils/disability';
import { genderLabel } from '@/utils/format';
import { useListUrlSync } from '@/composables/useListUrlSync';
import TagPill from '@/components/TagPill.vue';

const route = useRoute();
const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const quick = ref<any[]>([]);
const quickNote = ref('注：各人群人数存在交叉，不可简单相加');
/** 是否已执行过筛查。未筛查时不展示全量人口，避免一进页面就拉整表 */
const searched = ref(false);
const filterCard = ref<HTMLElement | null>(null);
const personTags = ref<any[]>([]);
const grids = ref<any[]>([]);
const villages = ref<string[]>([]);
const stats = ref<any>({ gender: [], grids: [] });
const hitTagIds = ref<number[]>([]);

/** 只统计在册人员：已死亡/迁出的不再计入重点人群服务名单 */
const activeOnly = ref(true);

/**
 * 筛选条件 ↔ 地址栏同步。新增筛选项只要往 fields 加一行，
 * 就同时获得写入 URL / 还原 / 重置 / 组装请求参数四件事。
 * minAge/maxAge 不再提供手输入口（年龄区间由「快捷入口」的年龄类卡片设置）。
 * tagMode 不再提供 UI 选择器：默认 ALL（交集）；快捷入口身份类族群
 * （「党员」= 正式+预备）天然是并集，点卡片时内部切成 ANY。
 */
const {
  query,
  syncUrl,
  restoreQuery: restoreQueryState,
  resetQuery: resetQueryState,
  buildParams,
} = useListUrlSync({
  path: '/key-groups',
  initial: () => ({
    page: 1,
    pageSize: 20,
    tagIds: [] as number[],
    tagMode: 'ALL',
    gridId: null as number | null,
    villages: [] as string[],
    minAge: null as number | null,
    maxAge: null as number | null,
  }),
  fields: [
    { key: 'tagIds', type: 'numberArray' },
    { key: 'tagMode', defaultValue: 'ALL', parse: (raw: string) => (['ANY', 'ALL'].includes(raw) ? raw : undefined) },
    { key: 'gridId', type: 'number' },
    { key: 'villages', type: 'stringArray' },
    { key: 'minAge', type: 'number' },
    { key: 'maxAge', type: 'number' },
  ],
  extras: { activeOnly: { ref: activeOnly, defaultValue: true } },
});

/** 从地址栏恢复条件（个性化筛选已移除，不再需要展开折叠区） */
function restoreQuery() {
  restoreQueryState();
}

/** 金额显示：整数不带小数，非整数保留两位 */
function money(n?: number | null): string {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** 残疾等级标签色：越重越醒目，一级最深 */
function levelTag(level: string): any {
  return { LEVEL_1: 'danger', LEVEL_2: 'warning', LEVEL_3: 'primary', LEVEL_4: 'info' }[level] || 'info';
}

function tagName(id: number) { return personTags.value.find((t: any) => t.id === id)?.name || `#${id}`; }
function gridName(id: number) { return grids.value.find((g: any) => g.id === id)?.name || `#${id}`; }
function isHitTag(id: number) { return hitTagIds.value.includes(id); }

/** 把当前筛选条件拆成可单独移除的标签 */
const activeChips = computed(() => {
  const chips: { key: string; text: string }[] = [];
  if (query.tagIds.length) {
    chips.push({
      key: 'tagIds',
      text: `个人标签（${query.tagMode === 'ANY' ? '并集' : '交集'}）：${query.tagIds.map(tagName).join('、')}`,
    });
  }
  if (query.gridId) chips.push({ key: 'gridId', text: `网格：${gridName(query.gridId)}` });
  if (query.villages.length) chips.push({ key: 'villages', text: `村庄：${query.villages.join('、')}` });
  if (query.minAge != null || query.maxAge != null) {
    chips.push({ key: 'age', text: `年龄：${ageRangeText(query.minAge, query.maxAge)}` });
  }
  return chips;
});

/** 年龄区间人话表述，与后端口径一致（只给上界时按「<N+1 岁」理解） */
function ageRangeText(minAge?: number | null, maxAge?: number | null): string {
  if (minAge != null && maxAge != null) return `${minAge}-${maxAge} 岁`;
  if (minAge != null) return `≥${minAge} 岁`;
  if (maxAge != null) return `<${maxAge + 1} 岁`;
  return '不限';
}

/** 快捷入口是否处于选中态，便于一眼看出当前在看哪类人群 */
function isQuickActive(g: any) {
  if (g.byAge) {
    return query.tagIds.length === 0 && (query.minAge ?? null) === (g.minAge ?? null) && (query.maxAge ?? null) === (g.maxAge ?? null);
  }
  const ids = quickTagIds(g);
  return ids.length > 0 && ids.length === query.tagIds.length && ids.every((id) => query.tagIds.includes(id));
}

function removeChip(key: string) {
  if (key === 'tagIds') query.tagIds = [];
  else if (key === 'gridId') query.gridId = null;
  else if (key === 'villages') query.villages = [];
  else if (key === 'age') { query.minAge = null; query.maxAge = null; }
  // 条件被拆完就回到未筛查状态，而不是退回全量人口
  if (!hasFilter.value) { reset(); return; }
  doSearch();
}

/** 性别构成：转中文并按占比排序 */
const genderStats = computed(() => {
  const rows = stats.value.gender || [];
  const sum = rows.reduce((a: number, r: any) => a + r.count, 0) || 1;
  return rows.map((r: any) => ({
    key: r.key,
    label: genderLabel(r.key),
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

/** 当前是否设置了任一筛选条件 */
const hasFilter = computed(
  () =>
    query.tagIds.length > 0 ||
    query.gridId != null ||
    query.villages.length > 0 ||
    query.minAge != null ||
    query.maxAge != null
);

/** 列表查询：请求参数统一由 buildParams() 组装，查询后把条件写回地址栏 */
async function load() {
  loading.value = true;
  try {
    const params = buildParams();
    const res = await keyGroupApi.query(params);
    list.value = res.data.page.list;
    total.value = res.data.page.total;
    stats.value = res.data.stats || { gender: [], grids: [] };
    hitTagIds.value = res.data.filter?.tagIds || [];
    syncUrl();
  } finally { loading.value = false; }
}

function doSearch() {
  // 无条件时不跑全量：既没必要，也会把整表拉出来
  if (!hasFilter.value) {
    ElMessage.warning('请先选择标签、网格或村庄等条件后再筛查');
    focusFilter();
    return;
  }
  query.page = 1;
  searched.value = true;
  load();
}

/** 回到未筛查状态并清空结果 */
function reset() {
  resetQueryState();
  searched.value = false;
  list.value = [];
  total.value = 0;
  stats.value = { gender: [], grids: [] };
  hitTagIds.value = [];
  syncUrl();
}

function focusFilter() {
  filterCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 快捷入口：身份类（党员/退役军人…）按标签筛；
 * 年龄类（老年人/未成年人）按年龄区间筛，不依赖是否打过标签。
 */
function setQuickTag(g: any) {
  query.tagIds = [];
  query.gridId = null;
  query.villages = [];
  query.minAge = null;
  query.maxAge = null;
  if (g.byAge) {
    query.tagMode = 'ALL';
    query.minAge = g.minAge ?? null;
    query.maxAge = g.maxAge ?? null;
  } else {
    // 身份类族群的一个 code 常对应多个标签（「党员」= 正式+预备），
    // 语义是「任一即可」，必须按并集筛，否则会漏掉只打了一个标签的人
    query.tagMode = 'ANY';
    const ids = quickTagIds(g);
    if (!ids.length) return;
    query.tagIds = ids;
  }
  doSearch();
}

/**
 * 族群 code → 标签 id 列表。
 *
 * 必须按 `tagCodes` 解析而不是只看 `code`：「党员」要含预备党员，
 * 用单个 code 筛选会比卡片上的人数少一截（卡片与工作台都是按 tagCodes 求和的）。
 */
function quickTagIds(g: any) {
  const codes: string[] = g.tagCodes?.length ? g.tagCodes : [g.code];
  return codes
    .map((c) => personTags.value.find((t: any) => t.code === c)?.id)
    .filter((id): id is number => typeof id === 'number');
}

onMounted(async () => {
  // 村庄下拉与人口档案页同源（/grids/villages）：options 接口不含村庄，
  // 此前误用导致下拉无数据；取不到时静默降级为空，不影响筛查本身
  const [q, pt, opts, vil] = await Promise.all([
    keyGroupApi.quick(),
    tagApi.definitions({ pageSize: 200, objectType: 'PERSON' }),
    personApi.options(),
    gridApi.villages().catch(() => ({ data: { list: [] } })),
  ]);
  quick.value = q.data.list;
  if (q.data.note) quickNote.value = `注：${q.data.note}`;
  personTags.value = pt.data.list;
  grids.value = opts.data.grids;
  villages.value = (vil?.data?.list || []).map((v: any) => v.name).filter(Boolean);
  // 地址栏带条件时（从人员详情返回、或打开分享链接）直接还原筛查结果；
  // 否则停在引导态，等用户设置条件，避免一进页面就拉全量人口
  restoreQuery();
  if (hasFilter.value) {
    searched.value = true;
    load();
  }
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.card-title { font-size: var(--font-size-base); font-weight: 600; margin-bottom: 14px; }
.count { color: var(--color-primary); font-size: var(--font-size-lg); }
.quick-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 12px; }
.quick-card { background: var(--color-bg-subtle); border-radius: var(--radius-button); padding: 14px; text-align: center; cursor: pointer; transition: all var(--transition-fast); border: 1px solid transparent; }
.quick-card:hover { border-color: var(--color-primary); background: var(--color-primary-light); }
.quick-card.active { border-color: var(--color-primary); background: var(--color-primary-light); box-shadow: 0 0 0 2px var(--color-primary-light); }
.quick-card .num { font-size: var(--font-size-xl); font-weight: 700; color: var(--color-primary); }
.quick-card .lbl { font-size: var(--font-size-sm); color: var(--color-text-regular); margin-top: 4px; }
.note { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 10px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 16px; }

/* 筛选条件标签 */
.filter-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--color-border); }
.chips-label { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-right: 2px; }
.chips-empty { font-size: var(--font-size-sm); color: var(--color-text-secondary); }

/* 结果区 */
.screen-empty { padding: 24px 0 8px; }
.result-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.result-title { font-size: var(--font-size-base); font-weight: 600; }
.result-sub { font-size: var(--font-size-sm); font-weight: 400; color: var(--color-text-secondary); margin-left: 6px; }
.result-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.rs-block { background: var(--color-bg-subtle); border-radius: var(--radius-button); padding: 12px 14px; }
.rs-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text-primary); margin-bottom: 10px; }
.rs-row { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
.rs-row:last-child { margin-bottom: 0; }
.rs-name { width: 76px; font-size: var(--font-size-xs); color: var(--color-text-regular); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-bar { flex: 1; height: 8px; background: var(--color-border-light, #EEF1F5); border-radius: 4px; overflow: hidden; }
.rs-fill { height: 100%; border-radius: 4px; transition: width var(--transition-fast); }
.rs-num { width: 46px; text-align: right; font-size: var(--font-size-xs); font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
.result-table { cursor: pointer; }
.muted { color: var(--color-text-secondary); }

@media (max-width: 900px) {
  .quick-grid { grid-template-columns: repeat(4, 1fr); }
  .result-stats { grid-template-columns: 1fr; }
}
</style>
