<script setup>
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { state, employeeColor, openLeave } from '../store.js'
import { monthLabel, shiftMonth, todayStr, shortDate } from '../lib/format.js'
import { holidaysIn } from '../lib/holidays.js'

/**
 * A month at a glance: who is off each day (a coloured dot per person; hollow = still a request)
 * and the public holidays. Tap a day to see who's off.
 */
const today = todayStr()
const month = ref(today.slice(0, 7))
const picked = ref(today)
const nameOf = (id) => state.employees.find((e) => e.id === id)?.name || '—'

const cells = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7 // Monday first
  const count = new Date(y, m, 0).getDate()
  const hols = new Map(holidaysIn(y).map((h) => [h.date, h.name]))
  const leave = state.leave.filter((l) => l.status !== 'declined')
  const out = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= count; d++) {
    const date = `${month.value}-${String(d).padStart(2, '0')}`
    const off = leave.filter((l) => l.from <= date && (l.to || l.from) >= date)
    out.push({ date, d, holiday: hols.get(date) || '', off, weekend: [0, 6].includes(new Date(y, m - 1, d).getDay()) })
  }
  return out
})
const day = computed(() => cells.value.find((c) => c?.date === picked.value))
const clashes = computed(() => cells.value.filter((c) => c && new Set(c.off.map((l) => l.employeeId)).size > 1).length)
function go(delta) {
  month.value = shiftMonth(month.value, delta)
  picked.value = `${month.value}-01`
}
</script>

<template>
  <section class="card leave-cal">
    <div class="period-nav-simple">
      <button class="icon-btn" aria-label="Previous month" @click="go(-1)"><Icon name="left" /></button>
      <div><b>{{ monthLabel(month) }}</b><small>{{ clashes ? `${clashes} day${clashes === 1 ? '' : 's'} with more than one person off` : 'who is off' }}</small></div>
      <button class="icon-btn" aria-label="Next month" @click="go(1)"><Icon name="right" /></button>
    </div>
    <div class="lc-grid" role="grid">
      <div v-for="(w, i) in ['M', 'T', 'W', 'T', 'F', 'S', 'S']" :key="'h' + i" class="lc-head">{{ w }}</div>
      <template v-for="(c, i) in cells" :key="i">
        <div v-if="!c" />
        <button
          v-else class="lc-day" :class="{ today: c.date === today, picked: c.date === picked, holiday: c.holiday, weekend: c.weekend, busy: new Set(c.off.map((l) => l.employeeId)).size > 1 }"
          :aria-label="`${shortDate(c.date)}${c.holiday ? ', ' + c.holiday : ''}${c.off.length ? ', ' + c.off.map((l) => nameOf(l.employeeId)).join(', ') + ' off' : ''}`"
          @click="picked = c.date"
        >
          <span class="lc-num">{{ c.d }}</span>
          <span class="lc-dots">
            <i v-for="l in c.off.slice(0, 4)" :key="l.id" :class="{ req: l.status === 'requested' }" :style="{ '--c': employeeColor(l.employeeId) }" />
          </span>
        </button>
      </template>
    </div>
    <div v-if="day" class="lc-detail">
      <b>{{ new Date(day.date + 'T12:00').toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }) }}</b>
      <div v-if="day.holiday" class="lc-hol">🇿🇦 {{ day.holiday }} — public holiday</div>
      <button v-for="l in day.off" :key="l.id" class="lc-person" @click="openLeave(l)">
        <i class="swatch-dot" :style="{ background: employeeColor(l.employeeId) }" />
        {{ nameOf(l.employeeId) }} · {{ l.type }}<template v-if="l.status === 'requested'"> (request)</template>
      </button>
      <div v-if="!day.off.length && !day.holiday" class="muted">Everyone's in 💕</div>
    </div>
  </section>
</template>
