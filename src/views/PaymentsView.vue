<script setup>
import { computed } from 'vue'
import PeriodNav from '../components/PeriodNav.vue'
import EmployeeChips from '../components/EmployeeChips.vue'
import StatCards from '../components/StatCards.vue'
import TotalsTable from '../components/TotalsTable.vue'
import AppointmentItem from '../components/AppointmentItem.vue'
import { byEmployee, currentMonth, dayLabel, fmt, monthLabel, shiftMonth, totals } from '../lib/format.js'
import {
  state, employeeAppts, visibleAppts, employeeById,
  changeMonth, setEmployee, setStatus, openAppointment, openEmployee,
} from '../store.js'

const monthTotals = computed(() => totals(employeeAppts.value))

const perEmployee = computed(() =>
  byEmployee(state.appts, state.employees).map((r) => ({ key: r.id, label: r.name, t: r.t })),
)

/** Visible appointments grouped by day, newest first. */
const groups = computed(() => {
  const sorted = [...visibleAppts.value].sort(
    (a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName),
  )
  const out = []
  for (const a of sorted) {
    const g = out[out.length - 1]
    if (g && g.date === a.date) g.items.push(a)
    else out.push({ date: a.date, items: [a] })
  }
  return out.map((g) => ({ ...g, total: totals(g.items).total }))
})

const allSelected = computed({
  get: () => visibleAppts.value.length > 0 && visibleAppts.value.every((a) => state.selected.has(a.id)),
  set: (v) => visibleAppts.value.forEach((a) => (v ? state.selected.add(a.id) : state.selected.delete(a.id))),
})

const emptyText = computed(() => {
  const kind = state.status === 'all' ? '' : state.status.toLowerCase() + ' '
  const who = state.employee !== 'all' ? ' for ' + (employeeById(state.employee)?.name || '') : ''
  return `No ${kind}appointments in ${monthLabel(state.month)}${who}.`
})

function pickEmployee(id) {
  setEmployee(id)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <div v-if="!state.employees.length" class="panel empty welcome">
    <div class="emoji">💅</div>
    <p><b>Welcome!</b><br>Start by adding the ladies who work with you.</p>
    <button class="btn" @click="openEmployee()">+ Add first employee</button>
  </div>

  <template v-else>
    <PeriodNav
      :label="monthLabel(state.month)"
      @prev="changeMonth(shiftMonth(state.month, -1))"
      @next="changeMonth(shiftMonth(state.month, 1))"
    >
      <button v-if="state.month !== currentMonth()" class="today-btn" @click="changeMonth(currentMonth())">
        Back to this month
      </button>
    </PeriodNav>

    <EmployeeChips />
    <StatCards :t="monthTotals" />

    <template v-if="state.employee === 'all' && state.appts.length">
      <div class="section-title">Per employee</div>
      <TotalsTable :rows="perEmployee" @select="pickEmployee" />
    </template>

    <div class="section-title">
      <span>Appointments</span>
      <span class="chips inline">
        <button
          v-for="s in ['all', 'Unpaid', 'Paid']"
          :key="s"
          class="chip small"
          :class="{ active: state.status === s }"
          @click="setStatus(s)"
        >
          {{ s === 'all' ? 'All' : s }}
        </button>
      </span>
    </div>

    <div class="panel">
      <template v-if="visibleAppts.length">
        <div class="date-head plain">
          <label class="select-all"><input v-model="allSelected" type="checkbox"> Select all</label>
          <span>{{ visibleAppts.length }} shown · {{ fmt(totals(visibleAppts).total) }}</span>
        </div>
        <template v-for="g in groups" :key="g.date">
          <div class="date-head">
            <span>{{ dayLabel(g.date) }}</span>
            <span>{{ fmt(g.total) }}</span>
          </div>
          <AppointmentItem v-for="a in g.items" :key="a.id" :appt="a" />
        </template>
      </template>
      <div v-else class="empty">
        {{ emptyText }}
        <br>
        <button class="btn" @click="openAppointment()">+ Add appointment</button>
      </div>
    </div>
  </template>
</template>
