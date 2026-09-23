<script setup>
import { onMounted } from 'vue'
import PaymentsView from './views/PaymentsView.vue'
import EmployeesView from './views/EmployeesView.vue'
import YearView from './views/YearView.vue'
import BulkBar from './components/BulkBar.vue'
import AppointmentModal from './components/AppointmentModal.vue'
import EmployeeModal from './components/EmployeeModal.vue'
import { state, init, setView, openAppointment } from './store.js'

const views = { payments: PaymentsView, employees: EmployeesView, year: YearView }
const tabs = [
  { id: 'payments', label: 'Payments' },
  { id: 'employees', label: 'Employees' },
  { id: 'year', label: 'Year' },
]

onMounted(init)
</script>

<template>
  <div v-if="state.pending" class="loading" />

  <header class="top">
    <div class="wrap">
      <div class="top-row">
        <div class="brand">Little Lash <span>Lounge</span></div>
        <a v-if="state.spreadsheetUrl" class="top-link" :href="state.spreadsheetUrl" target="_blank" rel="noopener">
          Open Google Sheet ↗
        </a>
      </div>
      <nav class="tabs">
        <button v-for="t in tabs" :key="t.id" :class="{ active: state.view === t.id }" @click="setView(t.id)">
          {{ t.label }}
        </button>
      </nav>
    </div>
  </header>

  <main class="wrap">
    <div v-if="state.loadError" class="splash">Could not load your data. Please refresh the page.</div>
    <div v-else-if="!state.ready" class="splash">Loading your payments…</div>
    <component :is="views[state.view]" v-else />
  </main>

  <template v-if="state.ready">
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
