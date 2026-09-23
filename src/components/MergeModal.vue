<script setup>
/**
 * Merge clients into one name, or rename a client. Every appointment of the chosen
 * clients gets the same name (logged in History, so it can be undone).
 */
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import Icon from './Icon.vue'
import { clients, closeModal, renameClients, toastUndo, fail, openClient } from '../store.js'
import { fmt0, shortDate } from '../lib/format.js'
import { looseKey, findDuplicates } from '../lib/stats.js'

const props = defineProps({
  client: { type: Object, required: true },
  with: { type: Array, default: () => [] }, // preselected clients to merge with
  mode: { type: String, default: 'merge' }, // 'merge' | 'rename'
})

const renaming = props.mode === 'rename'
const selected = ref([...props.with])
const query = ref('')
const choice = ref(props.client.name)
const custom = ref(renaming ? props.client.name : '')
const saving = ref(false)

const alsoSuggested = computed(() => {
  const k = looseKey(props.client.name)
  return findDuplicates(clients.value).find((g) => g.some((c) => c.key === props.client.key))?.filter((c) => c.key !== props.client.key && !selected.value.some((s) => s.key === c.key)) || []
})
const results = computed(() => {
  const q = looseKey(query.value)
  if (!q) return alsoSuggested.value
  return clients.value
    .filter((c) => c.key !== props.client.key && !selected.value.some((s) => s.key === c.key) && looseKey(c.name).includes(q))
    .sort((a, b) => a.daysSince - b.daysSince)
    .slice(0, 8)
})

const everyone = computed(() => [props.client, ...selected.value])
const names = computed(() => [...new Set(everyone.value.map((c) => c.name))])
const finalName = computed(() => (renaming || choice.value === '__custom' ? custom.value : choice.value).trim())
const visits = computed(() => everyone.value.reduce((s, c) => s + c.history.length, 0))

async function save() {
  if (!finalName.value) return
  saving.value = true
  try {
    const ids = everyone.value.flatMap((c) => c.history.map((v) => v.id))
    const others = selected.value.map((c) => `"${c.name}"`).join(', ')
    const summary = renaming
      ? `Renamed client "${props.client.name}" to "${finalName.value}"`
      : `Merged ${others} with "${props.client.name}" as "${finalName.value}" (${visits.value} visits)`
    await renameClients(ids, finalName.value, summary)
    toastUndo(renaming ? 'Client renamed' : 'Clients merged')
    const merged = clients.value.find((c) => c.name === finalName.value)
    if (merged) openClient(merged)
    else closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="renaming ? 'Rename client' : 'Merge clients'" @close="closeModal">
    <template v-if="renaming">
      <div class="field">
        <label for="f-rename">Name</label>
        <input id="f-rename" v-model="custom" autocapitalize="words">
      </div>
      <p class="muted-note" style="margin-top: 0 !important">Changes the name on all {{ client.history.length }} of her appointments.</p>
    </template>

    <template v-else>
      <p style="margin: -8px 0 12px; color: var(--ink-2); font-size: 14px">
        Is the same person listed twice? Pick the other name(s) — all their visits will be joined under one name.
      </p>

      <div class="merge-picked">
        <div v-for="c in everyone" :key="c.key" class="merge-chip">
          <b>{{ c.name }}</b> <span>{{ c.history.length }} visits · last {{ shortDate(c.last) }}</span>
          <button v-if="c !== client" class="icon-btn" aria-label="Remove" @click="selected = selected.filter((s) => s.key !== c.key)"><Icon name="close" :size="16" /></button>
        </div>
      </div>

      <label class="search" style="margin-top: 12px">
        <Icon name="search" />
        <input v-model="query" placeholder="Find the other client…" aria-label="Find a client to merge with">
      </label>
      <div v-if="results.length" class="list" style="margin-bottom: 8px">
        <div v-if="!query" class="muted-note" style="margin: 0 0 4px !important">Looks similar:</div>
        <button v-for="c in results" :key="c.key" class="list-row" @click="selected.push(c); query = ''">
          <Icon name="plus" :size="18" />
          <div class="grow"><div class="title">{{ c.name }}</div><div class="meta">{{ c.visits }} visits · last {{ shortDate(c.last) }} · {{ fmt0(c.spend) }}</div></div>
        </button>
      </div>

      <template v-if="selected.length">
        <div class="field" style="margin-top: 14px">
          <label>Which name should we keep?</label>
          <div class="radio-list">
            <label v-for="n in names" :key="n"><input v-model="choice" type="radio" :value="n"> {{ n }}</label>
            <label><input v-model="choice" type="radio" value="__custom"> Something else:
              <input v-model="custom" class="inline-input" placeholder="Type the name" @focus="choice = '__custom'">
            </label>
          </div>
        </div>
      </template>
    </template>

    <div class="modal-actions">
      <button class="btn ghost" @click="closeModal">Cancel</button>
      <button class="btn" :disabled="saving || !finalName || (!renaming && !selected.length)" @click="save">
        {{ renaming ? 'Save name' : `Merge ${visits} visits` }}
      </button>
    </div>
  </BaseModal>
</template>
