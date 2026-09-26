<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import { todayStr } from '../lib/format.js'
import { addDays } from '../lib/booking.js'

/** Day picker: ‹ Today › with the phone's date picker on the label. v-model = 'YYYY-MM-DD'. */
const day = defineModel({ type: String, required: true })
const props = defineProps({ max: String }) // e.g. today for staff payments
const today = todayStr()
const label = computed(() => {
  if (day.value === today) return 'Today'
  if (day.value === addDays(today, -1)) return 'Yesterday'
  if (day.value === addDays(today, 1)) return 'Tomorrow'
  return new Date(day.value + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'long' })
})
const long = computed(() => new Date(day.value + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }))
const go = (n) => {
  const next = addDays(day.value, n)
  day.value = props.max && next > props.max ? props.max : next
}
const pick = (e) => e.target.value && (day.value = props.max && e.target.value > props.max ? props.max : e.target.value)
</script>

<template>
  <div class="day-nav">
    <button class="icon-btn" aria-label="Previous day" @click="go(-1)"><Icon name="left" /></button>
    <label class="day-pick">
      <b>{{ label }}</b><small>{{ long }}</small>
      <input type="date" :value="day" :max="max" aria-label="Choose a day" @change="pick">
    </label>
    <button class="icon-btn" aria-label="Next day" :disabled="!!max && day >= max" @click="go(1)"><Icon name="right" /></button>
  </div>
  <p v-if="day !== today" class="day-back"><button class="link-btn" @click="day = today">Back to today</button></p>
</template>
