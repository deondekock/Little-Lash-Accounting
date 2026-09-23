<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import PaymentsView from './views/PaymentsView.vue'
import EmployeesView from './views/EmployeesView.vue'
import YearView from './views/YearView.vue'
import BulkBar from './components/BulkBar.vue'
import AppointmentModal from './components/AppointmentModal.vue'
import EmployeeModal from './components/EmployeeModal.vue'
import SignInScreen from './components/SignInScreen.vue'
import SheetPicker from './components/SheetPicker.vue'
import { state, init, setView, openAppointment, refresh, openSheet, useDifferentSheet } from './store.js'

const views = { payments: PaymentsView, employees: EmployeesView, year: YearView }
const tabs = [
  { id: 'payments', label: 'Payments' },
  { id: 'employees', label: 'Employees' },
  { id: 'year', label: 'Year' },
]

// Coming back to the app after a while: pick up changes made on another device.
function onVisible() {
  if (document.visibilityState === 'visible' && state.phase === 'ready' && Date.now() - state.loadedAt > 2 * 60_000) refresh()
}
onMounted(() => {
  init()
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
const retry = () => location.reload()
</script>

<template>
  <div v-if="state.pending" class="loading" />

  <header class="top">
    <div class="wrap">
      <div class="top-row">
        <div class="brand">Little Lash <span>Lounge</span></div>
        <div v-if="state.phase === 'ready'" class="top-actions">
          <button class="icon-btn" aria-label="Refresh" title="Refresh" @click="refresh">↻</button>
          <a class="top-link" :href="state.spreadsheetUrl" target="_blank" rel="noopener">Sheet ↗</a>
        </div>
      </div>
      <nav v-if="state.phase === 'ready'" class="tabs">
        <button v-for="t in tabs" :key="t.id" :class="{ active: state.view === t.id }" @click="setView(t.id)">
          {{ t.label }}
        </button>
      </nav>
    </div>
  </header>

  <main class="wrap">
    <div v-if="state.phase === 'loading'" class="splash">Loading your payments…</div>
    <div v-else-if="state.phase === 'config'" class="panel welcome-card">
      <h2>Almost there</h2>
      <p>This copy of the app has no Google Client ID yet. Set <code>VITE_GOOGLE_CLIENT_ID</code> (see the README) and rebuild.</p>
    </div>
    <SignInScreen v-else-if="state.phase === 'signedOut'" />
    <SheetPicker v-else-if="state.phase === 'pickSheet'" />
    <div v-else-if="state.phase === 'error'" class="panel welcome-card">
      <h2>Couldn't open the sheet</h2>
      <p>Check your internet connection, and that the sheet is shared with {{ state.email || 'this Google account' }}.</p>
      <button class="btn wide" @click="retry">Try again</button>
      <button class="btn ghost wide" @click="useDifferentSheet">Use a different sheet</button>
    </div>
    <component :is="views[state.view]" v-else />
  </main>

  <template v-if="state.phase === 'ready'">
    <BulkBar v-if="state.view === 'payments' && state.selected.size" />
    <button
      v-if="state.view === 'payments' && state.employees.length"
      class="fab"
      :class="{ raised: state.selected.size }"
      @click="openAppointment()"
    >
      + Add appointment
    </button>
  </template>

  <AppointmentModal v-if="state.modal?.type === 'appointment'" :appt="state.modal.data" />
  <EmployeeModal v-if="state.modal?.type === 'employee'" :employee="state.modal.data" />

  <div v-if="state.toast" class="toast" :class="{ error: state.toast.error }">{{ state.toast.msg }}</div>
</template>
