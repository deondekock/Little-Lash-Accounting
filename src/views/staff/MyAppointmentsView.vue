<script setup>
import { computed, ref } from 'vue'
import DayNav from '../../components/DayNav.vue'
import CalendarDay from '../../components/CalendarDay.vue'
import { all, state, openMyAppointment, openBooking, moveBooking, setView, toastUndo, fail } from '../../store.js'
import { businessMonth, monthLabel, todayStr } from '../../lib/format.js'
import { overtimeLabel } from '../../lib/payroll.js'
import { lockedReason } from '../../lib/staffRules.js'
import { monthProgress } from '../../lib/staffStats.js'
import { salonNow } from '../../lib/booking.js'

/** Staff: her day — the calendar of her bookings, then the payments she recorded (no amounts). */
const today = todayStr()
const day = ref(today)
const me = computed(() => state.employees[0])
const list = computed(() => all.value
  .filter((a) => a.date === day.value)
  .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.client.localeCompare(b.client)))
const unpaid = computed(() => list.value.filter((a) => a.status !== 'Paid').length)
const locked = computed(() => lockedReason({ month: businessMonth(day.value, state.monthStartDay) }, state.monthStartDay, state.payslips))
const canPay = computed(() => day.value <= today && !locked.value)
const month = computed(() => monthProgress(all.value, state.monthStartDay, today))
const added = (a) => (a.createdAt ? new Date(a.createdAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '')
const bookingsToday = computed(() => state.bookings.filter((b) => b.date === day.value && b.kind === 'booking' && b.status === 'booked').length)
async function move({ booking, start }) {
  try {
    await moveBooking(booking, start, booking.employeeId)
    toastUndo(`Moved to ${start}`)
  } catch (err) {
    fail(err)
  }
}
</script>

<template>
  <div class="page">
    <DayNav v-model="day" />
    <button class="month-strip" @click="setView('my-details')">
      <span><b>{{ monthLabel(month.month).split(' ')[0] }} so far:</b> {{ month.count }} appointment{{ month.count === 1 ? '' : 's' }}</span>
      <span v-if="month.change" :class="month.change > 0 ? 'green' : 'orange'">{{ month.change > 0 ? '↑' : '↓' }} {{ Math.abs(month.change) }} vs last month</span>
      <span v-if="month.unpaid" class="orange">{{ month.unpaid }} unpaid</span>
      <span class="more">My stats →</span>
    </button>

    <div class="day-actions">
      <button class="btn small soft" @click="openBooking(null, { date: day, employeeId: me?.id })">+ Booking</button>
      <button v-if="canPay" class="btn small soft" @click="openMyAppointment(null, { date: day })">+ Walk-in payment</button>
    </div>
    <p class="muted-note" style="margin: 0 0 8px !important">
      {{ bookingsToday }} booking{{ bookingsToday === 1 ? '' : 's' }} to do · tap one when you're done to record the payment · hold &amp; drag to move
    </p>
    <CalendarDay v-if="me" :date="day" :people="[me]" :bookings="state.bookings" :leave="state.leave" :now="salonNow()"
      @open="openBooking" @create="(x) => openBooking(null, x)" @move="move" />

    <h4 class="section-label">Payments recorded</h4>
    <p v-if="locked" class="field-hint orange" style="margin: 0 0 10px">🔒 {{ locked }}</p>
    <div v-if="list.length" class="card" style="padding: 4px 0">
      <button v-for="(a, i) in list" :key="a.id" class="list-row" @click="openMyAppointment(a)">
        <div class="appt-num">{{ i + 1 }}</div>
        <div class="grow">
          <div class="title">{{ a.client || 'Client' }}</div>
          <div class="meta">{{ [overtimeLabel(a) && '⏰ ' + overtimeLabel(a), a.service, a.method, a.notes].filter(Boolean).join(' · ') || ' ' }}</div>
        </div>
        <div class="right">
          <span class="tag" :class="a.status === 'Paid' ? 'green-tag' : 'orange-tag'">{{ a.status }}</span>
          <div v-if="added(a)" class="meta" style="margin-top: 4px">added {{ added(a) }}</div>
        </div>
      </button>
    </div>
    <div v-else class="card empty" style="padding: 18px">{{ day > today ? 'Payments are recorded on the day.' : 'No payments recorded on this day.' }}{{ unpaid ? '' : '' }}</div>
  </div>
</template>
