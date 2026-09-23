<script setup>
/**
 * Running takings through the month: this month (accent line + 10% wash)
 * against last month (quiet context line). One y-axis, crosshair tooltip.
 */
import { computed, ref } from 'vue'
import ChartTooltip from './ChartTooltip.vue'
import { useWidth } from '../../composables/useWidth.js'
import { compactMoney, niceTicks } from '../../lib/stats.js'
import { fmt, shortDate } from '../../lib/format.js'

const props = defineProps({
  current: { type: Array, required: true }, // [{ date, value }]
  previous: { type: Array, default: () => [] },
  currentLabel: { type: String, default: 'This month' },
  previousLabel: { type: String, default: 'Last month' },
  height: { type: Number, default: 180 },
})

const box = ref(null)
const width = useWidth(box)
const pad = { top: 10, right: 12, bottom: 24, left: 44 }
const n = computed(() => Math.max(props.previous.length, props.current.length, 2))
const ticks = computed(() => niceTicks(Math.max(1, ...props.current.map((p) => p.value), ...props.previous.map((p) => p.value))))
const yMax = computed(() => ticks.value[ticks.value.length - 1])
const x = (i) => pad.left + (i / (n.value - 1)) * (width.value - pad.left - pad.right)
const y = (v) => pad.top + (1 - v / yMax.value) * (props.height - pad.top - pad.bottom)
const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
const area = computed(() => {
  const pts = props.current
  if (!pts.length) return ''
  return `${path(pts)}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
})
const last = computed(() => props.current[props.current.length - 1])

// x-axis: first, middle and last day of the period
const xLabels = computed(() => {
  const dates = (props.previous.length >= props.current.length ? props.previous : props.current).map((p) => p.date)
  const count = n.value
  return [0, Math.floor((count - 1) / 2), count - 1].map((i) => ({ i, label: `Day ${i + 1}` }))
})

const hover = ref(null)
function onMove(e) {
  const rect = box.value.getBoundingClientRect()
  const px = e.clientX - rect.left
  const i = Math.round(((px - pad.left) / (width.value - pad.left - pad.right)) * (n.value - 1))
  hover.value = Math.min(Math.max(i, 0), n.value - 1)
}
const tip = computed(() => {
  const i = hover.value
  if (i === null) return null
  const c = props.current[i]
  const p = props.previous[i]
  const rows = []
  if (c) rows.push({ label: props.currentLabel, value: fmt(c.value), color: 'var(--series-1)' })
  if (p) rows.push({ label: props.previousLabel, value: fmt(p.value), color: 'var(--series-ghost)' })
  return {
    x: x(i),
    y: Math.min(y(c?.value ?? p?.value ?? 0), y(p?.value ?? c?.value ?? 0)) - 10,
    title: `Day ${i + 1}${c ? ' · ' + shortDate(c.date) : ''}`,
    rows,
  }
})
</script>

<template>
  <div ref="box" class="chart" @pointermove="onMove" @pointerdown="onMove" @pointerleave="hover = null">
    <svg :width="width" :height="height" role="img" :aria-label="`${currentLabel}: ${last ? fmt(last.value) : 'no takings yet'}`">
      <g v-for="t in ticks" :key="t">
        <line class="grid-line" :x1="pad.left" :x2="width - pad.right" :y1="y(t)" :y2="y(t)" />
        <text :x="pad.left - 8" :y="y(t) + 4" text-anchor="end">{{ compactMoney(t) }}</text>
      </g>
      <line class="base-line" :x1="pad.left" :x2="width - pad.right" :y1="y(0)" :y2="y(0)" />
      <text v-for="l in xLabels" :key="l.i" :x="x(l.i)" :y="height - 6" :text-anchor="l.i === 0 ? 'start' : l.i === n - 1 ? 'end' : 'middle'">{{ l.label }}</text>

      <path v-if="previous.length" :d="path(previous)" fill="none" stroke="var(--series-ghost)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <path :d="area" fill="var(--series-1)" opacity="0.1" />
      <path v-if="current.length" :d="path(current)" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <circle v-if="last" :cx="x(current.length - 1)" :cy="y(last.value)" r="4.5" fill="var(--series-1)" stroke="var(--card)" stroke-width="2" />

      <g v-if="tip">
        <line class="crosshair" :x1="tip.x" :x2="tip.x" :y1="pad.top" :y2="y(0)" />
        <circle v-if="previous[hover]" :cx="tip.x" :cy="y(previous[hover].value)" r="4" fill="var(--series-ghost)" stroke="var(--card)" stroke-width="2" />
        <circle v-if="current[hover]" :cx="tip.x" :cy="y(current[hover].value)" r="4.5" fill="var(--series-1)" stroke="var(--card)" stroke-width="2" />
      </g>
    </svg>
    <ChartTooltip v-if="tip" :x="tip.x" :y="Math.max(tip.y, 40)" :title="tip.title" :rows="tip.rows" :width="width" />
  </div>
</template>
