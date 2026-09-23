<script setup>
/**
 * Vertical columns (≤24px, 4px rounded tops, square at the baseline).
 * Optional `ghost` values draw a quiet paired column (e.g. last year) on the same axis.
 * Every column has its own hover/tap tooltip; the largest value is labelled on its cap.
 */
import { computed, ref } from 'vue'
import ChartTooltip from './ChartTooltip.vue'
import { useWidth } from '../../composables/useWidth.js'
import { niceTicks } from '../../lib/stats.js'

const props = defineProps({
  items: { type: Array, required: true }, // [{ label, value, ghost?, title? }]
  color: { type: String, default: 'var(--series-1)' },
  valueLabel: { type: String, default: '' },
  ghostLabel: { type: String, default: '' },
  format: { type: Function, default: (v) => String(v) },
  axisFormat: { type: Function, default: null },
  height: { type: Number, default: 170 },
  labelMax: { type: Boolean, default: true },
})

const box = ref(null)
const width = useWidth(box)
const pad = { top: 18, right: 6, bottom: 24, left: 40 }
const hasGhost = computed(() => props.items.some((d) => d.ghost != null))
const ticks = computed(() => niceTicks(Math.max(1, ...props.items.map((d) => Math.max(d.value, d.ghost || 0)))))
const yMax = computed(() => ticks.value[ticks.value.length - 1])
const band = computed(() => (width.value - pad.left - pad.right) / props.items.length)
const barW = computed(() => Math.min(24, (band.value * (hasGhost.value ? 0.36 : 0.6))))
const y = (v) => pad.top + (1 - v / yMax.value) * (props.height - pad.top - pad.bottom)
const base = computed(() => y(0))
const maxIdx = computed(() => props.items.reduce((m, d, i, arr) => (d.value > arr[m].value ? i : m), 0))

/** Column path: 4px rounded data-end, square at the baseline. */
function col(cx, v) {
  const h = Math.max(0, base.value - y(v))
  if (h < 0.5) return ''
  const w = barW.value
  const r = Math.min(4, h, w / 2)
  const x0 = cx - w / 2
  const top = base.value - h
  return `M${x0},${base.value}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${base.value}Z`
}
const center = (i) => pad.left + band.value * (i + 0.5)
const mainX = (i) => (hasGhost.value ? center(i) + barW.value / 2 + 1 : center(i))
const ghostX = (i) => center(i) - barW.value / 2 - 1

const hover = ref(null)
const tip = computed(() => {
  if (hover.value === null) return null
  const d = props.items[hover.value]
  const rows = [{ label: props.valueLabel, value: props.format(d.value), color: props.color }]
  if (d.ghost != null) rows.push({ label: props.ghostLabel, value: props.format(d.ghost), color: 'var(--series-ghost)' })
  return { x: center(hover.value), y: y(Math.max(d.value, d.ghost || 0)) - 8, title: d.title || d.label, rows }
})
</script>

<template>
  <div ref="box" class="chart" @pointerleave="hover = null">
    <svg :width="width" :height="height" role="img" :aria-label="valueLabel">
      <g v-for="t in ticks" :key="t">
        <line class="grid-line" :x1="pad.left" :x2="width - pad.right" :y1="y(t)" :y2="y(t)" />
        <text :x="pad.left - 8" :y="y(t) + 4" text-anchor="end">{{ (axisFormat || format)(t) }}</text>
      </g>
      <line class="base-line" :x1="pad.left" :x2="width - pad.right" :y1="base" :y2="base" />
      <g v-for="(d, i) in items" :key="d.label">
        <path v-if="d.ghost != null" :d="col(ghostX(i), d.ghost)" fill="var(--series-ghost)" />
        <path :d="col(mainX(i), d.value)" :fill="color" :opacity="hover !== null && hover !== i ? 0.55 : 1" />
        <text v-if="labelMax && i === maxIdx && d.value > 0" :x="mainX(i)" :y="y(d.value) - 6" text-anchor="middle" style="fill: var(--ink); font-weight: 700">{{ format(d.value) }}</text>
        <text :x="center(i)" :y="height - 6" text-anchor="middle">{{ d.label }}</text>
        <!-- hit target: the whole band, taller than the mark -->
        <rect :x="center(i) - band / 2" :y="pad.top" :width="band" :height="base - pad.top + 20" fill="transparent"
              tabindex="0" @pointerenter="hover = i" @pointerdown="hover = i" @focus="hover = i" @blur="hover = null" />
      </g>
    </svg>
    <ChartTooltip v-if="tip" :x="tip.x" :y="Math.max(tip.y, 44)" :title="tip.title" :rows="tip.rows" :width="width" />
  </div>
</template>
