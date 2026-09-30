<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import { METHODS, fmt } from '../lib/format.js'
import { overtimeLabel } from '../lib/payroll.js'
import { state, updateMany, openAppointment, employeeColor, toastUndo } from '../store.js'

const props = defineProps({ appt: { type: Object, required: true } })

/** Staff member (by login email) who added or last changed it. */
const staffName = (email) => (email ? state.employees.find((e) => e.pay?.loginEmail && e.pay.loginEmail === email)?.name : '')
const byStaff = computed(() => {
  const added = staffName(props.appt.createdBy)
  const changed = staffName(props.appt.updatedBy)
  if (changed && props.appt.updatedBy !== props.appt.createdBy) return `✎ changed by ${changed}`
  return added ? `✎ added by ${added}` : ''
})
const meta = computed(() =>
  [byStaff.value, overtimeLabel(props.appt) && '⏰ ' + overtimeLabel(props.appt), props.appt.service, props.appt.notes, props.appt.status === 'Paid' && props.appt.paidOn ? 'paid ' + props.appt.paidOn : '']
    .filter(Boolean)
    .join(' · '),
)

const selected = computed({
  get: () => state.selected.has(props.appt.id),
  set: (v) => (v ? state.selected.add(props.appt.id) : state.selected.delete(props.appt.id)),
})

async function toggleStatus() {
  // Unpaid ⇄ Paid; a written-off visit goes back to unpaid.
  const status = props.appt.status === 'Unpaid' ? 'Paid' : 'Unpaid'
  if (await updateMany([props.appt.id], { status })) toastUndo(`${props.appt.client || 'Appointment'} marked ${status.toLowerCase()}`)
}
async function setMethod(e) {
  const method = e.target.value
  if (await updateMany([props.appt.id], { method })) toastUndo(`Set to ${method}`)
}
</script>

<template>
  <div class="item">
    <input v-model="selected" type="checkbox" aria-label="Select">
    <div class="item-body" @click="openAppointment(appt)">
      <div class="who">
        <i class="swatch-dot" :style="{ background: employeeColor(appt.employeeId) }" />
        <span style="overflow:hidden;text-overflow:ellipsis">{{ appt.client || 'Client' }}</span>
        <span v-if="state.employee === 'all'" class="who-emp">· {{ appt.employeeName }}</span>
      </div>
      <div class="meta">{{ meta || ' ' }}</div>
    </div>
    <div>
      <div v-if="appt.status === 'Written off'" class="amount written-off" title="Written off — counts as R0">{{ fmt(appt.writtenOff) }}</div>
      <div v-else class="amount">{{ fmt(appt.amount) }}</div>
      <div class="actions">
        <select v-if="METHODS.includes(appt.method)" class="method" :value="appt.method" aria-label="Payment method" @change="setMethod">
          <option v-for="m in METHODS" :key="m">{{ m }}</option>
        </select>
        <span v-else class="method" :title="(appt.tenders || []).map((t) => `${fmt(t.amount)} ${t.method}`).join(' + ')">{{ appt.method }}</span>
        <button class="pill" :class="appt.status === 'Written off' ? 'WrittenOff' : appt.status" :title="appt.status === 'Written off' ? 'Tap to mark unpaid again' : ''" @click="toggleStatus">
          <Icon v-if="appt.status === 'Paid'" name="check" :size="13" :stroke="2.6" />{{ appt.status }}
        </button>
      </div>
    </div>
  </div>
</template>
