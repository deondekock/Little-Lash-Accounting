<script setup>
import { computed } from 'vue'
import { emptyTotals, fmt } from '../lib/format.js'

/** rows: [{ key, label, t, muted?, color? }] — one line per employee or per month. The table view of each chart. */
const props = defineProps({
  rows: { type: Array, required: true },
  heading: { type: String, default: 'Employee' },
  footerLabel: { type: String, default: 'All' },
  alwaysFooter: Boolean,
})
defineEmits(['select'])

const sum = computed(() => {
  const s = emptyTotals()
  for (const r of props.rows) for (const k in s) s[k] += r.t[k]
  return s
})
</script>

<template>
  <div class="card table-card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ heading }}</th><th>Appts</th><th>Total</th><th>Paid</th><th>Unpaid</th>
            <th>Cash</th><th>Card</th><th>EFT</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.key" class="clickable" :class="{ muted: r.muted }" @click="$emit('select', r.key)">
            <td><i v-if="r.color" class="swatch-dot" :style="{ background: r.color, marginRight: '8px' }" /><b>{{ r.label }}</b></td>
            <td>{{ r.t.count }}</td>
            <td><b>{{ fmt(r.t.total) }}</b></td>
            <td class="green">{{ fmt(r.t.paid) }}</td>
            <td class="orange">{{ fmt(r.t.unpaid) }}</td>
            <td>{{ fmt(r.t.Cash) }}</td>
            <td>{{ fmt(r.t.Card) }}</td>
            <td>{{ fmt(r.t.EFT) }}</td>
          </tr>
        </tbody>
        <tfoot v-if="alwaysFooter || rows.length > 1">
          <tr>
            <td>{{ footerLabel }}</td>
            <td>{{ sum.count }}</td>
            <td>{{ fmt(sum.total) }}</td>
            <td class="green">{{ fmt(sum.paid) }}</td>
            <td class="orange">{{ fmt(sum.unpaid) }}</td>
            <td>{{ fmt(sum.Cash) }}</td>
            <td>{{ fmt(sum.Card) }}</td>
            <td>{{ fmt(sum.EFT) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>
