<script setup>
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import { all, state, employeeColor, openClient, openAppointment } from '../store.js'
import { buildClients } from '../lib/stats.js'
import { fmt, fmt0, initials, shortDate } from '../lib/format.js'

const query = ref('')
const shown = ref(50)
const clients = computed(() => buildClients(all.value))
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'due', label: 'Due for refill' },
  { id: 'regulars', label: 'Regulars' },
  { id: 'new', label: 'New this month' },
]

const list = computed(() => {
  const q = query.value.trim().toLowerCase()
  let out = clients.value
  if (q) out = out.filter((c) => c.key.includes(q))
  else if (state.clientFilter === 'due') out = out.filter((c) => c.due)
  else if (state.clientFilter === 'regulars') out = out.filter((c) => c.visits >= 5 && c.daysSince <= 120)
  else if (state.clientFilter === 'new') out = out.filter((c) => c.history[c.history.length - 1].month === state.month)
  const sortKey = state.clientFilter === 'due' && !q ? (c) => -c.visits : (c) => (c.last < '' ? 0 : -Date.parse(c.last))
  return [...out].sort((a, b) => sortKey(a) - sortKey(b))
})

const counts = computed(() => ({
  all: clients.value.length,
  due: clients.value.filter((c) => c.due).length,
  regulars: clients.value.filter((c) => c.visits >= 5 && c.daysSince <= 120).length,
}))

const ago = (d) => (d < 0 ? 'booked ahead' : d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`)
</script>

<template>
  <div class="page">
    <div class="greeting" style="margin-bottom: 12px">
      <div class="hello">Your <em>clients</em></div>
      <div class="sub">{{ counts.all.toLocaleString('en-ZA') }} clients · {{ counts.regulars }} regulars</div>
    </div>

    <label class="search">
      <Icon name="search" />
      <input v-model="query" type="search" placeholder="Search a client…" aria-label="Search clients">
    </label>

    <div v-if="!query" class="chips">
      <button v-for="f in FILTERS" :key="f.id" class="chip" :class="{ active: state.clientFilter === f.id }" @click="state.clientFilter = f.id">
        {{ f.label }}<template v-if="f.id === 'due' && counts.due"> · {{ counts.due }}</template>
      </button>
    </div>

    <p v-if="state.clientFilter === 'due' && !query" class="sub" style="color: var(--ink-2); margin: 0 0 12px; font-size: 13.5px">
      Regulars who are past their usual time between visits — a friendly WhatsApp might bring them back. 💌
    </p>

    <div class="card" style="padding: 4px 16px">
      <div v-if="list.length" class="list">
        <button v-for="c in list.slice(0, shown)" :key="c.key" class="list-row" @click="openClient(c)">
          <div class="avatar sm" :style="{ background: employeeColor(c.staffId) }">{{ initials(c.name) }}</div>
          <div class="grow">
            <div class="title">
              {{ c.name }}
              <span v-if="c.due" class="badge due">Due</span>
              <span v-else-if="c.visits === 1 && c.daysSince < 40" class="badge new">New</span>
            </div>
            <div class="meta">{{ c.visits }} visit{{ c.visits === 1 ? '' : 's' }} · last {{ ago(c.daysSince) }}<template v-if="c.service"> · {{ c.service }}</template></div>
          </div>
          <div class="right">
            <div class="big">{{ fmt0(c.spend) }}</div>
            <div class="meta">{{ shortDate(c.last) }}</div>
          </div>
        </button>
      </div>
      <div v-else class="empty">No clients found.</div>
    </div>
    <p v-if="list.length > shown" style="text-align: center; margin-top: 14px">
      <button class="btn ghost small" @click="shown += 50">Show more ({{ list.length - shown }} left)</button>
    </p>
  </div>

  <button class="fab" @click="openAppointment()"><Icon name="plus" :stroke="2.4" /> Add</button>
</template>
