<script setup>
import { METHODS } from '../lib/format.js'
import { state, updateMany, toast } from '../store.js'

async function apply(changes, message) {
  const ids = [...state.selected]
  if (await updateMany(ids, changes)) {
    toast(message(ids.length))
    state.selected.clear()
  }
}

function setMethod(e) {
  const method = e.target.value
  e.target.value = ''
  if (method) apply({ method }, () => 'Set to ' + method)
}
</script>

<template>
  <div class="bulk">
    <div class="wrap">
      <span class="count">{{ state.selected.size }} selected</span>
      <button class="btn small paid" @click="apply({ status: 'Paid' }, (n) => n + ' marked paid')">Mark paid</button>
      <button class="btn small" @click="apply({ status: 'Unpaid' }, (n) => n + ' marked unpaid')">Mark unpaid</button>
      <select aria-label="Set payment method" @change="setMethod">
        <option value="">Set method…</option>
        <option v-for="m in METHODS" :key="m">{{ m }}</option>
      </select>
      <button class="btn small" aria-label="Clear selection" @click="state.selected.clear()">✕</button>
    </div>
  </div>
</template>
