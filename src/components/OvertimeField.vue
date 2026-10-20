<script setup>
import { computed, ref } from 'vue'
import { overtimeShare, minutesLabel } from '../lib/payroll.js'

/**
 * Overtime on an appointment: a button that opens two inputs — how long the service took and how
 * many of those minutes fell after hours. Stored as minutes (`overtime`) and minutes (`length`);
 * payroll pays the overtime share (overtime ÷ length) at the overtime rate.
 */
const props = defineProps({ form: Object, prefix: { type: String, default: 'ot' } })
const open = ref(!!props.form.overtime)
// Entries saved before this change hold a percentage ("50%" / "all"); shown so it isn't lost silently.
const legacyPct = computed(() => (typeof props.form.overtime === 'string' ? Math.round(overtimeShare(props.form) * 100) : null))
const minutes = computed(() => (typeof props.form.overtime === 'number' ? props.form.overtime : 0))

const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)))
const length = computed({
  get: () => props.form.length || '',
  set: (v) => {
    props.form.length = num(v, 720)
    if (minutes.value > props.form.length && props.form.length) props.form.overtime = props.form.length
  },
})
const overtime = computed({
  get: () => minutes.value || '',
  set: (v) => { props.form.overtime = num(v, props.form.length || 720) },
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
          <label :for="prefix + '-len'">Service duration (min)</label>
          <input :id="prefix + '-len'" v-model.lazy="length" type="number" inputmode="numeric" min="1" max="720" step="5" placeholder="e.g. 90" :required="minutes > 0">
        </div>
        <div class="field">
          <label :for="prefix + '-min'">Of which overtime (min)</label>
          <input :id="prefix + '-min'" v-model.lazy="overtime" type="number" inputmode="numeric" min="0" :max="form.length || 720" step="5" placeholder="e.g. 30">
        </div>
      </div>
      <p v-if="legacyPct != null" class="field-hint">Saved earlier as {{ legacyPct }}% overtime — type the minutes to replace that.</p>
      <p v-else-if="share" class="field-hint">{{ minutesLabel(minutes) }} of {{ minutesLabel(form.length) }} · {{ share }}% of this appointment earns the overtime rate.</p>
      <p v-else class="field-hint">Overtime can't be more than the service duration.</p>
    </template>
  </div>
</template>
