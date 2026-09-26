<script setup>
import { computed } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, closeModal, viewAs, employeeColor } from '../store.js'
import { initials } from '../lib/format.js'

/** Owner: pick a team member to see the app as she sees it. */
const people = computed(() => state.employees.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name)))
</script>

<template>
  <BaseModal title="View the app as…" @close="closeModal">
    <p class="muted-note" style="margin-top: -6px">
      See exactly what she sees. Anything you do there really happens as her (it's marked as you in History).
      Tap "Back to my view" at the top to come back.
    </p>
    <div class="list">
      <button v-for="e in people" :key="e.id" class="list-row" @click="viewAs(e)">
        <div class="avatar sm" :style="{ background: employeeColor(e.id) }">{{ initials(e.name) }}</div>
        <div class="grow">
          <div class="title">{{ e.name }}</div>
          <div class="meta">{{ e.pay?.loginEmail ? `Signs in as ${e.pay.loginEmail}` : 'No login yet' }}</div>
        </div>
        <span class="link-btn">View</span>
      </button>
    </div>
  </BaseModal>
</template>
