<script setup>
import { computed } from 'vue'
import PeriodNav from '../components/PeriodNav.vue'
import EmployeeChips from '../components/EmployeeChips.vue'
import Columns from '../components/charts/Columns.vue'
import TotalsTable from '../components/TotalsTable.vue'
import Icon from '../components/Icon.vue'
import RebookTeam from '../components/RebookTeam.vue'
import RebookCard from '../components/RebookCard.vue'
import { all, state, serviceCatalog, employeeColor, employeeById, changeYear, changeMonth, setEmployee, setView, openReview, openService } from '../store.js'
import { byEmployee, fmt, fmt0, monthName, totals } from '../lib/format.js'
import { compactMoney, monthlyTotals, priceNudges } from '../lib/stats.js'

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

const tableRows = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const key = `${state.year}-${String(i + 1).padStart(2, '0')}`
    const tt = totals(year.value.filter((a) => a.month === key))
    return { key, label: monthName(i + 1), t: tt, muted: !tt.count }
  }),
)
const teamRows = computed(() => team.value.map((r) => ({ key: r.id, label: r.name, t: r.t, color: employeeColor(r.id) })))

// Smart price nudges — whole team (or the picked member), from the last 3 months of real prices + volume.
const nudges = computed(() => priceNudges(serviceCatalog.value, all.value, { employeeId: state.employee }))
const nudgeWho = computed(() => (state.employee === 'all' ? 'whole team' : employeeById(state.employee)?.name || 'this person'))
function openNudge(n) {
  const s = serviceCatalog.value.find((x) => x.key === n.key)
  if (s) openService(s)
}

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

    <button class="card list-row review-cta" @click="openReview()">
      <div class="history-icon">✨</div>
      <div class="grow"><div class="title">Year in review</div><div class="meta">Busiest days, most loyal clients, milestones — and a summary to share</div></div>
      <Icon name="right" />
    </button>

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

    <section v-if="nudges.rows.length" class="card" style="margin-top: 14px">
      <div class="card-title"><h3>Smart price nudges</h3><span class="hint">{{ nudgeWho }} · last 3 months</span></div>
      <p class="muted-note" style="margin: 0 0 10px">A ~5% lift on your busiest services, across everyone who does them. Tap one to set the price.</p>
      <div class="list">
        <button v-for="n in nudges.rows" :key="n.key" type="button" class="list-row" @click="openNudge(n)">
          <div class="grow">
            <div class="title">{{ n.name }}</div>
            <div class="meta">{{ Math.round(n.perMonth) }}× / month · usually {{ fmt0(n.price) }} → {{ fmt0(n.price + n.step) }}</div>
          </div>
          <div class="right">
            <div class="big" style="color: var(--paid)">+{{ fmt0(n.uplift) }}<span class="hint"> /mo</span></div>
            <div class="meta">+{{ fmt0(n.step) }} each</div>
          </div>
        </button>
      </div>
      <div class="nudge-total">
        <span>If you lifted all {{ nudges.count }} services ~5%</span>
        <b style="color: var(--paid)">+{{ fmt0(nudges.total) }}/mo · {{ fmt0(nudges.total * 12) }}/yr</b>
      </div>
    </section>

    <div style="margin-top: 14px">
      <RebookTeam v-if="state.employee === 'all'" />
      <RebookCard v-else :employee-id="state.employee" />
    </div>

    <div class="section-label">Month by month <span style="text-transform: none; letter-spacing: 0; font-weight: 500">tap a month to open it</span></div>
    <TotalsTable :rows="tableRows" heading="Month" :footer-label="String(state.year)" always-footer @select="openMonth" />

    <template v-if="state.employee === 'all' && teamRows.length">
      <div class="section-label">Per team member</div>
      <TotalsTable :rows="teamRows" @select="pickEmployee" />
    </template>
  </div>
</template>
