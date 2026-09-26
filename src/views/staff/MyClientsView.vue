<script setup>
import { computed, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import { clients, openMyAppointment } from '../../store.js'
import { shortDate } from '../../lib/format.js'
import { looseKey } from '../../lib/stats.js'

/** Staff: the clients she has seen, how often, and who is due back (no amounts). */
const query = ref('')
const filter = ref('all') // 'all' | 'due' | 'regulars' | 'new'
const open = ref('')
const shown = ref(60)
const counts = computed(() => ({
  all: clients.value.length,
  due: clients.value.filter((c) => c.due).length,
  regulars: clients.value.filter((c) => c.visits >= 3).length,
}))
const list = computed(() => {
  const q = looseKey(query.value)
  let out = clients.value
  if (filter.value === 'due') out = out.filter((c) => c.due)
  if (filter.value === 'regulars') out = out.filter((c) => c.visits >= 3)
  if (q) out = out.filter((c) => looseKey(c.name).includes(q))
  // Due: the ones who only just became due first (most likely to rebook).
  const by = filter.value === 'due' ? (c) => c.usualGap - c.daysSince : filter.value === 'regulars' ? (c) => c.visits : (c) => -c.daysSince
  return [...out].sort((a, b) => by(b) - by(a))
})
const ago = (d) => (d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`)
const bookFor = (c) => openMyAppointment(null, { client: c.name, service: c.service || '' })
</script>

<template>
  <div class="page">
    <div class="greeting"><div class="hello">Your <em>clients</em></div><div class="sub">{{ counts.all }} clients · {{ counts.due }} due back</div></div>
    <label class="search">
      <Icon name="search" />
      <input v-model="query" type="search" placeholder="Search your clients…" aria-label="Search your clients">
    </label>
    <div class="chips">
      <button class="chip" :class="{ active: filter === 'all' }" @click="filter = 'all'">All</button>
      <button class="chip" :class="{ active: filter === 'due' }" @click="filter = 'due'">Due for a fill · {{ counts.due }}</button>
      <button class="chip" :class="{ active: filter === 'regulars' }" @click="filter = 'regulars'">Regulars · {{ counts.regulars }}</button>
    </div>

    <div v-if="list.length" class="card" style="padding: 4px 0">
      <template v-for="c in list.slice(0, shown)" :key="c.key">
        <button class="list-row" :aria-expanded="open === c.key" @click="open = open === c.key ? '' : c.key">
          <div class="grow">
            <div class="title">{{ c.name }} <span v-if="c.due" class="tag orange-tag">Due</span></div>
            <div class="meta">
              {{ c.visits }} visit{{ c.visits === 1 ? '' : 's' }} · last {{ ago(c.daysSince) }}<template v-if="c.usualGap"> · usually every {{ c.usualGap }} days</template><template v-if="c.service"> · {{ c.service }}</template>
            </div>
          </div>
          <Icon :name="open === c.key ? 'down' : 'right'" :size="18" />
        </button>
        <div v-if="open === c.key" class="client-visits">
          <div v-for="v in c.history.slice(0, 20)" :key="v.id"><span>{{ shortDate(v.date) }} {{ v.date.slice(0, 4) }}</span><span>{{ v.service || '—' }}</span></div>
          <p v-if="c.history.length > 20" class="meta">+ {{ c.history.length - 20 }} earlier visits</p>
          <button class="btn small soft" style="margin-top: 8px" @click="bookFor(c)">+ Add an appointment for {{ c.name.split(' ')[0] }}</button>
        </div>
      </template>
      <p v-if="list.length > shown" style="text-align: center"><button class="link-btn" @click="shown += 60">Show more</button></p>
    </div>
    <div v-else class="card empty" style="padding: 18px">{{ filter === 'due' ? 'Nobody is due back right now 💕' : 'No clients found.' }}</div>
  </div>
</template>
