<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">数据统计</h2>
        <div class="vp-page-subtitle">人口统计中心 · 所有数据来自数据库实时计算</div>
      </div>
    </div>

    <!-- 统计口径说明 -->
    <el-alert
      title="统计口径说明：总人口=状态为「正常/迁入」的档案数；各标签人数为有效关联的去重人数，存在交叉，不可相加；低保区分家庭级「低保家庭」与个人级「低保对象」。"
      type="info"
      :closable="false"
    />

    <!-- 核心指标 -->
    <div class="vp-container">
      <div class="card-title">核心指标</div>
      <div class="core-grid">
        <div class="core-card"><div class="v">{{ dash.totalPopulation ?? 0 }}</div><div class="l">全村总人口</div></div>
        <div class="core-card"><div class="v">{{ dash.hukouCount ?? 0 }}</div><div class="l">户籍人口</div></div>
        <div class="core-card"><div class="v">{{ dash.residentCount ?? 0 }}</div><div class="l">常住人口</div></div>
        <div class="core-card"><div class="v">{{ dash.familyCount ?? 0 }}</div><div class="l">家庭总数</div></div>
        <div class="core-card"><div class="v">{{ dash.gridCount ?? 0 }}</div><div class="l">网格总数</div></div>
      </div>
    </div>

    <!-- 重点人群统计 -->
    <div class="vp-container">
      <div class="card-title">重点人群统计（交叉口径）</div>
      <div class="core-grid">
        <div class="core-card"><div class="v">{{ dash.partyCount ?? 0 }}</div><div class="l">党员</div></div>
        <div class="core-card"><div class="v">{{ dash.veteranCount ?? 0 }}</div><div class="l">退役军人</div></div>
        <div class="core-card"><div class="v">{{ dash.preferentialCount ?? 0 }}</div><div class="l">优抚对象</div></div>
        <div class="core-card"><div class="v">{{ dash.lowIncomeFamilyCount ?? 0 }}</div><div class="l">低保家庭</div></div>
        <div class="core-card"><div class="v">{{ dash.lowIncomePersonCount ?? 0 }}</div><div class="l">低保对象</div></div>
        <div class="core-card"><div class="v">{{ dash.extremePovertyCount ?? 0 }}</div><div class="l">特困供养对象</div></div>
        <div class="core-card"><div class="v">{{ dash.disabledCount ?? 0 }}</div><div class="l">残疾人</div></div>
      </div>
    </div>

    <!-- 分布图表 -->
    <div class="chart-grid">
      <div class="vp-card"><div class="card-title">年龄分布</div><VpChart :option="ageOption" height="280px" /></div>
      <div class="vp-card"><div class="card-title">性别分布</div><VpChart :option="genderOption" height="280px" /></div>
      <div class="vp-card"><div class="card-title">网格人口分布</div><VpChart :option="gridOption" height="280px" /></div>
      <div class="vp-card"><div class="card-title">标签分布（Top15）</div><VpChart :option="tagOption" height="280px" /></div>
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

const ageOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 16, top: 20, bottom: 28 },
  xAxis: { type: 'category', data: dist.value.age.map((a: any) => a.band) },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: dist.value.age.map((a: any) => a.cnt), barWidth: 26, itemStyle: { color: '#3978F6', borderRadius: [6, 6, 0, 0] } }],
}));
const genderOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0 },
  series: [{ type: 'pie', radius: ['45%', '68%'], data: dist.value.gender.map((g: any) => ({ name: g.gender === 'MALE' ? '男' : '女', value: g.cnt })), color: ['#3978F6', '#0E7C6B'] }],
}));
const gridOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 16, top: 20, bottom: 28 },
  xAxis: { type: 'category', data: dist.value.grids.map((g: any) => g.name) },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: dist.value.grids.map((g: any) => g.cnt), barWidth: 26, itemStyle: { color: '#5B5BD6', borderRadius: [6, 6, 0, 0] } }],
}));
const tagOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 90, right: 20, top: 10, bottom: 24 },
  xAxis: { type: 'value' },
  yAxis: { type: 'category', data: dist.value.tags.map((t: any) => t.name).reverse() },
  series: [{ type: 'bar', data: dist.value.tags.map((t: any) => t.cnt).reverse(), barWidth: 14, itemStyle: { color: '#0E7C6B', borderRadius: [0, 6, 6, 0] } }],
}));

onMounted(async () => {
  const [d, di] = await Promise.all([statisticsApi.dashboard(), statisticsApi.distributions()]);
  dash.value = d.data;
  dist.value = di.data;
});
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.card-title { font-size: var(--font-size-base); font-weight: 600; margin-bottom: 14px; }
.core-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 14px; }
.core-card { background: var(--color-bg-subtle); border-radius: var(--radius-button); padding: 18px 14px; text-align: center; }
.core-card .v { font-size: var(--font-size-xl); font-weight: 700; color: var(--color-primary); }
.core-card .l { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-top: 4px; }
.chart-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
@media (max-width: 900px) {
  .core-grid { grid-template-columns: repeat(3, 1fr); }
  .chart-grid { grid-template-columns: 1fr; }
}
</style>
