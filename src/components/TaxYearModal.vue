<script setup>
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import Icon from './Icon.vue'
import ReportDocument from './ReportDocument.vue'
import { state, closeModal, printReport, toast } from '../store.js'
import { taxYear, taxYearLabel } from '../lib/payroll.js'
import { todayStr } from '../lib/format.js'
import { taxYearReport, taxYearsWithPayslips, reportRows } from '../lib/reports.js'
import { downloadCsv } from '../lib/csv.js'

/** Tax-year totals per team member (IRP5 / EMP501) and the monthly EMP201 figures. */
const years = computed(() => {
  const list = taxYearsWithPayslips(state.payslips, state.monthStartDay)
  const now = taxYear(todayStr())
  return [...new Set([now, ...list])].sort((a, b) => b - a)
})
// After February the year that just ended is the one to file; otherwise the current one.
const year = ref(years.value.includes(taxYear(todayStr()) - 1) && new Date().getMonth() < 5 ? taxYear(todayStr()) - 1 : taxYear(todayStr()))
const report = computed(() => taxYearReport({ year: year.value, payslips: state.payslips, employees: state.employees, company: state.company, startDay: state.monthStartDay }))
function download() {
  downloadCsv(report.value.fileName, reportRows(report.value))
  toast('Spreadsheet downloaded')
}
</script>

<template>
  <BaseModal title="Tax year (IRP5 / EMP501)" @close="closeModal">
    <div class="chips inline" style="margin-bottom: 12px; flex-wrap: wrap">
      <button v-for="y in years" :key="y" class="chip small" :class="{ active: y === year }" @click="year = y">{{ taxYearLabel(y) }}</button>
    </div>
    <div class="report-actions">
      <button class="btn" @click="printReport(report)"><Icon name="receipt" :size="16" /> Print / save as PDF</button>
      <button class="btn ghost" @click="download">Spreadsheet (CSV)</button>
    </div>
    <div class="report-screen"><ReportDocument :report="report" /></div>
  </BaseModal>
</template>
