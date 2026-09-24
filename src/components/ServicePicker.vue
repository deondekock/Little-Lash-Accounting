<script setup>
/**
 * Multi-select for services. Stored as one text value joined with " + ".
 * Suggestions come from her service list first, then services used on past visits.
 */
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { serviceCatalog } from '../store.js'
import { fmt0 } from '../lib/format.js'
import { looseKey, servicePrice } from '../lib/stats.js'
import { splitServices, joinServices, serviceKey } from '../lib/services.js'

const model = defineModel({ type: String, default: '' })
const props = defineProps({ id: String, employeeId: String })

const query = ref('')
const open = ref(false)
const active = ref(0)
const input = ref(null)

const selected = computed(() => splitServices(model.value))
const selectedKeys = computed(() => new Set(selected.value.map(serviceKey)))

// Her list (active) first, then past services by how often they were done.
const ranked = computed(() =>
  serviceCatalog.value
    .filter((s) => s.active && !selectedKeys.value.has(s.key))
    .sort((a, b) => (b.inList - a.inList) || b.count - a.count),
)
const popular = computed(() => ranked.value.slice(0, 8))
const matches = computed(() => {
  const q = looseKey(query.value)
  if (!q) return []
  const hits = ranked.value.filter((s) => looseKey(s.name).includes(q))
  return hits.sort((a, b) => (looseKey(b.name).startsWith(q) - looseKey(a.name).startsWith(q))).slice(0, 7)
})
const canAddNew = computed(() => query.value.trim() && !serviceCatalog.value.some((s) => s.key === serviceKey(query.value)))

function add(name, keepFocus = true) {
  model.value = joinServices([...selected.value, name])
  query.value = ''
  active.value = 0
  if (keepFocus) input.value?.focus()
}
/** Text still typed in the box when the form is saved counts as a service. */
function commit() {
  if (!query.value.trim()) return
  const match = serviceCatalog.value.find((s) => s.key === serviceKey(query.value))
  add(match ? match.name : query.value.trim(), false)
}
defineExpose({ commit })
function remove(name) {
  model.value = joinServices(selected.value.filter((s) => s !== name))
}
function onKey(e) {
  const list = matches.value
  if (e.key === 'ArrowDown' && list.length) { active.value = (active.value + 1) % list.length; e.preventDefault() }
  else if (e.key === 'ArrowUp' && list.length) { active.value = (active.value - 1 + list.length) % list.length; e.preventDefault() }
  else if (e.key === 'Enter') {
    e.preventDefault()
    if (list[active.value]) add(list[active.value].name)
    else if (query.value.trim()) add(query.value.trim())
  } else if (e.key === 'Backspace' && !query.value && selected.value.length) remove(selected.value[selected.value.length - 1])
  else if (e.key === 'Escape') { open.value = false; e.stopPropagation() }
}
const priceOf = (s) => servicePrice(s, props.employeeId)
</script>

<template>
  <div class="suggest">
    <div class="multi" @click="input?.focus()">
      <span v-for="s in selected" :key="s" class="svc-chip">
        {{ s }}
        <button type="button" :aria-label="`Remove ${s}`" @click.stop="remove(s)"><Icon name="close" :size="13" :stroke="2.4" /></button>
      </span>
      <input :id="id" ref="input" v-model="query" :placeholder="selected.length ? 'Add another…' : 'Type or pick below…'" autocomplete="off"
             role="combobox" :aria-expanded="open && !!matches.length" aria-autocomplete="list"
             @focus="open = true" @input="open = true; active = 0" @blur="open = false" @keydown="onKey">
    </div>
    <ul v-if="open && (matches.length || canAddNew)" class="suggest-list" role="listbox">
      <li v-for="(s, i) in matches" :key="s.key" role="option" :aria-selected="i === active" :class="{ active: i === active }" @mousedown.prevent="add(s.name)">
        <div class="grow">
          <div class="s-name">{{ s.name }}</div>
          <div class="s-meta">{{ s.inList ? 'On your list' : 'Used before' }} · {{ s.count }} time{{ s.count === 1 ? '' : 's' }}</div>
        </div>
        <div v-if="priceOf(s) != null" class="s-right">{{ fmt0(priceOf(s)) }}</div>
      </li>
      <li v-if="canAddNew" @mousedown.prevent="add(query.trim())">
        <Icon name="plus" :size="16" /><div class="grow"><div class="s-name">Add "{{ query.trim() }}"</div></div>
      </li>
    </ul>
    <div v-if="!query && popular.length" class="quick-picks">
      <button v-for="s in popular" :key="s.key" type="button" class="chip small" @click="add(s.name)">
        <Icon name="plus" :size="13" :stroke="2.4" />{{ s.name }}
      </button>
    </div>
  </div>
</template>
