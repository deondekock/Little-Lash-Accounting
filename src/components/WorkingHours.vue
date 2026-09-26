<script setup>
import { reactive, watch } from 'vue'
import { WEEKDAY_NAMES, DEFAULT_SCHEDULE } from '../lib/booking.js'

/** Working hours per weekday (Monday first), with an optional break. v-model = { "1": [["08:00","17:00"]], … } */
const model = defineModel({ type: Object, default: null })
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const start = model.value || DEFAULT_SCHEDULE
const days = reactive(ORDER.map((d) => {
  const ranges = start[d] || []
  return {
    d,
    on: ranges.length > 0,
    from: ranges[0]?.[0] || '08:00',
    to: ranges[ranges.length - 1]?.[1] || '17:00',
    breakOn: ranges.length > 1,
    breakFrom: ranges.length > 1 ? ranges[0][1] : '12:00',
    breakTo: ranges.length > 1 ? ranges[1][0] : '13:00',
  }
}))
watch(days, () => {
  const out = {}
  for (const x of days) {
    out[x.d] = !x.on ? [] : x.breakOn && x.from < x.breakFrom && x.breakFrom < x.breakTo && x.breakTo < x.to
      ? [[x.from, x.breakFrom], [x.breakTo, x.to]]
      : [[x.from, x.to]]
  }
  model.value = out
}, { deep: true, immediate: !model.value })
</script>

<template>
  <div class="hours">
    <div v-for="x in days" :key="x.d" class="hours-day" :class="{ off: !x.on }">
      <label class="hours-name"><input v-model="x.on" type="checkbox"> {{ WEEKDAY_NAMES[x.d].slice(0, 3) }}</label>
      <template v-if="x.on">
        <input v-model="x.from" type="time" step="900" :aria-label="`${WEEKDAY_NAMES[x.d]} start`">
        <span>–</span>
        <input v-model="x.to" type="time" step="900" :aria-label="`${WEEKDAY_NAMES[x.d]} end`">
        <button type="button" class="link-btn hours-break-btn" @click="x.breakOn = !x.breakOn">{{ x.breakOn ? '− break' : '+ break' }}</button>
        <div v-if="x.breakOn" class="hours-break">
          Break <input v-model="x.breakFrom" type="time" step="900" :aria-label="`${WEEKDAY_NAMES[x.d]} break start`"> –
          <input v-model="x.breakTo" type="time" step="900" :aria-label="`${WEEKDAY_NAMES[x.d]} break end`">
        </div>
      </template>
      <span v-else class="hours-offtext">Not working</span>
    </div>
  </div>
</template>
