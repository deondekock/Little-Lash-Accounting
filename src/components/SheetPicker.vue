<script setup>
import { ref } from 'vue'
import { state, openSheet, createSheet } from '../store.js'

const link = ref('')
const busy = ref(false)

async function run(fn) {
  busy.value = true
  await fn()
  busy.value = false
}
</script>

<template>
  <div class="card welcome-card">
    <h2>Which Google Sheet?</h2>
    <p>Paste the link to your <b>Little Lash Lounge Payments</b> sheet. You only need to do this once on each device.</p>
    <form @submit.prevent="run(() => openSheet(link))">
      <div class="field">
        <input v-model="link" placeholder="https://docs.google.com/spreadsheets/d/…" required>
      </div>
      <button class="btn wide" :disabled="busy">{{ busy ? 'Opening…' : 'Use this sheet' }}</button>
    </form>
    <p class="muted-note">Starting fresh?</p>
    <button class="btn ghost wide" :disabled="busy" @click="run(createSheet)">Create a new sheet in my Google Drive</button>
    <p v-if="state.email" class="muted-note">Signed in as {{ state.email }}</p>
  </div>
</template>
