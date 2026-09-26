<script setup>
import { computed } from 'vue'
import { fmt, monthLabel, shortDate } from '../lib/format.js'

/** A printable payslip (same layout as the salon's old Google Sheets payslip). */
const props = defineProps({ slip: { type: Object, required: true } })
const s = computed(() => props.slip)
const p = computed(() => s.value.pay || {})
const co = computed(() => s.value.company || {})
const lines = (text) => String(text || '').split(/\n|,\s*/).map((x) => x.trim()).filter(Boolean)
const date = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const days = (n) => `${Math.round((n || 0) * 100) / 100} day(s)`
const rows = computed(() => {
  const n = Math.max(s.value.earnings.length, s.value.deductions.length)
  return Array.from({ length: n }, (_, i) => [s.value.earnings[i], s.value.deductions[i]])
})
</script>

<template>
  <article class="payslip">
    <header>
      <div>
        <div class="ps-company">{{ co.name || 'Little Lash Lounge' }}</div>
        <h1>Payslip</h1>
        <div class="ps-month">{{ monthLabel(s.month) }}</div>
      </div>
      <div class="ps-right">
        <div><span>Pay date</span> {{ date(s.payDate) }}</div>
        <div><span>Period</span> {{ shortDate(s.period.from) }} – {{ shortDate(s.period.to) }} {{ s.period.to.slice(0, 4) }}</div>
      </div>
    </header>

    <div class="ps-cols">
      <section>
        <h2>Employee details</h2>
        <dl>
          <dt>Employee name</dt><dd>{{ s.name }}</dd>
          <template v-if="p.code"><dt>Employee code</dt><dd>{{ p.code }}</dd></template>
          <template v-if="p.idNumber"><dt>ID number</dt><dd>{{ p.idNumber }}</dd></template>
          <template v-if="p.address"><dt>Address</dt><dd><div v-for="(l, i) in lines(p.address)" :key="i">{{ l }}</div></dd></template>
          <template v-if="p.engaged"><dt>Date engaged</dt><dd>{{ date(p.engaged) }}</dd></template>
          <template v-if="p.taxNumber"><dt>Tax number</dt><dd>{{ p.taxNumber }}</dd></template>
          <template v-if="p.bankName"><dt>Bank name</dt><dd>{{ p.bankName }}</dd></template>
          <template v-if="p.accountType"><dt>Account type</dt><dd>{{ p.accountType }}</dd></template>
          <template v-if="p.accountNumber"><dt>Account number</dt><dd>{{ p.accountNumber }}</dd></template>
          <template v-if="p.branchCode"><dt>Branch code</dt><dd>{{ p.branchCode }}</dd></template>
        </dl>
      </section>
      <section>
        <h2>Company details</h2>
        <dl>
          <template v-if="co.name"><dt>Company name</dt><dd>{{ co.name }}</dd></template>
          <template v-if="co.type"><dt>Company type</dt><dd>{{ co.type }}</dd></template>
          <template v-if="co.registration"><dt>Registration number</dt><dd>{{ co.registration }}</dd></template>
          <template v-if="co.address"><dt>Address</dt><dd><div v-for="(l, i) in lines(co.address)" :key="i">{{ l }}</div></dd></template>
          <template v-if="co.payeRef"><dt>PAYE reference</dt><dd>{{ co.payeRef }}</dd></template>
          <template v-if="co.uifRef"><dt>UIF reference</dt><dd>{{ co.uifRef }}</dd></template>
        </dl>
        <template v-if="s.leave && s.leave.start">
          <h2 style="margin-top: 14px">Annual leave</h2>
          <dl>
            <dt>Leave accrued</dt><dd>{{ days(s.leave.accruedThisMonth) }}</dd>
            <dt>Leave taken</dt><dd>{{ s.leave.takenThisMonth || 0 }} hours</dd>
            <dt>Total leave</dt><dd>{{ days(s.leave.days) }} · {{ s.leave.hours }} h</dd>
            <template v-if="s.leave.sick"><dt>Sick leave left</dt><dd>{{ s.leave.sick.hours }} h (cycle to {{ date(s.leave.sick.to) }})</dd></template>
            <template v-if="s.leave.family?.eligible"><dt>Family leave left</dt><dd>{{ s.leave.family.hours }} h</dd></template>
          </dl>
        </template>
      </section>
    </div>

    <table class="ps-table">
      <thead><tr><th>Earnings</th><th /><th>Deductions</th><th /></tr></thead>
      <tbody>
        <tr v-for="([e, d], i) in rows" :key="i">
          <td>{{ e?.label }}</td><td class="n">{{ e ? fmt(e.amount) : '' }}</td>
          <td>{{ d?.label }}</td><td class="n">{{ d ? fmt(d.amount) : '' }}</td>
        </tr>
      </tbody>
    </table>

    <div class="ps-totals">
      <div><span>Total earnings</span><b>{{ fmt(s.gross) }}</b></div>
      <div><span>Total deductions</span><b>{{ fmt(s.totalDeductions) }}</b></div>
      <div class="net"><span>Nett pay</span><b>{{ fmt(s.net) }}</b></div>
    </div>
    <p v-if="s.employerUif" class="ps-foot">Employer UIF contribution: {{ fmt(s.employerUif) }}</p>
  </article>
</template>
