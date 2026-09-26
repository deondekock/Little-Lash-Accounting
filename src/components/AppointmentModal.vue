<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import ClientInput from './ClientInput.vue'
import ServicePicker from './ServicePicker.vue'
import { watch } from 'vue'
import { all, serviceCatalog } from '../store.js'
import { OVERTIME_CHOICES, LENGTH_CHOICES, minutesLabel, overtimeShare } from '../lib/payroll.js'
import { servicePrice } from '../lib/stats.js'
import { splitServices, serviceKey } from '../lib/services.js'
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
    overtime: 0,
    length: 0,
  }
}

const form = reactive(editing ? { ...props.appt } : { ...blank(), ...(props.prefill || {}) })
const another = ref(false)
const saving = ref(false)
const amountInput = ref(null)
const suggestion = ref('')
const servicePicker = ref(null)
// The amount follows the chosen services until she types her own amount.
const autoAmount = ref(!editing && !form.amount)
watch(() => [form.service, form.employeeId], ([svc, emp]) => {
  if (!autoAmount.value) return
  const byKey = new Map(serviceCatalog.value.map((s) => [s.key, s]))
  const prices = splitServices(svc).map((t) => servicePrice(byKey.get(serviceKey(t)), emp))
  if (prices.length && prices.every((p) => p != null)) form.amount = prices.reduce((a, b) => a + b, 0)
  else if (!prices.length) form.amount = ''
})

/* Overtime: how much of the appointment was after hours, and how long it took in total. */
const partial = computed(() => typeof form.overtime === 'number' && form.overtime > 0)
/** How long this service usually takes (from earlier appointments where it was noted). */
function usualLength() {
  const key = serviceKey(form.service || '')
  const seen = all.value.filter((a) => a.length && serviceKey(a.service) === key).map((a) => a.length).sort((a, b) => a - b)
  return seen.length ? seen[Math.floor(seen.length / 2)] : 0
}
function setOvertime(v) {
  form.overtime = v
  if (typeof v === 'number' && v > 0 && !(form.length >= v)) form.length = Math.max(usualLength(), v, 60)
}
const lengthOptions = computed(() => [...new Set([...LENGTH_CHOICES, Number(form.length) || 0])].filter((m) => m && m >= (partial.value ? form.overtime : 0)).sort((a, b) => a - b))
const otPct = computed(() => Math.round(overtimeShare({ overtime: form.overtime, length: Number(form.length) }) * 100))

const employeeOptions = computed(() => state.employees.filter((e) => e.active || e.id === form.employeeId))

onMounted(() => !editing && !form.client && document.getElementById('f-client')?.focus())

/** Picking a known client fills in her usual service and price (only fields still empty). */
function onPick(c) {
  const last = c.history[0]
  if (!last) return
  if (!form.service && last.service) form.service = last.service
  if ((!form.amount || autoAmount.value) && last.amount) {
    form.amount = last.amount
    autoAmount.value = false
  }
  suggestion.value = `Last visit ${last.date.slice(8)}/${last.date.slice(5, 7)}/${last.date.slice(0, 4)} · ${last.service || 'appointment'} · R ${last.amount} · ${last.method}`
}

async function submit() {
  servicePicker.value?.commit()
  saving.value = true
  try {
    const saved = await saveAppointment({ ...form })
    toastUndo(editing ? 'Saved' : 'Appointment added')
    if (another.value) {
      // Keep employee + date, clear the rest for fast entry of a busy day.
      Object.assign(form, blank(), { employeeId: saved.employeeId, date: saved.date })
      suggestion.value = ''
      autoAmount.value = true
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
      <div class="field">
        <label for="f-service">Services</label>
        <ServicePicker id="f-service" ref="servicePicker" v-model="form.service" :employee-id="form.employeeId" />
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
            step="0.01" min="0" placeholder="0.00" required @input="autoAmount = false"
          >
        </div>
      </div>
      <div class="field">
        <label>Done in overtime?</label>
        <div class="chips inline" role="group" aria-label="Done in overtime">
          <button
            v-for="o in OVERTIME_CHOICES" :key="o.value" type="button" class="chip small"
            :class="{ active: form.overtime === o.value || (!form.overtime && !o.value) }" :aria-pressed="form.overtime === o.value"
            @click="setOvertime(o.value)"
          >
            {{ o.label }}
          </button>
        </div>
        <div v-if="partial" class="ot-length">
          <label for="f-length">of an appointment that took</label>
          <select id="f-length" v-model.number="form.length">
            <option v-for="m in lengthOptions" :key="m" :value="m">{{ minutesLabel(m) }}</option>
          </select>
          <span class="field-hint" style="margin: 0">→ {{ otPct }}% counts as overtime</span>
        </div>
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
