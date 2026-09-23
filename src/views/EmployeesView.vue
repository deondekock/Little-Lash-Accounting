<script setup>
import { computed, ref } from 'vue'
import { byEmployee, fmt, initials, monthLabel } from '../lib/format.js'
import { state, openEmployee, setEmployee, setView, signOut, useDifferentSheet } from '../store.js'

const showInactive = ref(false)

const monthTotals = computed(() => new Map(byEmployee(state.appts, state.employees).map((r) => [r.id, r.t])))
const list = computed(() => state.employees.filter((e) => e.active || showInactive.value))
const inactiveCount = computed(() => state.employees.filter((e) => !e.active).length)

function view(id) {
  setEmployee(id)
  setView('payments')
}
</script>

<template>
  <div class="section-title first">
    <span>Employees</span>
    <button class="btn small" @click="openEmployee()">+ Add employee</button>
  </div>

  <div class="panel">
    <div v-for="e in list" :key="e.id" class="emp-row" :class="{ inactive: !e.active }">
      <div class="avatar">{{ initials(e.name) }}</div>
      <div class="grow">
        <div class="name">
          {{ e.name }}<span v-if="!e.active" class="tag">inactive</span>
        </div>
        <div class="meta">
          <template v-if="e.phone">{{ e.phone }} · </template>
          {{ monthLabel(state.month) }}:
          <template v-if="monthTotals.get(e.id)">
            {{ fmt(monthTotals.get(e.id).total) }}
            (<span class="orange">{{ fmt(monthTotals.get(e.id).unpaid) }} unpaid</span>)
          </template>
          <template v-else>no appointments</template>
        </div>
      </div>
      <button class="btn small ghost" @click="view(e.id)">View</button>
      <button class="btn small ghost" @click="openEmployee(e)">Edit</button>
    </div>
    <div v-if="!list.length" class="empty">No employees yet.</div>
  </div>

  <p v-if="inactiveCount" class="center">
    <button class="link-btn" @click="showInactive = !showInactive">
      {{ showInactive ? 'Hide' : 'Show' }} {{ inactiveCount }} inactive employee{{ inactiveCount === 1 ? '' : 's' }}
    </button>
  </p>

  <div class="section-title">Account</div>
  <div class="panel account">
    <div class="meta">Signed in as <b>{{ state.email || 'Google account' }}</b></div>
    <div class="meta">Business months start on day {{ state.monthStartDay }} (change it in the sheet's Settings tab)</div>
    <div class="account-actions">
      <a class="btn small ghost" :href="state.spreadsheetUrl" target="_blank" rel="noopener">Open Google Sheet</a>
      <button class="btn small ghost" @click="useDifferentSheet">Use a different sheet</button>
      <button class="btn small ghost" @click="signOut">Sign out</button>
    </div>
  </div>
</template>
