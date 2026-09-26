<script setup>
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { all, state, closeModal, readOldPayslips, saveEmployee, saveCompany, toast, fail } from '../store.js'
import { fmt, monthLabel } from '../lib/format.js'
import { matchEmployee, suggestFor } from '../lib/payslipImport.js'

/** Fills in employees' payslip details from the salon's old Google Sheets payslips. */
const link = ref('')
const busy = ref(false)
const slips = ref(null)
const picked = ref({})

const LABELS = {
  fullName: 'Full name', code: 'Employee number', idNumber: 'ID number', address: 'Address', engaged: 'Date engaged',
  taxNumber: 'Tax number', bankName: 'Bank', accountType: 'Account type', accountNumber: 'Account number', branchCode: 'Branch code',
  salaryLabel: 'Salary shown as', basic: 'Salary', commissionPct: 'Commission %', commissionOn: 'Commission on',
  leaveOpening: 'Annual leave balance (days)', leaveFrom: '…on', leavePerYear: 'Annual leave hours / year', owner: 'Owner (no leave limits)',
}
const ON = { all: 'all takings', aboveBasic: 'takings above her basic', above: 'takings above an amount' }
const show = (k, v) => (k === 'basic' ? fmt(v) : k === 'commissionOn' ? ON[v] : k === 'owner' ? 'yes' : k === 'address' ? v.replace(/\n/g, ', ') : String(v))

/** Newest payslip per employee, with what it would fill in. */
const rows = computed(() => {
  if (!slips.value) return []
  const best = new Map()
  for (const s of slips.value) {
    const e = matchEmployee(s, state.employees)
    if (!e) continue
    const prev = best.get(e.id)
    if (!prev || (s.month || '') > (prev.slip.month || '')) best.set(e.id, { e, slip: s })
  }
  return [...best.values()].map(({ e, slip }) => {
    const takings = slip.month ? all.value.filter((a) => a.employeeId === e.id && a.month === slip.month).reduce((t, a) => t + a.amount, 0) : null
    const { set, notes } = suggestFor(slip, e, { takings, startDay: state.monthStartDay })
    return { e, slip, set, notes, fields: Object.keys(set) }
  })
})
const unmatched = computed(() => (slips.value || []).filter((s) => !matchEmployee(s, state.employees)).map((s) => s.tab))
const companyFill = computed(() => {
  const src = (slips.value || []).find((s) => s.company.name)?.company
  if (!src) return null
  const out = {}
  for (const k of ['name', 'type', 'registration', 'address']) if (!state.company[k] && src[k]) out[k] = src[k]
  return Object.keys(out).length ? out : null
})

async function load() {
  busy.value = true
  try {
    slips.value = await readOldPayslips(link.value)
    picked.value = Object.fromEntries(rows.value.filter((r) => r.fields.length).map((r) => [r.e.id, true]))
  } catch (err) {
    fail(err)
  } finally {
    busy.value = false
  }
}

async function apply() {
  busy.value = true
  try {
    let n = 0
    for (const r of rows.value) {
      if (!picked.value[r.e.id] || !r.fields.length) continue
      await saveEmployee({ id: r.e.id, name: r.e.name, phone: r.e.phone, active: r.e.active, pay: { ...r.e.pay, ...r.set } })
      n++
    }
    if (companyFill.value && picked.value.company !== false) await saveCompany({ ...state.company, ...companyFill.value })
    toast(`Filled in ${n} team member${n === 1 ? '' : 's'} — check them under Team → Edit`)
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal title="Fill in from old payslips" @close="closeModal">
    <template v-if="!slips">
      <p class="muted-note" style="margin-top: -6px">
        Paste the link to the Google Sheet with the old payslips (one tab per person). The app reads them and fills in
        details that are still empty: ID and tax numbers, address, bank, salary, commission % and leave. Nothing is changed until you tap Fill in.
      </p>
      <form @submit.prevent="load">
        <div class="field">
          <label for="imp-link">Payslip sheet link</label>
          <input id="imp-link" v-model="link" required placeholder="https://docs.google.com/spreadsheets/d/…">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
          <button type="submit" class="btn" :disabled="busy">{{ busy ? 'Reading…' : 'Read payslips' }}</button>
        </div>
      </form>
    </template>

    <template v-else>
      <p v-if="!rows.length" class="muted-note">No tabs matched your team's names.</p>
      <div v-for="r in rows" :key="r.e.id" class="import-card">
        <label class="import-head">
          <input v-model="picked[r.e.id]" type="checkbox" :disabled="!r.fields.length">
          <span><b>{{ r.e.name }}</b><small>from “{{ r.slip.tab }}”{{ r.slip.month ? ' · ' + monthLabel(r.slip.month) : '' }}</small></span>
        </label>
        <dl v-if="r.fields.length">
          <template v-for="k in r.fields" :key="k"><dt>{{ LABELS[k] || k }}</dt><dd>{{ show(k, r.set[k]) }}</dd></template>
        </dl>
        <p v-else class="muted-note">Everything is already filled in.</p>
        <p v-for="n in r.notes" :key="n" class="field-hint orange">{{ n }}</p>
      </div>
      <div v-if="companyFill" class="import-card">
        <label class="import-head">
          <input type="checkbox" :checked="picked.company !== false" @change="picked.company = $event.target.checked">
          <span><b>Company details</b><small>for the payslips</small></span>
        </label>
        <dl><template v-for="(v, k) in companyFill" :key="k"><dt>{{ k }}</dt><dd>{{ String(v).replace(/\n/g, ', ') }}</dd></template></dl>
      </div>
      <p v-if="unmatched.length" class="muted-note">Not matched to anyone: {{ unmatched.join(', ') }}</p>
      <div class="modal-actions">
        <button type="button" class="btn ghost" @click="slips = null">Back</button>
        <button type="button" class="btn" :disabled="busy || !Object.values(picked).some(Boolean)" @click="apply">{{ busy ? 'Saving…' : 'Fill in' }}</button>
      </div>
    </template>
  </BaseModal>
</template>
