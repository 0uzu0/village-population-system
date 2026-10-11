<template>
  <div class="vp-pill" :class="{ 'is-highlight': highlight }" :style="{ background: bg, color }">
    <span v-if="dot" class="dot" :style="{ background: color }"></span>
    {{ name }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ name: string; color: string; dot?: boolean; highlight?: boolean }>();

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const bg = computed(() => hexToRgba(props.color, 0.12));
</script>

<style scoped>
.vp-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 11px;
  border-radius: var(--radius-tag);
  font-size: var(--font-size-xs);
  line-height: 1;
  white-space: nowrap;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
/* 命中当前筛选条件的标签：加描边强调 */
.vp-pill.is-highlight {
  box-shadow: 0 0 0 1.5px currentColor inset;
  font-weight: 600;
}
</style>
