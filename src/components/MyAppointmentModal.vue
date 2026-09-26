<script setup>
import { computed, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import ClientInput from './ClientInput.vue'
import ServicePicker from './ServicePicker.vue'
import { all, state, closeModal, saveMyAppointment, deleteMyAppointment, toast, fail } from '../store.js'
import { todayStr, shortDate } from '../lib/format.js'
import { OVERTIME_CHOICES, LENGTH_CHOICES, minutesLabel, overtimeShare } from '../lib/payroll.js'
import { serviceKey } from '../lib/services.js'
import { METHODS } from '../lib/schema.js'
import { lockedReason, canDelete } from '../lib/staffRules.js'

/**
 * Staff: add or change one of her appointments. She types the amount when adding (or to change it),
 * but never sees an amount again — the server doesn't even send it to her phone.
 */
const props = defineProps({ appt: Object, prefill: Object })
const editing = !!props.appt
const me = computed(() => state.employees[0])
const form = reactive(editing
  ? { ...props.appt, amount: '' }
  : { date: todayStr(), client: '', service: '', amount: '', method: 'Card', status: 'Paid', notes: '', overtime: 0, length: 0, ...(props.prefill || {}) })
const locked = editing ? lockedReason(props.appt, state.monthStartDay, state.payslips) : ''
const deletable = editing && canDelete(props.appt, state.email)
const saving = ref(false)
const changeAmount = ref(!editing)
const picker = ref(null)
const suggestion = ref('')

function onPick(c) {
  const last = c.history[0]
  if (!last) return
  if (!form.service && last.service) form.service = last.service
  suggestion.value = `Last visit ${shortDate(last.date)} ${last.date.slice(0, 4)}${last.service ? ' · ' + last.service : ''} · ${c.visits} visit${c.visits === 1 ? '' : 's'}`
}

/* Overtime (same as the owner's form). */
const partial = computed(() => typeof form.overtime === 'number' && form.overtime > 0)
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
watch(changeAmount, (v) => !v && (form.amount = ''))

async function submit() {
  picker.value?.commit()
  saving.value = true
  try {
    await saveMyAppointment({
      id: props.appt?.id, date: form.date, client: form.client, service: form.service, method: form.method, status: form.status,
      notes: form.notes, overtime: form.overtime, length: form.length, amount: changeAmount.value ? form.amount : '',
    })
    toast(editing ? 'Saved' : 'Appointment added')
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!confirm('Delete this appointment?')) return
  try {
    await deleteMyAppointment(props.appt.id)
    toast('Deleted')
    closeModal()
  } catch (err) {
    fail(err)
  }
}
</script>

<template>
  <BaseModal :title="editing ? (locked ? 'Appointment' : 'Edit appointment') : 'New appointment'" @close="closeModal">
    <p v-if="locked" class="field-hint orange" style="margin-top: -4px">🔒 {{ locked }}</p>
    <form autocomplete="off" @submit.prevent="submit">
      <fieldset :disabled="!!locked" class="plain-fieldset">
        <div class="field">
          <label for="s-client">Client</label>
          <ClientInput id="s-client" v-model="form.client" hide-amounts @pick="onPick" />
          <div v-if="suggestion" class="field-hint">{{ suggestion }}</div>
        </div>
        <div class="field">
          <label for="s-service">Services</label>
          <ServicePicker id="s-service" ref="picker" v-model="form.service" :employee-id="me?.id" hide-prices />
        </div>
        <div class="row2">
          <div class="field">
            <label for="s-date">Date</label>
            <input id="s-date" v-model="form.date" type="date" :max="todayStr()" required>
          </div>
          <div class="field">
            <label for="s-amount">{{ editing ? 'Amount (R)' : 'Amount paid / to pay (R)' }}</label>
            <input v-if="changeAmount" id="s-amount" v-model="form.amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" :required="!editing">
            <button v-else type="button" class="btn ghost wide amount-hidden" @click="changeAmount = true">•••• Change</button>
          </div>
        </div>
        <p v-if="!editing" class="field-hint" style="margin-top: -6px">Once saved, the amount is only visible to the owner.</p>
        <p v-else-if="changeAmount" class="field-hint" style="margin-top: -6px">Type the new amount. <button type="button" class="link-btn" @click="changeAmount = false">Keep the current amount</button></p>
        <div class="field">
          <label>Paid with</label>
          <SegmentedControl v-model="form.method" :options="METHODS" />
        </div>
        <div class="field">
          <label>Status</label>
          <SegmentedControl v-model="form.status" :options="['Unpaid', 'Paid']" variant="status" />
        </div>
        <div class="field">
          <label>Done in overtime?</label>
          <div class="chips inline" role="group" aria-label="Done in overtime">
            <button v-for="o in OVERTIME_CHOICES" :key="o.value" type="button" class="chip small" :class="{ active: form.overtime === o.value || (!form.overtime && !o.value) }" @click="setOvertime(o.value)">{{ o.label }}</button>
          </div>
          <div v-if="partial" class="ot-length">
            <label for="s-length">of an appointment that took</label>
            <select id="s-length" v-model.number="form.length">
              <option v-for="m in lengthOptions" :key="m" :value="m">{{ minutesLabel(m) }}</option>
            </select>
            <span class="field-hint" style="margin: 0">→ {{ otPct }}% counts as overtime</span>
          </div>
        </div>
        <div class="field">
          <label for="s-notes">Notes (optional)</label>
          <input id="s-notes" v-model="form.notes" maxlength="300">
        </div>
      </fieldset>
      <div class="modal-actions">
        <button v-if="deletable && !locked" type="button" class="btn danger" @click="remove">Delete</button>
        <button type="button" class="btn ghost" @click="closeModal">{{ locked ? 'Close' : 'Cancel' }}</button>
        <button v-if="!locked" type="submit" class="btn" :disabled="saving">{{ editing ? 'Save' : 'Add' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
