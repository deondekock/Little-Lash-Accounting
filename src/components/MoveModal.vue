<script setup>
import { ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, closeModal, fail } from '../store.js'
import { sheets, cloudflare } from '../api.js'
import { fmt } from '../lib/format.js'

/** Copies everything from the Google Sheet into the Cloudflare database, then compares the two. */
const busy = ref(false)
const progress = ref(0)
const result = ref(null)
const ROWS = [
  ['appointments', 'Appointments'], ['total', 'Total takings'], ['paid', 'Paid appointments'], ['clients', 'Clients'],
  ['employees', 'Team members'], ['services', 'Services'], ['leave', 'Leave bookings'], ['payslips', 'Payslips'],
]

async function copy() {
  if (!confirm('Copy everything from the Google Sheet to Cloudflare now? Anything already in Cloudflare is replaced.')) return
  busy.value = true
  progress.value = 0
  try {
    await sheets.reload()
    const data = sheets.dumpAll()
    cloudflare.setUser(state.email)
    const sheet = cloudflare.summarize(data)
    const cf = await cloudflare.replaceAll(data, (p) => (progress.value = p))
    result.value = ROWS.map(([k, label]) => ({ label, sheet: sheet[k], cf: cf[k], ok: sheet[k] === cf[k], money: k === 'total' }))
  } catch (err) {
    fail(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal title="Move data to Cloudflare" @close="closeModal">
    <template v-if="!result">
      <p class="muted-note" style="margin-top: -6px">
        Copies all appointments, the team, services, leave, payslips and settings from the Google Sheet into the new
        Cloudflare database, then shows both side by side. The Google Sheet isn't changed. Do this when nobody is adding
        appointments. You can run it again — it replaces what's in Cloudflare.
      </p>
      <div v-if="busy" class="calc-box" style="margin-top: 12px">Copying… {{ Math.round(progress * 100) }}%</div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" :disabled="busy" @click="closeModal">Cancel</button>
        <button type="button" class="btn" :disabled="busy" @click="copy">{{ busy ? 'Copying…' : 'Copy now' }}</button>
      </div>
    </template>
    <template v-else>
      <p class="muted-note" style="margin-top: -6px">
        {{ result.every((r) => r.ok) ? '✅ Everything matches. Tell Deon, and he\'ll switch the app over.' : '⚠️ Something doesn\'t match — tell Deon before switching.' }}
      </p>
      <table class="move-table">
        <thead><tr><th /><th>Google Sheet</th><th>Cloudflare</th><th /></tr></thead>
        <tbody>
          <tr v-for="r in result" :key="r.label">
            <td>{{ r.label }}</td>
            <td class="num">{{ r.money ? fmt(r.sheet) : r.sheet.toLocaleString('en-ZA') }}</td>
            <td class="num">{{ r.money ? fmt(r.cf) : r.cf.toLocaleString('en-ZA') }}</td>
            <td>{{ r.ok ? '✅' : '❌' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="modal-actions">
        <button type="button" class="btn" @click="closeModal">Done</button>
      </div>
    </template>
  </BaseModal>
</template>
