<script setup>
import { computed } from 'vue'
import Icon from '../components/Icon.vue'
import AreaCompare from '../components/charts/AreaCompare.vue'
import Columns from '../components/charts/Columns.vue'
import ClientFlowCard from '../components/ClientFlowCard.vue'
import TaxNotice from '../components/TaxNotice.vue'
import { all, state, clients, monthAppts, employeeById, employeeColor, setView, openClient, openAppointment, openPicker, changeMonth } from '../store.js'
import { fmt, fmt0, monthLabel, monthRange, shortDate, initials, currentMonth, METHODS } from '../lib/format.js'
import { monthToDate, byWeekday, buildClients } from '../lib/stats.js'
import { totals, byEmployee } from '../lib/format.js'

const monthName = computed(() => monthLabel(state.month).split(' ')[0])
const thisMonth = computed(() => currentMonth(state.monthStartDay))
const firstName = computed(() => {
  const local = (state.email || '').split('@')[0].split(/[._\d]/)[0]
  return local ? local[0].toUpperCase() + local.slice(1) : ''
})
const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
})
const today = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })

const mtd = computed(() => monthToDate(all.value, state.month, state.monthStartDay))
const t = computed(() => totals(monthAppts.value))
const range = computed(() => {
  const r = monthRange(state.month, state.monthStartDay)
  return `${shortDate(r.from)} – ${shortDate(r.to)}`
})
// A month that has only just started, with nothing recorded yet.
const freshMonth = computed(() => mtd.value.inProgress && mtd.value.curTotal === 0)
const change = computed(() => {
  const c = mtd.value.change
  if (c === null || !isFinite(c) || freshMonth.value) return null
  return { pct: Math.round(c * 100), dir: c > 0.005 ? 'up' : c < -0.005 ? 'down' : 'flat' }
})
const prevName = computed(() => monthLabel(mtd.value.prevMonth).split(' ')[0])

const methodShare = computed(() => {
  const total = t.value.total || 1
  return METHODS.map((m, i) => ({ m, value: t.value[m], pct: Math.round((t.value[m] / total) * 100), color: `var(--series-${i + 1})` }))
})

const team = computed(() => {
  const rows = byEmployee(monthAppts.value, state.employees)
  const max = Math.max(1, ...rows.map((r) => r.t.total))
  return rows
    .sort((a, b) => b.t.total - a.t.total)
    .map((r) => ({ ...r, pct: (r.t.total / max) * 100, color: employeeColor(r.id) }))
})

const weekdays = computed(() => byWeekday(monthAppts.value).map((d) => ({ label: d.label, value: d.count, title: `${d.label} · ${fmt(d.total)}` })))

