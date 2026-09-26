<script setup>
import { computed } from 'vue'
import Icon from '../components/Icon.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import TaxNotice from '../components/TaxNotice.vue'
import { all, state, employeeColor, openPicker, openPayslip, openLeave, openEmployee, openCompany, printPayslips } from '../store.js'
import { fmt, fmt0, initials, monthLabel, monthRange, shortDate, todayStr } from '../lib/format.js'
import { draftPayslip, leaveBalance, leaveText, payDefaults } from '../lib/payroll.js'

const tab = computed({
  get: () => (state.payrollTab === 'leave' ? 'Leave' : 'Payslips'),
  set: (v) => (state.payrollTab = v === 'Leave' ? 'leave' : 'payslips'),
})
const period = computed(() => monthRange(state.month, state.monthStartDay))
const saved = computed(() => new Map(state.payslips.filter((p) => p.month === state.month).map((p) => [p.employeeId, p])))

/** Everyone active, plus anyone who worked this month or already has a payslip for it. */
const people = computed(() => {
  const worked = new Set(all.value.filter((a) => a.month === state.month).map((a) => a.employeeId))
  return state.employees
    .filter((e) => e.active || worked.has(e.id) || saved.value.has(e.id))
    .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name))
})

const rows = computed(() =>
  people.value.map((e) => {
    const slip = saved.value.get(e.id)
    const inputs = slip?.details?.inputs || {}
    const draft = draftPayslip({
      emp: e, appts: all.value, leave: state.leave, month: state.month, startDay: state.monthStartDay,
      payDate: slip?.payDate || period.value.to, ...inputs,
    })
    const pay = payDefaults(e.pay)
    const setUp = pay.basic !== '' || pay.commissionPct !== ''
    return { e, slip, draft, setUp, changed: slip && Math.abs(slip.net - draft.net) >= 0.01 }
  }),
)

const totals = computed(() => {
  const t = { gross: 0, paye: 0, uif: 0, employerUif: 0, net: 0 }
  for (const r of rows.value) {
    if (!r.setUp && !r.slip) continue
    const d = r.draft
    t.gross += d.gross
    t.paye += d.deductions.find((x) => x.label === 'PAYE')?.amount || 0
    t.uif += d.deductions.find((x) => x.label === 'UIF')?.amount || 0
    t.employerUif += d.employerUif
    t.net += d.net
  }
  return t
})
const savedSlips = computed(() => rows.value.filter((r) => r.slip).map((r) => r.slip.details).filter(Boolean))

/* ---------------- leave ---------------- */
const today = todayStr()
const balances = computed(() =>
  state.employees
    .filter((e) => e.active)
    .map((e) => ({ e, b: leaveBalance({ ...e, pay: payDefaults(e.pay) }, state.leave, today) }))
    .sort((a, b) => a.e.name.localeCompare(b.e.name)),
)
const upcoming = computed(() => state.leave.filter((l) => l.to >= today).sort((a, b) => (a.from < b.from ? -1 : 1)))
const past = computed(() => state.leave.filter((l) => l.to < today).slice(0, 30))
const nameOf = (id) => state.employees.find((e) => e.id === id)?.name || '—'
const range = (l) => (l.to && l.to !== l.from ? `${shortDate(l.from)} – ${shortDate(l.to)}` : shortDate(l.from))
const TYPE_EMOJI = { Annual: '🌴', Sick: '🤒', Family: '👨‍👩‍👧', Unpaid: '⏸️' }
</script>

