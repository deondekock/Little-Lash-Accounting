<script setup>
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import SwipeArea from '../components/SwipeArea.vue'
import PeriodNav from '../components/PeriodNav.vue'
import StatCards from '../components/StatCards.vue'
import AppointmentItem from '../components/AppointmentItem.vue'
import { currentMonth, dayLabel, fmt, monthLabel, monthRange, shiftMonth, shortDate, todayStr, totals } from '../lib/format.js'
import { holidayOn } from '../lib/holidays.js'
import { all, state, employeeAppts, visibleAppts, employeeById, changeMonth, setStatus, setMethod, setEmployee, paidWith, employeeColor, openAppointment, openVouchers, liveVouchers } from '../store.js'

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
const dayVisible = computed(() => dayEmployeeAppts.value.filter((a) => (state.status === 'all' || a.status === state.status) && paidWith(a, state.method)))

/* The filter chips: only the statuses / methods / team members that actually occur in the period are offered. */
const periodAppts = computed(() => (mode.value === 'day' ? all.value.filter((a) => a.date === day.value) : all.value.filter((a) => a.month === state.month)))
const statusChoices = computed(() => ['all', 'Unpaid', 'Paid', ...(periodAppts.value.some((a) => a.status === 'Written off') ? ['Written off'] : [])])
const methodChoices = computed(() => {
  const seen = new Set()
  for (const a of periodAppts.value) { seen.add(a.method); for (const t of a.tenders || []) seen.add(t.method) }
  return ['all', ...['Cash', 'Card', 'EFT', 'Voucher', 'Split'].filter((m) => seen.has(m) || m === state.method)]
})
const teamChoices = computed(() => {
  const inPeriod = new Set(periodAppts.value.map((a) => a.employeeId))
  return state.employees.filter((e) => e.active || inPeriod.has(e.id) || e.id === state.employee)
})

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


const emptyText = computed(() => {
  const kind = state.status === 'all' ? '' : state.status.toLowerCase() + ' '
  const how = state.method === 'all' ? '' : ` paid by ${state.method.toLowerCase()}`
  const who = (state.employee !== 'all' ? ' for ' + (employeeById(state.employee)?.name || '') : '') + how
  const when = mode.value === 'day' ? (day.value === today ? 'today' : `${dayTitle.value.toLowerCase()}, ${dayLong.value}`) : monthLabel(state.month)
  return `No ${kind}appointments ${mode.value === 'day' ? 'on' : 'in'} ${when}${who}.`
})

const add = () => openAppointment(null, mode.value === 'day' ? { date: day.value } : null)
const voucherMeta = computed(() => {
  const n = liveVouchers.value.length
  if (!n) return 'Sell one, or take one as payment'
  return `${n} with money on ${n === 1 ? 'it' : 'them'} · ${fmt(liveVouchers.value.reduce((t, v) => t + v.balance, 0))} still to redeem`
})
// Swipe on the list: a day in Day view, a month in Month view.
const onSwipe = (dir) => (mode.value === 'day' ? shiftDay(dir) : changeMonth(shiftMonth(state.month, dir)))

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

    <StatCards :t="statTotals" />
    <button class="card list-row voucher-link" @click="openVouchers">
      <div class="history-icon"><Icon name="gift" :size="16" /></div>
      <div class="grow"><div class="title">Gift vouchers</div><div class="meta">{{ voucherMeta }}</div></div>
      <Icon name="right" />
    </button>

    <div class="section-label"><span>Appointments</span></div>
    <div class="appt-filters">
      <div class="chips" role="group" aria-label="Status">
        <button v-for="s in statusChoices" :key="s" class="chip small" :class="{ active: state.status === s }" @click="setStatus(s)">{{ s === 'all' ? 'All' : s }}</button>
      </div>
      <div v-if="methodChoices.length > 2" class="chips" role="group" aria-label="Paid with">
        <button v-for="m in methodChoices" :key="m" class="chip small" :class="{ active: state.method === m }" @click="setMethod(m)">{{ m === 'all' ? 'Any payment' : m }}</button>
      </div>
      <div class="chips" role="group" aria-label="Team member">
        <button class="chip small" :class="{ active: state.employee === 'all' }" @click="setEmployee('all')">Everyone</button>
        <button v-for="e in teamChoices" :key="e.id" class="chip small" :class="{ active: state.employee === e.id }" @click="setEmployee(e.id)">
          <i class="swatch-dot" :style="{ background: employeeColor(e.id) }" />{{ e.name }}
        </button>
      </div>
    </div>

    <SwipeArea @swipe="onSwipe">
    <div class="card appt-card">
      <template v-if="list.length">
        <div class="date-head plain">
          <span>{{ list.length }} appointment{{ list.length === 1 ? '' : 's' }}</span>
          <span>{{ fmt(totals(list).total) }}</span>
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
    </SwipeArea>
  </div>

  <button class="fab" @click="add"><Icon name="plus" :stroke="2.4" /> Add</button>
</template>
