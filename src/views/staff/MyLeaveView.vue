<script setup>
import { computed, ref } from 'vue'
import { state, openMyLeave } from '../../store.js'
import { shortDate, todayStr } from '../../lib/format.js'
import { leaveBalance, sickBalance, familyBalance, leaveForecast, payDefaults } from '../../lib/payroll.js'
import { monthLabel } from '../../lib/format.js'
import { LEAVE_STATUS } from '../../lib/schema.js'
import { holidaysIn } from '../../lib/holidays.js'

/** Staff: her leave balances, her requests and her leave. */
const me = computed(() => state.employees[0])
const today = todayStr()
const withPay = computed(() => me.value && { ...me.value, pay: payDefaults(me.value.pay) })
const annual = computed(() => withPay.value && leaveBalance(withPay.value, state.leave, today))
const sick = computed(() => withPay.value && sickBalance(withPay.value, state.leave, today))
const family = computed(() => withPay.value && familyBalance(withPay.value, state.leave, today))
const first = computed(() => (me.value?.name || '').split(' ')[0])
// The next 12 months of annual leave: balance at each month's end, what's booked in it, what's still waiting.
const forecast = computed(() => (annual.value?.start ? leaveForecast(withPay.value, state.leave, today.slice(0, 7), 12) : []))
const showForecast = ref(false)

const sorted = computed(() => [...state.leave].sort((a, b) => (a.from < b.from ? 1 : -1)))
const waiting = computed(() => sorted.value.filter((l) => l.status === 'requested'))
const upcoming = computed(() => sorted.value.filter((l) => l.status !== 'requested' && l.to >= today).reverse())
const past = computed(() => sorted.value.filter((l) => l.status !== 'requested' && l.to < today))
const range = (l) => (l.to && l.to !== l.from ? `${shortDate(l.from)} – ${shortDate(l.to)}` : shortDate(l.from))
const TYPE_EMOJI = { Annual: '🌴', Sick: '🤒', Family: '👨‍👩‍👧', Maternity: '🤱', Unpaid: '⏸️' }
// The next few public holidays.
const y = Number(today.slice(0, 4))
const holidays = [...holidaysIn(y), ...holidaysIn(y + 1)].filter((h) => h.date >= today).slice(0, 5)
const weekday = (d) => new Date(d + 'T12:00').toLocaleDateString('en-ZA', { weekday: 'short' })
const TAG = { requested: 'orange-tag', approved: 'green-tag', declined: 'red-tag' }
</script>

