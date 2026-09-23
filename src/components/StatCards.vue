<script setup>
import { fmt } from '../lib/format.js'

defineProps({ t: { type: Object, required: true } })
</script>

<template>
  <div class="cards">
    <div class="stat">
      <div class="label">Total</div>
      <div class="value">{{ fmt(t.total) }}</div>
      <div class="sub">{{ t.count }} appointment{{ t.count === 1 ? '' : 's' }}</div>
    </div>
    <div class="stat paid">
      <div class="label">Paid</div>
      <div class="value">{{ fmt(t.paid) }}</div>
      <div class="sub">{{ t.paidCount }} paid</div>
    </div>
    <div class="stat unpaid">
      <div class="label">Unpaid</div>
      <div class="value">{{ fmt(t.unpaid) }}</div>
      <div class="sub">{{ t.unpaidCount }} unpaid</div>
    </div>
  </div>
  <div class="cards">
    <div class="stat"><div class="label">Cash</div><div class="value cash">{{ fmt(t.Cash) }}</div></div>
    <div class="stat"><div class="label">Card</div><div class="value card">{{ fmt(t.Card) }}</div></div>
    <div class="stat"><div class="label">EFT</div><div class="value eft">{{ fmt(t.EFT) }}</div></div>
  </div>
</template>
