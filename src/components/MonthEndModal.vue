<script setup>
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import Icon from './Icon.vue'
import ReportDocument from './ReportDocument.vue'
import { all, state, closeModal, printReport, toast } from '../store.js'
import { monthLabel, shiftMonth, currentMonth } from '../lib/format.js'
import { monthEndReport, reportRows } from '../lib/reports.js'
import { downloadCsv } from '../lib/csv.js'

/** Month-end pack for the accountant: takings, unpaid, payroll and the EMP201 figures. */
const month = ref(state.month)
const latest = currentMonth(state.monthStartDay)
const report = computed(() => monthEndReport({
  month: month.value, appts: all.value, employees: state.employees, payslips: state.payslips, company: state.company, startDay: state.monthStartDay,
}))
function download() {
  downloadCsv(report.value.fileName, reportRows(report.value))
  toast('Spreadsheet downloaded')
}
</script>

<template>
  <BaseModal title="Month-end pack" @close="closeModal">
    <div class="period-nav-simple">
      <button class="icon-btn" aria-label="Previous month" @click="month = shiftMonth(month, -1)"><Icon name="left" /></button>
      <div><b>{{ monthLabel(month) }}</b><small>for your accountant</small></div>
      <button class="icon-btn" aria-label="Next month" :disabled="month >= latest" @click="month = shiftMonth(month, 1)"><Icon name="right" /></button>
    </div>
    <div class="report-actions">
      <button class="btn" @click="printReport(report)"><Icon name="receipt" :size="16" /> Print / save as PDF</button>
      <button class="btn ghost" @click="download">Spreadsheet (CSV)</button>
    </div>
    <div class="report-screen"><ReportDocument :report="report" /></div>
  </BaseModal>
</template>
