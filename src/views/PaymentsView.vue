<script setup>
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import PeriodNav from '../components/PeriodNav.vue'
import EmployeeChips from '../components/EmployeeChips.vue'
import StatCards from '../components/StatCards.vue'
import AppointmentItem from '../components/AppointmentItem.vue'
import { currentMonth, dayLabel, fmt, monthLabel, monthRange, shiftMonth, shortDate, todayStr, totals } from '../lib/format.js'
import { holidayOn } from '../lib/holidays.js'
import { all, state, employeeAppts, visibleAppts, employeeById, changeMonth, setStatus, openAppointment, openVouchers } from '../store.js'

// Day or month view, remembered on this phone. The owner is a lash tech too and works day-to-day, so Day leads.
const MODE_KEY = 'llp.payView'
const mode = ref((() => { try { return localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'day' } catch { return 'day' } })())
function setMode(m) { mode.value = m; try { localStorage.setItem(MODE_KEY, m) } catch { /* private mode */ } }

const today = todayStr()
const day = ref(today)
const shiftDay = (n) => {
  const d = new Date(day.value + 'T12:00:00')
  d.setDate(d.getDate() + n)
  day.value = d.toISOString().slice(0, 10)
}
const pickDay = (e) => e.target.value && (day.value = e.target.value)
const dayTitle = computed(() => {
  if (day.value === today) return 'Today'
  const y = new Date(today + 'T12:00:00')
  y.setDate(y.getDate() - 1)
  if (day.value === y.toISOString().slice(0, 10)) return 'Yesterday'
  return new Date(day.value + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'long' })
})
const dayLong = computed(() => new Date(day.value + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }))

// The day's appointments, with the same employee + status filters the month view uses.
const dayEmployeeAppts = computed(() => {
  const list = all.value.filter((a) => a.date === day.value)
  return state.employee === 'all' ? list : list.filter((a) => a.employeeId === state.employee)
})
const dayVisible = computed(() => (state.status === 'all' ? dayEmployeeAppts.value : dayEmployeeAppts.value.filter((a) => a.status === state.status)))

// What the page shows depends on the mode.
const list = computed(() => (mode.value === 'day' ? dayVisible.value : visibleAppts.value))
const statSource = computed(() => (mode.value === 'day' ? dayEmployeeAppts.value : employeeAppts.value))
const statTotals = computed(() => totals(statSource.value))
const thisMonth = computed(() => currentMonth(state.monthStartDay))
const range = computed(() => {
  if (state.monthStartDay <= 1) return ''
  const r = monthRange(state.month, state.monthStartDay)
  return `${shortDate(r.from)} – ${shortDate(r.to)}`
})

/** Month view: visible appointments grouped by day, newest first. */
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
  get: () => list.value.length > 0 && list.value.every((a) => state.selected.has(a.id)),
  set: (v) => list.value.forEach((a) => (v ? state.selected.add(a.id) : state.selected.delete(a.id))),
})

const emptyText = computed(() => {
  const kind = state.status === 'all' ? '' : state.status.toLowerCase() + ' '
  const who = state.employee !== 'all' ? ' for ' + (employeeById(state.employee)?.name || '') : ''
  const when = mode.value === 'day' ? (day.value === today ? 'today' : `${dayTitle.value.toLowerCase()}, ${dayLong.value}`) : monthLabel(state.month)
  return `No ${kind}appointments ${mode.value === 'day' ? 'on' : 'in'} ${when}${who}.`
})

const add = () => openAppointment(null, mode.value === 'day' ? { date: day.value } : null)
</script>

<template>
  <div class="page">
    <div class="segmented view-toggle" role="tablist" aria-label="View" style="margin-bottom: 12px">
      <button role="tab" :aria-selected="mode === 'day'" :class="{ active: mode === 'day' }" @click="setMode('day')">Day</button>
      <button role="tab" :aria-selected="mode === 'month'" :class="{ active: mode === 'month' }" @click="setMode('month')">Month</button>
    </div>

    <div v-if="mode === 'day'" class="period">
      <button class="round" aria-label="Previous day" @click="shiftDay(-1)"><Icon name="left" /></button>
      <div class="period-label">
        <label class="period-pick">
          <h2>{{ dayTitle }}</h2><Icon name="down" :size="18" :stroke="2.2" />
          <input type="date" :value="day" aria-label="Choose day" @change="pickDay">
        </label>
        <div class="range">{{ dayLong }}</div>
        <button v-if="day !== today" class="today-btn" @click="day = today">Back to today</button>
      </div>
      <button class="round" aria-label="Next day" @click="shiftDay(1)"><Icon name="right" /></button>
    </div>
    <PeriodNav
      v-else
      :label="monthLabel(state.month)"
      @prev="changeMonth(shiftMonth(state.month, -1))"
      @next="changeMonth(shiftMonth(state.month, 1))"
    >
      <div v-if="range" class="range">{{ range }}</div>
      <button v-if="state.month !== thisMonth" class="today-btn" @click="changeMonth(thisMonth)">Back to this month</button>
    </PeriodNav>

    <EmployeeChips />
    <StatCards :t="statTotals" />
    <div class="report-actions" style="margin: -4px 0 10px">
      <button class="btn soft small" @click="openVouchers">🎁 Gift vouchers</button>
    </div>

    <div class="section-label">
      <span>Appointments</span>
      <div class="segmented" role="tablist">
        <button v-for="s in ['all', 'Unpaid', 'Paid', ...(statSource.some((a) => a.status === 'Written off') ? ['Written off'] : [])]" :key="s" :class="{ active: state.status === s }" @click="setStatus(s)">
          {{ s === 'all' ? 'All' : s }}
        </button>
      </div>
    </div>

    <div class="card appt-card">
      <template v-if="list.length">
        <div class="date-head plain">
          <label class="select-all"><input v-model="allSelected" type="checkbox"> Select all</label>
          <span>{{ list.length }} · {{ fmt(totals(list).total) }}</span>
        </div>
        <template v-if="mode === 'month'">
          <template v-for="g in groups" :key="g.date">
            <div class="date-head">
              <span>{{ dayLabel(g.date) }}<template v-if="holidayOn(g.date)"> · 🇿🇦 {{ holidayOn(g.date) }}</template></span>
              <span>{{ fmt(g.total) }}</span>
            </div>
            <AppointmentItem v-for="a in g.items" :key="a.id" :appt="a" />
          </template>
        </template>
        <template v-else>
          <div v-if="holidayOn(day)" class="date-head"><span>🇿🇦 {{ holidayOn(day) }}</span><span /></div>
          <AppointmentItem v-for="a in list" :key="a.id" :appt="a" />
        </template>
      </template>
      <div v-else class="empty">
        <div class="emoji">🌸</div>
        {{ emptyText }}
        <br>
        <button class="btn" @click="add"><Icon name="plus" :size="18" /> Add appointment</button>
      </div>
    </div>
  </div>

  <button class="fab" :class="{ raised: state.selected.size }" @click="add"><Icon name="plus" :stroke="2.4" /> Add</button>
</template>
