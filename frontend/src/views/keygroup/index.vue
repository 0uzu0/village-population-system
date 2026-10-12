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
        <el-select v-model="query.tagIds" placeholder="个人标签（可多选）" multiple filterable collapse-tags style="width: 280px">
          <el-option v-for="t in personTags" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
        <el-radio-group v-model="query.tagMode">
          <el-radio-button value="ANY">并集</el-radio-button>
          <el-radio-button value="ALL">交集</el-radio-button>
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
        <el-checkbox v-model="activeOnly">只看在册（排除已迁出/已死亡）</el-checkbox>
        <el-button type="primary" @click="doSearch"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>

      <!-- 个性化筛选：默认收起，按需展开（条件多，常用筛选项仍在一行） -->
      <el-collapse v-model="advancedOpen" class="adv-collapse">
        <el-collapse-item name="adv">
          <template #title>
            <span class="adv-title">个性化筛选（特困供养方式 / 残疾等级 / 发放金额 / 监护人）</span>
            <span v-if="advancedCount" class="adv-badge">{{ advancedCount }}</span>
          </template>
          <div class="vp-search-bar">
            <el-select v-model="query.extremePovertyMode" placeholder="特困供养方式" clearable style="width: 150px" @change="doSearch">
              <el-option v-for="m in EXTREME_POVERTY_MODES" :key="m.value" :label="m.label" :value="m.value" />
            </el-select>
            <el-select v-model="query.disabilityLevelMin" placeholder="残疾等级自" clearable style="width: 130px">
              <el-option v-for="l in DISABILITY_LEVELS" :key="l.value" :label="l.label" :value="l.value" />
            </el-select>
            <span class="sep">—</span>
            <el-select v-model="query.disabilityLevelMax" placeholder="至" clearable style="width: 130px">
              <el-option v-for="l in DISABILITY_LEVELS" :key="l.value" :label="l.label" :value="l.value" />
            </el-select>
            <el-select v-model="query.disabilityType" placeholder="残疾类别" clearable filterable allow-create style="width: 120px">
              <el-option v-for="t in DISABILITY_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
            <el-input-number v-model="query.minSubsidy" :min="0" :step="50" placeholder="金额≥" controls-position="right" style="width: 120px" />
            <span class="sep">—</span>
            <el-input-number v-model="query.maxSubsidy" :min="0" :step="50" placeholder="元/月" controls-position="right" style="width: 120px" />
            <el-select v-model="query.guardian" placeholder="监护人" clearable style="width: 110px">
              <el-option label="已登记" value="YES" />
              <el-option label="未登记" value="NO" />
            </el-select>
            <el-button @click="doSearch"><el-icon><Search /></el-icon>应用</el-button>
          </div>
        </el-collapse-item>
      </el-collapse>

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

      <el-table :data="list" v-loading="loading" @row-click="(row: any) => $router.push(toPersonDetail(route, row.id))" class="result-table">
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
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { keyGroupApi, tagApi, gridApi, excelApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { toPersonDetail } from '@/utils/nav';
import { statusLabel as statusLabelOf } from '@/utils/personStatus';
import {
  DISABILITY_LEVELS, DISABILITY_TYPES, EXTREME_POVERTY_MODES, disabilityLevelShort,
} from '@/utils/disability';
import TagPill from '@/components/TagPill.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const quick = ref<any[]>([]);
const quickNote = ref('注：各人群人数存在交叉，不可简单相加');
/** 是否已执行过筛查。未筛查时不展示全量人口，避免一进页面就拉整表 */
const searched = ref(false);
const filterCard = ref<HTMLElement | null>(null);
const personTags = ref<any[]>([]);
const familyTags = ref<any[]>([]);
const grids = ref<any[]>([]);
const stats = ref<any>({ gender: [], grids: [] });
const hitTagIds = ref<number[]>([]);

const query = reactive<any>({
  page: 1, pageSize: 20, tagIds: [] as number[], tagMode: 'ANY', familyTagIds: [] as number[],
  gridId: null, minAge: null, maxAge: null,
  // 个性化筛选（V008）
  extremePovertyMode: '',
  disabilityLevelMin: '',
  disabilityLevelMax: '',
  disabilityType: '',
  minSubsidy: null,
  maxSubsidy: null,
  guardian: '',
});

/** 只统计在册人员：已死亡/迁出的不再计入重点人群服务名单 */
const activeOnly = ref(true);

/** 个性化筛选区默认收起，但已设条件时自动展开，避免「设了却看不见」 */
const advancedOpen = ref<string[]>([]);
const advancedCount = computed(() =>
  [query.extremePovertyMode, query.disabilityLevelMin, query.disabilityLevelMax,
    query.disabilityType, query.minSubsidy, query.maxSubsidy, query.guardian]
    .filter((v) => v !== '' && v != null).length
);

/** 金额显示：整数不带小数，非整数保留两位 */
function money(n?: number | null): string {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** 残疾等级标签色：越重越醒目，一级最深 */
function levelTag(level: string): any {
  return { LEVEL_1: 'danger', LEVEL_2: 'warning', LEVEL_3: 'primary', LEVEL_4: 'info' }[level] || 'info';
}

function statusLabel(s: string) { return statusLabelOf(s); }
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
    chips.push({ key: 'age', text: `年龄：${ageRangeText(query.minAge, query.maxAge)}` });
  }
  // 个性化条件（V008）：与后端 conditions 文案保持一致
  if (query.extremePovertyMode) {
    const label = EXTREME_POVERTY_MODES.find((m) => m.value === query.extremePovertyMode)?.label || query.extremePovertyMode;
    chips.push({ key: 'extremePovertyMode', text: `特困供养方式：${label}` });
  }
  if (query.disabilityLevelMin || query.disabilityLevelMax) {
    const short = (v: string) => (v ? disabilityLevelShort(v) : '不限');
    chips.push({
      key: 'disabilityLevel',
      text: `残疾等级：${short(query.disabilityLevelMin)} ~ ${short(query.disabilityLevelMax)}`,
    });
  }
  if (query.disabilityType) chips.push({ key: 'disabilityType', text: `残疾类别：${query.disabilityType}` });
  if (query.minSubsidy != null || query.maxSubsidy != null) {
    chips.push({ key: 'subsidy', text: `发放金额：${moneyRangeText(query.minSubsidy, query.maxSubsidy)}` });
  }
  if (query.guardian) chips.push({ key: 'guardian', text: query.guardian === 'YES' ? '已登记监护人' : '未登记监护人' });
  return chips;
});

