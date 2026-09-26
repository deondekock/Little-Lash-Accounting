<script setup>
import { computed, ref } from 'vue'
import { todayStr } from '../lib/format.js'
import { taxTableNotice, taxYearLabel } from '../lib/payroll.js'

/** Reminds her to ask Deon to update the SARS tax tables for the new tax year. */
const notice = computed(() => taxTableNotice(todayStr()))
const key = computed(() => `llp.taxNotice.${notice.value?.year}`)
function read() {
  try { return localStorage.getItem(key.value) === 'hidden' } catch { return false }
}
const hidden = ref(read())
function hide() {
  hidden.value = true
  try { localStorage.setItem(key.value, 'hidden') } catch { /* private mode */ }
}
</script>

<template>
  <div v-if="notice && !(notice.level === 'soon' && hidden)" class="tax-notice" :class="notice.level" role="status">
    <div class="tn-icon">{{ notice.level === 'due' ? '⚠️' : '🗓️' }}</div>
    <div class="grow">
      <template v-if="notice.level === 'due'">
        <b>Tax tables need updating</b>
        The {{ taxYearLabel(notice.year) }} tax year has started, but the app still has last year's SARS tax tables, so PAYE on
        payslips may be wrong. <b>Tell Deon to update the tax tables.</b>
      </template>
      <template v-else>
        <b>New tax year on 1 March</b>
        The SARS tax tables change for {{ taxYearLabel(notice.year) }}. <b>Tell Deon to update the tax tables</b> after the budget speech.
      </template>
    </div>
    <button v-if="notice.level === 'soon'" class="icon-btn" aria-label="Hide" @click="hide">×</button>
  </div>
</template>