<template>
  <div class="page">
    <div class="greeting" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px">
      <div>
        <div class="hello">Hi <em>{{ first }}</em> ✨</div>
        <div class="sub">Your leave</div>
      </div>
      <button class="btn small soft" @click="openMyLeave()">+ Ask for leave</button>
    </div>

    <div v-if="annual" class="card leave-card">
      <template v-if="annual.start && (annual.perYear || annual.opening)">
        <div class="leave-fig"><b>{{ annual.hours }}</b> h <span>annual leave available ({{ annual.days }} days)</span></div>
        <div class="meta">You earn {{ annual.perMonth }} days a month<template v-if="annual.bookedHours"> · {{ annual.bookedHours }} h booked ahead</template></div>
      </template>
      <div v-else class="meta">Your annual leave balance hasn't been set up yet.</div>
      <template v-if="forecast.length">
        <button class="link-btn" style="margin-top: 8px" :aria-expanded="showForecast" @click="showForecast = !showForecast">{{ showForecast ? 'Hide' : 'See' }} your leave month by month {{ showForecast ? '▴' : '▾' }}</button>
        <table v-if="showForecast" class="leave-forecast">
          <thead><tr><th>Month</th><th>Earned</th><th>Booked</th><th>Left at month end</th></tr></thead>
          <tbody>
            <tr v-for="(f, i) in forecast" :key="f.month" :class="{ waiting: f.pending, short: f.hours < 0 }">
              <td>{{ monthLabel(f.month).replace(/ 20/, ' ’') }}<small v-if="i === 0"> · now {{ annual.hours }} h</small></td>
              <td>{{ f.earned == null ? '' : '+' + f.earned + ' h' }}</td>
              <td>
                <template v-if="f.approved">−{{ f.approved }} h</template>
                <small v-if="f.waiting" class="orange">{{ f.approved ? ' · ' : '' }}{{ f.waiting }} h waiting</small>
                <template v-if="!f.approved && !f.waiting">—</template>
              </td>
              <td><b>{{ f.hours }} h</b> <small>({{ f.days }} d)</small><small v-if="f.pending" class="orange"> · {{ f.ifApproved }} h if approved</small></td>
            </tr>
          </tbody>
        </table>
        <div v-if="showForecast" class="meta" style="margin-top: 6px">Each month end includes that month's accrual. Public holidays aren't leave days.</div>
      </template>
      <div v-if="sick && !sick.owner" class="leave-others">
        <div><span>🤒 Sick</span><b>{{ sick.hours }} h</b><small>of {{ sick.entitled }} h · until {{ shortDate(sick.to) }} {{ sick.to.slice(0, 4) }}</small></div>
        <div><span>👨‍👩‍👧 Family</span><b>{{ family.hours }} h</b><small>{{ family.eligible ? `of ${family.entitled} h · until ${shortDate(family.to)} ${family.to.slice(0, 4)}` : 'after 4 months' }}</small></div>
      </div>
    </div>

    <template v-if="waiting.length">
      <h4 class="section-label">Waiting for approval</h4>
      <div class="list card" style="padding: 4px 16px">
        <button v-for="l in waiting" :key="l.id" class="list-row" @click="openMyLeave(l)">
          <div class="history-icon">{{ TYPE_EMOJI[l.type] }}</div>
          <div class="grow"><div class="title">{{ l.type }} · {{ range(l) }}</div><div class="meta">{{ l.hours }} h{{ l.notes ? ' · ' + l.notes : '' }}</div></div>
          <span class="tag orange-tag">{{ LEAVE_STATUS.requested }}</span>
        </button>
      </div>
    </template>

    <h4 class="section-label">Coming up</h4>
    <div v-if="upcoming.length" class="list card" style="padding: 4px 16px">
      <div v-for="l in upcoming" :key="l.id" class="list-row">
        <div class="history-icon">{{ TYPE_EMOJI[l.type] }}</div>
        <div class="grow"><div class="title">{{ l.type }} · {{ range(l) }}</div><div class="meta">{{ l.hours }} h{{ l.notes ? ' · ' + l.notes : '' }}</div></div>
        <span class="tag" :class="TAG[l.status]">{{ LEAVE_STATUS[l.status] }}</span>
      </div>
    </div>
    <div v-else class="card empty" style="padding: 18px">No leave coming up.</div>

    <h4 class="section-label">Public holidays coming up</h4>
    <div class="list card" style="padding: 4px 16px">
      <div v-for="h in holidays" :key="h.date" class="list-row">
        <div class="history-icon">🇿🇦</div>
        <div class="grow"><div class="title">{{ h.name }}</div><div class="meta">{{ weekday(h.date) }} {{ shortDate(h.date) }} {{ h.date.slice(0, 4) }}</div></div>
      </div>
    </div>

    <template v-if="past.length">
      <h4 class="section-label">Taken</h4>
      <div class="list card" style="padding: 4px 16px">
        <div v-for="l in past.slice(0, 30)" :key="l.id" class="list-row">
          <div class="history-icon">{{ TYPE_EMOJI[l.type] }}</div>
          <div class="grow"><div class="title">{{ l.type }} · {{ range(l) }} {{ l.from.slice(0, 4) }}</div><div class="meta">{{ l.hours }} h</div></div>
          <span v-if="l.status === 'declined'" class="tag red-tag">{{ LEAVE_STATUS.declined }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
