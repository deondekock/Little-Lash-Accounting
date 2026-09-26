<script setup>
import BaseModal from './BaseModal.vue'
import Icon from './Icon.vue'
import { state, closeModal, signOut, useDifferentSheet, refresh, openHistory, openCompany, openMove, openExport, setView } from '../store.js'
import { BACKEND } from '../config.js'

function run(fn) {
  closeModal()
  fn()
}
</script>

<template>
  <BaseModal title="Settings" @close="closeModal">
    <div class="list">
      <div class="list-row">
        <div class="avatar-btn" style="display:grid;place-items:center;flex:none">{{ (state.email || '?')[0].toUpperCase() }}</div>
        <div class="grow">
          <div class="title">{{ state.email || 'Google account' }}</div>
          <div class="meta">Signed in with Google</div>
        </div>
      </div>
      <template v-if="state.role !== 'staff'">
      <a v-if="state.spreadsheetUrl" class="list-row" :href="state.spreadsheetUrl" target="_blank" rel="noopener" style="color: inherit; text-decoration: none">
        <Icon name="external" />
        <div class="grow"><div class="title">Open the Google Sheet</div><div class="meta">All data lives here</div></div>
      </a>
      <button class="list-row" @click="openHistory()">
        <Icon name="history" />
        <div class="grow"><div class="title">History &amp; undo</div><div class="meta">See every change and roll back mistakes</div></div>
      </button>
      <button class="list-row" @click="run(() => setView('services'))">
        <Icon name="sparkle" />
        <div class="grow"><div class="title">Services &amp; prices</div><div class="meta">Add, rename, merge and price your services</div></div>
      </button>
      <button class="list-row" @click="run(() => setView('payroll', { payrollTab: 'payslips' }))">
        <Icon name="wallet" />
        <div class="grow"><div class="title">Payslips &amp; leave</div><div class="meta">Pay, PAYE, UIF and leave balances</div></div>
      </button>
      <button class="list-row" @click="openCompany()">
        <Icon name="receipt" />
        <div class="grow"><div class="title">Company details</div><div class="meta">Shown on payslips</div></div>
      </button>
      <button class="list-row" @click="openExport()">
        <Icon name="external" />
        <div class="grow"><div class="title">Download data</div><div class="meta">Appointments, team, payslips… as Excel/CSV files</div></div>
      </button>
      <button v-if="BACKEND === 'sheets'" class="list-row" @click="openMove()">
        <Icon name="swap" />
        <div class="grow"><div class="title">Move data to Cloudflare</div><div class="meta">Copy everything to the new database and compare</div></div>
      </button>
      </template>
      <button class="list-row" @click="run(refresh)">
        <Icon name="refresh" />
        <div class="grow"><div class="title">Refresh</div><div class="meta">Load changes made on another phone</div></div>
      </button>
      <div v-if="state.role !== 'staff'" class="list-row">
        <Icon name="calendar" />
        <div class="grow"><div class="title">Months start on day {{ state.monthStartDay }}</div><div v-if="BACKEND === 'sheets'" class="meta">Change it in the sheet's Settings tab</div></div>
      </div>
      <button v-if="BACKEND === 'sheets'" class="list-row" @click="run(useDifferentSheet)">
        <Icon name="swap" />
        <div class="grow"><div class="title">Use a different sheet</div></div>
      </button>
      <button class="list-row" @click="run(signOut)">
        <Icon name="logout" />
        <div class="grow"><div class="title">Sign out</div></div>
      </button>
    </div>
  </BaseModal>
</template>
