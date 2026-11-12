<script setup>
import { computed, onMounted, ref } from 'vue'
import { state, openPayslipView, loadPayPreview } from '../../store.js'
import { fmt, monthLabel, monthRange, currentMonth, shortDate, todayStr } from '../../lib/format.js'
import { weekDays, leaveSettings, payDefaults } from '../../lib/payroll.js'
import { holidayOn } from '../../lib/holidays.js'

/** Staff: this pay month so far (work days ticking off + what her payslip would be today), then her saved payslips. */
const slips = computed(() => [...state.payslips].filter((p) => p.details).sort((a, b) => (a.month < b.month ? 1 : -1)))
const date = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

const today = todayStr()
const me = computed(() => state.employees[0])
const month = computed(() => currentMonth(state.monthStartDay))
const period = computed(() => monthRange(month.value, state.monthStartDay))
const TYPE = { Annual: 'annual leave', Sick: 'sick leave', Family: 'family leave', Maternity: 'maternity leave', Unpaid: 'unpaid leave' }

/* One segment per work day of the pay month: done, today, still to come, or on leave. */
const days = computed(() => {
  if (!me.value) return []
  const work = new Set(weekDays(leaveSettings(payDefaults(me.value.pay)).perWeek))
  const leave = state.leave.filter((l) => l.status === 'approved')
  const out = []
  const d = new Date(period.value.from + 'T12:00:00')
  const end = new Date(period.value.to + 'T12:00:00')
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!work.has(d.getDay()) || holidayOn(iso)) continue
    const off = leave.find((l) => l.from <= iso && (l.to || l.from) >= iso)
    out.push({ date: iso, state: off ? 'leave' : iso < today ? 'done' : iso === today ? 'today' : 'ahead', leave: off ? TYPE[off.type] || 'leave' : '' })
  }
  return out
})
const working = computed(() => days.value.filter((d) => d.state !== 'leave'))
const doneCount = computed(() => working.value.filter((d) => d.state === 'done').length)
const leftCount = computed(() => working.value.filter((d) => d.state === 'ahead' || d.state === 'today').length)
const leaveCount = computed(() => days.value.length - working.value.length)

const preview = ref(null)
onMounted(async () => { try { preview.value = await loadPayPreview() } catch { preview.value = null } })
const showLines = ref(false)
</script>

<template>
  <div class="page">
    <div class="greeting"><div class="hello">Your <em>payslips</em></div><div class="sub">This month so far, and the ones you've been paid</div></div>

    <div v-if="days.length" class="card pay-progress">
      <div class="pp-head">
        <div>
          <div class="pp-title">{{ monthLabel(month) }}</div>
          <div class="meta">{{ shortDate(period.from) }} – {{ shortDate(period.to) }} · day {{ Math.min(working.length, doneCount + (leftCount ? 1 : 0)) }} of {{ working.length }}</div>
        </div>
        <div v-if="preview?.setUp" class="pp-net"><b>{{ fmt(preview.net) }}</b><small>nett so far</small></div>
      </div>
      <div class="pp-bar" role="img" :aria-label="`${doneCount} of ${working.length} work days done`">
        <i v-for="d in days" :key="d.date" :class="d.state" :title="`${shortDate(d.date)}${d.leave ? ' · ' + d.leave : ''}`" />
      </div>
      <div class="meta">
        {{ doneCount }} done · {{ leftCount }} to go<template v-if="leaveCount"> · {{ leaveCount }} on leave</template>
      </div>

      <template v-if="preview?.setUp">
        <div class="pp-figs">
          <div><span>Earned so far</span><b>{{ fmt(preview.gross) }}</b></div>
          <div><span>Tax &amp; UIF</span><b>− {{ fmt(preview.totalDeductions) }}</b></div>
          <div><span>From</span><b>{{ preview.count }} appt{{ preview.count === 1 ? '' : 's' }}</b></div>
        </div>
        <button class="link-btn" :aria-expanded="showLines" @click="showLines = !showLines">{{ showLines ? 'Hide' : 'See' }} how it adds up {{ showLines ? '▴' : '▾' }}</button>
        <div v-if="showLines" class="pp-lines">
          <div v-for="e in preview.earnings" :key="'e' + e.label"><span>{{ e.label }}</span><b>{{ fmt(e.amount) }}</b></div>
          <div v-for="x in preview.deductions" :key="'d' + x.label"><span>{{ x.label }}</span><b>− {{ fmt(x.amount) }}</b></div>
        </div>
        <p class="meta" style="margin: 8px 0 0">If today were payday. Every appointment you add before {{ shortDate(period.to) }} pushes it up 🥳 Your final payslip may differ a little (bonuses, deductions, unpaid visits).</p>
      </template>
      <p v-else-if="preview?.done" class="meta" style="margin: 8px 0 0">This month's payslip is done — it's in the list below.</p>
    </div>

    <h4 class="section-label">Paid</h4>
    <div v-if="slips.length" class="list card" style="padding: 4px 16px">
      <button v-for="p in slips" :key="p.id" class="list-row" @click="openPayslipView(p.details)">
        <div class="history-icon">🧾</div>
        <div class="grow"><div class="title">{{ monthLabel(p.month) }}</div><div class="meta">Paid {{ date(p.payDate) }} · gross {{ fmt(p.gross) }}</div></div>
        <div class="right"><div class="title num">{{ fmt(p.net) }}</div><div class="meta">net</div></div>
      </button>
    </div>
    <div v-else class="card empty" style="padding: 18px">No payslips yet.</div>
  </div>
</template>
