<script setup>
/**
 * Picks a voucher's expiry as "N months after it was sold": a dropdown of months, each resolving to
 * the purchase day in that month (or the month's last day when it's shorter). v-model is the date.
 */
import { computed } from 'vue'
import { addMonths } from '../lib/vouchers.js'

const model = defineModel({ type: String, default: '' })
const props = defineProps({ soldOn: { type: String, required: true }, id: String, months: { type: Number, default: 24 } })
const longDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
const options = computed(() => {
  const out = []
  for (let n = 1; n <= props.months; n++) {
    const date = addMonths(props.soldOn, n)
    out.push({ date, label: `${n} month${n === 1 ? '' : 's'} · ${longDate(date)}` })
  }
  // A date set some other way (an older voucher, or a hand-picked one) stays selectable.
  if (model.value && !out.some((o) => o.date === model.value)) out.unshift({ date: model.value, label: longDate(model.value) })
  return out
})
</script>

<template>
  <select :id="id" v-model="model">
    <option v-for="o in options" :key="o.date" :value="o.date">{{ o.label }}</option>
  </select>
</template>
