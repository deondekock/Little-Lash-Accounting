<script setup>
import { computed, ref } from 'vue'
import { overtimeShare, minutesLabel } from '../lib/payroll.js'

/**
 * Overtime on an appointment: a button that opens two durations — how long the service took and how
 * much of that fell after hours — each picked in quarter hours (0:00 … 5:00). Stored as minutes
 * (`overtime` and `length`); payroll pays the overtime share (overtime ÷ length) at the overtime rate.
 */
const props = defineProps({ form: Object, prefix: { type: String, default: 'ot' } })
const open = ref(!!props.form.overtime)
const STEPS = Array.from({ length: 21 }, (_, i) => i * 15) // 0:00 … 5:00 in quarter hours
const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
// Entries saved before this change hold a percentage ("50%" / "all"); shown so it isn't lost silently.
const legacyPct = computed(() => (typeof props.form.overtime === 'string' ? Math.round(overtimeShare(props.form) * 100) : null))
const minutes = computed(() => (typeof props.form.overtime === 'number' ? props.form.overtime : 0))
// A duration saved outside the quarter-hour steps (older entries) stays selectable until changed.
const options = (current) => (current && !STEPS.includes(current) ? [...STEPS, current].sort((a, b) => a - b) : STEPS)
const length = computed({
  get: () => props.form.length || 0,
  set: (v) => {
    props.form.length = Number(v)
    if (minutes.value > props.form.length) props.form.overtime = props.form.length
  },
})
const overtime = computed({
  get: () => minutes.value,
  set: (v) => { props.form.overtime = Math.min(Number(v), props.form.length || STEPS.at(-1)) },
})
const share = computed(() => (props.form.length && minutes.value ? Math.round(overtimeShare(props.form) * 100) : 0))

function toggle() {
  open.value = !open.value
  if (!open.value) { props.form.overtime = 0; props.form.length = 0 }
}
</script>

<template>
  <div class="field">
    <button type="button" class="btn ghost wide ot-toggle" :class="{ active: open }" :aria-expanded="open" @click="toggle">
      ⏰ {{ open ? 'Overtime — tap to remove' : 'Add overtime' }}
    </button>
    <template v-if="open">
      <div class="row2 ot-row">
        <div class="field">
          <label :for="prefix + '-len'">Service duration</label>
          <select :id="prefix + '-len'" v-model="length"><option v-for="m in options(form.length)" :key="m" :value="m">{{ hm(m) }}</option></select>
        </div>
        <div class="field">
          <label :for="prefix + '-min'">Of which overtime</label>
          <select :id="prefix + '-min'" v-model="overtime"><option v-for="m in options(minutes)" :key="m" :value="m" :disabled="m > (form.length || 0)">{{ hm(m) }}</option></select>
        </div>
      </div>
      <p v-if="legacyPct != null" class="field-hint">Saved earlier as {{ legacyPct }}% overtime — pick the time to replace that.</p>
      <p v-else-if="share" class="field-hint">{{ minutesLabel(minutes) }} of {{ minutesLabel(form.length) }} · {{ share }}% of this appointment earns the overtime rate.</p>
      <p v-else class="field-hint">Overtime can't be more than the service duration.</p>
    </template>
  </div>
</template>
