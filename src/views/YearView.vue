<script setup>
import { computed } from 'vue'
import PeriodNav from '../components/PeriodNav.vue'
import EmployeeChips from '../components/EmployeeChips.vue'
import StatCards from '../components/StatCards.vue'
import TotalsTable from '../components/TotalsTable.vue'
import { byEmployee, monthName, totals, ym } from '../lib/format.js'
import { state, changeYear, changeMonth, setEmployee, setView } from '../store.js'

const list = computed(() => {
  const all = state.yearAppts || []
  return state.employee === 'all' ? all : all.filter((a) => a.employeeId === state.employee)
})

const months = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const key = ym(state.year, i + 1)
    const t = totals(list.value.filter((a) => a.month === key))
    return { key, label: monthName(i + 1), t, muted: !t.count }
  }),
)

const perEmployee = computed(() =>
  byEmployee(state.yearAppts || [], state.employees).map((r) => ({ key: r.id, label: r.name, t: r.t })),
)

function openMonth(month) {
  setView('payments')
  changeMonth(month)
}

function pickEmployee(id) {
  setEmployee(id)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <PeriodNav :label="`Jan – Dec ${state.year}`" @prev="changeYear(-1)" @next="changeYear(1)" />

  <div v-if="!state.yearAppts" class="splash">Loading {{ state.year }}…</div>

  <template v-else>
    <EmployeeChips />
    <StatCards :t="totals(list)" />

    <div class="section-title">
      Month by month <span class="hint">tap a month to open it</span>
    </div>
    <TotalsTable :rows="months" heading="Month" :footer-label="String(state.year)" always-footer @select="openMonth" />

    <template v-if="state.employee === 'all' && perEmployee.length">
      <div class="section-title">Per employee — {{ state.year }}</div>
      <TotalsTable :rows="perEmployee" @select="pickEmployee" />
    </template>
  </template>
</template>
