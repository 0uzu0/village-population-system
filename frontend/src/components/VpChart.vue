<template>
  <div ref="chartRef" class="vp-chart" :style="{ height }"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts';

const props = withDefaults(
  defineProps<{
    option: echarts.EChartsOption;
    height?: string;
  }>(),
  { height: '300px' }
);

const chartRef = ref<HTMLElement>();
let chart: echarts.ECharts | null = null;
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
