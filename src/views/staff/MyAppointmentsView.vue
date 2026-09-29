<script setup>
import { computed, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import { all, state, openMyAppointment } from '../../store.js'
import { businessMonth, todayStr } from '../../lib/format.js'
import { overtimeLabel } from '../../lib/payroll.js'
import { lockedReason } from '../../lib/staffRules.js'
import { monthProgress } from '../../lib/staffStats.js'
import { monthLabel } from '../../lib/format.js'
import { setView } from '../../store.js'
import { holidayOn } from '../../lib/holidays.js'

/** Staff: one day at a time (today first), in the order the appointments were added. No amounts. */
const today = todayStr()
const day = ref(today)
const shift = (n) => {
  const d = new Date(day.value + 'T12:00:00')
  d.setDate(d.getDate() + n)
  const next = d.toISOString().slice(0, 10)
  day.value = next > today ? today : next
}
const pick = (e) => e.target.value && (day.value = e.target.value > today ? today : e.target.value)
const label = computed(() => {
  if (day.value === today) return 'Today'
  const y = new Date(today + 'T12:00:00')
  y.setDate(y.getDate() - 1)
  if (day.value === y.toISOString().slice(0, 10)) return 'Yesterday'
  return new Date(day.value + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'long' })
})
const long = computed(() => new Date(day.value + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }))

const list = computed(() => all.value
  .filter((a) => a.date === day.value)
  .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.client.localeCompare(b.client)))
const unpaid = computed(() => list.value.filter((a) => a.status === 'Unpaid').length)
const locked = computed(() => lockedReason({ month: businessMonth(day.value, state.monthStartDay) }, state.monthStartDay, state.payslips))
const month = computed(() => monthProgress(all.value, state.monthStartDay, today))
const added = (a) => (a.createdAt ? new Date(a.createdAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '')
</script>

<template>
  <div class="page">
    <div class="day-nav">
      <button class="icon-btn" aria-label="Previous day" @click="shift(-1)"><Icon name="left" /></button>
      <label class="day-pick">
        <b>{{ label }}</b><small>{{ long }}<template v-if="holidayOn(day)"> · 🇿🇦 {{ holidayOn(day) }}</template></small>
        <input type="date" :value="day" :max="today" aria-label="Choose a day" @change="pick">
      </label>
      <button class="icon-btn" aria-label="Next day" :disabled="day >= today" @click="shift(1)"><Icon name="right" /></button>
    </div>
    <p class="muted-note day-summary">
      {{ list.length }} appointment{{ list.length === 1 ? '' : 's' }}<template v-if="unpaid"> · {{ unpaid }} not paid yet</template>
      <button v-if="day !== today" class="link-btn" @click="day = today">Back to today</button>
    </p>
    <button class="month-strip" @click="setView('my-details')">
      <span><b>{{ monthLabel(month.month).split(' ')[0] }} so far:</b> {{ month.count }} appointment{{ month.count === 1 ? '' : 's' }}</span>
      <span v-if="month.change" :class="month.change > 0 ? 'green' : 'orange'">{{ month.change > 0 ? '↑' : '↓' }} {{ Math.abs(month.change) }} vs last month</span>
      <span v-if="month.unpaid" class="orange">{{ month.unpaid }} unpaid</span>
      <span class="more">My stats →</span>
    </button>
    <p v-if="locked" class="field-hint orange" style="margin: 0 0 10px">🔒 {{ locked }}</p>

    <div v-if="list.length" class="card" style="padding: 4px 16px">
      <button v-for="(a, i) in list" :key="a.id" class="list-row" @click="openMyAppointment(a)">
        <div class="appt-num">{{ i + 1 }}</div>
        <div class="grow">
          <div class="title">{{ a.client || 'Client' }}</div>
          <div class="meta">{{ [overtimeLabel(a) && '⏰ ' + overtimeLabel(a), a.service, a.method, a.notes].filter(Boolean).join(' · ') || ' ' }}</div>
        </div>
        <div class="right">
          <span class="tag" :class="{ Paid: 'green-tag', Unpaid: 'orange-tag' }[a.status]">{{ a.status }}</span>
          <div v-if="added(a)" class="meta" style="margin-top: 4px">added {{ added(a) }}</div>
        </div>
      </button>
    </div>
    <div v-else class="card empty" style="padding: 22px">{{ day === today ? 'No appointments yet today. Tap Add after each client ✨' : 'No appointments on this day.' }}</div>
  </div>
  <button v-if="!locked" class="fab" @click="openMyAppointment(null, { date: day })"><Icon name="plus" :stroke="2.4" /> Add</button>
</template>
