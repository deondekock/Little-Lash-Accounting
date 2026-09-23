<script setup>
import { computed } from 'vue'
import { state, all, setEmployee, employeeColor } from '../store.js'

// Active employees, plus inactive ones that have appointments in the selected month or year.
const visible = computed(() => {
  const m = state.month
  const y = String(state.year)
  const inView = new Set(all.value.filter((a) => a.month === m || (state.view === 'insights' && a.month.startsWith(y))).map((a) => a.employeeId))
  return state.employees.filter((e) => e.active || inView.has(e.id))
})
</script>

<template>
  <div class="chips">
    <button class="chip" :class="{ active: state.employee === 'all' }" @click="setEmployee('all')">Everyone</button>
    <button
      v-for="e in visible"
      :key="e.id"
      class="chip"
      :class="{ active: state.employee === e.id }"
      @click="setEmployee(e.id)"
    >
      <i class="swatch-dot" :style="{ background: employeeColor(e.id) }" />{{ e.name }}
    </button>
  </div>
</template>
