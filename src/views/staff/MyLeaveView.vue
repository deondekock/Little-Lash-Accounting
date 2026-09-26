<script setup>
import { computed } from 'vue'
import { state, openMyLeave } from '../../store.js'
import { shortDate, todayStr } from '../../lib/format.js'
import { leaveBalance, sickBalance, familyBalance, payDefaults } from '../../lib/payroll.js'
import { LEAVE_STATUS } from '../../lib/schema.js'

/** Staff: her leave balances, her requests and her leave. */
const me = computed(() => state.employees[0])
const today = todayStr()
const withPay = computed(() => me.value && { ...me.value, pay: payDefaults(me.value.pay) })
const annual = computed(() => withPay.value && leaveBalance(withPay.value, state.leave, today))
const sick = computed(() => withPay.value && sickBalance(withPay.value, state.leave, today))
const family = computed(() => withPay.value && familyBalance(withPay.value, state.leave, today))
const first = computed(() => (me.value?.name || '').split(' ')[0])

const sorted = computed(() => [...state.leave].sort((a, b) => (a.from < b.from ? 1 : -1)))
const waiting = computed(() => sorted.value.filter((l) => l.status === 'requested'))
const upcoming = computed(() => sorted.value.filter((l) => l.status !== 'requested' && l.to >= today).reverse())
const past = computed(() => sorted.value.filter((l) => l.status !== 'requested' && l.to < today))
const range = (l) => (l.to && l.to !== l.from ? `${shortDate(l.from)} – ${shortDate(l.to)}` : shortDate(l.from))
const TYPE_EMOJI = { Annual: '🌴', Sick: '🤒', Family: '👨‍👩‍👧', Maternity: '🤱', Unpaid: '⏸️' }
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
      <div v-if="sick && !sick.owner" class="leave-others">
        <div><span>🤒 Sick</span><b>{{ sick.hours }} h</b><small>of {{ sick.entitled }} h · until {{ shortDate(sick.to) }} {{ sick.to.slice(0, 4) }}</small></div>
        <div><span>👨‍👩‍👧 Family</span><b>{{ family.hours }} h</b><small>{{ family.eligible ? `of ${family.entitled} h · until ${shortDate(family.to)} ${family.to.slice(0, 4)}` : 'after 4 months' }}</small></div>
      </div>
    </div>

    <template v-if="waiting.length">
      <h4 class="section-label">Waiting for approval</h4>
      <div class="list card" style="padding: 4px 0">
        <button v-for="l in waiting" :key="l.id" class="list-row" @click="openMyLeave(l)">
          <div class="history-icon">{{ TYPE_EMOJI[l.type] }}</div>
          <div class="grow"><div class="title">{{ l.type }} · {{ range(l) }}</div><div class="meta">{{ l.hours }} h{{ l.notes ? ' · ' + l.notes : '' }}</div></div>
          <span class="tag orange-tag">{{ LEAVE_STATUS.requested }}</span>
        </button>
      </div>
    </template>

    <h4 class="section-label">Coming up</h4>
    <div v-if="upcoming.length" class="list card" style="padding: 4px 0">
      <div v-for="l in upcoming" :key="l.id" class="list-row">
        <div class="history-icon">{{ TYPE_EMOJI[l.type] }}</div>
        <div class="grow"><div class="title">{{ l.type }} · {{ range(l) }}</div><div class="meta">{{ l.hours }} h{{ l.notes ? ' · ' + l.notes : '' }}</div></div>
        <span class="tag" :class="TAG[l.status]">{{ LEAVE_STATUS[l.status] }}</span>
      </div>
    </div>
    <div v-else class="card empty" style="padding: 18px">No leave coming up.</div>

    <template v-if="past.length">
      <h4 class="section-label">Taken</h4>
      <div class="list card" style="padding: 4px 0">
        <div v-for="l in past.slice(0, 30)" :key="l.id" class="list-row">
          <div class="history-icon">{{ TYPE_EMOJI[l.type] }}</div>
          <div class="grow"><div class="title">{{ l.type }} · {{ range(l) }} {{ l.from.slice(0, 4) }}</div><div class="meta">{{ l.hours }} h</div></div>
          <span v-if="l.status === 'declined'" class="tag red-tag">{{ LEAVE_STATUS.declined }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
