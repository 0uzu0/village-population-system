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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { statisticsApi } from '@/api';
import VpChart from '@/components/VpChart.vue';
import type { EChartsOption } from 'echarts';

const dash = ref<any>({});
const dist = ref<any>({ age: [], gender: [], grids: [] });
const changes = ref<any[]>([]);

const statCards = computed(() => {
  const d = dash.value;
  // 「总人口」口径 = 户籍人口 + 流动人口（2026-10 口径调整：原「常住人口」
  // 更名为「流动人口」，标签编码 RESIDENT_POP → FLOATING_POP）。
  // v2.1.0 起流动人口定义 = 户籍不在本村、暂住本村的人员，与户籍人口
  // **互斥不存在交叉**（打标签侧互斥 + 统计按户籍优先排除兜底），
  // 因此总人口直接相加即得。户籍/流动各自单列一块，方便核对总人口构成。
  const hukou = d.hukouCount ?? 0;
  const floating = d.floatingCount ?? 0;
  return [
    { label: '总人口', value: hukou + floating, icon: 'User', color: '#3978F6', bg: '#EAF1FE' },
    { label: '户籍人口', value: hukou, icon: 'UserFilled', color: '#3978F6', bg: '#EAF1FE' },
    { label: '流动人口', value: floating, icon: 'Position', color: '#3978F6', bg: '#EAF1FE' },
    { label: '家庭总数', value: d.familyCount ?? 0, icon: 'House', color: '#0E7C6B', bg: '#E4F4F0' },
    { label: '网格总数', value: d.gridCount ?? 0, icon: 'Grid', color: '#5B5BD6', bg: '#ECECFA' },
    { label: '党员人数', value: d.partyCount ?? 0, icon: 'Flag', color: '#E5484D', bg: '#FDECEC' },
    { label: '退役军人', value: d.veteranCount ?? 0, icon: 'Medal', color: '#5B5BD6', bg: '#ECECFA' },
    { label: '优抚对象', value: d.preferentialCount ?? 0, icon: 'Star', color: '#0E7C6B', bg: '#E4F4F0' },
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

function typeLabel(t: string) {
  const map: Record<string, string> = { CREATE: '新增', UPDATE: '更新', STATUS_CHANGE: '状态变更', TAG: '标签', DELETE: '删除' };
  return map[t] || t;
}
function typeTag(t: string) {
  const map: Record<string, any> = { CREATE: 'success', UPDATE: 'primary', STATUS_CHANGE: 'warning', TAG: 'info', DELETE: 'danger' };
  return map[t] || 'info';
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
  grid-template-columns: repeat(3, 1fr);
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
  grid-template-columns: 1fr;
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
