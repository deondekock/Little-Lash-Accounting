<script setup>
import { computed } from 'vue'
import PeriodNav from '../components/PeriodNav.vue'
import EmployeeChips from '../components/EmployeeChips.vue'
import Columns from '../components/charts/Columns.vue'
import StackedColumns from '../components/charts/StackedColumns.vue'
import TotalsTable from '../components/TotalsTable.vue'
import Icon from '../components/Icon.vue'
import { all, state, employeeColor, employeeById, changeYear, changeMonth, setEmployee, setView } from '../store.js'
import { byEmployee, fmt, fmt0, monthName, totals, METHODS } from '../lib/format.js'
import { compactMoney, monthlyTotals } from '../lib/stats.js'

const forEmployee = (list) => (state.employee === 'all' ? list : list.filter((a) => a.employeeId === state.employee))
const year = computed(() => forEmployee(all.value.filter((a) => a.month.startsWith(String(state.year)))))
const lastYear = computed(() => forEmployee(all.value.filter((a) => a.month.startsWith(String(state.year - 1)))))
const t = computed(() => totals(year.value))

// Compare with the same months of last year (up to the latest month that has data this year).
const lastMonthWithData = computed(() => year.value.reduce((m, a) => (a.month > m ? a.month : m), ''))
const sameSpanLastYear = computed(() => {
  if (!lastMonthWithData.value) return 0
  const cut = `${state.year - 1}${lastMonthWithData.value.slice(4)}`
  return lastYear.value.filter((a) => a.month <= cut).reduce((s, a) => s + a.amount, 0)
})
const change = computed(() => (sameSpanLastYear.value ? (t.value.total - sameSpanLastYear.value) / sameSpanLastYear.value : null))

const short = (m) => monthName(m).slice(0, 3)
const months = computed(() => {
  const cur = monthlyTotals(year.value, state.year)
  const prev = monthlyTotals(lastYear.value, state.year - 1)
  return cur.map((c, i) => ({ label: short(i + 1)[0], title: `${monthName(i + 1)} ${state.year}`, value: c.total, ghost: prev[i].total, month: c.month }))
})
const best = computed(() => months.value.reduce((b, m) => (m.value > b.value ? m : b), months.value[0]))

const team = computed(() => byEmployee(all.value.filter((a) => a.month.startsWith(String(state.year))), state.employees))
const stackSeries = computed(() => team.value.map((r) => ({ key: r.id, label: r.name, color: employeeColor(r.id) })))
const stackColumns = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const key = `${state.year}-${String(i + 1).padStart(2, '0')}`
    const parts = {}
    for (const a of all.value) if (a.month === key) parts[a.employeeId] = (parts[a.employeeId] || 0) + a.amount
    return { label: short(i + 1)[0], title: `${monthName(i + 1)} ${state.year}`, parts }
  }),
)

const tableRows = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const key = `${state.year}-${String(i + 1).padStart(2, '0')}`
    const tt = totals(year.value.filter((a) => a.month === key))
    return { key, label: monthName(i + 1), t: tt, muted: !tt.count }
  }),
)
const teamRows = computed(() => team.value.map((r) => ({ key: r.id, label: r.name, t: r.t, color: employeeColor(r.id) })))

const methodShare = computed(() => {
  const total = t.value.total || 1
  return METHODS.map((m, i) => ({ m, value: t.value[m], pct: Math.round((t.value[m] / total) * 100), color: `var(--series-${i + 1})` }))
})

function openMonth(month) {
  changeMonth(month)
  setView('payments')
}
function pickEmployee(id) {
  setEmployee(id)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <div class="page">
    <PeriodNav :label="String(state.year)" mode="year" @prev="changeYear(-1)" @next="changeYear(1)">
      <div class="range">Jan – Dec (business months)</div>
    </PeriodNav>
    <EmployeeChips />

    <section class="card hero">
      <div class="eyebrow">{{ state.employee === 'all' ? 'Salon' : employeeById(state.employee)?.name }} takings in {{ state.year }}</div>
      <div class="figure">{{ fmt0(t.total) }}</div>
      <div class="meta">
        <span v-if="change !== null" class="delta" :class="change > 0.005 ? 'up' : change < -0.005 ? 'down' : 'flat'">
          <Icon :name="change < 0 ? 'trendDown' : 'trendUp'" :size="14" :stroke="2.4" />
          {{ change > 0 ? '+' : '' }}{{ Math.round(change * 100) }}%
        </span>
        <span v-if="change !== null">vs same months of {{ state.year - 1 }} ({{ fmt0(sameSpanLastYear) }})</span>
        <span>{{ t.count.toLocaleString('en-ZA') }} appointments</span>
      </div>
      <div style="margin-top: 16px">
        <Columns :items="months" :value-label="String(state.year)" :ghost-label="String(state.year - 1)" :format="(v) => fmt0(v)" :axis-format="compactMoney" :height="190" />
      </div>
      <div class="legend" style="margin-top: 6px">
        <span class="key"><i class="swatch" style="background: var(--series-1)" />{{ state.year }}</span>
        <span class="key"><i class="swatch" style="background: var(--series-ghost)" />{{ state.year - 1 }}</span>
        <span v-if="best?.value" class="key" style="margin-left: auto">Best month: <b style="color: var(--ink)">{{ best.title.split(' ')[0] }}</b></span>
      </div>
    </section>

    <div class="grid two" style="margin-top: 14px">
      <section v-if="state.employee === 'all' && stackSeries.length" class="card">
        <div class="card-title"><h3>Who earned what</h3><span class="hint">per month</span></div>
        <StackedColumns :columns="stackColumns" :series="stackSeries" />
        <div class="legend" style="margin-top: 8px">
          <span v-for="s in stackSeries" :key="s.key" class="key"><i class="swatch" :style="{ background: s.color }" />{{ s.label }}</span>
        </div>
      </section>

      <section class="card">
        <div class="card-title"><h3>How clients paid</h3><span class="hint">{{ state.year }}</span></div>
        <div class="share" role="img" :aria-label="methodShare.map((s) => `${s.m} ${s.pct}%`).join(', ')">
          <div v-for="s in methodShare.filter((x) => x.value > 0)" :key="s.m" :style="{ flex: s.value, background: s.color }" />
        </div>
        <div class="share-legend">
          <div v-for="s in methodShare" :key="s.m">
            <div class="name"><i class="swatch" :style="{ background: s.color, width: '10px', height: '10px', borderRadius: '3px', display: 'inline-block' }" />{{ s.m }}</div>
            <div class="amt">{{ compactMoney(s.value) }}</div>
            <div class="pct">{{ s.pct }}%</div>
          </div>
        </div>
      </section>
    </div>

    <div class="section-label">Month by month <span style="text-transform: none; letter-spacing: 0; font-weight: 500">tap a month to open it</span></div>
    <TotalsTable :rows="tableRows" heading="Month" :footer-label="String(state.year)" always-footer @select="openMonth" />

    <template v-if="state.employee === 'all' && teamRows.length">
      <div class="section-label">Per team member</div>
      <TotalsTable :rows="teamRows" @select="pickEmployee" />
    </template>
  </div>
</template>
