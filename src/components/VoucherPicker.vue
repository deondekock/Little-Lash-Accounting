<script setup>
/** Pick a gift voucher to pay with: type a code, buyer or note; each match shows what's left on it. */
import { computed, ref, watch } from 'vue'
import { liveVouchers } from '../store.js'
import { fmt } from '../lib/format.js'
import { looseKey } from '../lib/stats.js'

const model = defineModel({ type: String, default: '' }) // the voucher id
const emit = defineEmits(['pick'])
const query = ref('')
const open = ref(false)
const active = ref(0)

const label = (v) => `${v.code}${v.buyer ? ' · ' + v.buyer : ''}`
const exp = (v) => (v.expiresOn ? `exp ${v.expiresOn.slice(8)}/${v.expiresOn.slice(5, 7)}/${v.expiresOn.slice(2, 4)}` : '')
const chosen = computed(() => liveVouchers.value.find((v) => v.id === model.value) || null)
// The box shows the chosen voucher; typing again un-picks it but must keep what she typed.
watch(chosen, (v) => { if (v) query.value = label(v) }, { immediate: true })

const suggestions = computed(() => {
  const q = looseKey(query.value)
  const all = liveVouchers.value
  if (!q || (chosen.value && query.value === label(chosen.value))) return all.slice(0, 8)
  return all.filter((v) => looseKey(`${v.code} ${v.buyer} ${v.note}`).includes(q)).slice(0, 8)
})
const show = computed(() => open.value && suggestions.value.length > 0)

function pick(v) {
  model.value = v.id
  query.value = label(v)
  open.value = false
  emit('pick', v)
}
function onInput() {
  open.value = true
  active.value = 0
  if (chosen.value && query.value !== label(chosen.value)) model.value = '' // typing again un-picks it
}
function onBlur() {
  open.value = false
  if (chosen.value) query.value = label(chosen.value)
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
  <div class="suggest voucher-picker">
    <input v-model="query" placeholder="Voucher code, who bought it, or note…" autocomplete="off"
           role="combobox" :aria-expanded="show" aria-autocomplete="list" aria-label="Voucher"
           :class="{ picked: !!chosen }"
           @focus="open = true; $event.target.select()" @input="onInput" @blur="onBlur" @keydown="onKey">
    <ul v-if="show" class="suggest-list" role="listbox">
      <li v-for="(v, i) in suggestions" :key="v.id" role="option" :aria-selected="i === active" :class="{ active: i === active }" @mousedown.prevent="pick(v)">
        <div class="grow">
          <div class="s-name">{{ v.code }}<template v-if="v.buyer"> · {{ v.buyer }}</template></div>
          <div class="s-meta">{{ [v.note, exp(v)].filter(Boolean).join(' · ') || ' ' }}</div>
        </div>
        <div class="s-right">{{ fmt(v.balance) }}<small>left</small></div>
      </li>
    </ul>
    <div v-if="chosen" class="field-hint" style="margin: 4px 0 8px">{{ fmt(chosen.balance) }} left on {{ chosen.code }}<template v-if="exp(chosen)"> · {{ exp(chosen) }}</template></div>
    <div v-else-if="!liveVouchers.length" class="field-hint" style="margin: 4px 0 8px">No vouchers with money on them.</div>
  </div>
</template>
