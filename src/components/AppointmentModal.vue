<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import ClientInput from './ClientInput.vue'
import { METHODS, businessMonth, monthRange, todayStr } from '../lib/format.js'
import { state, saveAppointment, deleteAppointment, closeModal, toastUndo, fail } from '../store.js'

const props = defineProps({ appt: Object, prefill: Object })
const editing = !!props.appt

function blank() {
  const today = todayStr()
  return {
    date: businessMonth(today, state.monthStartDay) === state.month ? today : monthRange(state.month, state.monthStartDay).from,
    employeeId: state.employee !== 'all' ? state.employee : state.employees.find((e) => e.active)?.id,
    client: '',
    service: '',
    amount: '',
    method: 'Card',
    status: 'Unpaid',
    notes: '',
  }
}

const form = reactive(editing ? { ...props.appt } : { ...blank(), ...(props.prefill || {}) })
const another = ref(false)
const saving = ref(false)
const amountInput = ref(null)
const suggestion = ref('')

const employeeOptions = computed(() => state.employees.filter((e) => e.active || e.id === form.employeeId))

onMounted(() => !editing && !form.client && document.getElementById('f-client')?.focus())

/** Picking a known client fills in her usual service and price (only fields still empty). */
function onPick(c) {
  const last = c.history[0]
  if (!last) return
  if (!form.service && last.service) form.service = last.service
  if (!form.amount && last.amount) form.amount = last.amount
  suggestion.value = `Last visit ${last.date.slice(8)}/${last.date.slice(5, 7)}/${last.date.slice(0, 4)} · ${last.service || 'appointment'} · R ${last.amount} · ${last.method}`
}

async function submit() {
  saving.value = true
  try {
    const saved = await saveAppointment({ ...form })
    toastUndo(editing ? 'Saved' : 'Appointment added')
    if (another.value) {
      // Keep employee + date, clear the rest for fast entry of a busy day.
      Object.assign(form, blank(), { employeeId: saved.employeeId, date: saved.date })
      suggestion.value = ''
      await nextTick()
      document.getElementById('f-client')?.focus()
    } else {
      closeModal()
    }
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!confirm('Delete this appointment?')) return
  try {
    await deleteAppointment(props.appt.id)
    closeModal()
    toastUndo('Deleted')
  } catch (err) {
    fail(err)
  }
}
</script>

<template>
  <BaseModal :title="editing ? 'Edit appointment' : 'New appointment'" @close="closeModal">
    <form autocomplete="off" @submit.prevent="submit">
      <div class="field">
        <label for="f-emp">Employee</label>
        <select id="f-emp" v-model="form.employeeId" required>
          <option v-for="e in employeeOptions" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </div>
      <div class="field">
        <label for="f-client">Client</label>
        <ClientInput id="f-client" v-model="form.client" @pick="onPick" />
        <div v-if="suggestion" class="field-hint">{{ suggestion }}</div>
      </div>
      <div class="row2">
        <div class="field">
          <label for="f-date">Date</label>
          <input id="f-date" v-model="form.date" type="date" required>
        </div>
        <div class="field">
          <label for="f-amount">Amount (R)</label>
          <input
            id="f-amount" ref="amountInput" v-model="form.amount" type="number" inputmode="decimal"
            step="0.01" min="0" placeholder="0.00" required
          >
        </div>
      </div>
      <div class="field">
        <label for="f-service">Service (optional)</label>
        <input id="f-service" v-model="form.service" placeholder="e.g. Classic full set">
      </div>
      <div class="field">
        <label>Paid with</label>
        <SegmentedControl v-model="form.method" :options="METHODS" />
      </div>
      <div class="field">
        <label>Status</label>
        <SegmentedControl v-model="form.status" :options="['Unpaid', 'Paid']" variant="status" />
      </div>
      <div class="field">
        <label for="f-notes">Notes (optional)</label>
        <input id="f-notes" v-model="form.notes">
      </div>
      <div class="modal-actions">
        <button v-if="editing" type="button" class="btn danger" @click="remove">Delete</button>
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">{{ editing ? 'Save' : 'Add' }}</button>
      </div>
      <p v-if="!editing" class="another">
        <label><input v-model="another" type="checkbox"> Add another after saving</label>
      </p>
    </form>
  </BaseModal>
</template>