<template>
  <div class="page">
    <div class="greeting" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px">
      <div>
        <div class="hello">Pay &amp; <em>leave</em></div>
        <button v-if="tab === 'Payslips'" class="month-pill" style="margin-top: 8px" aria-label="Choose month" @click="openPicker('month')">
          <Icon name="calendar" :size="16" />{{ monthLabel(state.month) }}<Icon name="down" :size="16" :stroke="2.2" />
        </button>
      </div>
      <button v-if="tab === 'Leave'" class="btn small soft" @click="openLeave()"><Icon name="plus" :size="16" /> Book leave</button>
    </div>

    <SegmentedControl v-model="tab" :options="['Payslips', 'Leave']" style="margin-bottom: 14px" />

    <template v-if="tab === 'Payslips'">
      <TaxNotice />
      <button v-if="!state.company.name" class="card list-row" style="padding: 16px; margin-bottom: 14px" @click="openCompany">
        <div class="history-icon"><Icon name="receipt" :size="16" /></div>
        <div class="grow"><div class="title">Add your company details</div><div class="meta">Name, registration number and address for the payslips</div></div>
        <Icon name="right" />
      </button>

      <p class="muted-note" style="margin: 0 0 10px">Commission on takings {{ shortDate(period.from) }} – {{ shortDate(period.to) }}</p>
      <div class="list card" style="padding: 4px 0">
        <button v-for="r in rows" :key="r.e.id" class="list-row" @click="r.setUp || r.slip ? openPayslip(r.e.id) : openEmployee(r.e)">
          <div class="avatar sm" :style="{ background: employeeColor(r.e.id) }">{{ initials(r.e.name) }}</div>
          <div class="grow">
            <div class="title">{{ r.e.name }}</div>
            <div v-if="!r.setUp && !r.slip" class="meta orange">Set up her pay first →</div>
            <div v-else class="meta">
              {{ r.draft.appts.count }} appts · {{ fmt0(r.draft.appts.takings) }} takings<template v-if="r.draft.appts.otCount"> · ⏰ {{ r.draft.appts.otCount }} overtime</template>
            </div>
          </div>
          <div v-if="r.setUp || r.slip" class="right">
            <div class="title num">{{ fmt(r.slip ? r.slip.net : r.draft.net) }}</div>
            <div class="meta">
              <span v-if="r.slip && r.changed" class="tag orange-tag">changed</span>
              <span v-else-if="r.slip" class="tag green-tag">saved</span>
              <span v-else>draft · net</span>
            </div>
          </div>
        </button>
      </div>

      <section v-if="totals.gross" class="card" style="margin-top: 14px">
        <div class="card-title"><h3>{{ monthLabel(state.month).split(' ')[0] }} payroll</h3><span class="hint">all payslips</span></div>
        <div class="pay-totals">
          <div><span>Total pay (gross)</span><b>{{ fmt(totals.gross) }}</b></div>
          <div><span>Paid out (net)</span><b>{{ fmt(totals.net) }}</b></div>
          <div><span>PAYE to SARS</span><b>{{ fmt(totals.paye) }}</b></div>
          <div><span>UIF to SARS <small>(staff {{ fmt(totals.uif) }} + yours {{ fmt(totals.employerUif) }})</small></span><b>{{ fmt(totals.uif + totals.employerUif) }}</b></div>
        </div>
        <p class="muted-note" style="margin: 10px 0 0">PAYE + UIF is what goes on the EMP201 to SARS by the 7th of next month.</p>
      </section>

      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px">
        <button v-if="savedSlips.length" class="btn soft" @click="printPayslips(savedSlips)"><Icon name="receipt" :size="16" /> Print / PDF all saved ({{ savedSlips.length }})</button>
        <button class="btn ghost" @click="openCompany">Company details</button>
      </div>
    </template>

    <template v-else>
      <div class="team-grid">
        <div v-for="{ e, b } in balances" :key="e.id" class="card leave-card">
          <div class="head">
            <div class="avatar sm" :style="{ background: employeeColor(e.id) }">{{ initials(e.name) }}</div>
            <div class="grow"><div class="name">{{ e.name }}</div></div>
            <button class="btn small ghost" @click="openLeave(null, { employeeId: e.id })">Book</button>
          </div>
          <template v-if="b.start">
            <div class="leave-fig">
              <b>{{ b.hours }}</b> h <span>available ({{ b.days }} days)</span>
            </div>
            <div class="meta">
              {{ b.perMonth }} days/month · {{ b.takenDays }} days taken since {{ shortDate(b.start) }} {{ b.start.slice(0, 4) }}
              <template v-if="b.bookedHours"> · {{ leaveText(b.bookedDays, b.perDay) }} booked ahead</template>
            </div>
          </template>
          <button v-else class="link-btn" style="margin-top: 8px" @click="openEmployee(e)">Add her leave balance →</button>
        </div>
      </div>

      <h4 class="section-label">Coming up</h4>
      <div v-if="upcoming.length" class="list card" style="padding: 4px 0">
        <button v-for="l in upcoming" :key="l.id" class="list-row" @click="openLeave(l)">
          <div class="history-icon">{{ TYPE_EMOJI[l.type] }}</div>
          <div class="grow"><div class="title">{{ nameOf(l.employeeId) }} · {{ l.type }}</div><div class="meta">{{ range(l) }}{{ l.notes ? ' · ' + l.notes : '' }}</div></div>
          <div class="right"><div class="title num">{{ l.hours }} h</div></div>
        </button>
      </div>
      <div v-else class="card empty" style="padding: 18px">No leave booked ahead.</div>

      <template v-if="past.length">
        <h4 class="section-label">Taken</h4>
        <div class="list card" style="padding: 4px 0">
          <button v-for="l in past" :key="l.id" class="list-row" @click="openLeave(l)">
            <div class="history-icon">{{ TYPE_EMOJI[l.type] }}</div>
            <div class="grow"><div class="title">{{ nameOf(l.employeeId) }} · {{ l.type }}</div><div class="meta">{{ range(l) }} {{ l.from.slice(0, 4) }}{{ l.notes ? ' · ' + l.notes : '' }}</div></div>
            <div class="right"><div class="title num">{{ l.hours }} h</div></div>
          </button>
        </div>
      </template>
    </template>
  </div>
</template>
