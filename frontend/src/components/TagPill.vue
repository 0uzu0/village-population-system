<template>
  <div class="vp-pill" :style="{ background: bg, color }">
    <span v-if="dot" class="dot" :style="{ background: color }"></span>
    {{ name }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ name: string; color: string; dot?: boolean }>();

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
  height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-tag);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
</style>
