<script setup>
import { computed, ref } from 'vue'
import { overtimeShare, minutesLabel } from '../lib/payroll.js'

/**
 * Overtime on an appointment: a button that opens two durations — how long the service took and how
 * much of that fell after hours — each picked as hours + minutes (quarter hours). Stored as minutes
 * (`overtime` and `length`); payroll pays the overtime share (overtime ÷ length) at the overtime rate.
 */
const props = defineProps({ form: Object, prefix: { type: String, default: 'ot' } })
const open = ref(!!props.form.overtime)
const HOURS = Array.from({ length: 13 }, (_, i) => i)
const MINS = [0, 15, 30, 45]
// Entries saved before this change hold a percentage ("50%" / "all"); shown so it isn't lost silently.
const legacyPct = computed(() => (typeof props.form.overtime === 'string' ? Math.round(overtimeShare(props.form) * 100) : null))
const minutes = computed(() => (typeof props.form.overtime === 'number' ? props.form.overtime : 0))

const split = (total) => ({ h: Math.floor((total || 0) / 60), m: (total || 0) % 60 })
const setLength = (h, m) => {
  props.form.length = Math.min(720, h * 60 + m)
  if (minutes.value > props.form.length) props.form.overtime = props.form.length
}
const setOvertime = (h, m) => { props.form.overtime = Math.min(h * 60 + m, props.form.length || 720) }
const lenH = computed({ get: () => split(props.form.length).h, set: (h) => setLength(Number(h), split(props.form.length).m) })
const lenM = computed({ get: () => split(props.form.length).m, set: (m) => setLength(split(props.form.length).h, Number(m)) })
const otH = computed({ get: () => split(minutes.value).h, set: (h) => setOvertime(Number(h), split(minutes.value).m) })
const otM = computed({ get: () => split(minutes.value).m, set: (m) => setOvertime(split(minutes.value).h, Number(m)) })
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
          <label :for="prefix + '-len-h'">Service duration</label>
          <div class="ot-hm">
            <select :id="prefix + '-len-h'" v-model="lenH" aria-label="Service hours"><option v-for="h in HOURS" :key="h" :value="h">{{ h }} h</option></select>
            <select v-model="lenM" aria-label="Service minutes"><option v-for="m in MINS" :key="m" :value="m">{{ m }} min</option></select>
          </div>
        </div>
        <div class="field">
          <label :for="prefix + '-ot-h'">Of which overtime</label>
          <div class="ot-hm">
            <select :id="prefix + '-ot-h'" v-model="otH" aria-label="Overtime hours"><option v-for="h in HOURS" :key="h" :value="h">{{ h }} h</option></select>
            <select v-model="otM" aria-label="Overtime minutes"><option v-for="m in MINS" :key="m" :value="m">{{ m }} min</option></select>
          </div>
        </div>
      </div>
      <p v-if="legacyPct != null" class="field-hint">Saved earlier as {{ legacyPct }}% overtime — pick the time to replace that.</p>
      <p v-else-if="share" class="field-hint">{{ minutesLabel(minutes) }} of {{ minutesLabel(form.length) }} · {{ share }}% of this appointment earns the overtime rate.</p>
      <p v-else class="field-hint">Overtime can't be more than the service duration.</p>
    </template>
  </div>
</template>
