<script setup>
/**
 * Pick a business month (year stepper + 12-month grid) or, in 'year' mode, a year.
 * Each month shows its takings so busy and quiet months stand out.
 */
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import Icon from './Icon.vue'
import { all, state, changeMonth, setYear, closeModal } from '../store.js'
import { currentMonth, monthName, monthRange, shortDate } from '../lib/format.js'
import { compactMoney } from '../lib/stats.js'

const props = defineProps({ mode: { type: String, default: 'month' } })
const isYear = props.mode === 'year'

const thisMonth = currentMonth(state.monthStartDay)
const thisYear = Number(thisMonth.slice(0, 4))

// Takings per business month, and the range of years that have data.
const perMonth = computed(() => {
  const m = new Map()
  for (const a of all.value) m.set(a.month, (m.get(a.month) || 0) + a.amount)
  return m
})
const years = computed(() => {
  const ys = [...perMonth.value.keys()].map((k) => Number(k.slice(0, 4)))
  const min = Math.min(thisYear, ...ys)
  const max = Math.max(thisYear, ...ys)
  return Array.from({ length: max - min + 1 }, (_, i) => max - i)
})
const perYear = computed(() => {
  const m = new Map()
  for (const [k, v] of perMonth.value) m.set(Number(k.slice(0, 4)), (m.get(Number(k.slice(0, 4))) || 0) + v)
  return m
})

const year = ref(isYear ? state.year : Number(state.month.slice(0, 4)))
const canPrev = computed(() => year.value > years.value[years.value.length - 1])
const canNext = computed(() => year.value < years.value[0])

const months = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const key = `${year.value}-${String(i + 1).padStart(2, '0')}`
    const r = monthRange(key, state.monthStartDay)
    return {
      key,
      name: monthName(i + 1).slice(0, 3),
      total: perMonth.value.get(key) || 0,
      range: state.monthStartDay > 1 ? `${shortDate(r.from)} – ${shortDate(r.to)}` : '',
      selected: key === state.month,
      current: key === thisMonth,
    }
  }),
)

function pickMonth(key) {
  changeMonth(key)
  closeModal()
}
function pickYear(y) {
  setYear(y)
  closeModal()
}
</script>

<template>
  <BaseModal :title="isYear ? 'Choose a year' : 'Choose a month'" @close="closeModal">
    <template v-if="!isYear">
      <div class="picker-year">
        <button class="round" aria-label="Previous year" :disabled="!canPrev" @click="year--"><Icon name="left" /></button>
        <select v-model.number="year" aria-label="Year">
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
        <button class="round" aria-label="Next year" :disabled="!canNext" @click="year++"><Icon name="right" /></button>
      </div>
      <div class="picker-grid">
        <button v-for="m in months" :key="m.key" class="picker-cell" :class="{ selected: m.selected, current: m.current, empty: !m.total }"
                :aria-pressed="m.selected" @click="pickMonth(m.key)">
          <span class="pm-name">{{ m.name }}</span>
          <span class="pm-total">{{ m.total ? compactMoney(m.total) : '—' }}</span>
        </button>
      </div>
      <p v-if="state.monthStartDay > 1" class="picker-note">Months run from the {{ state.monthStartDay }}th to the {{ state.monthStartDay - 1 }}th.</p>
      <div class="modal-actions">
        <button class="btn ghost" @click="closeModal">Cancel</button>
        <button class="btn" @click="pickMonth(thisMonth)">This month</button>
      </div>
    </template>

    <template v-else>
      <div class="picker-grid years">
        <button v-for="y in years" :key="y" class="picker-cell" :class="{ selected: y === state.year, current: y === thisYear, empty: !perYear.get(y) }"
                :aria-pressed="y === state.year" @click="pickYear(y)">
          <span class="pm-name">{{ y }}</span>
          <span class="pm-total">{{ perYear.get(y) ? compactMoney(perYear.get(y)) : '—' }}</span>
        </button>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="closeModal">Cancel</button>
        <button class="btn" @click="pickYear(thisYear)">This year</button>
      </div>
    </template>
  </BaseModal>
</template>
