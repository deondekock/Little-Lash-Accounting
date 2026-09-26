<script setup>
import { computed, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import { all, state, openMyAppointment } from '../../store.js'
import { businessMonth, dayLabel, monthLabel, monthRange, shiftMonth, shortDate, todayStr } from '../../lib/format.js'
import { overtimeLabel } from '../../lib/payroll.js'
import { lockedReason } from '../../lib/staffRules.js'

/** Staff: her appointments by day (no amounts). */
const month = ref(businessMonth(todayStr(), state.monthStartDay))
const thisMonth = computed(() => businessMonth(todayStr(), state.monthStartDay))
const range = computed(() => monthRange(month.value, state.monthStartDay))
const list = computed(() => all.value.filter((a) => a.month === month.value))
const groups = computed(() => {
  const by = new Map()
  for (const a of [...list.value].sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (x.createdAt < y.createdAt ? 1 : -1)))) {
    if (!by.has(a.date)) by.set(a.date, [])
    by.get(a.date).push(a)
  }
  return [...by.entries()]
})
const unpaid = computed(() => list.value.filter((a) => a.status !== 'Paid').length)
const locked = computed(() => lockedReason({ month: month.value }, state.monthStartDay, state.payslips))
</script>

<template>
  <div class="page">
    <div class="greeting"><div class="hello">Your <em>appointments</em></div></div>
    <div class="period-nav-simple">
      <button class="icon-btn" aria-label="Previous month" @click="month = shiftMonth(month, -1)"><Icon name="left" /></button>
      <div><b>{{ monthLabel(month) }}</b><small>{{ shortDate(range.from) }} – {{ shortDate(range.to) }}</small></div>
      <button class="icon-btn" aria-label="Next month" :disabled="month >= thisMonth" @click="month = shiftMonth(month, 1)"><Icon name="right" /></button>
    </div>
    <p class="muted-note" style="margin: 0 0 10px">
      {{ list.length }} appointment{{ list.length === 1 ? '' : 's' }}<template v-if="unpaid"> · {{ unpaid }} not paid yet</template>
      <template v-if="locked"> · 🔒 {{ locked.split('.')[0] }}</template>
    </p>

    <div v-if="groups.length" class="card" style="padding: 4px 0">
      <template v-for="[date, items] in groups" :key="date">
        <div class="date-head">{{ dayLabel(date) }}<span>{{ items.length }}</span></div>
        <button v-for="a in items" :key="a.id" class="list-row" @click="openMyAppointment(a)">
          <div class="grow">
            <div class="title">{{ a.client || 'Client' }}</div>
            <div class="meta">{{ [overtimeLabel(a) && '⏰ ' + overtimeLabel(a), a.service, a.method, a.notes].filter(Boolean).join(' · ') || ' ' }}</div>
          </div>
          <span class="tag" :class="a.status === 'Paid' ? 'green-tag' : 'orange-tag'">{{ a.status }}</span>
        </button>
      </template>
    </div>
    <div v-else class="card empty" style="padding: 18px">No appointments in {{ monthLabel(month).split(' ')[0] }}.</div>
  </div>
  <button v-if="!lockedReason({ month: thisMonth }, state.monthStartDay, state.payslips)" class="fab" @click="openMyAppointment()"><Icon name="plus" :stroke="2.4" /> Add</button>
</template>
