<script setup>
/** Home: new → returning → regular clients per team member this month (ordinal berry ramp), plus switches and rebooking. */
import { computed } from 'vue'
import { state, monthFlow, employeeById, employeeColor, openFlow } from '../store.js'
import { monthLabel } from '../lib/format.js'

const CATS = [
  { id: 'new', label: 'New', color: 'var(--flow-1)' },
  { id: 'returning', label: '2nd / 3rd visit', color: 'var(--flow-2)' },
  { id: 'regular', label: 'Regulars', color: 'var(--flow-3)' },
]
const monthName = computed(() => monthLabel(state.month).split(' ')[0])
const rows = computed(() => {
  const out = Object.entries(monthFlow.value)
    .map(([id, b]) => ({ id, name: employeeById(id)?.name || '?', b, total: b.new.length + b.returning.length + b.regular.length }))
    .filter((r) => r.total)
    .sort((a, b) => b.total - a.total)
  const max = Math.max(1, ...out.map((r) => r.total))
  return out.map((r) => ({ ...r, pct: (r.total / max) * 100 }))
})
const sum = (cat) => rows.value.reduce((n, r) => n + r.b[cat].length, 0)
const lastNew = computed(() => sum('lastMonthNew'))
const back = computed(() => sum('cameBack') + sum('cameBackToOther'))
const switches = computed(() => sum('switchedIn'))
</script>

<template>
  <section class="card">
    <div class="card-title"><h3>Client flow</h3><span class="hint">{{ monthName }} · tap a name</span></div>
    <div class="flow-summary">
      <div><b>{{ sum('new') }}</b><span>new clients</span></div>
      <div><b>{{ sum('returning') }}</b><span>2nd / 3rd visit</span></div>
      <div><b>{{ switches }}</b><span>switched team member</span></div>
      <div v-if="lastNew"><b>{{ back }}/{{ lastNew }}</b><span>of last month's new clients came back</span></div>
    </div>
    <div v-if="rows.length" class="flow-rows">
      <button v-for="r in rows" :key="r.id" class="flow-row" @click="openFlow(r.id, 'new')">
        <div class="top-line">
          <span class="who"><i class="swatch-dot" :style="{ background: employeeColor(r.id) }" />{{ r.name }}</span>
          <span class="flow-nums">
            <template v-for="(c, i) in CATS" :key="c.id"><span v-if="i">·</span> {{ r.b[c.id].length }}</template>
          </span>
        </div>
        <div class="flow-bar" :style="{ width: r.pct + '%' }" role="img"
             :aria-label="`${r.name}: ${r.b.new.length} new, ${r.b.returning.length} second or third visit, ${r.b.regular.length} regulars`">
          <div v-for="c in CATS.filter((c) => r.b[c.id].length)" :key="c.id" :style="{ flex: r.b[c.id].length, background: c.color }" />
        </div>
      </button>
    </div>
    <div v-else class="empty" style="padding: 16px">No clients yet this month.</div>
    <div class="legend" style="margin-top: 10px">
      <span v-for="c in CATS" :key="c.id" class="key"><i class="swatch" :style="{ background: c.color }" />{{ c.label }}</span>
    </div>
  </section>
</template>
