<template>
  <div ref="chartRef" class="vp-chart" :style="{ height }"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, PieChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';

/**
 * 按需引入：只注册工作台实际用到的图表与组件。
 * 原先 `import * as echarts from 'echarts'` 会把全部图表类型、坐标系、
 * 地图与渲染器一起打包（约 1.0 MB / gzip 343 kB），而这里只需要柱状图、饼图与折线图。
 * 该 chunk 本来就随工作台路由异步加载，瘦身后台首次进入工作台明显更快。
 */
echarts.use([BarChart, PieChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const props = withDefaults(
  defineProps<{
    option: EChartsOption;
    height?: string;
  }>(),
  { height: '300px' }
);

const chartRef = ref<HTMLElement>();
let chart: ReturnType<typeof echarts.init> | null = null;
let resizeObserver: ResizeObserver | null = null;

function render() {
  if (!chartRef.value) return;
  if (!chart) {
    chart = echarts.init(chartRef.value);
  }
  chart.setOption(props.option, true);
}

onMounted(() => {
  render();
  resizeObserver = new ResizeObserver(() => chart?.resize());
  if (chartRef.value) resizeObserver.observe(chartRef.value);
});

watch(() => props.option, render, { deep: true });

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.vp-chart {
  width: 100%;
}
</style>
