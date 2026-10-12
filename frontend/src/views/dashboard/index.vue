<template>
  <div class="dashboard">
    <!-- 统计卡片 -->
    <div class="stat-grid">
      <el-tooltip v-for="card in statCards" :key="card.label" :content="card.tip || ''" placement="bottom" :disabled="!card.tip">
        <div class="stat-card">
          <div class="stat-icon" :style="{ background: card.bg, color: card.color }">
            <el-icon :size="22"><component :is="card.icon" /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ card.value }}</div>
            <div class="stat-label">{{ card.label }}</div>
          </div>
        </div>
      </el-tooltip>
    </div>
    <!-- 口径说明：后端返回 scope=ACTIVE_ONLY 才显示，用于确认在册口径已生效 -->
    <div v-if="dash.scope === 'ACTIVE_ONLY'" class="scope-note">
      <el-icon><InfoFilled /></el-icon>
      统计口径：以上人数均为<strong>在册人口</strong>（正常 / 迁入），已迁出、死亡的人员不计入；档案保留，可在人口档案关闭「只看在册」后查看。
    </div>

    <!-- 图表区 -->
    <div class="chart-grid">
      <div class="vp-card">
        <div class="card-title">人口年龄分布</div>
        <VpChart :option="ageOption" height="280px" />
      </div>
      <div class="vp-card">
        <div class="card-title">性别分布</div>
        <VpChart :option="genderOption" height="280px" />
      </div>
      <div class="vp-card">
        <div class="card-title">各网格人口分布</div>
        <VpChart :option="gridOption" height="280px" />
      </div>
      <div class="vp-card">
        <div class="card-title">人口标签分布（Top 15）</div>
        <VpChart :option="tagOption" height="280px" />
      </div>
    </div>

    <!-- 近期动态 -->
    <div class="bottom-grid">
      <div class="vp-card">
        <div class="card-title">近期人口档案变更</div>
        <el-table :data="changes" size="small">
          <el-table-column prop="name" label="姓名" width="80" />
          <el-table-column prop="change_type" label="类型" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="typeTag(row.change_type)">{{ typeLabel(row.change_type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="变更原因" show-overflow-tooltip />
          <el-table-column prop="created_at" label="时间" width="160" />
        </el-table>
        <el-empty v-if="!changes.length" description="暂无变更记录" :image-size="60" />
      </div>
      <div class="vp-card">
        <div class="card-head">
          <div class="card-title">最近导入任务</div>
          <div class="head-actions">
            <el-button link size="small" :loading="importLoading" @click="loadImports">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
            <el-button link type="primary" size="small" @click="$router.push('/excel')">去导入</el-button>
          </div>
        </div>

        <div v-loading="importLoading" class="import-list">
          <div v-for="row in imports" :key="row.id" class="import-item">
            <div class="ii-top">
              <span class="ii-batch">{{ row.batch_no }}</span>
              <el-tag size="small" :type="importTag(row.status)" effect="light">{{ importLabel(row.status) }}</el-tag>
              <span v-if="isImportStale(row)" class="ii-stale">已中断</span>
            </div>
            <div class="ii-bar">
              <div class="ii-track">
                <div class="ii-ok" :style="{ width: pct(row, 'success') + '%' }" />
                <div class="ii-pending" :style="{ width: pct(row, 'pending') + '%' }" />
                <div class="ii-fail" :style="{ width: pct(row, 'fail') + '%' }" />
              </div>
            </div>
            <div class="ii-meta">
              <span class="ii-total">共 {{ row.total_rows }} 行</span>
              <span class="dot-ok">成功 {{ row.success_count }}</span>
              <span v-if="row.pending_count" class="dot-pending">待核查 {{ row.pending_count }}</span>
              <span v-if="row.fail_count" class="dot-fail">失败 {{ row.fail_count }}</span>
              <span class="ii-time">{{ row.created_at }}</span>
            </div>
            <div v-if="row.pending_count" class="ii-tip">
              有 {{ row.pending_count }} 条身份证缺失/非法
              <el-button link type="warning" size="small" @click="$router.push('/pending')">去核查</el-button>
            </div>
          </div>
          <el-empty v-if="!imports.length && !importLoading" description="暂无导入记录，上传 Excel 后这里会显示任务进度" :image-size="60" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { statisticsApi } from '@/api';
import VpChart from '@/components/VpChart.vue';
import { ACTIVE_SCOPE_TIP, FAMILY_TAG_SCOPE_TIP } from '@/utils/personStatus';
import type { EChartsOption } from 'echarts';

const dash = ref<any>({});
const dist = ref<any>({ age: [], gender: [], grids: [], tags: [] });
const changes = ref<any[]>([]);
const imports = ref<any[]>([]);

const statCards = computed(() => {
  const d = dash.value;
  return [
    { label: '总人口', value: d.totalPopulation ?? 0, icon: 'User', color: '#3978F6', bg: '#EAF1FE', tip: ACTIVE_SCOPE_TIP },
    { label: '家庭总数', value: d.familyCount ?? 0, icon: 'House', color: '#0E7C6B', bg: '#E4F4F0' },
    { label: '网格总数', value: d.gridCount ?? 0, icon: 'Grid', color: '#5B5BD6', bg: '#ECECFA' },
    { label: '党员人数', value: d.partyCount ?? 0, icon: 'Flag', color: '#E5484D', bg: '#FDECEC', tip: ACTIVE_SCOPE_TIP },
    { label: '退役军人', value: d.veteranCount ?? 0, icon: 'Medal', color: '#5B5BD6', bg: '#ECECFA', tip: ACTIVE_SCOPE_TIP },
    { label: '优抚对象', value: d.preferentialCount ?? 0, icon: 'Star', color: '#0E7C6B', bg: '#E4F4F0', tip: ACTIVE_SCOPE_TIP },
    { label: '低保家庭', value: d.lowIncomeFamilyCount ?? 0, icon: 'HomeFilled', color: '#F76B15', bg: '#FEF0E6', tip: FAMILY_TAG_SCOPE_TIP },
    { label: '低保对象', value: d.lowIncomePersonCount ?? 0, icon: 'UserFilled', color: '#F76B15', bg: '#FEF0E6', tip: ACTIVE_SCOPE_TIP },
    { label: '特困供养', value: d.extremePovertyCount ?? 0, icon: 'Grape', color: '#C2410C', bg: '#FEF0E6', tip: ACTIVE_SCOPE_TIP },
    { label: '残疾人', value: d.disabledCount ?? 0, icon: 'FirstAidKit', color: '#0E7C6B', bg: '#E4F4F0', tip: ACTIVE_SCOPE_TIP },
  ];
});

const ageOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 16, top: 20, bottom: 28 },
  xAxis: { type: 'category', data: dist.value.age.map((a: any) => a.band) },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: dist.value.age.map((a: any) => a.cnt), barWidth: 28, itemStyle: { color: '#3978F6', borderRadius: [6, 6, 0, 0] } }],
}));

const genderOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0 },
  series: [{
    type: 'pie',
    radius: ['45%', '68%'],
    data: dist.value.gender.map((g: any) => ({ name: g.gender === 'MALE' ? '男' : '女', value: g.cnt })),
    label: { formatter: '{b}: {c}' },
    color: ['#3978F6', '#0E7C6B'],
  }],
}));

const gridOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 16, top: 20, bottom: 28 },
  xAxis: { type: 'category', data: dist.value.grids.map((g: any) => g.name) },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: dist.value.grids.map((g: any) => g.cnt), barWidth: 28, itemStyle: { color: '#5B5BD6', borderRadius: [6, 6, 0, 0] } }],
}));

const tagOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 90, right: 20, top: 10, bottom: 24 },
  xAxis: { type: 'value' },
  yAxis: { type: 'category', data: dist.value.tags.map((t: any) => t.name).reverse() },
  series: [{ type: 'bar', data: dist.value.tags.map((t: any) => t.cnt).reverse(), barWidth: 14, itemStyle: { color: '#0E7C6B', borderRadius: [0, 6, 6, 0] } }],
}));

function typeLabel(t: string) {
  const map: Record<string, string> = { CREATE: '新增', UPDATE: '更新', STATUS_CHANGE: '状态变更', TAG: '标签' };
  return map[t] || t;
}
function typeTag(t: string) {
  const map: Record<string, any> = { CREATE: 'success', UPDATE: 'primary', STATUS_CHANGE: 'warning', TAG: 'info' };
  return map[t] || 'info';
}
function importLabel(s: string) {
  const map: Record<string, string> = { PENDING: '待处理', RUNNING: '处理中', SUCCESS: '成功', FAILED: '失败', PARTIAL: '部分成功' };
  return map[s] || s;
}
function importTag(s: string) {
  const map: Record<string, any> = { SUCCESS: 'success', FAILED: 'danger', PARTIAL: 'warning', RUNNING: 'primary', PENDING: 'info' };
  return map[s] || 'info';
}
/** 导入是同步执行，长时间停在「处理中」说明进程中断了（后端会自动收敛为失败） */
function isImportStale(row: any) {
  if (row.status !== 'RUNNING' || !row.created_at) return false;
  const t = new Date(String(row.created_at).replace(/-/g, '/')).getTime();
  return Number.isFinite(t) && Date.now() - t > 10 * 60 * 1000;
}

