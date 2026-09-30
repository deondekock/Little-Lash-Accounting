<script setup>
import { STATUSES } from '../lib/schema.js'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import ClientInput from './ClientInput.vue'
import ServicePicker from './ServicePicker.vue'
import { watch } from 'vue'
import { serviceCatalog, liveVouchers } from '../store.js'
import { OVERTIME_PCT_CHOICES, overtimeShare } from '../lib/payroll.js'
import { servicePrice } from '../lib/stats.js'
import { splitServices, serviceKey } from '../lib/services.js'
import { METHODS, businessMonth, monthRange, todayStr, fmt } from '../lib/format.js'
import { cloudflare } from '../api.js'
import { BACKEND } from '../config.js'
import { state, saveAppointment, deleteAppointment, closeModal, toastUndo, fail } from '../store.js'

const props = defineProps({ appt: Object, prefill: Object })

/* Every change to this appointment: who, when, and how it was before (owner, on Cloudflare). */
const changes = ref(null)
onMounted(async () => {
  if (!props.appt?.id || BACKEND !== 'cloudflare') return
  try {
    changes.value = await cloudflare.appointmentHistory(props.appt.id)
  } catch {
    changes.value = []
  }
})
const who = (email) => state.employees.find((e) => e.pay?.loginEmail && e.pay.loginEmail === email)?.name || (!email || email === state.email ? 'You' : email.split('@')[0])
const when = (t) => new Date(t).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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

// A written-off visit shows its real amount here (it counts as R0 elsewhere).
const form = reactive(editing ? { ...props.appt, amount: props.appt.writtenOff ?? props.appt.amount } : { ...blank(), ...(props.prefill || {}) })
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

/* Overtime: the share of the appointment that fell after hours, as a percentage. */
const otPct = computed({
  get: () => Math.round(overtimeShare(form) * 100),
  set: (p) => {
    p = Math.max(0, Math.min(100, Math.round(Number(p) || 0)))
    form.length = 0 // the percentage model doesn't use minutes
    form.overtime = p <= 0 ? 0 : p >= 100 ? 'all' : `${p}%`
  },
})
const setOt = (v) => { otPct.value = v === 'all' ? 100 : v }
const otActive = (v) => (v === 'all' ? otPct.value === 100 : otPct.value === v)

/*
 * Paying: one or more lines, each the money actually taken for that method. The first line opens by
 * default and carries the full amount; splitting means typing less on it and adding another line, which
 * pre-fills with whatever is still left. Lines may add up to LESS than the amount (a deposit — the rest
 * stays owing) but never more. Whether they become payment rows is decided on save (see submit).
 */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const vouchers = liveVouchers