const due = computed(() =>
  clients.value
    .filter((c) => c.due)
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 5),
)
const leaveRequests = computed(() => state.leave.filter((l) => l.status === 'requested'))
const weeksAgo = (d) => (d < 0 ? 'booked ahead' : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} weeks ago`)
</script>

<template>
  <div class="page">
    <div class="greeting">
      <div class="hello">{{ greeting }}<template v-if="firstName">, <em>{{ firstName }}</em></template> ✨</div>
      <div class="sub">{{ today }}</div>
      <div style="display: flex; align-items: center; gap: 12px; margin-top: 12px">
        <button class="month-pill" aria-label="Choose month" @click="openPicker('month')">
          <Icon name="calendar" :size="16" />{{ monthLabel(state.month) }}<Icon name="down" :size="16" :stroke="2.2" />
        </button>
        <button v-if="state.month !== thisMonth" class="today-btn" @click="changeMonth(thisMonth)">Back to this month</button>
      </div>
    </div>

    <div v-if="!state.employees.length" class="card empty">
      <div class="emoji">💅</div>
      <p><b>Welcome!</b><br>Start by adding the ladies who work with you.</p>
      <button class="btn" @click="setView('team')">Add your team</button>
    </div>

    <template v-else>
      <TaxNotice />
      <button v-if="leaveRequests.length" class="card list-row" style="padding: 14px 16px; margin-bottom: 14px; width: 100%" @click="setView('payroll', { payrollTab: 'leave' })">
        <div class="history-icon">🌴</div>
        <div class="grow">
          <div class="title">{{ leaveRequests.length }} leave request{{ leaveRequests.length === 1 ? '' : 's' }} waiting</div>
          <div class="meta">{{ leaveRequests.map((l) => employeeById(l.employeeId)?.name).filter(Boolean).join(', ') }} · tap to approve or decline</div>
        </div>
        <Icon name="right" />
      </button>

      <!-- Hero: this month's takings -->
      <section class="card hero">
        <div class="eyebrow">{{ state.month.slice(0, 4) === thisMonth.slice(0, 4) ? monthName : monthLabel(state.month) }} takings · {{ range }}</div>
        <div class="figure">{{ fmt0(mtd.curTotal) }}</div>
        <div class="meta">
          <span v-if="change" class="delta" :class="change.dir">
            <Icon :name="change.dir === 'down' ? 'trendDown' : 'trendUp'" :size="14" :stroke="2.4" />
            {{ change.pct > 0 ? '+' : '' }}{{ change.pct }}%
          </span>
          <span v-if="change">vs {{ prevName }}{{ mtd.inProgress ? ' at this point' : '' }} ({{ fmt0(mtd.prevSame) }})</span>
          <template v-if="freshMonth">
            <span>✨ A new month started {{ shortDate(monthRange(state.month, state.monthStartDay).from) }} — nothing recorded yet.</span>
            <button class="today-btn" style="margin: 0" @click="changeMonth(mtd.prevMonth)">See {{ prevName }} →</button>
          </template>
        </div>
        <div style="margin-top: 14px">
          <AreaCompare :current="mtd.current" :previous="mtd.previous" :current-label="monthName" :previous-label="prevName" />
        </div>
        <div class="legend" style="margin-top: 6px">
          <span class="key"><i class="line-key" style="background: var(--series-1)" />{{ monthName }}</span>
          <span class="key"><i class="line-key" style="background: var(--series-ghost)" />{{ prevName }} ({{ fmt0(mtd.prevTotal) }})</span>
        </div>
      </section>

      <div class="kpis">
        <button class="kpi" @click="setView('payments', { status: 'all', employee: 'all' })">
          <div class="label"><Icon name="calendar" :size="14" /> Appointments</div>
          <div class="value">{{ t.count }}</div>
          <div class="sub">in {{ monthName }}</div>
        </button>
        <div class="kpi">
          <div class="label"><Icon name="heart" :size="14" /> Avg visit</div>
          <div class="value">{{ fmt0(t.count ? t.total / t.count : 0) }}</div>
          <div class="sub">per appointment</div>
        </div>
        <button class="kpi" :class="{ alert: t.unpaid > 0 }" @click="setView('payments', { status: 'Unpaid', employee: 'all' })">
          <div class="label"><Icon name="clock" :size="14" /> Owed</div>
          <div class="value">{{ fmt0(t.unpaid) }}</div>
          <div class="sub">{{ t.unpaidCount }} unpaid →</div>
        </button>
      </div>

      <div class="grid two" style="margin-top: 14px">
        <!-- Team leaderboard -->
        <section class="card">
          <div class="card-title">
            <h3>Team in {{ monthName }}</h3>
            <button class="link-btn" @click="setView('team')">See team</button>
          </div>
          <div v-if="team.length" class="hbars">
            <div v-for="r in team" :key="r.id" class="hbar">
              <div class="top-line">
                <span class="who"><i class="swatch-dot" :style="{ background: r.color }" />{{ r.name }} <small>{{ r.t.count }} appts</small></span>
                <span class="amount">{{ fmt0(r.t.total) }}</span>
              </div>
              <div class="track"><div class="fill" :style="{ width: r.pct + '%', background: r.color }" /></div>
            </div>
          </div>
          <div v-else class="empty">No appointments in {{ monthName }}.</div>
        </section>

        <!-- Payment methods -->
        <section class="card">
          <div class="card-title"><h3>How clients paid</h3><span class="hint">{{ monthName }}</span></div>
          <div class="share" role="img" :aria-label="methodShare.map((s) => `${s.m} ${s.pct}%`).join(', ')">
            <div v-for="s in methodShare.filter((x) => x.value > 0)" :key="s.m" :style="{ flex: s.value, background: s.color }" />
          </div>
          <div class="share-legend">
            <div v-for="s in methodShare" :key="s.m">
              <div class="name"><i class="swatch" :style="{ background: s.color, width: '10px', height: '10px', borderRadius: '3px', display: 'inline-block' }" />{{ s.m }}</div>
              <div class="amt">{{ fmt0(s.value) }}</div>
              <div class="pct">{{ s.pct }}%</div>
            </div>
          </div>

          <div class="card-title" style="margin-top: 22px"><h3>Busiest days</h3><span class="hint">appointments</span></div>
          <Columns :items="weekdays" value-label="appointments" :height="150" />
        </section>
      </div>

      <div style="margin-top: 14px"><ClientFlowCard /></div>

      <!-- Clients due for a refill -->
      <section class="card" style="margin-top: 14px">
        <div class="card-title">
          <h3>Due for a refill</h3>
          <button class="link-btn" @click="setView('clients', { clientFilter: 'due' })">See all</button>
        </div>
        <div v-if="due.length" class="list">
          <button v-for="c in due" :key="c.key" class="list-row" @click="openClient(c)">
            <div class="avatar sm" :style="{ background: employeeColor(c.staffId) }">{{ initials(c.name) }}</div>
            <div class="grow">
              <div class="title">{{ c.name }}</div>
              <div class="meta">Usually every {{ c.usualGap }} days · last visit {{ weeksAgo(c.daysSince) }}</div>
            </div>
            <div class="right"><div class="meta">{{ employeeById(c.staffId)?.name }}</div></div>
          </button>
        </div>
        <div v-else class="empty" style="padding: 18px">All your regulars have been in recently 💕</div>
      </section>
    </template>
  </div>

  <button v-if="state.employees.length" class="fab" @click="openAppointment()"><Icon name="plus" :stroke="2.4" /> Add</button>
</template>
