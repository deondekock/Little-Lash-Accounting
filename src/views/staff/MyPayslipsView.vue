<script setup>
import { computed } from 'vue'
import { state, printPayslips } from '../../store.js'
import { fmt, monthLabel } from '../../lib/format.js'

/** Staff: her saved payslips (open one to save it as a PDF or print it). */
const slips = computed(() => [...state.payslips].filter((p) => p.details).sort((a, b) => (a.month < b.month ? 1 : -1)))
const date = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
</script>

<template>
  <div class="page">
    <div class="greeting"><div class="hello">Your <em>payslips</em></div><div class="sub">Tap one to save it as a PDF or print it</div></div>
    <div v-if="slips.length" class="list card" style="padding: 4px 0">
      <button v-for="p in slips" :key="p.id" class="list-row" @click="printPayslips([p.details])">
        <div class="history-icon">🧾</div>
        <div class="grow"><div class="title">{{ monthLabel(p.month) }}</div><div class="meta">Paid {{ date(p.payDate) }} · gross {{ fmt(p.gross) }}</div></div>
        <div class="right"><div class="title num">{{ fmt(p.net) }}</div><div class="meta">net</div></div>
      </button>
    </div>
    <div v-else class="card empty" style="padding: 18px">No payslips yet.</div>
  </div>
</template>
