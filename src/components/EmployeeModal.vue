<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { saveEmployee, deleteEmployee, closeModal, toastUndo, fail } from '../store.js'
import { payDefaults, birthDateFromId, leaveSettings } from '../lib/payroll.js'
import { todayStr } from '../lib/format.js'

const props = defineProps({ employee: Object })
const editing = !!props.employee

const form = reactive({
  name: props.employee?.name || '',
  phone: props.employee?.phone || '',
  status: props.employee?.active === false ? 'Inactive' : 'Active',
})
const pay = reactive(payDefaults(props.employee?.pay))
// Open the payslip section straight away when it's still empty (after the name is in).
const open = ref(editing && !pay.basic && !pay.idNumber ? 'pay' : '')
const saving = ref(false)
// Typing a leave balance: it's her balance today unless she picks another date.
const hasBefore = computed(() => [pay.leaveOpening, pay.sickUsed].some((v) => v !== '' && v != null))
watch(hasBefore, (v) => {
  if (v && !pay.leaveFrom) pay.leaveFrom = todayStr()
})
const set = computed(() => leaveSettings(pay))
const round = (n) => Math.round(n * 100) / 100
const nameInput = ref(null)

onMounted(() => !editing && nameInput.value?.focus())

const COMMISSION_ON = [
  { value: 'all', label: 'All her takings' },
  { value: 'aboveBasic', label: 'Takings above her basic salary' },
  { value: 'above', label: 'Takings above a set amount' },
]
const birth = computed(() => {
  const b = birthDateFromId(pay.idNumber)
  return b ? new Date(b + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
})
const idWarning = computed(() => pay.idNumber && pay.idNumber.replace(/\D/g, '').length !== 13)

async function submit() {
  saving.value = true
  try {
    await saveEmployee({
      id: props.employee?.id,
      name: form.name,
      phone: form.phone,
      active: form.status === 'Active',
      pay: { ...pay },
    })
    closeModal()
    toastUndo(editing ? 'Saved' : 'Employee added')
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!confirm('Delete ' + props.employee.name + '?')) return
  try {
    await deleteEmployee(props.employee.id)
    closeModal()
    toastUndo('Deleted')
  } catch (err) {
    fail(err)
  }
}
const toggle = (id) => (open.value = open.value === id ? '' : id)
</script>

<template>
  <BaseModal :title="editing ? 'Edit employee' : 'New employee'" @close="closeModal">
    <form autocomplete="off" @submit.prevent="submit">
      <div class="field">
        <label for="f-name">Name</label>
        <input id="f-name" ref="nameInput" v-model="form.name" required placeholder="e.g. Chrisilda">
      </div>
      <div class="field">
        <label for="f-phone">Phone (optional)</label>
        <input id="f-phone" v-model="form.phone" type="tel">
      </div>
      <div class="field">
        <label for="f-login">Her Google email, to sign in (optional)</label>
        <input id="f-login" v-model="pay.loginEmail" type="email" inputmode="email" autocapitalize="off" placeholder="name@gmail.com">
        <div v-if="pay.loginEmail" class="field-hint">She can sign in to the app with this Google account and see only her own leave, payslips and details.</div>
      </div>
      <div v-if="editing" class="field">
        <label>Status</label>
        <SegmentedControl v-model="form.status" :options="['Active', 'Inactive']" />
      </div>

      <button type="button" class="fold" :aria-expanded="open === 'pay'" @click="toggle('pay')">
        <span><b>Pay</b><small>Basic salary, commission, overtime</small></span><span class="chev">{{ open === 'pay' ? '−' : '+' }}</span>
      </button>
      <div v-if="open === 'pay'" class="fold-body">
        <div class="row2">
          <div class="field">
            <label for="p-label">Salary shown as</label>
            <input id="p-label" v-model="pay.salaryLabel" list="salary-labels" placeholder="Basic Salary">
            <datalist id="salary-labels"><option>Basic Salary</option><option>Salary</option><option>Cost to Company</option></datalist>
          </div>
          <div class="field">
            <label for="p-basic">Amount per month (R)</label>
            <input id="p-basic" v-model="pay.basic" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00">
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label for="p-comm">Commission %</label>
            <input id="p-comm" v-model="pay.commissionPct" type="number" inputmode="decimal" step="0.1" min="0" max="100" placeholder="e.g. 20">
          </div>
          <div class="field">
            <label for="p-ot">Overtime commission %</label>
            <input id="p-ot" v-model="pay.overtimePct" type="number" inputmode="decimal" step="0.1" min="0" max="100" :placeholder="pay.commissionPct ? `same (${pay.commissionPct})` : 'e.g. 50'">
          </div>
        </div>
        <div class="field">
          <label for="p-on">Commission is paid on</label>
          <select id="p-on" v-model="pay.commissionOn">
            <option v-for="o in COMMISSION_ON" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div v-if="pay.commissionOn === 'above'" class="field">
          <label for="p-thr">Commission starts above (R)</label>
          <input id="p-thr" v-model="pay.threshold" type="number" inputmode="decimal" step="0.01" min="0">
        </div>
        <p class="field-hint" style="margin-top: -4px">
          Work done in overtime earns the overtime % instead of the normal %. Mark it on each appointment.
        </p>
      </div>

      <button type="button" class="fold" :aria-expanded="open === 'details'" @click="toggle('details')">
        <span><b>Payslip details</b><small>ID, tax number, address, bank</small></span><span class="chev">{{ open === 'details' ? '−' : '+' }}</span>
      </button>
      <div v-if="open === 'details'" class="fold-body">
        <div class="field">
          <label for="p-full">Full name</label>
          <input id="p-full" v-model="pay.fullName" :placeholder="form.name">
        </div>
        <div class="row2">
          <div class="field">
            <label for="p-code">Employee number</label>
            <input id="p-code" v-model="pay.code" placeholder="EMP01">
          </div>
          <div class="field">
            <label for="p-engaged">Date engaged</label>
            <input id="p-engaged" v-model="pay.engaged" type="date">
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label for="p-id">ID number</label>
            <input id="p-id" v-model="pay.idNumber" inputmode="numeric">
            <div v-if="idWarning" class="field-hint orange">An SA ID number has 13 digits</div>
            <div v-else-if="birth" class="field-hint">Born {{ birth }}</div>
          </div>
          <div class="field">
            <label for="p-tax">SARS tax number</label>
            <input id="p-tax" v-model="pay.taxNumber" inputmode="numeric">
          </div>
        </div>
        <div class="field">
          <label for="p-addr">Address</label>
          <textarea id="p-addr" v-model="pay.address" rows="4" placeholder="Street&#10;Suburb&#10;City&#10;Postal code" />
        </div>
        <div class="row2">
          <div class="field">
            <label for="p-bank">Bank</label>
            <input id="p-bank" v-model="pay.bankName" list="banks">
            <datalist id="banks"><option>Capitec</option><option>FNB</option><option>ABSA</option><option>Standard Bank</option><option>Nedbank</option><option>TymeBank</option><option>Discovery Bank</option><option>African Bank</option></datalist>
          </div>
          <div class="field">
            <label for="p-type">Account type</label>
            <input id="p-type" v-model="pay.accountType" list="acc-types">
            <datalist id="acc-types"><option>Savings</option><option>Cheque</option><option>Transmission</option></datalist>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label for="p-acc">Account number</label>
            <input id="p-acc" v-model="pay.accountNumber" inputmode="numeric">
          </div>
          <div class="field">
            <label for="p-branch">Branch code</label>
            <input id="p-branch" v-model="pay.branchCode" inputmode="numeric">
          </div>
        </div>
      </div>

      <button type="button" class="fold" :aria-expanded="open === 'leave'" @click="toggle('leave')">
        <span><b>Leave</b><small>{{ set.owner ? 'Owner · ' : '' }}{{ set.perYear }} h annual leave a year · {{ set.perWeek }} days × {{ set.perDay }} h a week</small></span><span class="chev">{{ open === 'leave' ? '−' : '+' }}</span>
      </button>
      <div v-if="open === 'leave'" class="fold-body">
        <label class="calc-check" style="margin: 0 0 12px"><input v-model="pay.owner" type="checkbox"> Owner — no legal leave minimums or limits</label>
        <div class="row2">
          <div class="field">
            <label for="l-hours">Hours in a work day</label>
            <input id="l-hours" v-model="pay.hoursPerDay" type="number" inputmode="decimal" step="0.25" min="1" max="24" placeholder="8">
          </div>
          <div class="field">
            <label for="l-week">Work days a week</label>
            <input id="l-week" v-model="pay.daysPerWeek" type="number" inputmode="numeric" step="1" min="1" max="7" placeholder="5">
          </div>
        </div>
        <div class="field">
          <label for="l-year">Annual leave hours per year</label>
          <input id="l-year" v-model="pay.leavePerYear" type="number" inputmode="decimal" step="0.5" min="0" :placeholder="set.owner ? '0 (not tracked)' : `${set.minYear} (legal minimum)`">
          <div class="field-hint" :class="{ orange: !set.owner && set.perYear < set.minYear }">
            = {{ round(set.perYear / set.perDay) }} days a year · she earns <b>{{ round(set.perYear / 12) }} h ({{ set.perMonth }} days) a month</b>
            <template v-if="!set.owner && set.perYear < set.minYear"> · below the legal minimum of {{ set.minYear }} h (3 weeks)</template>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label for="l-open">Annual leave days she had…</label>
            <input id="l-open" v-model="pay.leaveOpening" type="number" inputmode="decimal" step="0.01" placeholder="0">
          </div>
          <div class="field">
            <label for="l-from">…on this date</label>
            <input id="l-from" v-model="pay.leaveFrom" type="date" :required="hasBefore">
          </div>
        </div>
        <div v-if="!set.owner" class="field">
          <label for="l-sick">Sick leave hours already used this 3-year cycle (before the app)</label>
          <input id="l-sick" v-model="pay.sickUsed" type="number" inputmode="decimal" step="0.5" min="0" placeholder="0">
        </div>
        <p v-if="set.owner" class="field-hint" style="margin-top: -4px">
          As the owner she has no legal minimums or limits: set her own hours above, and any leave she books is just recorded.
        </p>
        <p v-else class="field-hint" style="margin-top: -4px">
          Legal minimums, worked out from her week:
          <b>sick leave {{ set.sickCycle }} h</b> every 3 years from the date engaged (6 weeks; in her first 6 months 1 day per 26 days worked),
          <b>family responsibility {{ set.family }} h</b> a year (3 days, after 4 months, if she works 4+ days a week) and
          <b>maternity</b> 4 months (unpaid — she claims from UIF).
          <template v-if="!pay.engaged"> Add her date engaged under Payslip details so the app knows when her cycles start.</template>
        </p>
      </div>

      <div class="modal-actions">
        <button v-if="editing" type="button" class="btn danger" @click="remove">Delete</button>
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">{{ editing ? 'Save' : 'Add' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
