<script setup>
import { computed, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import OvertimeField from './OvertimeField.vue'
import SegmentedControl from './SegmentedControl.vue'
import VoucherPicker from './VoucherPicker.vue'
import ClientInput from './ClientInput.vue'
import ServicePicker from './ServicePicker.vue'
import { state, serviceCatalog, liveVouchers, closeModal, saveMyAppointment, deleteMyAppointment, toast, fail } from '../store.js'
import { todayStr, shortDate } from '../lib/format.js'
import { METHODS } from '../lib/schema.js'
import { fmt } from '../lib/format.js'
import { servicePrice } from '../lib/stats.js'
import { splitServices, serviceKey } from '../lib/services.js'
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

/*
 * Paid with: one or more lines, each the money actually taken for that method (Cash / Card / EFT) — same
 * as the owner's form. The first line follows the Amount until she edits it; "+ Add payment method" adds
 * a line pre-filled with what's still unpaid. Only shown while she can see the amount (adding, or after
 * tapping Change on an edit); an existing split visit keeps its rows unless she redoes the payment.
 */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const vouchers = liveVouchers
const tenders = reactive([{ amount: '', method: METHODS.includes(form.method) ? form.method : 'Card', voucherId: '' }])
const methodOptions = computed(() => (vouchers.value.length ? [...METHODS, 'Voucher'] : METHODS))
const mirrorFirst = ref(true)
const paymentsTouched = ref(false)
const amountNum = computed(() => r2(form.amount))
const paidNum = computed(() => r2(tenders.reduce((s, l) => s + (Number(l.amount) || 0), 0)))
const owing = computed(() => r2(amountNum.value - paidNum.value))
const overPaid = computed(() => owing.value < -0.005)
watch(() => form.amount, (a) => { if (mirrorFirst.value && tenders.length === 1) tenders[0].amount = a === '' ? '' : r2(a) })
function editAmount() { mirrorFirst.value = false; paymentsTouched.value = true }
function selectAmount(e) { const el = e.target; requestAnimationFrame(() => { try { el.select() } catch { /* ignore */ } }) }
function addMethod() {
  editAmount()
  const rest = Math.max(0, r2(amountNum.value - paidNum.value))
  const used = new Set(tenders.map((l) => l.method))
  tenders.push({ amount: rest || '', method: ['Card', 'Cash', 'EFT'].find((m) => !used.has(m)) || 'Cash', voucherId: '' })
}
function removeTender(i) {
  if (i === 0) return
  editAmount()
  tenders.splice(i, 1)
}
function onTenderMethod(l) {
  paymentsTouched.value = true
  if (l.method === 'Voucher') { if (!l.voucherId) l.voucherId = vouchers.value[0]?.id || '' } else l.voucherId = ''
}

function onPick(c) {
  const last = c.history[0]
  if (!last) return
  if (!form.service && last.service) form.service = last.service
  suggestion.value = `Last visit ${shortDate(last.date)} ${last.date.slice(0, 4)}${last.service ? ' · ' + last.service : ''} · ${c.visits} visit${c.visits === 1 ? '' : 's'}`
}

watch(changeAmount, (v) => !v && (form.amount = ''))

// The amount follows the chosen services at her own price; she can still type her own (same as the owner's form).
watch(() => form.service, (svc) => {
  if (!changeAmount.value) return
  const byKey = new Map(serviceCatalog.value.map((s) => [s.key, s]))
  const prices = splitServices(svc).map((t) => servicePrice(byKey.get(serviceKey(t)), me.value?.id))
  if (prices.length && prices.every((p) => p != null)) form.amount = prices.reduce((a, b) => a + b, 0)
  else if (!prices.length) form.amount = ''
})

async function submit() {
  picker.value?.commit()
  saving.value = true
  try {
    if (changeAmount.value && overPaid.value) throw new Error('The payments add up to more than the amount.')
    const body = {
      id: props.appt?.id, date: form.date, client: form.client, service: form.service, method: form.method, status: form.status,
      notes: form.notes, overtime: form.overtime, length: form.length, amount: changeAmount.value ? form.amount : '',
    }
    if (changeAmount.value) {
      const rows = tenders.map((l) => ({ amount: r2(l.amount), method: l.method, voucherId: l.voucherId }))
        .filter((l) => l.amount > 0 && (METHODS.includes(l.method) || (l.method === 'Voucher' && l.voucherId)))
      if (rows[0]) body.method = rows.length > 1 ? 'Split' : rows[0].method
      // Rows are sent (replacing any old ones) for a split, a voucher or a part-payment, or whenever she redoes an edit's amount.
      if (editing || rows.length > 1 || owing.value > 0.005 || rows.some((l) => l.method === 'Voucher')) body.tenders = rows
    }
    await saveMyAppointment(body)
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
          <ServicePicker id="s-service" ref="picker" v-model="form.service" :employee-id="me?.id" />
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
          <template v-if="changeAmount">
            <template v-for="(l, i) in tenders" :key="i">
              <div class="pay-line">
                <input v-model="l.amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" aria-label="Amount" @focus="selectAmount" @input="editAmount">
                <SegmentedControl :model-value="l.method" :options="methodOptions" @update:model-value="(m) => { l.method = m; onTenderMethod(l) }" />
                <button v-if="i > 0" type="button" class="icon-btn" aria-label="Remove" @click="removeTender(i)">✕</button>
              </div>
              <VoucherPicker v-if="l.method === 'Voucher'" v-model="l.voucherId" @pick="onTenderMethod(l)" />
            </template>
            <button type="button" class="btn small ghost" style="margin-top: 8px" @click="addMethod">+ Add payment method</button>
            <div v-if="tenders.length > 1 || owing > 0.005 || overPaid" class="pay-total" :class="{ orange: overPaid || owing > 0.005 }">
              <template v-if="overPaid">{{ fmt(-owing) }} more than the amount</template>
              <template v-else-if="owing > 0.005">Paid {{ fmt(paidNum) }} · {{ fmt(owing) }} still owing</template>
              <template v-else>Paid in full<template v-if="form.status === 'Unpaid'"> · tap <b>Paid</b> below once the money is in</template></template>
            </div>
          </template>
          <template v-else>
            <SegmentedControl v-if="METHODS.includes(form.method)" v-model="form.method" :options="METHODS" />
            <div v-else class="field-hint" style="margin-top: 0">Paid {{ form.method === 'Voucher' ? 'with a gift voucher' : 'with more than one method' }}. Tap <b>•••• Change</b> above to redo the amount and payments.</div>
          </template>
        </div>
        <div class="field">
          <label>Status</label>
          <SegmentedControl v-model="form.status" :options="['Unpaid', 'Paid']" variant="status" />
          <div v-if="form.status === 'Written off'" class="field-hint">The owner wrote this one off (not paid, not owed). Tap Paid if the client paid after all.</div>
        </div>
        <OvertimeField :form="form" prefix="s-ot" />
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
