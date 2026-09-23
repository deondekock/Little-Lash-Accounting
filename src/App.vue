<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import HomeView from './views/HomeView.vue'
import PaymentsView from './views/PaymentsView.vue'
import ClientsView from './views/ClientsView.vue'
import TeamView from './views/TeamView.vue'
import InsightsView from './views/InsightsView.vue'
import ServicesView from './views/ServicesView.vue'
import ServiceModal from './components/ServiceModal.vue'
import ServiceMergeModal from './components/ServiceMergeModal.vue'
import BulkBar from './components/BulkBar.vue'
import AppointmentModal from './components/AppointmentModal.vue'
import EmployeeModal from './components/EmployeeModal.vue'
import ClientModal from './components/ClientModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import MonthPicker from './components/MonthPicker.vue'
import MergeModal from './components/MergeModal.vue'
import HistoryModal from './components/HistoryModal.vue'
import SignInScreen from './components/SignInScreen.vue'
import SheetPicker from './components/SheetPicker.vue'
import Icon from './components/Icon.vue'
import { state, init, setView, refresh, useDifferentSheet, openSettings, openHistory } from './store.js'

const views = { home: HomeView, payments: PaymentsView, clients: ClientsView, team: TeamView, insights: InsightsView, services: ServicesView }
const tabs = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'payments', label: 'Payments', icon: 'receipt' },
  { id: 'clients', label: 'Clients', icon: 'heart' },
  { id: 'team', label: 'Team', icon: 'users' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
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
    <div class="wrap top-row">
      <div class="wordmark">Little Lash <em>Lounge</em></div>
      <div v-if="state.phase === 'ready'" class="top-actions">
        <button class="icon-btn" aria-label="History and undo" title="History & undo" @click="openHistory"><Icon name="history" /></button>
        <button class="icon-btn" aria-label="Refresh" title="Refresh" @click="refresh"><Icon name="refresh" /></button>
        <button class="avatar-btn" aria-label="Settings" @click="openSettings">{{ (state.email || '•')[0].toUpperCase() }}</button>
      </div>
    </div>
  </header>

  <main class="wrap">
    <div v-if="state.phase === 'loading'" class="splash">Loading your salon…</div>
    <div v-else-if="state.phase === 'config'" class="card welcome-card">
      <h2>Almost there</h2>
      <p>This copy of the app has no Google Client ID yet. Set <code>VITE_GOOGLE_CLIENT_ID</code> (see the README) and rebuild.</p>
    </div>
    <SignInScreen v-else-if="state.phase === 'signedOut'" />
    <SheetPicker v-else-if="state.phase === 'pickSheet'" />
    <div v-else-if="state.phase === 'error'" class="card welcome-card">
      <h2>Couldn't open the sheet</h2>
      <p>Check your internet connection, and that the sheet is shared with {{ state.email || 'this Google account' }}.</p>
      <button class="btn wide" @click="retry">Try again</button>
      <button class="btn ghost wide" style="margin-top: 10px" @click="useDifferentSheet">Use a different sheet</button>
    </div>
    <component :is="views[state.view]" v-else />
  </main>

  <template v-if="state.phase === 'ready'">
    <BulkBar v-if="state.view === 'payments' && state.selected.size" />
    <nav class="bottom-nav" aria-label="Main">
      <div class="wrap">
        <button v-for="t in tabs" :key="t.id" :class="{ active: state.view === t.id || (t.id === 'team' && state.view === 'services') }" :aria-current="state.view === t.id ? 'page' : null" @click="setView(t.id)">
          <Icon :name="t.icon" :size="22" :stroke="state.view === t.id ? 2.2 : 1.8" />
          {{ t.label }}
        </button>
      </div>
    </nav>
  </template>

  <AppointmentModal v-if="state.modal?.type === 'appointment'" :appt="state.modal.data" :prefill="state.modal.prefill" />
  <EmployeeModal v-if="state.modal?.type === 'employee'" :employee="state.modal.data" />
  <ClientModal v-if="state.modal?.type === 'client'" :client="state.modal.data" />
  <SettingsModal v-if="state.modal?.type === 'settings'" />
  <MonthPicker v-if="state.modal?.type === 'picker'" :mode="state.modal.data.mode" />
  <MergeModal v-if="state.modal?.type === 'merge'" :key="state.modal.data.client.key" :client="state.modal.data.client" :with="state.modal.data.with" :mode="state.modal.data.mode" />
  <HistoryModal v-if="state.modal?.type === 'history'" />
  <ServiceModal v-if="state.modal?.type === 'service'" :service="state.modal.data" />
  <ServiceMergeModal v-if="state.modal?.type === 'serviceMerge'" :key="state.modal.data.service.key" :service="state.modal.data.service" :with="state.modal.data.with" />

  <div v-if="state.toast" class="toast" :class="{ error: state.toast.error, actionable: state.toast.action }" role="status">
    {{ state.toast.msg }}
    <button v-if="state.toast.action" class="toast-action" @click="state.toast.action.run(); state.toast = null">{{ state.toast.action.label }}</button>
  </div>
</template>
