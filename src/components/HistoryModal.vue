<script setup>
/**
 * Every change made through the app (from the sheet's History tab), grouped by day.
 * "Undo" rolls back that change and everything after it; "Undo today" rolls back the whole day.
 */
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import Icon from './Icon.vue'
import { state, closeModal, rollbackTo } from '../store.js'
import { todayStr } from '../lib/format.js'

const busy = ref(false)
const DAYS = 30

const localDate = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const time = (iso) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
const who = (email) => {
  const n = (email || '').split('@')[0].split(/[._\d]/)[0]
  return n ? n[0].toUpperCase() + n.slice(1) : ''
}

const entries = computed(() => {
  const cutoff = Date.now() - DAYS * 864e5
  return (state.history || []).filter((e) => Date.parse(e.time) >= cutoff)
})
const groups = computed(() => {
  const today = todayStr()
  const yesterday = localDate(new Date(Date.now() - 864e5).toISOString())
  const out = []
  for (const e of entries.value) {
    const day = localDate(e.time)
    let g = out[out.length - 1]
    if (!g || g.day !== day) {
      const label = day === today ? 'Today' : day === yesterday ? 'Yesterday'
        : new Date(e.time).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })
      g = { day, label, items: [] }
      out.push(g)
    }
    g.items.push(e)
  }
  return out
})
const todayAll = computed(() => entries.value.filter((e) => localDate(e.time) === todayStr()))
const todays = computed(() => todayAll.value.filter((e) => !e.undoneAt))
// Rolling back to the day's first change puts everything back as it was this morning.
const oldestToday = computed(() => (todays.value.length ? todayAll.value[todayAll.value.length - 1] : null))

/** How many changes an undo from this entry would roll back. */
const countFrom = (e) => entries.value.filter((x) => !x.undoneAt && x.time >= e.time).length

async function undo(e, whole = false) {
  const n = countFrom(e)
  const msg = whole
    ? `Undo all ${n} change${n === 1 ? '' : 's'} made today?`
    : n === 1
      ? `Undo "${e.summary}"?`
      : `Undo "${e.summary}" and the ${n - 1} change${n === 2 ? '' : 's'} made after it?`
  if (!confirm(msg)) return
  busy.value = true
  await rollbackTo(e.id)
  busy.value = false
}

const ICONS = { add: 'plus', edit: 'receipt', delete: 'close', update: 'check', clients: 'users', team: 'users', rollback: 'undo' }
</script>

<template>
  <BaseModal title="History & undo" @close="closeModal">
    <p style="margin: -8px 0 14px; color: var(--ink-2); font-size: 14px">
      Every change is saved here. Made a mistake? Undo it — the data goes back exactly as it was.
    </p>

    <button v-if="oldestToday" class="btn wide soft" style="margin-bottom: 14px" :disabled="busy" @click="undo(oldestToday, true)">
      <Icon name="undo" :size="18" /> Undo all of today's changes ({{ todays.length }})
    </button>

    <div v-if="state.history === null" class="empty">Loading history…</div>
    <div v-else-if="!groups.length" class="empty">No changes in the last {{ DAYS }} days.</div>

    <div v-for="g in groups" :key="g.day" class="history-day">
      <div class="history-label">{{ g.label }}</div>
      <div class="list">
        <div v-for="e in g.items" :key="e.id" class="list-row history-row" :class="{ undone: e.undoneAt }">
          <div class="history-icon" :class="e.action"><Icon :name="ICONS[e.action] || 'receipt'" :size="16" :stroke="2.2" /></div>
          <div class="grow">
            <div class="title" style="white-space: normal">{{ e.summary }}</div>
            <div class="meta">{{ time(e.time) }}<template v-if="who(e.who)"> · {{ who(e.who) }}</template><template v-if="e.undoneAt"> · undone</template></div>
          </div>
          <button v-if="!e.undoneAt" class="btn small ghost" :disabled="busy" @click="undo(e)">Undo</button>
        </div>
      </div>
    </div>

    <p class="muted-note" style="text-align: center">
      Showing the last {{ DAYS }} days. Everything is also kept in the sheet's <b>History</b> tab, and Google Sheets keeps its own
      backups under <b>File → Version history</b>.
    </p>
  </BaseModal>
</template>
