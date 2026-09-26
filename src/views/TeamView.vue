<script setup>
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import Sparkline from '../components/charts/Sparkline.vue'
import { all, state, monthAppts, employeeColor, openEmployee, setView, openPicker, monthFlow, openFlow } from '../store.js'
import { leaveBalance, payDefaults } from '../lib/payroll.js'
import { todayStr } from '../lib/format.js'
import { fmt, fmt0, initials, monthLabel, shiftMonth, totals } from '../lib/format.js'

const showInactive = ref(false)
const months = computed(() => Array.from({ length: 12 }, (_, i) => shiftMonth(state.month, i - 11)))

const members = computed(() =>
  state.employees
    .filter((e) => e.active || showInactive.value)
    .map((e) => {
      const mine = all.value.filter((a) => a.employeeId === e.id)
      const byMonth = new Map()
      for (const a of mine) byMonth.set(a.month, (byMonth.get(a.month) || 0) + a.amount)
      const t = totals(monthAppts.value.filter((a) => a.employeeId === e.id))
      const clients = new Set(mine.filter((a) => a.month === state.month).map((a) => a.client.trim().toLowerCase())).size
      return {
        ...e,
        t,
        clients,
        trend: months.value.map((m) => byMonth.get(m) || 0),
        lifetime: mine.length,
        leave: leaveBalance({ ...e, pay: payDefaults(e.pay) }, state.leave, todayStr()),
        since: mine.length ? mine.reduce((m, a) => (a.date < m ? a.date : m), mine[0].date).slice(0, 4) : '',
      }
    })
    .sort((a, b) => (b.active - a.active) || b.t.total - a.t.total),
)
const FLOW = [
  { id: 'new', label: 'new' },
  { id: 'returning', label: '2nd/3rd' },
  { id: 'regular', label: 'regulars' },
  { id: 'switchedIn', label: 'switched in' },
  { id: 'switchedOut', label: 'moved away' },
]
const inactiveCount = computed(() => state.employees.filter((e) => !e.active).length)
</script>

<template>
  <div class="page">
    <div class="greeting" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px">
      <div>
        <div class="hello">The <em>team</em></div>
        <button class="month-pill" style="margin-top: 8px" aria-label="Choose month" @click="openPicker('month')">
          <Icon name="calendar" :size="16" />{{ monthLabel(state.month) }}<Icon name="down" :size="16" :stroke="2.2" />
        </button>
      </div>
      <button class="btn small soft" @click="openEmployee()"><Icon name="plus" :size="16" /> Add</button>
    </div>

    <div class="team-grid">
      <div v-for="m in members" :key="m.id" class="card member" :class="{ inactive: !m.active }">
        <div class="head">
          <div class="avatar" :style="{ background: employeeColor(m.id) }">{{ initials(m.name) }}</div>
          <div class="grow">
            <div class="name">{{ m.name }}<span v-if="!m.active" class="tag">inactive</span></div>
            <div class="role">{{ m.lifetime.toLocaleString('en-ZA') }} appointments<template v-if="m.since"> since {{ m.since }}</template></div>
            <button v-if="m.active && m.leave.start" class="role link-btn" style="padding: 0; font-size: 12.5px" @click="setView('payroll', { payrollTab: 'leave' })">🌴 {{ m.leave.hours }} h leave ({{ m.leave.days }} days)</button>
          </div>
          <button class="btn small ghost" @click="openEmployee(m)">Edit</button>
        </div>
        <div class="figs">
          <div><div class="l">{{ monthLabel(state.month).split(' ')[0] }}</div><div class="v">{{ fmt0(m.t.total) }}</div></div>
          <div><div class="l">Appointments</div><div class="v">{{ m.t.count }}</div></div>
          <div><div class="l">Unpaid</div><div class="v" :class="{ orange: m.t.unpaid }">{{ fmt0(m.t.unpaid) }}</div></div>
        </div>
        <div class="flow-chips">
          <button v-for="c in FLOW" :key="c.id" class="flow-chip" @click="openFlow(m.id, c.id)">
            <b>{{ (monthFlow[m.id]?.[c.id] || []).length }}</b><span>{{ c.label }}</span>
          </button>
        </div>
        <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 10px">
          <div>
            <div style="font-size: 11.5px; color: var(--muted); font-weight: 600; margin-bottom: 4px">Last 12 months</div>
            <Sparkline :values="m.trend" :color="employeeColor(m.id)" :width="170" :height="38" :label="`${m.name}: takings over the last 12 months`" />
          </div>
          <button class="link-btn" @click="setView('payments', { employee: m.id, status: 'all' })">Payments →</button>
        </div>
      </div>
    </div>

    <button class="card list-row" style="margin-top: 14px; padding: 16px" @click="setView('payroll', { payrollTab: 'payslips' })">
      <div class="history-icon"><Icon name="wallet" :size="16" /></div>
      <div class="grow"><div class="title">Payslips</div><div class="meta">Salary, commission, overtime, PAYE &amp; UIF</div></div>
      <Icon name="right" />
    </button>
    <button class="card list-row" style="margin-top: 10px; padding: 16px" @click="setView('payroll', { payrollTab: 'leave' })">
      <div class="history-icon"><Icon name="calendar" :size="16" /></div>
      <div class="grow"><div class="title">Leave</div><div class="meta">Book leave and see who has how much left</div></div>
      <Icon name="right" />
    </button>
    <button class="card list-row" style="margin-top: 10px; padding: 16px" @click="setView('services')">
      <div class="history-icon"><Icon name="sparkle" :size="16" /></div>
      <div class="grow"><div class="title">Services &amp; prices</div><div class="meta">Add, rename or merge services and set prices</div></div>
      <Icon name="right" />
    </button>

    <p v-if="inactiveCount" style="text-align: center; margin-top: 16px">
      <button class="link-btn" @click="showInactive = !showInactive">
        {{ showInactive ? 'Hide' : 'Show' }} {{ inactiveCount }} past team member{{ inactiveCount === 1 ? '' : 's' }}
      </button>
    </p>
  </div>
</template>
