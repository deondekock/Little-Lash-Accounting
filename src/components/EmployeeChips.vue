<script setup>
import { computed } from 'vue'
import { state, setEmployee } from '../store.js'

// Active employees, plus inactive ones that still have appointments in view.
const visible = computed(() => {
  const inView = new Set([...state.appts, ...(state.yearAppts || [])].map((a) => a.employeeId))
  return state.employees.filter((e) => e.active || inView.has(e.id))
})
</script>

<template>
  <div class="chips">
    <button class="chip" :class="{ active: state.employee === 'all' }" @click="setEmployee('all')">
      All employees
    </button>
    <button
      v-for="e in visible"
      :key="e.id"
      class="chip"
      :class="{ active: state.employee === e.id }"
      @click="setEmployee(e.id)"
    >
      {{ e.name }}
    </button>
  </div>
</template>
