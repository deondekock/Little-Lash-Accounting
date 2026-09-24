<script setup>
/** Add a service to her list, or edit one (name, price, show/hide). Past names can be adopted into the list. */
import { computed, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { state, closeModal, saveService, openServiceMerge, toastUndo, fail, employeeColor } from '../store.js'
import { fmt0 } from '../lib/format.js'

const props = defineProps({ service: Object })
const s = props.service
const inList = !!s?.inList
const adopting = !!s && !inList
const form = reactive({
  name: s?.name || '',
  price: s?.price ?? (adopting && s.typical != null ? s.typical : ''),
  status: s && !s.active ? 'Hidden' : 'Shown',
  prices: { ...(s?.prices || {}) },
})
// Everyone active, plus anyone who already has a price set for this service.
const team = computed(() => state.employees.filter((e) => e.active || form.prices[e.id] != null))
const hint = (e) => {
  const usual = s?.typicalBy?.[e.id]
  const base = form.price !== '' && form.price != null ? `Same as above (${fmt0(form.price)})` : 'No price'
  return usual != null ? `${base} · usually ${fmt0(usual)}` : base
}
const saving = ref(false)
const title = computed(() => (inList ? 'Edit service' : adopting ? 'Add to your list' : 'New service'))
const renames = computed(() => s && form.name.trim() && form.name.trim() !== s.name && s.count)

async function save() {
  saving.value = true
  try {
    await saveService({
      id: inList ? s.id : undefined,
      name: form.name,
      price: form.price,
      prices: form.prices,
      active: form.status === 'Shown',
      fromNames: adopting ? s.spellings : undefined,
    })
    toastUndo(inList ? 'Service saved' : 'Service added')
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="title" @close="closeModal">
    <p v-if="s" style="margin: -8px 0 14px; color: var(--muted); font-size: 13.5px">
      Done {{ s.count }} time{{ s.count === 1 ? '' : 's' }}<template v-if="s.typical != null"> · usually {{ fmt0(s.typical) }}</template><template v-if="s.revenue"> · {{ fmt0(s.revenue) }} in total</template>
    </p>
    <form @submit.prevent="save">
      <div class="field">
        <label for="svc-name">Name</label>
        <input id="svc-name" v-model="form.name" required autocapitalize="sentences" placeholder="e.g. Volume lash fill">
        <div v-if="renames" class="field-hint">This also renames it on {{ s.count }} past appointment{{ s.count === 1 ? '' : 's' }}.</div>
      </div>
      <div class="field">
        <label for="svc-price">Price for anyone (R)</label>
        <input id="svc-price" v-model="form.price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Optional">
      </div>
      <div v-if="team.length" class="field">
        <label>Price per team member <span style="font-weight: 500; color: var(--muted)">— only if she charges differently</span></label>
        <div class="team-prices">
          <div v-for="e in team" :key="e.id" class="team-price">
            <span class="who"><i class="swatch-dot" :style="{ background: employeeColor(e.id) }" />{{ e.name }}</span>
            <input v-model="form.prices[e.id]" type="number" inputmode="decimal" step="0.01" min="0" :placeholder="hint(e)" :aria-label="`Price for ${e.name}`">
          </div>
        </div>
      </div>
      <div v-if="inList" class="field">
        <label>In the appointment form</label>
        <SegmentedControl v-model="form.status" :options="['Shown', 'Hidden']" />
      </div>
      <div class="modal-actions">
        <button v-if="s" type="button" class="btn ghost" @click="openServiceMerge(s)">Merge…</button>
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">{{ inList ? 'Save' : 'Add' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
