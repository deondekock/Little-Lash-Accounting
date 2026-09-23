<script setup>
import { fmt0 as fmt } from '../lib/format.js'

defineProps({ t: { type: Object, required: true } })
</script>

<template>
  <div class="stats">
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
  <div class="stats" style="margin-top: 10px">
    <div v-for="(m, i) in ['Cash', 'Card', 'EFT']" :key="m" class="stat">
      <div class="label"><i class="swatch-dot" :style="{ background: `var(--series-${i + 1})` }" />{{ m }}</div>
      <div class="value">{{ fmt(t[m]) }}</div>
    </div>
  </div>
</template>
