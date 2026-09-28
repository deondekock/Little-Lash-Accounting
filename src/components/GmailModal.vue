<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, closeModal, loadBooksy, dismissBooksy, recordFromBooksy, booksyEmployee, toast, fail } from '../store.js'
import { cloudflare as api } from '../api.js'
import { shortDate } from '../lib/format.js'

/** The salon's Gmail: connect it once (Google's own screen), see Booksy's emails as they come in. */
const status = ref(null)
const busy = ref('')
const open = ref('')
async function refreshStatus() {
  try {
    status.value = await api.getGoogleStatus()
  } catch (err) {
    fail(err)
  }
}
onMounted(async () => {
  await Promise.all([refreshStatus(), refreshBStatus()])
  if (status.value?.connected || bStatus.value?.connected) loadBooksy()
})
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
async function check() {
  busy.value = 'check'
  await loadBooksy(true)
  await refreshStatus()
  busy.value = ''
  toast('Checked for new Booksy emails')
}
async function disconnect() {
  if (!confirm('Disconnect the Gmail account? Booksy emails stop coming in, and emails go back to the old sender.')) return
  busy.value = 'off'
  try {
    await api.disconnectGoogle()
    state.booksy = null
    await refreshStatus()
    toast('Gmail disconnected')
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}
/* Reading Booksy's calendar directly (her own account), which also catches staff-made moves. */
const bStatus = ref(null)
const bForm = reactive({ token: '', apiKey: '', businessId: '' })
const bBusy = ref('')
const showConnect = ref(false)
async function refreshBStatus() {
  try { bStatus.value = await api.getBooksyApiStatus() } catch { bStatus.value = { connected: false } }
}
async function connectBooksy() {
  bBusy.value = 'connect'
  try {
    await api.connectBooksyApi({ token: bForm.token.trim(), apiKey: bForm.apiKey.trim(), businessId: bForm.businessId.trim() })
    bForm.token = bForm.apiKey = bForm.businessId = ''
    showConnect.value = false
    await refreshBStatus()
    await loadBooksy(true)
    toast('Booksy calendar connected')
  } catch (err) {
    fail(err)
  } finally {
    bBusy.value = ''
  }
}
async function disconnectBooksy() {
  if (!confirm('Disconnect the Booksy calendar? Bookings stop coming in directly.')) return
  bBusy.value = 'off'
  try {
    await api.disconnectBooksyApi()
    await refreshBStatus()
    toast('Booksy calendar disconnected')
  } catch (err) {
    fail(err)
  } finally {
    bBusy.value = ''
  }
}

const items = computed(() => state.booksy?.items || [])
const KIND = { new: '📅 New booking', cancelled: '✖️ Cancelled', moved: '🔁 Moved', other: '✉️ Email' }
const ago = (t) => new Date(t).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const copy = (x) => navigator.clipboard?.writeText(`${x.subject}\n\n${x.body}`).then(() => toast('Email text copied')).catch(() => {})
</script>

<template>
  <BaseModal title="Booksy & Gmail" @close="closeModal">
    <div v-if="!status" class="muted-note">Loading…</div>
    <template v-else>
      <p class="muted-note" style="margin-top: -6px !important">
        Connect the salon's Gmail (the one Booksy sends its notifications to). Bookings then show up in the app to record with one tap,
        and the app's emails are sent from that account. You sign in on Google's own page — the app never sees the password.
      </p>

      <div class="booksy-api-box">
        <h4 class="section-label" style="margin-top: 0">Booksy calendar (direct)</h4>
        <template v-if="bStatus?.connected">
          <div class="sec-status on">✅ Reading Booksy directly · business {{ bStatus.businessId }}</div>
          <p v-if="bStatus.error" class="field-hint orange">{{ bStatus.error }} <button class="link-btn" @click="showConnect = true">Reconnect</button></p>
          <p class="muted-note">Catches bookings staff move or add themselves too. Checks every 15 minutes.</p>
          <div class="report-actions">
            <button class="btn soft" :disabled="busy === 'check'" @click="check">{{ busy === 'check' ? 'Checking…' : 'Check now' }}</button>
            <button class="btn ghost" :disabled="bBusy === 'off'" @click="disconnectBooksy">Disconnect</button>
          </div>
        </template>
        <template v-else>
          <p class="muted-note" style="margin-top: -2px !important">
            Reads the salon's Booksy calendar directly, so every booking shows up — including ones staff move or add themselves.
            Deon sets this up with details from Booksy's calendar page.
          </p>
          <button v-if="!showConnect" class="btn soft wide" @click="showConnect = true">Set up Booksy calendar</button>
          <template v-else>
            <div class="field"><label for="b-biz">Business ID</label><input id="b-biz" v-model="bForm.businessId" inputmode="numeric" placeholder="e.g. 10818"></div>
            <div class="field"><label for="b-key">API key (X-Api-Key)</label><input id="b-key" v-model="bForm.apiKey" placeholder="frontdesk-…"></div>
            <div class="field"><label for="b-tok">Access token (X-Access-Token)</label><input id="b-tok" v-model="bForm.token" placeholder="paste the token"></div>
            <div class="report-actions">
              <button class="btn" :disabled="bBusy === 'connect'" @click="connectBooksy">{{ bBusy === 'connect' ? 'Checking…' : 'Connect' }}</button>
              <button class="btn ghost" @click="showConnect = false">Cancel</button>
            </div>
          </template>
        </template>
      </div>

      <h4 class="section-label">Gmail (Booksy emails + sending)</h4>
      <div v-if="!status.setUp" class="field-hint orange">The Google setup isn't finished yet — Deon needs to add the Google client secret first.</div>

      <template v-else-if="!status.connected">
        <p v-if="status.error" class="field-hint orange">{{ status.error }}</p>
        <button class="btn wide" :disabled="busy === 'connect'" @click="connect">{{ busy === 'connect' ? 'Opening Google…' : 'Connect Gmail' }}</button>
        <p class="muted-note">Pick the salon's Gmail account on the next screen. If Google warns the app isn't verified, tap <b>Advanced → Go to Little Lash Lounge</b> — it's your own app.</p>
      </template>

      <template v-else>
        <div class="sec-status on">✅ Connected: {{ status.email }}</div>
        <p v-if="status.error" class="field-hint orange">{{ status.error }}</p>
        <p class="muted-note">{{ status.lastSync ? `Last checked ${ago(status.lastSync)} · checks every 15 minutes` : 'Not checked yet' }}</p>
        <div class="report-actions">
          <button class="btn soft" :disabled="busy === 'check'" @click="check">{{ busy === 'check' ? 'Checking…' : 'Check now' }}</button>
          <button class="btn ghost" :disabled="busy === 'off'" @click="disconnect">Disconnect</button>
        </div>
        <p v-if="state.booksy?.error" class="field-hint orange">{{ state.booksy.error }}</p>

        <h4 class="section-label">Booksy emails (last 3 weeks)</h4>
        <div v-if="items.length" class="list">
          <div v-for="x in items" :key="x.id" class="booksy-email" :class="{ faded: x.dismissed || x.appointmentId }">
            <button class="list-row" @click="open = open === x.id ? '' : x.id">
              <div class="grow">
                <div class="title">{{ KIND[x.kind] || KIND.other }} · {{ x.data.client || x.subject }}</div>
                <div class="meta">
                  {{ [x.data.date && shortDate(x.data.date), x.data.time, x.data.service, x.data.staff].filter(Boolean).join(' · ') || x.subject }}
                  <template v-if="x.appointmentId"> · ✓ recorded</template><template v-else-if="x.dismissed"> · removed</template>
                </div>
              </div>
              <small class="muted">{{ ago(x.receivedAt) }}</small>
            </button>
            <div v-if="open === x.id" class="booksy-raw">
              <pre>{{ x.subject }}

{{ x.body }}</pre>
              <div class="report-actions">
                <button v-if="x.kind === 'new' && !x.appointmentId" class="btn small" @click="recordFromBooksy({ ...x, employeeId: booksyEmployee(x.data.staff) })">Record payment</button>
                <button v-if="x.dismissed" class="btn small ghost" @click="dismissBooksy(x.id, false)">Put back on the list</button>
                <button class="btn small ghost" @click="copy(x)">Copy text</button>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="empty" style="padding: 16px">No Booksy emails yet. Make a test booking in Booksy, then tap Check now.</div>
      </template>
    </template>
  </BaseModal>
</template>
