<script setup>
import { computed, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { all, state, closeModal, savePayslip, deletePayslip, printPayslips, openEmployee, toastUndo, fail } from '../store.js'
import { fmt, monthLabel, monthRange, shortDate } from '../lib/format.js'
import { draftPayslip, leaveText, taxYearLabel } from '../lib/payroll.js'

const props = defineProps({ employeeId: { type: String, required: true } })
const emp = computed(() => state.employees.find((e) => e.id === props.employeeId))
const existing = computed(() => state.payslips.find((p) => p.employeeId === props.employeeId && p.month === state.month))
const period = monthRange(state.month, state.monthStartDay)

// What she can change on this payslip (kept with the saved payslip so it opens the same way again).
const start = existing.value?.details?.inputs || {}
const inputs = reactive({
  payDate: existing.value?.payDate || period.to,
  onlyPaid: !!start.onlyPaid,
  over: { commission: '', overtime: '', paye: '', uif: '', ...(start.over || {}) },
  extras: (start.extras || []).map((x) => ({ ...x })),
  deductions: (start.deductions || []).map((x) => ({ ...x })),
})
const saving = ref(false)

const slip = computed(() =>
  draftPayslip({
    emp: emp.value, appts: all.value, leave: state.leave, month: state.month, startDay: state.monthStartDay,
    payDate: inputs.payDate, onlyPaid: inputs.onlyPaid, over: inputs.over,
    extras: inputs.extras.filter((x) => x.label || x.amount), deductions: inputs.deductions.filter((x) => x.label || x.amount),
  }),
)
const c = computed(() => slip.value.appts)
const pct = (r) => `${Math.round(r * 1000) / 10}%`
const line = (label) => slip.value.earnings.find((x) => x.label === label) || slip.value.deductions.find((x) => x.label === label)

/** Everything the printed payslip needs, frozen at the moment it's saved. */
function snapshot() {
  const s = slip.value
  return {
    ...s,
    appts: { count: s.appts.count, takings: s.appts.takings, overtime: s.appts.overtime, otCount: s.appts.otCount },
    leave: { ...s.leave, taken: undefined },
    company: { ...state.company },
    inputs: JSON.parse(JSON.stringify(inputs)),
  }
}

async function save(andPrint = false) {
  saving.value = true
  try {
    const saved = await savePayslip(snapshot())
    toastUndo(existing.value ? 'Payslip updated' : 'Payslip saved')
    if (andPrint) printPayslips([saved.details])
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!confirm('Delete this saved payslip?')) return
  try {
    await deletePayslip(existing.value.id)
    toastUndo('Payslip deleted')
    closeModal()
  } catch (err) {
    fail(err)
  }
}
const editPay = () => openEmployee(emp.value)
</script>

<template>
  <BaseModal :title="`Payslip · ${emp?.name}`" @close="closeModal">
    <p class="muted-note" style="margin-top: -6px">
      {{ monthLabel(state.month) }} · takings {{ shortDate(period.from) }} – {{ shortDate(period.to) }}
      <template v-if="existing"> · saved {{ new Date(existing.updatedAt).toLocaleDateString('en-ZA') }}</template>
    </p>

    <div class="field">
      <label for="ps-date">Pay date</label>
      <input id="ps-date" v-model="inputs.payDate" type="date" required>
    </div>

    <!-- How the commission was worked out -->
    <div class="calc-box">
      <div><span>{{ c.count }} appointments</span><b>{{ fmt(c.takings) }}</b></div>
      <div v-if="c.overtime"><span>⏰ of which overtime ({{ c.otCount }} appts)</span><b>{{ fmt(c.overtime) }}</b></div>
      <div v-if="c.threshold"><span>Commission starts above</span><b>{{ fmt(c.threshold) }}</b></div>
      <div><span>Commission {{ pct(c.rate) }} of {{ fmt(Math.max(0, c.normal - c.threshold)) }}</span><b>{{ fmt(c.normalCommission) }}</b></div>
      <div v-if="c.overtime"><span>Overtime {{ pct(c.otRate) }} of {{ fmt(c.overtime) }}</span><b>{{ fmt(c.overtimeCommission) }}</b></div>
      <label v-if="c.unpaid" class="calc-check"><input v-model="inputs.onlyPaid" type="checkbox"> Only count paid appointments ({{ fmt(c.unpaid) }} still unpaid)</label>
    </div>

    <h4 class="section-label" style="margin-top: 18px">Earnings</h4>
    <div class="pay-lines">
      <div class="pay-line">
        <span>{{ slip.earnings[0].label }}</span>
        <button type="button" class="link-btn" @click="editPay">{{ fmt(slip.earnings[0].amount) }} ✎</button>
      </div>
      <div class="pay-line">
        <label for="ps-comm">Commission</label>
        <input id="ps-comm" v-model="inputs.over.commission" type="number" step="0.01" inputmode="decimal" :placeholder="c.normalCommission.toFixed(2)">
      </div>
      <div class="pay-line">
        <label for="ps-ot">Overtime commission</label>
        <input id="ps-ot" v-model="inputs.over.overtime" type="number" step="0.01" inputmode="decimal" :placeholder="c.overtimeCommission.toFixed(2)">
      </div>
      <div v-for="(x, i) in inputs.extras" :key="'e' + i" class="pay-line">
        <input v-model="x.label" class="label-input" placeholder="e.g. Bonus" aria-label="Earning name">
        <input v-model="x.amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" aria-label="Amount">
        <button type="button" class="icon-btn" aria-label="Remove" @click="inputs.extras.splice(i, 1)">×</button>
      </div>
      <button type="button" class="link-btn" @click="inputs.extras.push({ label: '', amount: '' })">+ Add earning (bonus, tips…)</button>
      <div class="pay-line total"><span>Total earnings</span><b>{{ fmt(slip.gross) }}</b></div>
    </div>

    <h4 class="section-label">Deductions</h4>
    <div class="pay-lines">
      <div class="pay-line">
        <label for="ps-paye">PAYE <small>{{ slip.table.year - 1 }}/{{ String(slip.table.year).slice(2) }} tables{{ slip.age != null ? ` · age ${slip.age}` : '' }}</small></label>
        <input id="ps-paye" v-model="inputs.over.paye" type="number" step="0.01" inputmode="decimal" :placeholder="line('PAYE').calc.toFixed(2)">
      </div>
      <div class="pay-line">
        <label for="ps-uif">UIF <small>1% of salary, max R177.12</small></label>
        <input id="ps-uif" v-model="inputs.over.uif" type="number" step="0.01" inputmode="decimal" :placeholder="slip.employerUif.toFixed(2)">
      </div>
      <div v-for="(x, i) in inputs.deductions" :key="'d' + i" class="pay-line">
        <input v-model="x.label" class="label-input" placeholder="e.g. Advance" aria-label="Deduction name">
        <input v-model="x.amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" aria-label="Amount">
        <button type="button" class="icon-btn" aria-label="Remove" @click="inputs.deductions.splice(i, 1)">×</button>
      </div>
      <button type="button" class="link-btn" @click="inputs.deductions.push({ label: '', amount: '' })">+ Add deduction (advance, loan…)</button>
      <div class="pay-line total"><span>Total deductions</span><b>{{ fmt(slip.totalDeductions) }}</b></div>
    </div>

    <div class="net-box"><span>Nett pay</span><b>{{ fmt(slip.net) }}</b></div>
    <p v-if="!slip.table.exact" class="field-hint orange">The app doesn't have the {{ taxYearLabel(slip.table.wanted) }} tax tables yet, so PAYE uses {{ taxYearLabel(slip.table.year) }}'s. <b>Tell Deon to update the tax tables</b>, and check PAYE before paying.</p>
    <p class="muted-note">
      🌴 Leave: {{ leaveText(slip.leave.days, slip.leave.perDay) }} available on {{ shortDate(period.to) }}
      <template v-if="slip.leave.takenThisMonth"> · {{ slip.leave.takenThisMonth }} h taken this month</template>
    </p>

    <div class="modal-actions">
      <button v-if="existing" type="button" class="btn danger" @click="remove">Delete</button>
      <button type="button" class="btn ghost" :disabled="saving" @click="save(false)">Save</button>
      <button type="button" class="btn" :disabled="saving" @click="save(true)">Save &amp; PDF</button>
    </div>
  </BaseModal>
</template>
