<script setup>
import { onMounted, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, closeModal, toast, fail } from '../store.js'
import { cloudflare as api } from '../api.js'

/** The salon's Gmail: connect it once (Google's own screen) so the app sends its emails from it. */
const status = ref(null)
const busy = ref('')
async function refreshStatus() {
  try {
    status.value = await api.getGoogleStatus()
  } catch (err) {
    fail(err)
  }
}
onMounted(refreshStatus)
async function connect() {
  busy.value = 'connect'
  try {
    const { url } = await api.googleConnectUrl()
    location.href = url // Google's page; it comes back to the app
  } catch (err) {
    fail(err)
    busy.value = ''
  }
}
async function disconnect() {
  if (!confirm('Disconnect the Gmail account? The app goes back to sending emails the old way.')) return
  busy.value = 'off'
  try {
    await api.disconnectGoogle()
    await refreshStatus()
    toast('Gmail disconnected')
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}
const ago = (t) => new Date(t).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <BaseModal title="Gmail" @close="closeModal">
    <div v-if="!status" class="muted-note">Loading…</div>
    <template v-else>
      <p class="muted-note" style="margin-top: -6px !important">
        Connect the salon's Gmail so the app sends its emails (summaries, payslips, notifications) from that account.
        You sign in on Google's own page — the app never sees the password.
      </p>

      <div v-if="!status.setUp" class="field-hint orange">The Google setup isn't finished yet — Deon needs to add the Google client secret first.</div>

      <template v-else-if="!status.connected">
        <p v-if="status.error" class="field-hint orange">{{ status.error }}</p>
        <button class="btn wide" :disabled="busy === 'connect'" @click="connect">{{ busy === 'connect' ? 'Opening Google…' : 'Connect Gmail' }}</button>
        <p class="muted-note">Pick the salon's Gmail account on the next screen. If Google warns the app isn't verified, tap <b>Advanced → Go to Little Lash Lounge</b> — it's your own app.</p>
      </template>

      <template v-else>
        <div class="sec-status on">✅ Connected: {{ status.email }}</div>
        <p v-if="status.error" class="field-hint orange">{{ status.error }}</p>
        <p class="muted-note">{{ status.connectedAt ? `Connected ${ago(status.connectedAt)}` : '' }}</p>
        <div class="report-actions">
          <button class="btn ghost" :disabled="busy === 'off'" @click="disconnect">Disconnect</button>
        </div>
      </template>
    </template>
  </BaseModal>
</template>
