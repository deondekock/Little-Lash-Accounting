<script setup>
/** The clients behind a team member's month numbers: new, 2nd/3rd visit, regulars, switched in / away, came back. */
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, monthFlow, employeeById, employeeColor, clients, closeModal, openClient } from '../store.js'
import { monthLabel, shortDate } from '../lib/format.js'
import { clientKey } from '../lib/stats.js'

const props = defineProps({ employeeId: String, category: { type: String, default: 'new' } })
const cat = ref(props.category)
const b = computed(() => monthFlow.value[props.employeeId] || {})
const who = computed(() => employeeById(props.employeeId)?.name || '')
const TABS = computed(() => [
  { id: 'new', label: 'New' },
  { id: 'returning', label: '2nd / 3rd' },
  { id: 'regular', label: 'Regulars' },
  { id: 'switchedIn', label: 'Switched to her' },
  { id: 'switchedOut', label: 'Moved away' },
  { id: 'lastMonthNew', label: "Last month's new" },
])
const list = computed(() => {
  const items = b.value[cat.value] || []
  if (cat.value !== 'lastMonthNew') return items
  const back = new Map([...(b.value.cameBack || []), ...(b.value.cameBackToOther || [])].map((x) => [x.name, x]))
  return items.map((x) => ({ ...x, back: back.get(x.name) }))
})
const NOTE = {
  new: 'First visit to the salon ever.',
  returning: 'Came back for a 2nd or 3rd visit — on the way to becoming a regular.',
  regular: '4th visit or more.',
  switchedIn: 'Last visit was with someone else.',
  switchedOut: 'Last saw her, but this month went to someone else.',
  lastMonthNew: `New to the salon last month — did they come back?`,
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th')
function open(x) {
  const c = clients.value.find((c) => c.key === clientKey(x.name))
  if (c) openClient(c)
}
</script>

<template>
  <BaseModal :title="`${who} · ${monthLabel(state.month).split(' ')[0]}`" @close="closeModal">
    <div class="chips" style="margin-top: -6px">
      <button v-for="t in TABS" :key="t.id" class="chip small" :class="{ active: cat === t.id }" @click="cat = t.id">
        {{ t.label }} · {{ (b[t.id] || []).length }}
      </button>
    </div>
    <p class="muted-note" style="margin: 0 0 8px !important">{{ NOTE[cat] }}</p>
    <div v-if="list.length" class="list">
      <button v-for="x in list" :key="x.name + x.date" class="list-row" @click="open(x)">
        <div class="grow">
          <div class="title">{{ x.name }}</div>
          <div class="meta">
            {{ shortDate(x.date) }} · {{ ordinal(x.visit) }} visit
            <template v-if="x.from"> · before: {{ employeeById(x.from)?.name }}</template>
            <template v-if="x.to"> · went to {{ employeeById(x.to)?.name }}</template>
          </div>
        </div>
        <span v-if="cat === 'lastMonthNew'" class="badge" :class="x.back ? 'new' : 'due'">
          {{ x.back ? (x.back.with === employeeId ? 'Came back' : `Back · ${employeeById(x.back.with)?.name}`) : 'Not yet' }}
        </span>
        <i v-else-if="x.from || x.to" class="swatch-dot" :style="{ background: employeeColor(x.from || x.to) }" />
      </button>
    </div>
    <div v-else class="empty">Nobody here this month.</div>
  </BaseModal>
</template>
