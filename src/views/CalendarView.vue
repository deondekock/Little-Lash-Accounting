<script setup>
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import DayNav from '../components/DayNav.vue'
import CalendarDay from '../components/CalendarDay.vue'
import { state, employeeColor, openBooking, moveBooking, toastUndo, fail } from '../store.js'
import { todayStr } from '../lib/format.js'
import { salonNow, lengthLabel } from '../lib/booking.js'

/** Owner: the day's calendar for the whole team (or one person). */
const day = ref(todayStr())
const who = ref('all')
const people = computed(() => state.employees.filter((e) => e.active && (who.value === 'all' || e.id === who.value)).sort((a, b) => a.name.localeCompare(b.name)))
const dayList = computed(() => state.bookings.filter((b) => b.date === day.value && b.kind === 'booking' && b.status !== 'cancelled'))
const summary = computed(() => {
  const l = dayList.value
  const mins = l.reduce((t, b) => t + b.minutes, 0)
  return { count: l.length, online: l.filter((b) => b.source === 'online').length, done: l.filter((b) => b.status === 'done').length, hours: lengthLabel(mins) }
})
async function move({ booking, start, employeeId }) {
  try {
    await moveBooking(booking, start, employeeId)
    toastUndo(`Moved to ${start}${employeeId !== booking.employeeId ? ' · ' + state.employees.find((e) => e.id === employeeId)?.name : ''}`)
  } catch (err) {
    fail(err)
  }
}
</script>

<template>
  <div class="page">
    <DayNav v-model="day" />
    <div class="chips" style="margin-top: 4px">
      <button class="chip small" :class="{ active: who === 'all' }" @click="who = 'all'">Everyone</button>
      <button v-for="e in state.employees.filter((x) => x.active)" :key="e.id" class="chip small" :class="{ active: who === e.id }" @click="who = e.id">
        <i class="swatch-dot" :style="{ background: employeeColor(e.id) }" />{{ e.name }}
      </button>
    </div>
    <p class="muted-note" style="margin: 0 0 10px !important">
      {{ summary.count }} booking{{ summary.count === 1 ? '' : 's' }}<template v-if="summary.count"> · {{ summary.hours }} booked</template><template v-if="summary.online"> · 🌐 {{ summary.online }} online</template><template v-if="summary.done"> · {{ summary.done }} done</template>
      · <span style="white-space: nowrap">hold &amp; drag to move</span>
    </p>
    <CalendarDay :date="day" :people="people" :bookings="state.bookings" :leave="state.leave" :now="salonNow()"
      @open="openBooking" @create="(x) => openBooking(null, x)" @move="move" />
  </div>
  <button class="fab" @click="openBooking(null, { date: day, employeeId: who !== 'all' ? who : undefined })"><Icon name="plus" :stroke="2.4" /> Book</button>
</template>
