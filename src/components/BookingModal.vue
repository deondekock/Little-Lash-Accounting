<script setup>
import { computed, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import ClientInput from './ClientInput.vue'
import ServicePicker from './ServicePicker.vue'
import { state, closeModal, saveBookingAs, setBookingStatusAs, openAppointment, openMyAppointment, toastUndo, toast, fail, employeeById } from '../store.js'
import { splitServices, joinServices, serviceKey } from '../lib/services.js'
import { serviceFor, toMin, toTime, lengthLabel, dayName } from '../lib/booking.js'
import { fmt0 } from '../lib/format.js'

/**
 * A booking in the calendar (owner: anyone's; staff: her own). The length follows the services
 * (each person's own time for each service) until it's changed by hand — e.g. a brow tint done
 * during a lash fill doesn't need extra time.
 */
const props = defineProps({ booking: Object, prefill: Object })
const staff = state.role === 'staff'
const b = props.booking
const editing = !!b
const form = reactive({
  kind: b?.kind === 'block' ? 'Block time' : 'Booking',
  employeeId: b?.employeeId || props.prefill?.employeeId || (staff ? state.employees[0]?.id : state.employees.find((e) => e.active)?.id),
  date: b?.date || props.prefill?.date,
  start: b?.start || props.prefill?.start || '09:00',
  clientName: b?.clientName || '',
  clientPhone: b?.clientPhone || '',
  service: joinServices((b?.services || []).map((s) => s.name)),
  minutes: b?.minutes || 60,
  notes: b?.notes || '',
})
const isBlock = computed(() => form.kind === 'Block time')
const saving = ref(false)
const picker = ref(null)

/** The chosen services, each with this person's length and price. */
const items = computed(() => splitServices(form.service).map((name) => {
  const svc = state.services.find((s) => serviceKey(s.name) === serviceKey(name))
  if (!svc) return { id: null, name, minutes: 0, price: null }
  const f = serviceFor(svc, form.employeeId)
  return { id: svc.id, name: svc.name, minutes: svc.minutes || svc.durations?.[form.employeeId] ? f.minutes : 0, price: f.price }
}))
const normal = computed(() => items.value.reduce((t, i) => t + i.minutes, 0))
const price = computed(() => (items.value.length && items.value.every((i) => i.price != null) ? items.value.reduce((t, i) => t + i.price, 0) : null))
// Length follows the services until she sets it by hand.
const autoLength = ref(!editing || b.minutes === (b.services || []).reduce((t, s) => t + (s.minutes || 0), 0))
watch(normal, (m) => { if (autoLength.value && m) form.minutes = m })
const nudge = (d) => { autoLength.value = false; form.minutes = Math.max(5, Math.min(720, Number(form.minutes) + d)) }

const people = computed(() => state.employees.filter((e) => e.active || e.id === form.employeeId))
const times = computed(() => {
  const out = []
  for (let m = 6 * 60; m <= 21 * 60; m += 15) out.push(toTime(m))
  if (!out.includes(form.start)) out.push(form.start)
  return out.sort()
})
const overlaps = computed(() => state.bookings.filter((x) => x.id !== b?.id && x.employeeId === form.employeeId && x.date === form.date && x.status !== 'cancelled' && x.status !== 'noshow'
  && toMin(x.start) < toMin(form.start) + Number(form.minutes) && toMin(form.start) < toMin(x.start) + x.minutes))
const ends = computed(() => toTime(toMin(form.start) + Number(form.minutes || 0)))

async function save() {
  picker.value?.commit()
  saving.value = true
  try {
    await saveBookingAs({
      id: b?.id, kind: isBlock.value ? 'block' : 'booking', employeeId: form.employeeId, date: form.date, start: form.start,
      minutes: form.minutes, clientName: form.clientName, clientPhone: form.clientPhone, notes: form.notes,
      services: isBlock.value ? [] : items.value,
    })
    toastUndo(editing ? 'Booking saved' : isBlock.value ? 'Time blocked' : 'Booked ✨')
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}

async function status(s, msg) {
  if (s === 'cancelled' && !confirm(isBlock.value ? 'Remove this blocked time?' : 'Cancel this booking?')) return
  try {
    await setBookingStatusAs(b.id, s)
    toastUndo(msg)
    closeModal()
  } catch (err) {
    fail(err)
  }
}

/** Done: record the payment (the appointment), linked to this booking. */
function done() {
  const prefill = { date: b.date, client: b.clientName, service: joinServices(b.services.map((s) => s.name)), bookingId: b.id }
  if (staff) openMyAppointment(null, prefill)
  else openAppointment(null, { ...prefill, employeeId: b.employeeId, ...(price.value != null ? { amount: price.value } : {}), status: 'Paid' })
}
</script>

<template>
  <BaseModal :title="editing ? (isBlock ? 'Blocked time' : 'Booking') : 'New booking'" @close="closeModal">
    <p v-if="editing" class="muted-note" style="margin-top: -6px">
      {{ dayName(b.date, true) }} · {{ b.start }}–{{ toTime(toMin(b.start) + b.minutes) }}<template v-if="!staff"> · {{ employeeById(b.employeeId)?.name }}</template>
      <template v-if="b.source === 'online'"> · 🌐 booked online</template>
      <template v-if="b.status !== 'booked'"> · <b>{{ { done: 'Done ✓', cancelled: 'Cancelled', noshow: 'No-show' }[b.status] }}</b></template>
    </p>
    <form autocomplete="off" @submit.prevent="save">
      <div v-if="!editing" class="field"><SegmentedControl v-model="form.kind" :options="['Booking', 'Block time']" /></div>

      <template v-if="!isBlock">
        <div class="field">
          <label for="bk-client">Client</label>
          <ClientInput id="bk-client" v-model="form.clientName" :hide-amounts="staff" />
        </div>
        <div class="field">
          <label for="bk-phone">Phone (optional)</label>
          <input id="bk-phone" v-model="form.clientPhone" type="tel">
        </div>
        <div class="field">
          <label for="bk-svc">Services</label>
          <ServicePicker id="bk-svc" ref="picker" v-model="form.service" :employee-id="form.employeeId" :hide-prices="staff" />
          <div v-if="items.length" class="field-hint">
            {{ items.map((i) => `${i.name}${i.minutes ? ' ' + lengthLabel(i.minutes) : ''}`).join(' + ') }}<template v-if="!staff && price != null"> · {{ fmt0(price) }}</template>
          </div>
        </div>
      </template>
      <div v-else class="field">
        <label for="bk-reason">Reason</label>
        <input id="bk-reason" v-model="form.clientName" placeholder="e.g. Lunch, training, doctor">
      </div>

      <div v-if="!staff" class="field">
        <label for="bk-emp">With</label>
        <select id="bk-emp" v-model="form.employeeId">
          <option v-for="e in people" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </div>
      <div class="row2">
        <div class="field">
          <label for="bk-date">Date</label>
          <input id="bk-date" v-model="form.date" type="date" required>
        </div>
        <div class="field">
          <label for="bk-start">Time</label>
          <select id="bk-start" v-model="form.start">
            <option v-for="t in times" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>{{ isBlock ? 'For' : 'Booked for' }}</label>
        <div class="length-row">
          <button type="button" class="btn small ghost" @click="nudge(-15)">− 15</button>
          <div class="length-val"><b>{{ lengthLabel(Number(form.minutes) || 0) }}</b><small>until {{ ends }}</small></div>
          <button type="button" class="btn small ghost" @click="nudge(15)">+ 15</button>
        </div>
        <div v-if="!isBlock && normal && Number(form.minutes) !== normal" class="field-hint">
          Normally {{ lengthLabel(normal) }}. <button type="button" class="link-btn" @click="autoLength = true; form.minutes = normal">Use {{ lengthLabel(normal) }}</button>
        </div>
      </div>
      <p v-if="overlaps.length" class="field-hint orange">
        Overlaps {{ overlaps.map((x) => `${x.clientName} ${x.start}`).join(', ') }}. That's fine for something quick done in between.
      </p>
      <div class="field">
        <label for="bk-notes">Notes (optional)</label>
        <input id="bk-notes" v-model="form.notes" maxlength="500">
      </div>

      <div v-if="editing && b.status === 'booked' && !isBlock" class="booking-actions">
        <button type="button" class="btn" @click="done">✓ Done &amp; payment</button>
        <button type="button" class="btn ghost" @click="status('noshow', 'Marked as no-show')">No-show</button>
        <button type="button" class="btn ghost danger-text" @click="status('cancelled', 'Booking cancelled')">Cancel booking</button>
      </div>
      <div v-else-if="editing && (b.status === 'cancelled' || b.status === 'noshow')" class="booking-actions">
        <button type="button" class="btn ghost" @click="status('booked', 'Booking restored')">Restore booking</button>
      </div>
      <div class="modal-actions">
        <button v-if="editing && isBlock" type="button" class="btn danger" @click="status('cancelled', 'Blocked time removed')">Remove</button>
        <button type="button" class="btn ghost" @click="closeModal">Close</button>
        <button v-if="!editing || b.status === 'booked'" type="submit" class="btn" :disabled="saving">{{ editing ? 'Save' : isBlock ? 'Block' : 'Book' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
