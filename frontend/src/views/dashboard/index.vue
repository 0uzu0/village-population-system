<template>
  <div class="dashboard">
    <!-- 统计卡片 -->
    <div class="stat-grid">
      <div v-for="card in statCards" :key="card.label" class="stat-card">
        <div class="stat-icon" :style="{ background: card.bg, color: card.color }">
          <el-icon :size="22"><component :is="card.icon" /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ card.value }}</div>
          <div class="stat-label">{{ card.label }}</div>
        </div>
      </div>
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
        <div class="card-title">最近导入任务</div>
        <el-table :data="imports" size="small">
          <el-table-column prop="batch_no" label="批次号" width="140" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="importTag(row.status)">{{ importLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="成功/失败" width="90">
            <template #default="{ row }">{{ row.success_count }}/{{ row.fail_count }}</template>
          </el-table-column>
          <el-table-column prop="created_at" label="时间" width="160" />
        </el-table>
        <el-empty v-if="!imports.length" description="暂无导入记录" :image-size="60" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { statisticsApi } from '@/api';
import VpChart from '@/components/VpChart.vue';
import type { EChartsOption } from 'echarts';

const dash = ref<any>({});
const dist = ref<any>({ age: [], gender: [], grids: [], tags: [] });
const changes = ref<any[]>([]);
const imports = ref<any[]>([]);

const statCards = computed(() => {
  const d = dash.value;
  return [
    { label: '总人口', value: d.totalPopulation ?? 0, icon: 'User', color: '#3978F6', bg: '#EAF1FE' },
    { label: '家庭总数', value: d.familyCount ?? 0, icon: 'House', color: '#0E7C6B', bg: '#E4F4F0' },
    { label: '网格总数', value: d.gridCount ?? 0, icon: 'Grid', color: '#5B5BD6', bg: '#ECECFA' },
    { label: '党员人数', value: d.partyCount ?? 0, icon: 'Flag', color: '#E5484D', bg: '#FDECEC' },
    { label: '退役军人', value: d.veteranCount ?? 0, icon: 'Medal', color: '#5B5BD6', bg: '#ECECFA' },
    { label: '优抚对象', value: d.preferentialCount ?? 0, icon: 'Star', color: '#0E7C6B', bg: '#E4F4F0' },
    { label: '低保家庭', value: d.lowIncomeFamilyCount ?? 0, icon: 'HomeFilled', color: '#F76B15', bg: '#FEF0E6' },
    { label: '低保对象', value: d.lowIncomePersonCount ?? 0, icon: 'UserFilled', color: '#F76B15', bg: '#FEF0E6' },
    { label: '特困供养', value: d.extremePovertyCount ?? 0, icon: 'Grape', color: '#C2410C', bg: '#FEF0E6' },
    { label: '残疾人', value: d.disabledCount ?? 0, icon: 'FirstAidKit', color: '#0E7C6B', bg: '#E4F4F0' },
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

onMounted(async () => {
  const [d, di, c, im] = await Promise.all([
    statisticsApi.dashboard(),
    statisticsApi.distributions(),
    statisticsApi.changes(),
    statisticsApi.imports(),
  ]);
  dash.value = d.data;
  dist.value = di.data;
  changes.value = c.data || [];
  imports.value = im.data || [];
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
.stat-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.1;
}
.stat-label {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-top: 2px;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 12px;
}
.bottom-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

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
