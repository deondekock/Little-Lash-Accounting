<script setup>
/** Client name field with suggestions from past clients (recent regulars first). */
import { computed, ref } from 'vue'
import { clients, employeeById } from '../store.js'
import { fmt0, shortDate } from '../lib/format.js'
import { looseKey } from '../lib/stats.js'

const model = defineModel({ type: String, default: '' })
const emit = defineEmits(['pick'])
defineProps({ id: String })

const open = ref(false)
const active = ref(0)

const suggestions = computed(() => {
  const q = looseKey(model.value || '')
  if (!q) return []
  const scored = []
  for (const c of clients.value) {
    const k = looseKey(c.name)
    const pos = k.indexOf(q)
    if (pos < 0) continue
    // starts-with first, then most recent visit
    scored.push({ c, rank: (pos === 0 ? 0 : 1) * 1e6 + Math.max(0, c.daysSince) })
  }
  return scored.sort((a, b) => a.rank - b.rank).slice(0, 6).map((s) => s.c)
})
const exact = computed(() => suggestions.value.length === 1 && suggestions.value[0].name === model.value)
const show = computed(() => open.value && suggestions.value.length && !exact.value)

function pick(c) {
  model.value = c.name
  open.value = false
  emit('pick', c)
}
function onKey(e) {
  if (!show.value) return
  if (e.key === 'ArrowDown') { active.value = (active.value + 1) % suggestions.value.length; e.preventDefault() }
  else if (e.key === 'ArrowUp') { active.value = (active.value - 1 + suggestions.value.length) % suggestions.value.length; e.preventDefault() }
  else if (e.key === 'Enter') { pick(suggestions.value[active.value]); e.preventDefault() }
  else if (e.key === 'Escape') { open.value = false; e.stopPropagation() }
}
</script>

<template>
  <div class="suggest">
    <input :id="id" v-model="model" placeholder="Start typing a name…" autocomplete="off" autocapitalize="words"
           role="combobox" :aria-expanded="!!show" aria-autocomplete="list"
           @focus="open = true" @input="open = true; active = 0" @blur="open = false" @keydown="onKey">
    <ul v-if="show" class="suggest-list" role="listbox">
      <li v-for="(c, i) in suggestions" :key="c.key" role="option" :aria-selected="i === active" :class="{ active: i === active }"
          @mousedown.prevent="pick(c)">
        <div class="grow">
          <div class="s-name">{{ c.name }}</div>
          <div class="s-meta">{{ c.visits }} visit{{ c.visits === 1 ? '' : 's' }} · last {{ shortDate(c.last) }}<template v-if="employeeById(c.staffId)"> · {{ employeeById(c.staffId).name }}</template></div>
        </div>
        <div class="s-right">{{ fmt0(c.history[0]?.amount) }}<small v-if="c.history[0]?.service">{{ c.history[0].service }}</small></div>
      </li>
    </ul>
  </div>
</template>
