<script setup>
/** Tiny trend line: history in a quiet tone, the latest point in the accent colour. */
import { computed } from 'vue'

const props = defineProps({
  values: { type: Array, required: true },
  color: { type: String, default: 'var(--series-1)' },
  width: { type: Number, default: 120 },
  height: { type: Number, default: 36 },
  label: { type: String, default: '' },
})
const max = computed(() => Math.max(1, ...props.values))
const x = (i) => 3 + (i / Math.max(1, props.values.length - 1)) * (props.width - 6)
const y = (v) => 3 + (1 - v / max.value) * (props.height - 6)
const d = computed(() => props.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''))
</script>

<template>
  <svg :width="width" :height="height" role="img" :aria-label="label" style="display:block;overflow:visible">
    <path :d="d" fill="none" stroke="var(--series-ghost)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    <path :d="`${d}L${x(values.length - 1)},${height}L${x(0)},${height}Z`" :fill="color" opacity="0.08" />
    <circle :cx="x(values.length - 1)" :cy="y(values[values.length - 1] || 0)" r="4" :fill="color" stroke="var(--card)" stroke-width="2" />
  </svg>
</template>
