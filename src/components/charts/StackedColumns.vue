<script setup>
/**
 * Stacked columns: one column per month, one segment per employee (2px surface gap
 * between segments, 4px rounded top). Tooltip lists every employee for that month.
 */
import { computed, ref } from 'vue'
import ChartTooltip from './ChartTooltip.vue'
import { useWidth } from '../../composables/useWidth.js'
import { compactMoney, niceTicks } from '../../lib/stats.js'
import { fmt } from '../../lib/format.js'

const props = defineProps({
  columns: { type: Array, required: true }, // [{ label, title, parts: { [seriesKey]: value } }]
  series: { type: Array, required: true }, // [{ key, label, color }]
  height: { type: Number, default: 200 },
})

const box = ref(null)
const width = useWidth(box)
const pad = { top: 10, right: 6, bottom: 24, left: 44 }
const totals = computed(() => props.columns.map((c) => props.series.reduce((s, k) => s + (c.parts[k.key] || 0), 0)))
const ticks = computed(() => niceTicks(Math.max(1, ...totals.value)))
const yMax = computed(() => ticks.value[ticks.value.length - 1])
const band = computed(() => (width.value - pad.left - pad.right) / props.columns.length)
const barW = computed(() => Math.min(24, band.value * 0.62))
const y = (v) => pad.top + (1 - v / yMax.value) * (props.height - pad.top - pad.bottom)
const center = (i) => pad.left + band.value * (i + 0.5)

const segments = computed(() =>
  props.columns.map((c, i) => {
    let acc = 0
    const parts = props.series.filter((s) => c.parts[s.key] > 0)
    return parts.map((s, j) => {
      const v = c.parts[s.key]
      const y0 = y(acc)
      acc += v
      const y1 = y(acc)
      const gap = j > 0 ? 2 : 0 // surface gap between stacked segments
      const top = y1
      const bottom = y0 - gap
      const h = Math.max(0, bottom - top)
      const isTop = j === parts.length - 1
      const w = barW.value
      const x0 = center(i) - w / 2
      const r = isTop ? Math.min(4, h, w / 2) : 0
      const d = h < 0.5 ? '' : `M${x0},${bottom}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${bottom}Z`
      return { key: s.key, d, color: s.color }
    })
  }),
)

const hover = ref(null)
const tip = computed(() => {
  if (hover.value === null) return null
  const c = props.columns[hover.value]
  const rows = props.series
    .filter((s) => c.parts[s.key])
    .map((s) => ({ label: s.label, value: fmt(c.parts[s.key]), color: s.color }))
  rows.push({ label: 'Total', value: fmt(totals.value[hover.value]) })
  return { x: center(hover.value), y: y(totals.value[hover.value]) - 8, title: c.title || c.label, rows }
})
</script>

<template>
  <div ref="box" class="chart" @pointerleave="hover = null">
    <svg :width="width" :height="height" role="img" aria-label="Takings per month by team member">
      <g v-for="t in ticks" :key="t">
        <line class="grid-line" :x1="pad.left" :x2="width - pad.right" :y1="y(t)" :y2="y(t)" />
        <text :x="pad.left - 8" :y="y(t) + 4" text-anchor="end">{{ compactMoney(t) }}</text>
      </g>
      <line class="base-line" :x1="pad.left" :x2="width - pad.right" :y1="y(0)" :y2="y(0)" />
      <g v-for="(segs, i) in segments" :key="columns[i].label" :opacity="hover !== null && hover !== i ? 0.55 : 1">
        <path v-for="s in segs" :key="s.key" :d="s.d" :fill="s.color" />
        <text :x="center(i)" :y="height - 6" text-anchor="middle">{{ columns[i].label }}</text>
        <rect :x="center(i) - band / 2" :y="pad.top" :width="band" :height="height - pad.top" fill="transparent"
              tabindex="0" @pointerenter="hover = i" @pointerdown="hover = i" @focus="hover = i" @blur="hover = null" />
      </g>
    </svg>
    <ChartTooltip v-if="tip" :x="tip.x" :y="Math.max(tip.y, 60)" :title="tip.title" :rows="tip.rows" :width="width" />
  </div>
</template>