/** 金额区间人话表述 */
function moneyRangeText(min?: number | null, max?: number | null): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  if (min != null && max != null) return `${fmt(min)}~${fmt(max)} 元/月`;
  if (min != null) return `≥ ${fmt(min)} 元/月`;
  if (max != null) return `≤ ${fmt(max)} 元/月`;
  return '不限';
}

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
  const tag = personTags.value.find((t) => t.code === g.code);
  return !!tag && query.tagIds.length === 1 && query.tagIds[0] === tag.id;
}

function removeChip(key: string) {
  if (key === 'tagIds') query.tagIds = [];
  else if (key === 'familyTagIds') query.familyTagIds = [];
  else if (key === 'gridId') query.gridId = null;
  else if (key === 'age') { query.minAge = null; query.maxAge = null; }
  else if (key === 'extremePovertyMode') query.extremePovertyMode = '';
  else if (key === 'disabilityLevel') { query.disabilityLevelMin = ''; query.disabilityLevelMax = ''; }
  else if (key === 'disabilityType') query.disabilityType = '';
  else if (key === 'subsidy') { query.minSubsidy = null; query.maxSubsidy = null; }
  else if (key === 'guardian') query.guardian = '';
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

/** 当前是否设置了任一筛选条件 */
const hasFilter = computed(
  () =>
    query.tagIds.length > 0 ||
    query.familyTagIds.length > 0 ||
    query.gridId != null ||
    query.minAge != null ||
    query.maxAge != null ||
    advancedCount.value > 0
);

/**
 * 把筛选条件写入地址栏：
 * 一是从人员详情返回时能还原现场，二是筛查结果可直接复制分享。
 */
function syncUrl() {
  const q: any = {};
  if (query.tagIds.length) q.tagIds = query.tagIds.join(',');
  if (query.tagMode !== 'ANY') q.tagMode = query.tagMode;
  if (query.familyTagIds.length) q.familyTagIds = query.familyTagIds.join(',');
  if (query.gridId != null) q.gridId = String(query.gridId);
  if (query.minAge != null) q.minAge = String(query.minAge);
  if (query.maxAge != null) q.maxAge = String(query.maxAge);
  // 个性化条件（V008）
  if (query.extremePovertyMode) q.extremePovertyMode = query.extremePovertyMode;
  if (query.disabilityLevelMin) q.dlMin = query.disabilityLevelMin;
  if (query.disabilityLevelMax) q.dlMax = query.disabilityLevelMax;
  if (query.disabilityType) q.dType = query.disabilityType;
  if (query.minSubsidy != null) q.minSubsidy = String(query.minSubsidy);
  if (query.maxSubsidy != null) q.maxSubsidy = String(query.maxSubsidy);
  if (query.guardian) q.guardian = query.guardian;
  if (!activeOnly.value) q.activeOnly = 'false';
  if (query.page > 1) q.page = String(query.page);
  if (query.pageSize !== 20) q.pageSize = String(query.pageSize);
  router.replace({ path: '/key-groups', query: q });
}

/** 从地址栏恢复筛选条件（详情页返回、或直接粘贴带条件的链接） */
function restoreQuery() {
  const rq = route.query;
  if (rq.tagIds) {
    query.tagIds = String(rq.tagIds).split(',').map((s) => Number(s)).filter((n) => !isNaN(n));
  }
  if (rq.tagMode === 'ALL' || rq.tagMode === 'ANY') query.tagMode = rq.tagMode;
  if (rq.familyTagIds) {
    query.familyTagIds = String(rq.familyTagIds).split(',').map((s) => Number(s)).filter((n) => !isNaN(n));
  }
  if (rq.gridId) query.gridId = Number(rq.gridId);
  if (rq.minAge != null && rq.minAge !== '') query.minAge = Number(rq.minAge);
  if (rq.maxAge != null && rq.maxAge !== '') query.maxAge = Number(rq.maxAge);
  if (rq.extremePovertyMode) query.extremePovertyMode = String(rq.extremePovertyMode);
  if (rq.dlMin) query.disabilityLevelMin = String(rq.dlMin);
  if (rq.dlMax) query.disabilityLevelMax = String(rq.dlMax);
  if (rq.dType) query.disabilityType = String(rq.dType);
  if (rq.minSubsidy != null && rq.minSubsidy !== '') query.minSubsidy = Number(rq.minSubsidy);
  if (rq.maxSubsidy != null && rq.maxSubsidy !== '') query.maxSubsidy = Number(rq.maxSubsidy);
  if (rq.guardian === 'YES' || rq.guardian === 'NO') query.guardian = String(rq.guardian);
  // 恢复时若有个性化条件，自动展开折叠区，避免条件被隐藏看不见
  if (advancedCount.value > 0) advancedOpen.value = ['adv'];
  if (rq.activeOnly === 'false') activeOnly.value = false;
  if (rq.page) query.page = Number(rq.page) || 1;
  if (rq.pageSize) query.pageSize = Number(rq.pageSize) || 20;
}

async function load() {
  loading.value = true;
  try {
    const params: any = { ...query, activeOnly: activeOnly.value ? 'true' : 'false' };
    if (query.tagIds.length) params.tagIds = query.tagIds.join(',');
    else delete params.tagIds;
    if (query.familyTagIds.length) params.familyTagIds = query.familyTagIds.join(',');
    else delete params.familyTagIds;
    // 前端字段名（dlMin/dlMax/dType 短名）→ 后端参数名，保持接口语义直白
    params.minDisabilityLevel = query.disabilityLevelMin || undefined;
    params.maxDisabilityLevel = query.disabilityLevelMax || undefined;
    params.disabilityType = query.disabilityType || undefined;
    delete params.disabilityLevelMin; delete params.disabilityLevelMax;
    // 空值不传：后端 zod 对空字符串会按非法枚举报错
    for (const k of ['extremePovertyMode', 'guardian']) {
      if (!params[k]) delete params[k];
    }
    for (const k of ['minSubsidy', 'maxSubsidy']) {
      if (params[k] == null) delete params[k];
    }
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
    ElMessage.warning('请先选择标签、网格或年龄区间等条件后再筛查');
    focusFilter();
    return;
  }
  query.page = 1;
  searched.value = true;
  load();
}

/** 回到未筛查状态并清空结果 */
function reset() {
  Object.assign(query, {
    page: 1, tagIds: [], tagMode: 'ANY', familyTagIds: [], gridId: null, minAge: null, maxAge: null,
    extremePovertyMode: '', disabilityLevelMin: '', disabilityLevelMax: '',
    disabilityType: '', minSubsidy: null, maxSubsidy: null, guardian: '',
  });
  activeOnly.value = true;
  advancedOpen.value = [];
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
  query.tagMode = 'ANY';
  query.familyTagIds = [];
  query.gridId = null;
  query.minAge = null;
  query.maxAge = null;
  if (g.byAge) {
    query.minAge = g.minAge ?? null;
    query.maxAge = g.maxAge ?? null;
  } else {
    const tag = personTags.value.find((t) => t.code === g.code);
    if (!tag) return;
    query.tagIds = [tag.id];
  }
  doSearch();
}

async function doExport() {
  // 导出必须带上全部筛选条件（含个性化条件与在册口径），
  // 否则导出的会与屏幕上看到的结果不是同一批人
  const params: any = {
    gridId: query.gridId,
    minAge: query.minAge,
    maxAge: query.maxAge,
    activeOnly: activeOnly.value,
  };
  if (query.tagIds.length) params.tagIds = query.tagIds.join(',');
  if (query.familyTagIds.length) params.familyTagIds = query.familyTagIds.join(',');
  if (query.extremePovertyMode) params.extremePovertyMode = query.extremePovertyMode;
  if (query.disabilityLevelMin) params.minDisabilityLevel = query.disabilityLevelMin;
  if (query.disabilityLevelMax) params.maxDisabilityLevel = query.disabilityLevelMax;
  if (query.disabilityType) params.disabilityType = query.disabilityType;
  if (query.minSubsidy != null) params.minSubsidy = query.minSubsidy;
  if (query.maxSubsidy != null) params.maxSubsidy = query.maxSubsidy;
  if (query.guardian) params.guardian = query.guardian;
  const res: any = await excelApi.export(params);
  ElMessage.success(`导出完成，共 ${res.data.total} 条，请到 Excel 页面下载`);
}

onMounted(async () => {
  const [q, pt, ft, g] = await Promise.all([
    keyGroupApi.quick(),
    tagApi.definitions({ pageSize: 200, objectType: 'PERSON' }),
    tagApi.definitions({ pageSize: 200, objectType: 'FAMILY' }),
    gridApi.list({ pageSize: 100 }),
  ]);
  quick.value = q.data.list;
  if (q.data.note) quickNote.value = `注：${q.data.note}`;
  personTags.value = pt.data.list;
  familyTags.value = ft.data.list;
  grids.value = g.data.list;
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
.sep { color: var(--color-text-secondary); }
/* 个性化筛选折叠区 */
.adv-collapse {
  margin-top: 10px;
  border-top: 1px solid var(--color-border-light);
}
.adv-collapse :deep(.el-collapse-item__header) {
  border-bottom: none;
  height: 38px;
  line-height: 38px;
  background: transparent;
}
.adv-title { font-size: var(--font-size-sm); color: var(--color-text-regular); }
.adv-badge {
  display: inline-block;
  min-width: 18px;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--color-primary);
  color: #fff;
  font-size: var(--font-size-xs);
  line-height: 18px;
  text-align: center;
}
.adv-collapse :deep(.el-collapse-item__wrap) { border-bottom: none; }
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
