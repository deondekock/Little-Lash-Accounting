<script setup>
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import { state, serviceCatalog, openService, openServiceMerge, setView, employeeColor, importPastServices, toastUndo, fail } from '../store.js'
import { fmt0, shortDate } from '../lib/format.js'
import { looseKey, findServiceDuplicates, priceRange, servicePrice } from '../lib/stats.js'

const query = ref('')
const filter = ref('all') // 'all' | employee id | 'dupes' | 'hidden'
const shown = ref(60)
const importing = ref(false)

const dupes = computed(() => findServiceDuplicates(serviceCatalog.value))
const notLinked = computed(() => serviceCatalog.value.filter((s) => !s.inList))
const hidden = computed(() => serviceCatalog.value.filter((s) => !s.active))

// A team member's services: ones she has done, or has a price for.
const doneBy = (s, id) => s.countBy?.[id] || (s.prices?.[id] != null ? 0.5 : 0)
const people = computed(() =>
  state.employees
    .map((e) => ({ ...e, n: serviceCatalog.value.filter((s) => s.active && doneBy(s, e.id)).length }))
    .filter((e) => e.active || e.n)
    .sort((a, b) => (b.active - a.active) || b.n - a.n),
)
const person = computed(() => state.employees.find((e) => e.id === filter.value))

const list = computed(() => {
  const q = looseKey(query.value)
  let out = serviceCatalog.value
  if (filter.value === 'hidden') out = hidden.value
  else {
    out = out.filter((s) => s.active)
    if (person.value) out = out.filter((s) => doneBy(s, person.value.id))
  }
  if (q) out = out.filter((s) => looseKey(s.name).includes(q))
  const by = person.value ? (s) => doneBy(s, person.value.id) : (s) => s.count
  return [...out].sort((a, b) => by(b) - by(a) || a.name.localeCompare(b.name))
})

/** Price shown on the right: hers when a team member is picked, else the range across the team. */
function priceLabel(s) {
  if (person.value) {
    const v = servicePrice(s, person.value.id)
    const own = s.prices?.[person.value.id] != null || s.price != null
    return { value: v != null ? fmt0(v) : '—', note: v == null ? '' : own ? 'her price' : 'usually' }
  }
  const r = priceRange(s)
  if (r) return { value: r.min === r.max ? fmt0(r.min) : `${fmt0(r.min)} – ${r.max}`, note: r.min === r.max ? 'price' : 'by team member' }
  if (s.typical != null) return { value: fmt0(s.typical), note: 'usually' }
  return { value: '—', note: '' }
}
function meta(s) {
  const id = person.value?.id
  const n = id ? s.countBy?.[id] || 0 : s.count
  const last = id ? s.lastBy?.[id] : s.last
  const parts = [n ? `${n}× done` : 'not done yet']
  if (last) parts.push(`last ${shortDate(last)} ${last.slice(0, 4)}`)
  if (!id) {
    const who = Object.keys(s.countBy || {}).map((eid) => state.employees.find((e) => e.id === eid)?.name).filter(Boolean)
    if (who.length) parts.push(who.slice(0, 3).join(', ') + (who.length > 3 ? '…' : ''))
  }
  return parts.join(' · ')
}

async function linkAll() {
  if (!confirm(`Add all ${notLinked.value.length} past services to your list, each linked to the team members who did them at their usual price?`)) return
  importing.value = true
  try {
    const n = await importPastServices()
    toastUndo(`${n} services linked to the team`)
  } catch (err) {
    fail(err)
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="page">
    <button class="link-btn" style="display: inline-flex; align-items: center; gap: 4px; margin-bottom: 6px" @click="setView('team')">
      <Icon name="left" :size="16" /> Team
    </button>
    <div class="greeting" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 12px">
      <div>
        <div class="hello">Services <em>&amp; prices</em></div>
        <div class="sub">{{ serviceCatalog.filter((s) => s.active).length }} services · tap one to set prices</div>
      </div>
      <button class="btn small soft" @click="openService()"><Icon name="plus" :size="16" /> Add</button>
    </div>

    <div v-if="notLinked.length" class="card link-card">
      <div class="grow">
        <b>{{ notLinked.length }} past services aren't on your list yet</b>
        <div class="meta">Link them to the team members who did them, at their usual prices — in one tap. You can undo it.</div>
      </div>
      <button class="btn small" :disabled="importing" @click="linkAll">{{ importing ? 'Linking…' : 'Link all' }}</button>
    </div>

    <label class="search" style="margin-top: 14px">
      <Icon name="search" />
      <input v-model="query" type="search" placeholder="Search services…" aria-label="Search services">
    </label>
    <div class="chips">
      <button class="chip" :class="{ active: filter === 'all' }" @click="filter = 'all'; shown = 60">Everyone</button>
      <button v-for="e in people" :key="e.id" class="chip" :class="{ active: filter === e.id }" @click="filter = e.id; shown = 60">
        <i class="swatch-dot" :style="{ background: employeeColor(e.id) }" />{{ e.name }} · {{ e.n }}
      </button>
      <button class="chip" :class="{ active: filter === 'dupes' }" @click="filter = 'dupes'">Possible duplicates · {{ dupes.length }}</button>
      <button v-if="hidden.length" class="chip" :class="{ active: filter === 'hidden' }" @click="filter = 'hidden'">Hidden · {{ hidden.length }}</button>
    </div>

    <p v-if="person && !list.length" class="sub" style="color: var(--ink-2); font-size: 13.5px; margin: 0 0 12px">
      No services recorded for {{ person.name }} yet. They'll appear here as her appointments are added with services — or open a service and give her a price.
    </p>

    <template v-if="filter === 'dupes'">
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

    <div v-else-if="list.length" class="card" style="padding: 4px 16px">
      <div class="list">
        <button v-for="s in list.slice(0, shown)" :key="s.key" class="list-row" @click="openService(s)">
          <div class="history-icon" :style="person ? { background: employeeColor(person.id), color: '#fff' } : s.inList ? '' : 'background: var(--line); color: var(--ink-2)'">
            <Icon :name="s.inList ? 'sparkle' : 'clock'" :size="16" />
          </div>
          <div class="grow">
            <div class="title">{{ s.name }}<span v-if="!s.active" class="tag">hidden</span></div>
            <div class="meta">{{ meta(s) }}</div>
          </div>
          <div class="right">
            <div class="big">{{ priceLabel(s).value }}</div>
            <div class="meta">{{ priceLabel(s).note }}</div>
          </div>
        </button>
      </div>
    </div>
    <p v-if="filter !== 'dupes' && list.length > shown" style="text-align: center; margin-top: 14px">
      <button class="btn ghost small" @click="shown += 60">Show more ({{ list.length - shown }} left)</button>
    </p>
  </div>
</template>
