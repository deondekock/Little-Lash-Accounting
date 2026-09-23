<script setup>
/** Join several service names into one (past appointments are updated; undoable). */
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import Icon from './Icon.vue'
import { serviceCatalog, closeModal, mergeServices, toastUndo, fail } from '../store.js'
import { looseKey, findServiceDuplicates } from '../lib/stats.js'

const props = defineProps({ service: { type: Object, required: true }, with: { type: Array, default: () => [] } })
const selected = ref([...props.with])
const query = ref('')
const choice = ref(props.service.name)
const custom = ref('')
const saving = ref(false)

const everyone = computed(() => [props.service, ...selected.value])
const chosenKeys = computed(() => new Set(everyone.value.map((s) => s.key)))
const suggested = computed(() => findServiceDuplicates(serviceCatalog.value).find((g) => g.some((s) => s.key === props.service.key))?.filter((s) => !chosenKeys.value.has(s.key)) || [])
const results = computed(() => {
  const q = looseKey(query.value)
  if (!q) return suggested.value
  return serviceCatalog.value.filter((s) => !chosenKeys.value.has(s.key) && looseKey(s.name).includes(q)).sort((a, b) => b.count - a.count).slice(0, 8)
})
const names = computed(() => [...new Set(everyone.value.map((s) => s.name))])
const finalName = computed(() => (choice.value === '__custom' ? custom.value : choice.value).trim())
const total = computed(() => everyone.value.reduce((n, s) => n + s.count, 0))

async function save() {
  saving.value = true
  try {
    const from = everyone.value.flatMap((s) => [s.name, ...s.spellings])
    await mergeServices(from, finalName.value, `Merged services ${names.value.map((n) => `"${n}"`).join(', ')} into "${finalName.value}"`)
    toastUndo('Services merged')
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="Merge services" @close="closeModal">
    <p style="margin: -8px 0 12px; color: var(--ink-2); font-size: 14px">Same service under different names? Pick them and choose the name to keep.</p>
    <div class="merge-picked">
      <div v-for="s in everyone" :key="s.key" class="merge-chip">
        <b>{{ s.name }}</b> <span>{{ s.count }}×</span>
        <button v-if="s !== service" class="icon-btn" aria-label="Remove" @click="selected = selected.filter((x) => x.key !== s.key)"><Icon name="close" :size="16" /></button>
      </div>
    </div>
    <label class="search" style="margin-top: 12px">
      <Icon name="search" />
      <input v-model="query" placeholder="Find another service…" aria-label="Find a service to merge with">
    </label>
    <div v-if="results.length" class="list" style="margin-bottom: 8px">
      <div v-if="!query" class="muted-note" style="margin: 0 0 4px !important">Looks similar:</div>
      <button v-for="s in results" :key="s.key" class="list-row" @click="selected.push(s); query = ''">
        <Icon name="plus" :size="18" />
        <div class="grow"><div class="title">{{ s.name }}</div><div class="meta">{{ s.count }}× · {{ s.inList ? 'on your list' : 'used before' }}</div></div>
      </button>
    </div>
    <div v-if="selected.length" class="field" style="margin-top: 14px">
      <label>Which name should we keep?</label>
      <div class="radio-list">
        <label v-for="n in names" :key="n"><input v-model="choice" type="radio" :value="n"> {{ n }}</label>
        <label><input v-model="choice" type="radio" value="__custom"> Something else:
          <input v-model="custom" class="inline-input" placeholder="Type the name" @focus="choice = '__custom'">
        </label>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" @click="closeModal">Cancel</button>
      <button class="btn" :disabled="saving || !finalName || !selected.length" @click="save">Merge {{ total }} uses</button>
    </div>
  </BaseModal>
</template>
