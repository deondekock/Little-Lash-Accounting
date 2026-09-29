<script setup>
import { computed, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import { clients, openMyAppointment, state } from '../../store.js'
import { shortDate } from '../../lib/format.js'
import { looseKey, ordinal } from '../../lib/stats.js'
import ClientContact from '../../components/ClientContact.vue'

/** Staff: the clients she has seen, how often, and who is due back (no amounts). */
const query = ref('')
const filter = ref(state.clientFilter === 'due' ? 'due' : 'all') // 'all' | 'due' | 'quiet' | 'regulars' | 'milestones'
const open = ref('')
const shown = ref(60)
const counts = computed(() => ({
  all: clients.value.length,
  due: clients.value.filter((c) => c.due).length,
  quiet: clients.value.filter((c) => c.quiet).length,
  milestones: clients.value.filter((c) => c.milestone).length,
  regulars: clients.value.filter((c) => c.visits >= 3).length,
}))
const list = computed(() => {
  const q = looseKey(query.value)
  let out = clients.value
  if (filter.value === 'due') out = out.filter((c) => c.due)
  if (filter.value === 'quiet') out = out.filter((c) => c.quiet)
  if (filter.value === 'milestones') out = out.filter((c) => c.milestone)
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
      <button class="chip" :class="{ active: filter === 'quiet' }" @click="filter = 'quiet'">Gone quiet · {{ counts.quiet }}</button>
      <button v-if="counts.milestones" class="chip" :class="{ active: filter === 'milestones' }" @click="filter = 'milestones'">🎉 Milestones · {{ counts.milestones }}</button>
      <button class="chip" :class="{ active: filter === 'regulars' }" @click="filter = 'regulars'">Regulars · {{ counts.regulars }}</button>
    </div>

    <p v-if="filter === 'quiet'" class="muted-note">Regulars who haven't been back to the salon in over twice their usual time.</p>
    <p v-if="filter === 'milestones'" class="muted-note">Their next visit is a milestone (10th, 25th, 50th…). Maybe plan a little treat 💕</p>
    <div v-if="list.length" class="card" style="padding: 4px 16px">
      <template v-for="c in list.slice(0, shown)" :key="c.key">
        <button class="list-row" :aria-expanded="open === c.key" @click="open = open === c.key ? '' : c.key">
          <div class="grow">
            <div class="title">
              {{ c.name }} <span v-if="c.due" class="tag orange-tag">Due</span><span v-else-if="c.quiet" class="badge quiet">Quiet</span>
              <span v-if="c.milestone" class="badge milestone">🎉 {{ ordinal(c.milestone) }} next</span>
            </div>
            <div class="meta">
              {{ c.visits }} visit{{ c.visits === 1 ? '' : 's' }}<template v-if="c.salonVisits && c.salonVisits !== c.visits"> with you ({{ c.salonVisits }} at the salon)</template> · last {{ ago(c.daysSince) }}<template v-if="c.usualGap"> · usually every {{ c.usualGap }} days</template><template v-if="c.service"> · {{ c.service }}</template>
            </div>
          </div>
          <Icon :name="open === c.key ? 'down' : 'right'" :size="18" />
        </button>
        <div v-if="open === c.key" class="client-visits">
          <ClientContact :client="c" />
          <div v-for="v in c.history.slice(0, 20)" :key="v.id"><span>{{ shortDate(v.date) }} {{ v.date.slice(0, 4) }}</span><span>{{ v.service || '—' }}</span></div>
          <p v-if="c.history.length > 20" class="meta">+ {{ c.history.length - 20 }} earlier visits</p>
          <button class="btn small soft" style="margin-top: 8px" @click="bookFor(c)">+ Add an appointment for {{ c.name.split(' ')[0] }}</button>
        </div>
      </template>
      <p v-if="list.length > shown" style="text-align: center"><button class="link-btn" @click="shown += 60">Show more</button></p>
    </div>
    <div v-if="!list.length" class="card empty" style="padding: 18px">{{ filter === 'due' ? 'Nobody is due back right now 💕' : filter === 'quiet' ? 'Nobody has gone quiet 💕' : 'No clients found.' }}</div>
  </div>
</template>
