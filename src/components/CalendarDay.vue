<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { employeeColor } from '../store.js'
import { scheduleOf, weekdayOf, toMin, toTime, lengthLabel } from '../lib/booking.js'

/**
 * One day of the calendar: a column per team member, a 15-minute grid, working hours unshaded.
 * Tap an empty spot → create; tap a booking → open; hold a booking (½ s) and drag → move it
 * (to another time, or another column), snapped to 15 minutes.
 */
const props = defineProps({
  date: { type: String, required: true },
  people: { type: Array, required: true }, // employees shown as columns
  bookings: { type: Array, required: true },
  leave: { type: Array, default: () => [] },
  now: { type: Object, default: null }, // { date, minutes }
})
const emit = defineEmits(['open', 'create', 'move'])

const PX = 1.2 // pixels per minute (15 min = 18 px)
const SNAP = 15

const dayBookings = computed(() => props.bookings.filter((b) => b.date === props.date && b.status !== 'cancelled'))
/** Hours shown: 07:00–19:00, widened to fit working hours and bookings. */
const range = computed(() => {
  let a = 7 * 60
  let z = 19 * 60
  for (const e of props.people) for (const [f, t] of scheduleOf(e)[weekdayOf(props.date)] || []) { a = Math.min(a, toMin(f)); z = Math.max(z, toMin(t)) }
  for (const b of dayBookings.value) { a = Math.min(a, toMin(b.start)); z = Math.max(z, toMin(b.start) + b.minutes) }
  return { from: Math.floor(a / 60) * 60, to: Math.ceil(z / 60) * 60 }
})
const hours = computed(() => Array.from({ length: (range.value.to - range.value.from) / 60 }, (_, i) => range.value.from + i * 60))
const y = (min) => (min - range.value.from) * PX
const height = computed(() => (range.value.to - range.value.from) * PX)

const onLeave = (e) => props.leave.some((l) => l.employeeId === e.id && (!l.status || l.status === 'approved') && l.from <= props.date && (l.to || l.from) >= props.date)
/** Unavailable stretches of a column (outside working hours, or all day on leave). */
function closed(e) {
  if (onLeave(e)) return [[range.value.from, range.value.to]]
  const open = (scheduleOf(e)[weekdayOf(props.date)] || []).map(([f, t]) => [toMin(f), toMin(t)]).sort((p, q) => p[0] - q[0])
  const out = []
  let t = range.value.from
  for (const [f, z] of open) {
    if (f > t) out.push([t, f])
    t = Math.max(t, z)
  }
  if (t < range.value.to) out.push([t, range.value.to])
  return out
}

/** Bookings of a column laid out side by side where they overlap (a tint during a fill). */
function laid(e) {
  const list = dayBookings.value.filter((b) => b.employeeId === e.id).map((b) => ({ b, s: toMin(b.start), e: toMin(b.start) + b.minutes }))
    .sort((p, q) => p.s - q.s || q.e - p.e)
  const lanes = []
  for (const x of list) {
    let lane = lanes.findIndex((end) => end <= x.s)
    if (lane < 0) { lane = lanes.length; lanes.push(0) }
    lanes[lane] = x.e
    x.lane = lane
  }
  for (const x of list) x.lanes = Math.max(1, ...list.filter((o) => o.s < x.e && x.s < o.e).map((o) => o.lane + 1))
  return list
}

const nowY = computed(() => (props.now && props.now.date === props.date && props.now.minutes >= range.value.from && props.now.minutes <= range.value.to ? y(props.now.minutes) : null))

/* ---------- tapping and dragging ---------- */
const grid = ref(null)
const drag = ref(null) // { booking, start, empId, ghostY, col }
let press = null

function minuteAt(clientY) {
  const r = grid.value.getBoundingClientRect()
  const m = range.value.from + (clientY - r.top) / PX
  return Math.max(range.value.from, Math.min(range.value.to - SNAP, Math.floor(m / SNAP) * SNAP))
}
function columnAt(clientX) {
  const cols = [...grid.value.querySelectorAll('.cal-col')]
  const i = cols.findIndex((c) => { const r = c.getBoundingClientRect(); return clientX >= r.left && clientX < r.right })
  return i >= 0 ? props.people[i] : null
}

function tapEmpty(e, person) {
  if (drag.value || e.target.closest('.cal-booking')) return
  emit('create', { employeeId: person.id, start: toTime(minuteAt(e.clientY)), date: props.date })
}

