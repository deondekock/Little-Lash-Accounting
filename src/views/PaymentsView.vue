<script setup>
import { computed } from 'vue'
import Icon from '../components/Icon.vue'
import PeriodNav from '../components/PeriodNav.vue'
import EmployeeChips from '../components/EmployeeChips.vue'
import StatCards from '../components/StatCards.vue'
import AppointmentItem from '../components/AppointmentItem.vue'
import { currentMonth, dayLabel, fmt, monthLabel, monthRange, shiftMonth, shortDate, totals } from '../lib/format.js'
import { state, employeeAppts, visibleAppts, employeeById, changeMonth, setStatus, openAppointment } from '../store.js'

const monthTotals = computed(() => totals(employeeAppts.value))
const thisMonth = computed(() => currentMonth(state.monthStartDay))
const range = computed(() => {
  if (state.monthStartDay <= 1) return ''
  const r = monthRange(state.month, state.monthStartDay)
  return `${shortDate(r.from)} – ${shortDate(r.to)}`
})

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
</script>

<template>
  <div class="page">
    <PeriodNav
      :label="monthLabel(state.month)"
      @prev="changeMonth(shiftMonth(state.month, -1))"
      @next="changeMonth(shiftMonth(state.month, 1))"
    >
      <div v-if="range" class="range">{{ range }}</div>
      <button v-if="state.month !== thisMonth" class="today-btn" @click="changeMonth(thisMonth)">Back to this month</button>
    </PeriodNav>

    <EmployeeChips />
    <StatCards :t="monthTotals" />

    <div class="section-label">
      <span>Appointments</span>
      <div class="segmented" role="tablist">
        <button v-for="s in ['all', 'Unpaid', 'Paid']" :key="s" :class="{ active: state.status === s }" @click="setStatus(s)">
          {{ s === 'all' ? 'All' : s }}
        </button>
      </div>
    </div>

    <div class="card appt-card">
      <template v-if="visibleAppts.length">
        <div class="date-head plain">
          <label class="select-all"><input v-model="allSelected" type="checkbox"> Select all</label>
          <span>{{ visibleAppts.length }} · {{ fmt(totals(visibleAppts).total) }}</span>
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
        <div class="emoji">🌸</div>
        {{ emptyText }}
        <br>
        <button class="btn" @click="openAppointment()"><Icon name="plus" :size="18" /> Add appointment</button>
      </div>
    </div>
  </div>

  <button class="fab" :class="{ raised: state.selected.size }" @click="openAppointment()"><Icon name="plus" :stroke="2.4" /> Add</button>
</template>
