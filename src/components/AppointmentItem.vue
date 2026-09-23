<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import { METHODS, fmt } from '../lib/format.js'
import { state, updateMany, openAppointment, employeeColor } from '../store.js'

const props = defineProps({ appt: { type: Object, required: true } })

const meta = computed(() =>
  [props.appt.service, props.appt.notes, props.appt.status === 'Paid' && props.appt.paidOn ? 'paid ' + props.appt.paidOn : '']
    .filter(Boolean)
    .join(' · '),
)

const selected = computed({
  get: () => state.selected.has(props.appt.id),
  set: (v) => (v ? state.selected.add(props.appt.id) : state.selected.delete(props.appt.id)),
})

const toggleStatus = () => updateMany([props.appt.id], { status: props.appt.status === 'Paid' ? 'Unpaid' : 'Paid' })
const setMethod = (e) => updateMany([props.appt.id], { method: e.target.value })
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
      <div class="amount">{{ fmt(appt.amount) }}</div>
      <div class="actions">
        <select class="method" :value="appt.method" aria-label="Payment method" @change="setMethod">
          <option v-for="m in METHODS" :key="m">{{ m }}</option>
        </select>
        <button class="pill" :class="appt.status" @click="toggleStatus">
          <Icon v-if="appt.status === 'Paid'" name="check" :size="13" :stroke="2.6" />{{ appt.status }}
        </button>
      </div>
    </div>
  </div>
</template>
