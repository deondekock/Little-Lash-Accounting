<script setup>
import { METHODS } from '../lib/format.js'
import { state, updateMany, toastUndo } from '../store.js'
import Icon from './Icon.vue'

async function apply(changes, message) {
  const ids = [...state.selected]
  if (await updateMany(ids, changes)) {
    toastUndo(message(ids.length))
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
    <div class="row">
      <span class="count">{{ state.selected.size }} selected</span>
      <button class="btn small paid" @click="apply({ status: 'Paid' }, (n) => n + ' marked paid')"><Icon name="check" :size="15" :stroke="2.6" />Paid</button>
      <button class="btn small" @click="apply({ status: 'Unpaid' }, (n) => n + ' marked unpaid')">Unpaid</button>
      <select aria-label="Set payment method" @change="setMethod">
        <option value="">Method…</option>
        <option v-for="m in METHODS" :key="m">{{ m }}</option>
      </select>
      <button class="btn small" aria-label="Clear selection" @click="state.selected.clear()"><Icon name="close" :size="15" /></button>
    </div>
  </div>
</template>
