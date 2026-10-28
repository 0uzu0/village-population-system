<template>
  <div class="page">
    <div class="vp-page-header">
      <div>
        <h2 class="vp-page-title">台账统计分析</h2>
        <div class="vp-page-subtitle">按条口 / 工作类型汇总人工与发票费用</div>
      </div>
      <el-button @click="goBack"><el-icon><ArrowLeft /></el-icon>返回台账</el-button>
    </div>

    <div class="vp-container">
      <!-- 筛选 -->
      <div class="filter-bar">
        <el-select v-model="filters.category" placeholder="条口" clearable style="width: 140px" @change="onCategoryChange">
          <el-option v-for="c in categories" :key="c.code" :label="c.name" :value="c.code" />
        </el-select>
        <el-select v-model="filters.workType" placeholder="工作类型" clearable style="width: 150px">
          <el-option v-for="w in workTypeOptions" :key="w.code" :label="w.name" :value="w.code" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 260px"
        />
        <el-button type="primary" @click="loadStats"><el-icon><Search /></el-icon>统计</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>

      <!-- 指标卡 -->
      <div class="cards">
        <div class="card">
          <div class="card-label">记录数</div>
          <div class="card-value">{{ summary.recordCount }}</div>
        </div>
        <div class="card">
          <div class="card-label">总费用</div>
          <div class="card-value total">{{ money(summary.totalCost) }}</div>
        </div>
        <div class="card">
          <div class="card-label">人工费</div>
          <div class="card-value labor">{{ money(summary.laborCost) }}</div>
        </div>
        <div class="card">
          <div class="card-label">发票费</div>
          <div class="card-value invoice">{{ money(summary.invoiceCost) }}</div>
        </div>
        <div class="card">
          <div class="card-label">附件数</div>
          <div class="card-value">{{ summary.attachmentCount }}</div>
        </div>
      </div>

      <!-- 图表 -->
      <div class="chart-grid">
        <div class="chart-box">
          <div class="chart-title">按条口费用分布</div>
          <VpChart :option="categoryOption" height="300px" />
        </div>
        <div class="chart-box">
          <div class="chart-title">按工作类型费用</div>
          <VpChart :option="workTypeOption" height="300px" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Search, ArrowLeft } from '@element-plus/icons-vue';
import type { EChartsOption } from 'echarts';
import { ledgerApi } from '@/api';
import { formatMoney } from '@/utils/format';
import VpChart from '@/components/VpChart.vue';

const router = useRouter();
const categories = ref<any[]>([]);
const workTypeOptions = ref<{ code: string; name: string }[]>([]);
const dateRange = ref<string[]>([]);
const filters = reactive({ category: '', workType: '' });

const summary = reactive({ recordCount: 0, totalCost: 0, laborCost: 0, invoiceCost: 0, attachmentCount: 0 });
const byCategory = ref<any[]>([]);
const byWorkType = ref<any[]>([]);

// 与台账列表页共用同一实现，避免两处小数位/千分位写法逐渐分叉
const money = formatMoney;

function onCategoryChange() {
  filters.workType = '';
  workTypeOptions.value = categories.value.find((c) => c.code === filters.category)?.workTypes || [];
}

function resetFilters() {
  filters.category = '';
  filters.workType = '';
  dateRange.value = [];
  workTypeOptions.value = [];
  loadStats();
}

const baseGrid = { left: '3%', right: '4%', bottom: '3%', containLabel: true };

const categoryOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
  legend: { bottom: 0 },
  series: [{
    type: 'pie', radius: ['40%', '65%'],
    data: byCategory.value.map((c) => ({ name: c.name, value: c.totalCost })),
  }],
}));

const workTypeOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis', valueFormatter: (v: any) => money(v) },
  grid: baseGrid,
  xAxis: { type: 'category', data: byWorkType.value.map((w) => w.name), axisLabel: { interval: 0 } },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: byWorkType.value.map((w) => w.totalCost), itemStyle: { color: '#3978F6' } }],
}));

async function loadStats() {
  const params: any = {
    category: filters.category || undefined,
    workType: filters.workType || undefined,
    start: dateRange.value?.[0],
    end: dateRange.value?.[1],
  };
  const res: any = await ledgerApi.stats(params);
  const d = res.data;
  Object.assign(summary, d.summary);
  byCategory.value = d.byCategory;
  byWorkType.value = d.byWorkType;
}

function goBack() {
  router.push('/ledgers');
}

onMounted(async () => {
  const meta: any = await ledgerApi.meta();
  categories.value = meta.data;
  loadStats();
});
</script>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  padding: 16px;
}
.card-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}
.card-value {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--color-text-primary);
}
.card-value.total { color: #3978F6; }
.card-value.labor { color: #FA8C16; }
.card-value.invoice { color: #EB2F96; }
.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.chart-box {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  padding: 12px;
}
.chart-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  margin-bottom: 8px;
}
@media (max-width: 900px) {
  .cards { grid-template-columns: repeat(3, 1fr); }
  .chart-grid { grid-template-columns: 1fr; }
}
</style>
