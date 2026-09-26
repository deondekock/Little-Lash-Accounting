<script setup>
import { computed, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { state, closeModal, saveLeave, deleteLeave, toastUndo, fail } from '../store.js'
import { todayStr } from '../lib/format.js'
import { LEAVE_TYPES, MATERNITY_MONTHS, addMonths, leaveBalance, sickBalance, familyBalance, leaveSettings, leaveText, payDefaults, weekDays, workDays } from '../lib/payroll.js'

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
const settings = computed(() => leaveSettings(payDefaults(emp.value?.pay)))
const perDay = computed(() => settings.value.perDay)
const days = computed(() => workDays(form.from, form.to, weekDays(settings.value.perWeek)))
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

const others = computed(() => state.leave.filter((l) => l.id !== form.id))
const withPay = computed(() => emp.value && { ...emp.value, pay: payDefaults(emp.value.pay) })
const balance = computed(() => (withPay.value ? leaveBalance(withPay.value, others.value, form.from) : null))
const after = computed(() => balance.value && balance.value.days - (Number(form.hours) || 0) / perDay.value)
const sick = computed(() => (withPay.value ? sickBalance(withPay.value, others.value, form.from) : null))
const family = computed(() => (withPay.value ? familyBalance(withPay.value, others.value, form.from) : null))
const hrs = computed(() => Number(form.hours) || 0)
const nice = (d) => new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

// Maternity leave is 4 months in a row: fill in the end date.
watch(() => form.type, (t, old) => {
  if (t === 'Maternity' && form.from && (old !== 'Maternity' || form.to === form.from)) {
    const end = new Date(addMonths(form.from, MATERNITY_MONTHS) + 'T12:00:00')
    end.setDate(end.getDate() - 1)
    form.to = end.toISOString().slice(0, 10)
  }
})

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
        <SegmentedControl v-model="form.type" :options="LEAVE_TYPES" variant="wrap" />
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
      <p v-else-if="form.type === 'Sick' && sick" class="muted-note" :class="{ orange: sick.hours - hrs < 0 }">
        🤒 {{ sick.hours }} h sick leave left in her cycle {{ nice(sick.from) }} – {{ nice(sick.to) }}<template v-if="sick.firstSix"> (first 6 months: 1 day per 26 worked)</template>;
        after this: {{ Math.round((sick.hours - hrs) * 100) / 100 }} h.<template v-if="sick.hours - hrs < 0"> Anything over is unpaid sick leave.</template>
        More than 2 days in a row (or twice in 8 weeks) needs a doctor's note.
      </p>
      <p v-else-if="form.type === 'Family' && family" class="muted-note" :class="{ orange: family.hours - hrs < 0 }">
        <template v-if="!family.eligible">She only gets family responsibility leave after 4 months, and if she works 4+ days a week.</template>
        <template v-else>👨‍👩‍👧 {{ family.hours }} h family responsibility leave left until {{ nice(family.to) }}; after this: {{ Math.round((family.hours - hrs) * 100) / 100 }} h.</template>
        For a child's birth or illness, or the death of a close family member.
      </p>
      <p v-else-if="form.type === 'Maternity'" class="muted-note">
        🤱 4 months in a row, from up to 4 weeks before the due date. You don't have to pay her for it: she claims from UIF.
      </p>
      <p v-else-if="(form.type === 'Sick' || form.type === 'Family') && !emp?.pay?.engaged" class="muted-note orange">
        Add {{ emp?.name }}'s date engaged (Team → Edit → Payslip details) to see how much she has left.
      </p>
      <div class="modal-actions">
        <button v-if="editing" type="button" class="btn danger" @click="remove">Remove</button>
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">{{ editing ? 'Save' : 'Book' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