const importLoading = ref(false);

/** 进度条各段占比（相对总行数），避免出现 NaN */
function pct(row: any, kind: 'success' | 'pending' | 'fail') {
  const total = Number(row.total_rows) || 1;
  const v = kind === 'success' ? row.success_count : kind === 'pending' ? row.pending_count : row.fail_count;
  return Math.min(100, Math.round((Number(v || 0) / total) * 100));
}

async function loadImports() {
  importLoading.value = true;
  try {
    const im = await statisticsApi.imports();
    imports.value = im.data || [];
  } finally { importLoading.value = false; }
}

onMounted(async () => {
  const [d, di, c] = await Promise.all([
    statisticsApi.dashboard(),
    statisticsApi.distributions(),
    statisticsApi.changes(),
  ]);
  dash.value = d.data;
  dist.value = di.data;
  changes.value = c.data || [];
  loadImports();
});
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}
.stat-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-card);
  padding: 20px;
  box-shadow: var(--shadow-card);
  display: flex;
  align-items: center;
  gap: 14px;
}
.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.scope-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: var(--color-bg-card);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-button);
  padding: 8px 12px;
  margin-top: -8px;
}
.scope-note strong { color: var(--color-primary); font-weight: 600; }
.stat-value {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.1;
}
.stat-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-top: 2px;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.card-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 12px;
}
.bottom-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.card-head { display: flex; align-items: center; justify-content: space-between; }
.card-head .card-title { margin-bottom: 12px; }
.head-actions { display: flex; align-items: center; gap: 4px; }

/* 最近导入任务：卡片式进度展示 */
.import-list { min-height: 120px; display: flex; flex-direction: column; gap: 10px; }
.import-item { border: 1px solid var(--color-border); border-radius: var(--radius-button); padding: 10px 12px; transition: border-color var(--transition-fast); }
.import-item:hover { border-color: var(--color-primary); }
.ii-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ii-stale { font-size: var(--font-size-xs); color: #B42318; }
.ii-batch { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ii-bar { margin: 8px 0 6px; }
.ii-track { display: flex; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.ii-ok { background: #0E7C6B; }
.ii-pending { background: #F76B15; }
.ii-fail { background: #E5484D; }
.ii-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.ii-total { color: var(--color-text-regular); font-weight: 600; }
.dot-ok::before, .dot-pending::before, .dot-fail::before {
  content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; vertical-align: 1px;
}
.dot-ok::before { background: #0E7C6B; }
.dot-pending::before { background: #F76B15; }
.dot-fail::before { background: #E5484D; }
.ii-time { margin-left: auto; color: var(--color-text-secondary); }
.ii-tip { margin-top: 6px; font-size: var(--font-size-xs); color: #C2410C; background: #FEF0E6; border-radius: var(--radius-button); padding: 4px 8px; display: flex; align-items: center; gap: 6px; }

@media (max-width: 1100px) {
  .stat-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .chart-grid,
  .bottom-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 768px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
