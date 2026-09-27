<script setup>
import BaseModal from './BaseModal.vue'
import { all, state, closeModal, toast } from '../store.js'
import { downloadCsv } from '../lib/csv.js'
import { PAY_FIELDS } from '../lib/schema.js'

/** Downloads the salon's data as CSV files (open in Excel or Google Sheets). */
function download(name, rows) {
  downloadCsv(name, rows)
  toast(`${name} downloaded`)
}
const nameOf = (id) => state.employees.find((e) => e.id === id)?.name || ''

const FILES = [
  {
    name: 'Appointments', count: () => all.value.length,
    rows: () => [
      ['Date', 'Month', 'Team member', 'Client', 'Service', 'Amount', 'Method', 'Status', 'Paid on', 'Notes', 'Overtime', 'Length (min)'],
      ...[...all.value].sort((a, b) => (a.date < b.date ? -1 : 1)).map((a) => [a.date, a.month, a.employeeName, a.client, a.service, a.amount,
        a.method, a.status, a.paidOn, a.notes, a.overtime === 'all' ? 'All' : a.overtime || '', a.length || '']),
    ],
  },
  {
    name: 'Team', count: () => state.employees.length,
    rows: () => [
      ['Name', 'Phone', 'Active', ...PAY_FIELDS.map((f) => f[1])],
      ...state.employees.map((e) => [e.name, e.phone, e.active ? 'Yes' : 'No', ...PAY_FIELDS.map(([k]) => (typeof e.pay?.[k] === 'boolean' ? (e.pay[k] ? 'Yes' : '') : e.pay?.[k] ?? ''))]),
    ],
  },
  {
    name: 'Services', count: () => state.services.length,
    rows: () => [
      ['Service', 'Price (anyone)', 'Active', ...state.employees.map((e) => `Price: ${e.name}`)],
      ...state.services.map((s) => [s.name, s.price ?? '', s.active ? 'Yes' : 'No', ...state.employees.map((e) => s.prices?.[e.id] ?? '')]),
    ],
  },
  {
    name: 'Leave', count: () => state.leave.length,
    rows: () => [['Team member', 'Type', 'From', 'To', 'Hours', 'Notes'], ...state.leave.map((l) => [nameOf(l.employeeId) || l.employeeName, l.type, l.from, l.to, l.hours, l.notes])],
  },
  {
    name: 'Payslips', count: () => state.payslips.length,
    rows: () => [
      ['Month', 'Team member', 'Pay date', 'Gross', 'PAYE', 'UIF', 'Other deductions', 'Net'],
      ...[...state.payslips].sort((a, b) => (a.month < b.month ? -1 : 1)).map((p) => [p.month, nameOf(p.employeeId) || p.employeeName, p.payDate, p.gross, p.paye, p.uif, p.deductions, p.net]),
    ],
  },
]
</script>

<template>
  <BaseModal title="Download data" @close="closeModal">
    <p class="muted-note" style="margin-top: -6px">CSV files open in Excel, Numbers or Google Sheets.</p>
    <div class="list">
      <button v-for="f in FILES" :key="f.name" class="list-row" @click="download(f.name, f.rows())">
        <div class="grow"><div class="title">{{ f.name }}</div><div class="meta">{{ f.count().toLocaleString('en-ZA') }} rows</div></div>
        <span class="link-btn">Download</span>
      </button>
    </div>
  </BaseModal>
</template>
