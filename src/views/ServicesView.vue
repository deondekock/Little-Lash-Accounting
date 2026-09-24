<script setup>
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import { state, serviceCatalog, openService, openServiceMerge, setView } from '../store.js'
import { fmt0, shortDate } from '../lib/format.js'
import { looseKey, findServiceDuplicates, priceRange } from '../lib/stats.js'

const query = ref('')
const filter = ref('list')
const shown = ref(60)

const dupes = computed(() => findServiceDuplicates(serviceCatalog.value))
const counts = computed(() => ({
  list: serviceCatalog.value.filter((s) => s.inList && s.active).length,
  past: serviceCatalog.value.filter((s) => !s.inList).length,
  hidden: serviceCatalog.value.filter((s) => s.inList && !s.active).length,
  dupes: dupes.value.length,
}))
const FILTERS = computed(() => [
  { id: 'list', label: `Your list · ${counts.value.list}` },
  { id: 'past', label: `Used before · ${counts.value.past}` },
  { id: 'dupes', label: `Possible duplicates · ${counts.value.dupes}` },
  ...(counts.value.hidden ? [{ id: 'hidden', label: `Hidden · ${counts.value.hidden}` }] : []),
])

const list = computed(() => {
  const q = looseKey(query.value)
  let out = serviceCatalog.value
  if (q) out = out.filter((s) => looseKey(s.name).includes(q))
  else if (filter.value === 'list') out = out.filter((s) => s.inList && s.active)
  else if (filter.value === 'past') out = out.filter((s) => !s.inList)
  else if (filter.value === 'hidden') out = out.filter((s) => s.inList && !s.active)
  return [...out].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
})
/** "R 450" or "R 350 – 450" when team members charge differently; else what it usually cost. */
function priceLabel(s) {
  const r = priceRange(s)
  if (r) return { value: r.min === r.max ? fmt0(r.min) : `${fmt0(r.min)} – ${r.max}`, note: r.min === r.max ? 'price' : 'by team member' }
  if (s.typical != null) return { value: fmt0(s.typical), note: 'usually' }
  return { value: '—', note: '' }
}
const monthsAgo = (d) => (d ? shortDate(d) + ' ' + d.slice(0, 4) : 'never')
</script>

<template>
  <div class="page">
    <button class="link-btn" style="display: inline-flex; align-items: center; gap: 4px; margin-bottom: 6px" @click="setView('team')">
      <Icon name="left" :size="16" /> Team
    </button>
    <div class="greeting" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 12px">
      <div>
        <div class="hello">Services <em>&amp; prices</em></div>
        <div class="sub">What you offer, what it costs, and how often it's done.</div>
      </div>
      <button class="btn small soft" @click="openService()"><Icon name="plus" :size="16" /> Add</button>
    </div>

    <label class="search">
      <Icon name="search" />
      <input v-model="query" type="search" placeholder="Search services…" aria-label="Search services">
    </label>
    <div v-if="!query" class="chips">
      <button v-for="f in FILTERS" :key="f.id" class="chip" :class="{ active: filter === f.id }" @click="filter = f.id; shown = 60">{{ f.label }}</button>
    </div>

    <p v-if="!query && filter === 'list' && !counts.list" class="sub" style="color: var(--ink-2); font-size: 13.5px; margin: 0 0 12px">
      Your list is empty. Add the services you offer with their prices — or open <b>Used before</b> and tap one to add it.
      Services on your list show first when adding an appointment, and their price is filled in for you.
    </p>
    <p v-if="!query && filter === 'past'" class="sub" style="color: var(--ink-2); font-size: 13.5px; margin: 0 0 12px">
      Names typed on past appointments. Tap one to add it to your list (you can tidy the name and set a price).
    </p>

    <template v-if="!query && filter === 'dupes'">
      <p class="sub" style="color: var(--ink-2); margin: 0 0 12px; font-size: 13.5px">
        Names that only differ by spaces, capitals or a plural "s". Merge them so reports add up — you can undo it.
      </p>
      <div class="card" style="padding: 4px 16px">
        <div v-if="dupes.length" class="list">
          <div v-for="g in dupes" :key="g[0].key" class="list-row">
            <div class="grow">
              <div class="title" style="white-space: normal">{{ g.map((s) => s.name).join('  ·  ') }}</div>
              <div class="meta">{{ g.map((s) => `${s.count}×`).join(' · ') }}</div>
            </div>
            <button class="btn small soft" @click="openServiceMerge(g[0], { with: g.slice(1) })">Merge</button>
          </div>
        </div>
        <div v-else class="empty">No duplicates found 🎉</div>
      </div>
    </template>

    <div v-else class="card" style="padding: 4px 16px">
      <div v-if="list.length" class="list">
        <button v-for="s in list.slice(0, shown)" :key="s.key" class="list-row" @click="openService(s)">
          <div class="history-icon" :style="s.inList ? '' : 'background: var(--line); color: var(--ink-2)'"><Icon :name="s.inList ? 'sparkle' : 'clock'" :size="16" /></div>
          <div class="grow">
            <div class="title">{{ s.name }}<span v-if="s.inList && !s.active" class="tag">hidden</span></div>
            <div class="meta">{{ s.count }} time{{ s.count === 1 ? '' : 's' }} · last {{ monthsAgo(s.last) }}<template v-if="s.revenue"> · {{ fmt0(s.revenue) }} in total</template></div>
          </div>
          <div class="right">
            <div class="big">{{ priceLabel(s).value }}</div>
            <div class="meta">{{ priceLabel(s).note }}</div>
          </div>
        </button>
      </div>
      <div v-else class="empty">No services here yet.</div>
    </div>
    <p v-if="filter !== 'dupes' && list.length > shown" style="text-align: center; margin-top: 14px">
      <button class="btn ghost small" @click="shown += 60">Show more ({{ list.length - shown }} left)</button>
    </p>
  </div>
</template>
