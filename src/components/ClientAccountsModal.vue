<script setup>
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, clients, closeModal, linkClient, toastUndo, fail } from '../store.js'
import { looseKey } from '../lib/stats.js'
import { shortDate } from '../lib/format.js'

/**
 * Owner: clients who signed up on the booking page. Link each to the name her past visits are under,
 * so her history (and paid / unpaid) shows on her page — and new visits link by themselves.
 */
const busy = ref('')
const search = ref({})
const accounts = computed(() => [...state.clients].sort((a, b) => (!!a.clientKey - !!b.clientKey) || (b.createdAt || '').localeCompare(a.createdAt || '')))
const byKey = computed(() => new Map(clients.value.map((c) => [c.key, c])))
const linked = (a) => (a.clientKey ? byKey.value.get(a.clientKey) : null)
const taken = computed(() => new Set(state.clients.map((a) => a.clientKey).filter(Boolean)))

/** Past clients that look like her: same name first, then same first name + surname start, then the search. */
function matches(a) {
  const q = looseKey(search.value[a.id] || '')
  const name = looseKey(a.name)
  const first = looseKey((a.name || '').split(' ')[0])
  const pool = clients.value.filter((c) => !taken.value.has(c.key))
  const scored = pool.map((c) => {
    const k = looseKey(c.name)
    const score = q ? (k.includes(q) ? 3 : 0) : k === name ? 3 : first && k.startsWith(first) ? (name.slice(first.length, first.length + 1) && k.includes(name.slice(first.length, first.length + 3)) ? 2 : 1) : 0
    return { c, score }
  }).filter((x) => x.score > 0)
  return scored.sort((x, y) => y.score - x.score || y.c.visits - x.c.visits).slice(0, 5).map((x) => x.c)
}

async function link(a, c) {
  busy.value = a.id
  try {
    await linkClient(a.id, c ? c.name : '')
    toastUndo(c ? `Linked to ${c.name}` : 'Unlinked')
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <BaseModal title="Online clients" @close="closeModal">
    <p class="muted-note" style="margin-top: -6px">
      Clients who signed up on the booking page. Link each one to her name in your client list, so she sees her past
      visits (and what's still to pay) on her page.
    </p>
    <div v-if="!accounts.length" class="empty" style="padding: 18px">Nobody has signed up yet.</div>
    <div v-for="a in accounts" :key="a.id" class="import-card acct">
      <div class="acct-head">
        <div><b>{{ a.name || '(no name yet)' }}</b><small>{{ a.email }}{{ a.phone ? ' · ' + a.phone : '' }} · since {{ a.createdAt ? shortDate(a.createdAt.slice(0, 10)) : '' }}</small></div>
      </div>
      <template v-if="linked(a)">
        <div class="acct-linked">✅ Linked to <b>{{ linked(a).name }}</b> · {{ linked(a).visits }} visits
          <button class="link-btn" :disabled="busy === a.id" @click="link(a, null)">Unlink</button></div>
      </template>
      <template v-else>
        <div class="acct-linked orange">Not linked yet{{ a.clientKey ? '' : '' }}</div>
        <div class="acct-matches">
          <button v-for="c in matches(a)" :key="c.key" class="chip small" :disabled="busy === a.id" @click="link(a, c)">
            {{ c.name }} · {{ c.visits }} visit{{ c.visits === 1 ? '' : 's' }}
          </button>
          <span v-if="!matches(a).length" class="meta">No match found — search below, or leave it if she's new.</span>
        </div>
        <input v-model="search[a.id]" class="acct-search" placeholder="Search your clients…" :aria-label="`Search clients for ${a.name}`">
      </template>
    </div>
  </BaseModal>
</template>
