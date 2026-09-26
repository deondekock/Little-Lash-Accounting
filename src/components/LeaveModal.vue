<script setup>
import { computed, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { state, closeModal, saveLeave, deleteLeave, toastUndo, fail } from '../store.js'
import { todayStr } from '../lib/format.js'
import { LEAVE_TYPES, leaveBalance, leaveText, payDefaults, workDays } from '../lib/payroll.js'

const props = defineProps({ leave: Object, prefill: Object })
const editing = !!props.leave
const people = computed(() => state.employees.filter((e) => e.active || e.id === form.employeeId))

const form = reactive(editing ? { ...props.leave } : {
  employeeId: state.employees.find((e) => e.active)?.id,
  type: 'Annual',
  from: todayStr(),
  to: todayStr(),
  hours: '',
  notes: '',
  ...(props.prefill || {}),
})
const saving = ref(false)
const emp = computed(() => state.employees.find((e) => e.id === form.employeeId))
const perDay = computed(() => Number(payDefaults(emp.value?.pay).hoursPerDay) || 8)
const days = computed(() => workDays(form.from, form.to))
const half = ref(false)

// Hours follow the dates (Mon–Sat × her hours a day) until she types her own.
const autoHours = ref(!editing)
function fillHours() {
  if (autoHours.value) form.hours = Math.round(days.value * perDay.value * (half.value ? 0.5 : 1) * 100) / 100 || ''
}
watch([() => form.from, () => form.to, () => form.employeeId, half], () => {
  if (form.to < form.from) form.to = form.from
  fillHours()
}, { immediate: !editing })

const balance = computed(() => (emp.value ? leaveBalance({ ...emp.value, pay: payDefaults(emp.value.pay) }, state.leave.filter((l) => l.id !== form.id), form.from) : null))
const after = computed(() => balance.value && balance.value.days - (Number(form.hours) || 0) / perDay.value)

async function submit() {
  saving.value = true
  try {
    await saveLeave({ ...form })
    toastUndo(editing ? 'Leave updated' : 'Leave booked')
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
async function remove() {
  if (!confirm('Remove this leave?')) return
  try {
    await deleteLeave(props.leave.id)
    toastUndo('Leave removed')
    closeModal()
  } catch (err) {
    fail(err)
  }
}
</script>

<template>
  <BaseModal :title="editing ? 'Edit leave' : 'Book leave'" @close="closeModal">
    <form autocomplete="off" @submit.prevent="submit">
      <div class="field">
        <label for="l-emp">Who</label>
        <select id="l-emp" v-model="form.employeeId" required>
          <option v-for="e in people" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </div>
      <div class="field">
        <label>Type</label>
        <SegmentedControl v-model="form.type" :options="LEAVE_TYPES" />
      </div>
      <div class="row2">
        <div class="field">
          <label for="l-from">From</label>
          <input id="l-from" v-model="form.from" type="date" required>
        </div>
        <div class="field">
          <label for="l-to">To</label>
          <input id="l-to" v-model="form.to" type="date" :min="form.from" required>
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label for="l-hours">Hours</label>
          <input id="l-hours" v-model="form.hours" type="number" inputmode="decimal" step="0.25" min="0.25" required @input="autoHours = false">
          <div class="field-hint">{{ days }} work day{{ days === 1 ? '' : 's' }} × {{ perDay }} h</div>
        </div>
        <div class="field" style="align-self: center">
          <label class="calc-check"><input v-model="half" type="checkbox" @change="autoHours = true; fillHours()"> Half day{{ days > 1 ? 's' : '' }}</label>
        </div>
      </div>
      <div class="field">
        <label for="l-notes">Notes (optional)</label>
        <input id="l-notes" v-model="form.notes">
      </div>
      <p v-if="form.type === 'Annual' && balance?.start" class="muted-note" :class="{ orange: after < 0 }">
        🌴 {{ emp.name }} will have {{ leaveText(balance.days, perDay) }} on {{ form.from }};
        after this: {{ leaveText(after, perDay) }}.
      </p>
      <div class="modal-actions">
        <button v-if="editing" type="button" class="btn danger" @click="remove">Remove</button>
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">{{ editing ? 'Save' : 'Book' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