function downOnBooking(ev, item) {
  if (ev.button > 0) return
  const offset = minuteAt(ev.clientY) - toMin(item.b.start)
  press = {
    item, x: ev.clientX, y: ev.clientY, offset, moved: false,
    timer: setTimeout(() => {
      press.active = true
      drag.value = { booking: item.b, start: item.b.start, empId: item.b.employeeId }
      navigator.vibrate?.(20)
    }, 450),
  }
}
function onMove(ev) {
  if (!press) return
  if (!press.active) {
    if (Math.abs(ev.clientX - press.x) > 8 || Math.abs(ev.clientY - press.y) > 8) { clearTimeout(press.timer); press = null }
    return
  }
  ev.preventDefault?.()
  press.moved = true
  const m = Math.max(range.value.from, minuteAt(ev.clientY) - Math.round(press.offset / SNAP) * SNAP)
  const col = columnAt(ev.clientX)
  drag.value = { ...drag.value, start: toTime(m), empId: col ? col.id : drag.value.empId }
}
function onUp() {
  if (!press) return
  clearTimeout(press.timer)
  const p = press
  press = null
  if (p.active) {
    const d = drag.value
    drag.value = null
    if (p.moved && (d.start !== d.booking.start || d.empId !== d.booking.employeeId)) emit('move', { booking: d.booking, start: d.start, employeeId: d.empId })
    return
  }
  emit('open', p.item.b)
}
// Stop the page scrolling while a booking is being dragged (touch screens).
const blockScroll = (ev) => { if (press?.active) ev.preventDefault() }
onMounted(() => {
  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  window.addEventListener('touchmove', blockScroll, { passive: false })
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onUp)
  window.removeEventListener('touchmove', blockScroll)
})
const services = (b) => b.services.map((s) => s.name).filter(Boolean).join(' + ')
const STATUS = { done: '✓ done', noshow: 'no-show' }
</script>

<template>
  <div class="cal" :class="{ single: people.length === 1 }">
    <div class="cal-head">
      <div class="cal-gutter" />
      <div v-for="p in people" :key="p.id" class="cal-name"><i class="swatch-dot" :style="{ background: employeeColor(p.id) }" />{{ p.name }}<small v-if="onLeave(p)"> · on leave</small></div>
    </div>
    <div ref="grid" class="cal-body" :style="{ height: height + 'px' }">
      <div class="cal-gutter">
        <div v-for="h in hours" :key="h" class="cal-hour" :style="{ top: y(h) + 'px' }">{{ toTime(h) }}</div>
      </div>
      <div v-for="p in people" :key="p.id" class="cal-col" @click="tapEmpty($event, p)">
        <div v-for="h in hours" :key="h" class="cal-line" :style="{ top: y(h) + 'px' }" />
        <div v-for="([a, z], i) in closed(p)" :key="i" class="cal-closed" :style="{ top: y(a) + 'px', height: (z - a) * PX + 'px' }" />
        <div
          v-for="x in laid(p)" :key="x.b.id" class="cal-booking" :class="[x.b.kind, x.b.status, { dragging: drag?.booking.id === x.b.id }]"
          :style="{ top: y(x.s) + 'px', height: Math.max(18, x.b.minutes * PX - 2) + 'px', left: `calc(${(x.lane / x.lanes) * 100}% + 2px)`, width: `calc(${100 / x.lanes}% - 4px)`, '--c': employeeColor(p.id) }"
          role="button" :aria-label="`${x.b.clientName} ${x.b.start}`"
          @pointerdown="downOnBooking($event, x)" @contextmenu.prevent
        >
          <b>{{ x.b.kind === 'block' ? '⛔ ' : '' }}{{ x.b.clientName }}</b>
          <span>{{ x.b.start }}<template v-if="x.b.minutes >= 30 && (services(x.b) || x.b.notes)"> · {{ services(x.b) || x.b.notes }}</template></span>
          <span v-if="STATUS[x.b.status]" class="cal-status">{{ STATUS[x.b.status] }}</span>
          <span v-if="x.b.source === 'online'" class="cal-online" title="Booked online">🌐</span>
        </div>
        <div
          v-if="drag && drag.empId === p.id" class="cal-ghost"
          :style="{ top: y(toMin(drag.start)) + 'px', height: drag.booking.minutes * PX + 'px' }"
        >{{ drag.start }} · {{ lengthLabel(drag.booking.minutes) }}</div>
        <div v-if="nowY !== null" class="cal-now" :style="{ top: nowY + 'px' }" />
      </div>
    </div>
  </div>
</template>