const tenders = reactive([]) // lines: { amount, method, voucherId }
// An edited visit with payment rows opens with them loaded; anything else opens one line for the amount.
const hadTenders = editing && !!props.appt.tenders?.length
const paymentsTouched = ref(false)
// While untouched, the first line tracks the Amount field (so picking a service keeps it in step).
const mirrorFirst = ref(!hadTenders)
if (hadTenders) {
  for (const t of props.appt.tenders) tenders.push({ amount: t.amount, method: t.method, voucherId: t.voucherId || '' })
} else {
  tenders.push({ amount: form.amount === '' ? '' : r2(form.amount), method: METHODS.includes(form.method) ? form.method : 'Card', voucherId: '' })
}
const methodOptions = computed(() => (vouchers.value.length ? [...METHODS, 'Voucher'] : METHODS))
const amountNum = computed(() => r2(form.amount))
const paidNum = computed(() => r2(tenders.reduce((s, l) => s + (Number(l.amount) || 0), 0)))
const owing = computed(() => r2(amountNum.value - paidNum.value))
const overPaid = computed(() => owing.value < -0.005)
watch(() => form.amount, (a) => { if (mirrorFirst.value && tenders.length === 1) tenders[0].amount = a === '' ? '' : r2(a) })
// Editing an amount or splitting stops the first line from tracking the Amount; changing a method doesn't.
function editAmount() { mirrorFirst.value = false; paymentsTouched.value = true }
// Entering an amount field selects what's there, so typing replaces it; tapping again just moves the caret.
function selectAmount(e) { const el = e.target; requestAnimationFrame(() => { try { el.select() } catch { /* ignore */ } }) }
function addMethod() {
  editAmount()
  const rest = Math.max(0, r2(amountNum.value - paidNum.value))
  const used = new Set(tenders.map((l) => l.method))
  tenders.push({ amount: rest || '', method: ['Card', 'Cash', 'EFT'].find((m) => !used.has(m)) || 'Cash', voucherId: '' })
}
function removeTender(i) {
  if (i === 0) return // the first line always stays
  mirrorFirst.value = false
  paymentsTouched.value = true
  tenders.splice(i, 1)
}
function onTenderMethod(l) {
  paymentsTouched.value = true
  if (l.method === 'Voucher') { if (!l.voucherId) l.voucherId = vouchers.value[0]?.id || '' } else l.voucherId = ''
}

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
  if (overPaid.value) return fail(new Error('The payments add up to more than the amount.'))
  saving.value = true
  try {
    const payload = { ...form }
    const rows = tenders
      .map((l) => ({ amount: l.amount, method: l.method, voucherId: l.voucherId }))
      .filter((l) => (Number(l.amount) || 0) > 0 && (METHODS.includes(l.method) || (l.method === 'Voucher' && l.voucherId)))
    const paid = r2(rows.reduce((s, l) => s + (Number(l.amount) || 0), 0))
    const partial = paid > 0.005 && paid < amountNum.value - 0.005
    const isSplit = rows.length > 1
    const hasVoucher = rows.some((l) => l.method === 'Voucher')
    // A plain single method paying the whole amount needs no payment row (the status already says it all).
    // Record rows only for a split, a voucher, or a part-payment — and only when money was actually taken.
    const record = paid > 0.005 && (isSplit || hasVoucher || partial) && (form.status === 'Paid' || partial)
    // Only rewrite payment rows when the owner actually touched them (untouched edits leave rows as they were).
    if (paymentsTouched.value) {
      payload.replaceTenders = true
      payload.tenders = record ? rows : []
    }
    if (!record && rows[0] && METHODS.includes(rows[0].method)) payload.method = rows[0].method
    const saved = await saveAppointment(payload)
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
        <label>How much was in overtime?</label>
        <div class="chips inline" role="group" aria-label="Overtime share">
          <button
            v-for="o in OVERTIME_PCT_CHOICES" :key="o.label" type="button" class="chip small"
            :class="{ active: otActive(o.value) }" :aria-pressed="otActive(o.value)" @click="setOt(o.value)"
          >
            {{ o.label }}
          </button>
        </div>
        <div class="ot-length">
          <label for="f-otpct">or exactly</label>
          <input id="f-otpct" v-model.number="otPct" type="number" inputmode="numeric" min="0" max="100" style="max-width: 84px">
          <span class="field-hint" style="margin: 0">% of the appointment</span>
        </div>
      </div>
      <div class="field">
        <label>Paid with</label>
        <template v-for="(l, i) in tenders" :key="i">
          <div class="pay-line">
            <input v-model="l.amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" aria-label="Amount" @focus="selectAmount" @input="editAmount">
            <SegmentedControl :model-value="l.method" :options="methodOptions" @update:model-value="(m) => { l.method = m; onTenderMethod(l) }" />
            <button v-if="i > 0" type="button" class="icon-btn" aria-label="Remove" @click="removeTender(i)">✕</button>
          </div>
          <select v-if="l.method === 'Voucher'" v-model="l.voucherId" class="voucher-pick" @change="onTenderMethod(l)">
            <option v-for="v in vouchers" :key="v.id" :value="v.id">{{ v.code }} · {{ fmt(v.balance) }} left{{ v.buyer ? ` · ${v.buyer}` : '' }}</option>
          </select>
        </template>
        <button type="button" class="btn small ghost" style="margin-top: 8px" @click="addMethod">+ Add payment method</button>
        <div v-if="tenders.length > 1 || owing > 0.005 || overPaid" class="pay-total" :class="{ orange: overPaid || owing > 0.005 }">
          <template v-if="overPaid">{{ fmt(-owing) }} more than the amount</template>
          <template v-else-if="owing > 0.005">Paid {{ fmt(paidNum) }} · {{ fmt(owing) }} still owing</template>
          <template v-else>Paid in full</template>
        </div>
      </div>
      <div class="field">
        <label>Status</label>
        <SegmentedControl v-model="form.status" :options="STATUSES" variant="status" />
        <div v-if="form.status === 'Written off'" class="field-hint">Not paid, and not owed any more. It stays on record but counts as R0 in takings, money owed and commission.</div>
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
      <div v-if="changes?.length" class="changes">
        <h4 class="section-label" style="margin: 16px 0 6px">Changes</h4>
        <div v-for="c in changes" :key="c.id" class="change-row" :class="{ undone: c.undone_at }">
          <div><b>{{ who(c.who) }}</b> · {{ when(c.time) }}<template v-if="c.undone_at"> · undone</template></div>
          <div class="meta">{{ c.summary }}</div>
          <div v-if="c.before" class="meta">Before: {{ fmt(c.before.amount) }} · {{ c.before.status }} · {{ c.before.method }}{{ c.before.client !== appt.client ? ' · ' + c.before.client : '' }}</div>
          <div v-else class="meta">Before: (new)</div>
        </div>
      </div>
      <p v-if="!editing" class="another">
        <label><input v-model="another" type="checkbox"> Add another after saving</label>
      </p>
    </form>
  </BaseModal>
</template>
